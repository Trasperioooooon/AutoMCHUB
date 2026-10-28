package web

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"minedeck/internal/app"
	"minedeck/internal/autostart"
	"minedeck/internal/update"
)

// OnShutdown 由 main 注入：前端「退出程序」按钮触发（浏览器回退模式下唯一的退出途径）。
var OnShutdown func()

// publicConfig 返回可下发给前端的配置副本：抹去访问密码哈希（是否已设密码由 lanSet 告知）。
// 凡是把配置写进响应的处理器都必须经由此函数，不得直接下发 app.GetConfig()。
func publicConfig() app.Config {
	cfg := app.GetConfig()
	cfg.AccessPasswordHash = "" // 不下发哈希
	return cfg
}

func (s *Server) handleApp(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{
		"version":     app.Version,
		"base":        app.Base,
		"ramMb":       app.TotalRAMMB(),
		"availRamMb":  app.AvailRAMMB(),
		"port":        s.port,
		"serversRoot": app.ServersRoot(),
		"backupsRoot": app.BackupsRoot(),
		"config":      publicConfig(),
		"lanSet":      app.GetConfig().AccessPasswordHash != "",
		"autoStart":   autostart.Enabled(), // 开机自启真值以注册表为准
		"ips":         localIPs(),
	})
}

func localIPs() []string {
	var out []string
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return out
	}
	for _, a := range addrs {
		if ipn, ok := a.(*net.IPNet); ok && !ipn.IP.IsLoopback() && ipn.IP.To4() != nil {
			out = append(out, ipn.IP.String())
		}
	}
	return out
}

var bgExt = map[string]string{
	".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
	".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif", ".bmp": "image/bmp",
}

func bgDir() string { return filepath.Join(app.Base, "bg") }

// handleBGList 列出 bg/ 目录内的图片文件名（前端随机取一张作背景）。
func (s *Server) handleBGList(w http.ResponseWriter, r *http.Request) {
	var imgs []string
	if ents, err := os.ReadDir(bgDir()); err == nil {
		for _, e := range ents {
			if e.IsDir() {
				continue
			}
			if _, ok := bgExt[strings.ToLower(filepath.Ext(e.Name()))]; ok {
				imgs = append(imgs, e.Name())
			}
		}
	}
	if imgs == nil {
		imgs = []string{}
	}
	writeJSON(w, map[string]any{"images": imgs})
}

// handleBGImage 提供 bg/ 目录内的单张图片（filepath.Base 去除路径成分防穿越）。
func (s *Server) handleBGImage(w http.ResponseWriter, r *http.Request) {
	name := filepath.Base(r.PathValue("name"))
	ct, ok := bgExt[strings.ToLower(filepath.Ext(name))]
	if !ok {
		http.NotFound(w, r)
		return
	}
	f, err := os.Open(filepath.Join(bgDir(), name))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || st.IsDir() {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Cache-Control", "max-age=3600")
	http.ServeContent(w, r, name, st.ModTime(), f)
}

func (s *Server) handleShutdown(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, "ok")
	if OnShutdown != nil {
		go func() {
			time.Sleep(300 * time.Millisecond)
			OnShutdown()
		}()
	}
}

func (s *Server) handleSetConfig(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Source             *string `json:"source"`
		CFApiKey           *string `json:"cfApiKey"`
		WebhookURL         *string `json:"webhookUrl"`
		UpdateRepo         *string `json:"updateRepo"`
		CheckUpdateOnStart *bool   `json:"checkUpdateOnStart"`
		ServersDir         *string `json:"serversDir"`
		BackupsDir         *string `json:"backupsDir"`
		BackupKeep         *int    `json:"backupKeep"`
		Onboarded          *bool   `json:"onboarded"`
		TosAccepted        *bool   `json:"tosAccepted"`
		MinimizeToTray     *bool   `json:"minimizeToTray"`
		AutoStart          *bool   `json:"autoStart"`
		ListenLAN          *bool   `json:"listenLan"`
		LanPassword        *string `json:"lanPassword"` // 明文仅在本次请求中出现，存储为 bcrypt 哈希
		ChromeColor        *string `json:"chromeColor"` // 界面标题栏底色 #rrggbb（下次启动时 WebView2 的默认底色）；空串清除
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, err)
		return
	}
	// 存放 / 备份目录决定之后实例与备份写到主机何处（下方还会 MkdirAll）：与创建实例的 root 同理仅限本机，
	// 远程 / 局域网请求带这两个键（含置空恢复默认）即整次拒绝，其余键不受影响
	if (body.ServersDir != nil || body.BackupsDir != nil) && !isLoopbackReq(r) {
		writeErr(w, 403, fmt.Errorf("存放目录仅支持在本机修改"))
		return
	}
	// 可失败的校验与 I/O（建目录、算哈希）在锁外先做完，锁内只做字段套用
	if body.WebhookURL != nil {
		u := strings.TrimSpace(*body.WebhookURL)
		if u != "" && !strings.HasPrefix(u, "http://") && !strings.HasPrefix(u, "https://") {
			writeErr(w, 400, fmt.Errorf("Webhook 地址需以 http(s):// 开头"))
			return
		}
	}
	var chromeColor string
	if body.ChromeColor != nil && *body.ChromeColor != "" {
		c, ok := app.ParseHexColor(*body.ChromeColor)
		if !ok {
			writeErr(w, 400, fmt.Errorf("chromeColor 须为 #rrggbb 形式的颜色"))
			return
		}
		chromeColor = c
	}
	if body.ServersDir != nil {
		if d := strings.TrimSpace(*body.ServersDir); d != "" {
			if err := os.MkdirAll(d, 0o755); err != nil {
				writeErr(w, 400, fmt.Errorf("存放目录不可用: %w", err))
				return
			}
		}
	}
	if body.BackupsDir != nil {
		if d := strings.TrimSpace(*body.BackupsDir); d != "" {
			if err := os.MkdirAll(d, 0o755); err != nil {
				writeErr(w, 400, fmt.Errorf("备份目录不可用: %w", err))
				return
			}
		}
	}
	var newPassHash string
	if body.LanPassword != nil && *body.LanPassword != "" {
		h, err := bcrypt.GenerateFromPassword([]byte(*body.LanPassword), bcrypt.DefaultCost)
		if err != nil { // 超出 bcrypt 72 字节上限等
			writeErr(w, 400, fmt.Errorf("密码不可用（最长 72 字节）: %w", err))
			return
		}
		newPassHash = string(h)
	}
	// 读-改-写在 UpdateConfig 的锁内一次完成，避免并发保存互相丢字段
	if _, err := app.UpdateConfig(func(c *app.Config) error {
		if body.Source != nil {
			c.Source = *body.Source
		}
		if body.CFApiKey != nil {
			c.CFApiKey = strings.TrimSpace(*body.CFApiKey)
		}
		if body.WebhookURL != nil {
			c.WebhookURL = strings.TrimSpace(*body.WebhookURL)
		}
		if body.UpdateRepo != nil {
			c.UpdateRepo = strings.TrimSpace(*body.UpdateRepo)
		}
		if body.CheckUpdateOnStart != nil {
			c.CheckUpdateOnStart = *body.CheckUpdateOnStart
		}
		if body.ServersDir != nil {
			c.ServersDir = strings.TrimSpace(*body.ServersDir) // 旧值由 UpdateConfig 并入 Roots，旧实例照常扫描
		}
		if body.BackupsDir != nil {
			c.BackupsDir = strings.TrimSpace(*body.BackupsDir) // 旧值由 UpdateConfig 并入 BackupRoots，旧备份照常可用
		}
		if body.BackupKeep != nil {
			k := *body.BackupKeep
			if k < 1 {
				k = 1
			} else if k > 1000 {
				k = 1000
			}
			c.BackupKeep = k
		}
		if body.Onboarded != nil {
			c.Onboarded = *body.Onboarded
		}
		if body.TosAccepted != nil {
			c.TosAccepted = *body.TosAccepted
		}
		if body.MinimizeToTray != nil {
			c.MinimizeToTray = *body.MinimizeToTray
		}
		if newPassHash != "" {
			c.AccessPasswordHash = newPassHash
		}
		if body.ChromeColor != nil {
			c.ChromeColor = chromeColor
		}
		if body.ListenLAN != nil {
			if *body.ListenLAN && c.AccessPasswordHash == "" {
				return fmt.Errorf("开启局域网访问前请先设置访问密码")
			}
			c.ListenLAN = *body.ListenLAN
		}
		return nil
	}); err != nil {
		writeErr(w, 400, err)
		return
	}
	// 开机自启是注册表副作用（不落 config.json）：放在所有校验与配置保存成功之后再执行，
	// 避免上面任一校验失败提前 return 时已经改动了注册表（否则会「报错却已悄悄改了自启」）
	if body.AutoStart != nil {
		if err := autostart.Set(*body.AutoStart); err != nil {
			writeErr(w, 500, fmt.Errorf("设置开机自启失败: %w", err))
			return
		}
	}
	writeJSON(w, publicConfig())
}

func (s *Server) handleUpdateCheck(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	rel, has, err := update.Check(ctx, app.GetConfig().UpdateRepo)
	if err != nil {
		writeErr(w, 502, err)
		return
	}
	writeJSON(w, map[string]any{"current": app.Version, "latest": rel, "hasUpdate": has})
}

func (s *Server) handleUpdateApply(w http.ResponseWriter, r *http.Request) {
	// 防止换血期间新旧进程并发管理同一存档
	for _, i := range s.mgr.List() {
		if i.Status() != "stopped" {
			writeErr(w, 400, fmt.Errorf("实例「%s」仍在运行，请先停止所有服务器再更新", i.Name))
			return
		}
	}
	ctx := context.Background() // 独立于请求生命周期
	rel, has, err := update.Check(ctx, app.GetConfig().UpdateRepo)
	if err != nil {
		writeErr(w, 502, err)
		return
	}
	if !has {
		writeErr(w, 400, fmt.Errorf("已是最新版本"))
		return
	}
	if err := update.Apply(ctx, rel); err != nil {
		writeErr(w, 502, err)
		return
	}
	writeJSON(w, "updating")
	if OnShutdown != nil {
		go func() {
			time.Sleep(500 * time.Millisecond)
			OnShutdown()
		}()
	}
}
