// Package web 提供本地 HTTP API 与内嵌 GUI 静态资源。
// 安全措施：仅绑定 127.0.0.1、Host 头校验、API 需随机 Token（防跨站请求）。
package web

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"automchub/internal/app"
	"automchub/internal/autostart"
	"automchub/internal/inst"
	"automchub/internal/java"
	"automchub/internal/mcsrc"
	"automchub/internal/modpack"
	"automchub/internal/procutil"
	"automchub/internal/tunnel"
	"automchub/internal/update"
)

//go:embed ui
var uiFS embed.FS

// Token 每次启动随机生成，通过启动 URL 传入前端。
var Token = func() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}()

// sessionValue 局域网登录会话值（每次启动随机，重启后需重新登录）。
var sessionValue = func() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}()

// OnShutdown 由 main 注入：前端「退出程序」按钮触发（浏览器回退模式下唯一的退出途径）。
var OnShutdown func()

type Server struct {
	mgr  *inst.Manager
	tun  *tunnel.Manager
	port int // 实际监听端口（由 main 注入，只读；被占用时可能与默认端口不同）
}

func New(mgr *inst.Manager, tun *tunnel.Manager, port int) http.Handler {
	s := &Server{mgr: mgr, tun: tun, port: port}
	mux := http.NewServeMux()

	sub, _ := fs.Sub(uiFS, "ui")
	fileServer := http.FileServer(http.FS(sub))
	mux.Handle("GET /", noCache(fileServer))
	mux.HandleFunc("GET /bg/{name}", s.handleBGImage) // 用户壁纸（程序旁 bg/ 目录），免 token 供 CSS url() 引用

	mux.HandleFunc("GET /api/app", s.handleApp)
	mux.HandleFunc("GET /api/bg", s.handleBGList)
	mux.HandleFunc("POST /api/pickdir", s.handlePickDir)
	mux.HandleFunc("POST /api/openpath", s.handleOpenPath)
	mux.HandleFunc("POST /api/login", s.handleLogin)
	mux.HandleFunc("POST /api/shutdown", s.handleShutdown)
	mux.HandleFunc("PUT /api/config", s.handleSetConfig)
	mux.HandleFunc("POST /api/update/check", s.handleUpdateCheck)
	mux.HandleFunc("POST /api/update/apply", s.handleUpdateApply)
	mux.HandleFunc("GET /api/instances/{name}/resources/search", s.handleResourceSearch)
	mux.HandleFunc("POST /api/instances/{name}/resources/install", s.handleResourceInstall)
	mux.HandleFunc("GET /api/cores", s.handleCores)
	mux.HandleFunc("GET /api/mcversions", s.handleMCVersions)
	mux.HandleFunc("GET /api/builds", s.handleBuilds)
	mux.HandleFunc("GET /api/javas", s.handleJavas)
	mux.HandleFunc("POST /api/javas/scan", s.handleJavaScan)
	mux.HandleFunc("POST /api/javas/add", s.handleJavaAdd)

	mux.HandleFunc("GET /api/instances", s.handleListInstances)
	mux.HandleFunc("POST /api/instances", s.handleCreateInstance)
	mux.HandleFunc("POST /api/import/modpack", s.handleImportModpack)
	mux.HandleFunc("GET /api/tasks/{id}", s.handleTask)

	mux.HandleFunc("GET /api/instances/{name}/backups", s.handleListBackups)
	mux.HandleFunc("POST /api/instances/{name}/backups", s.handleCreateBackup)
	mux.HandleFunc("POST /api/instances/{name}/backups/restore", s.handleRestoreBackup)
	mux.HandleFunc("DELETE /api/instances/{name}/backups", s.handleDeleteBackup)
	mux.HandleFunc("GET /api/instances/{name}/players", s.handleGetPlayers)
	mux.HandleFunc("POST /api/instances/{name}/players", s.handlePlayerAction)
	mux.HandleFunc("GET /api/instances/{name}/policies", s.handleGetPolicies)
	mux.HandleFunc("PUT /api/instances/{name}/policies", s.handleSetPolicies)

	mux.HandleFunc("GET /api/tunnels", s.handleListTunnels)
	mux.HandleFunc("POST /api/tunnels", s.handleAddTunnel)
	mux.HandleFunc("PUT /api/tunnels/{id}", s.handleUpdateTunnel)
	mux.HandleFunc("DELETE /api/tunnels/{id}", s.handleDeleteTunnel)
	mux.HandleFunc("POST /api/tunnels/{id}/start", s.handleTunnelStart)
	mux.HandleFunc("POST /api/tunnels/{id}/stop", s.handleTunnelStop)
	mux.HandleFunc("GET /api/tunnels/{id}/console", s.handleTunnelConsole)

	mux.HandleFunc("POST /api/instances/{name}/start", s.handleInstStart)
	mux.HandleFunc("POST /api/instances/{name}/stop", s.instAction((*inst.Manager).Stop))
	mux.HandleFunc("POST /api/instances/{name}/kill", s.instAction((*inst.Manager).Kill))
	mux.HandleFunc("POST /api/instances/{name}/opendir", s.handleOpenDir)
	mux.HandleFunc("POST /api/instances/{name}/command", s.handleCommand)
	mux.HandleFunc("DELETE /api/instances/{name}", s.handleDelete)
	mux.HandleFunc("GET /api/instances/{name}/console", s.handleConsole)
	mux.HandleFunc("GET /api/instances/{name}/properties", s.handleGetProps)
	mux.HandleFunc("PUT /api/instances/{name}/properties", s.handleSetProps)
	mux.HandleFunc("PUT /api/instances/{name}/settings", s.handleSetSettings)

	return secure(mux)
}

// secure 校验 Host、API Token 或局域网会话 Cookie。
func secure(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		lan := app.GetConfig().ListenLAN && app.GetConfig().AccessPasswordHash != ""
		if !lan {
			host := r.Host
			if h, _, err := splitHostPort(host); err == nil {
				host = h
			}
			if host != "127.0.0.1" && host != "localhost" && host != "[::1]" && host != "::1" {
				http.Error(w, "forbidden host", http.StatusForbidden)
				return
			}
		}
		if strings.HasPrefix(r.URL.Path, "/api/") && r.URL.Path != "/api/login" {
			tok := r.Header.Get("X-Token")
			if tok == "" {
				tok = r.URL.Query().Get("token")
			}
			if tok != Token && !validSession(r) {
				writeErr(w, http.StatusUnauthorized, fmt.Errorf("需要登录"))
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func validSession(r *http.Request) bool {
	c, err := r.Cookie("amh_session")
	return err == nil && c.Value == sessionValue
}

// handleLogin 局域网访问的密码登录。
func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Password string `json:"password"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, err)
		return
	}
	hash := app.GetConfig().AccessPasswordHash
	if hash == "" {
		writeErr(w, 400, fmt.Errorf("未启用远程访问"))
		return
	}
	sum := sha256.Sum256([]byte(body.Password))
	if hex.EncodeToString(sum[:]) != hash {
		time.Sleep(700 * time.Millisecond) // 抑制暴力尝试
		writeErr(w, 401, fmt.Errorf("密码错误"))
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: "amh_session", Value: sessionValue,
		Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode,
	})
	writeJSON(w, "ok")
}

func splitHostPort(hp string) (string, string, error) {
	i := strings.LastIndex(hp, ":")
	if i < 0 {
		return hp, "", fmt.Errorf("no port")
	}
	return hp[:i], hp[i+1:], nil
}

func noCache(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "data": v})
}

func writeErr(w http.ResponseWriter, code int, err error) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": err.Error()})
}

func readJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(v)
}

// ---------- 基础信息 ----------

func (s *Server) handleApp(w http.ResponseWriter, r *http.Request) {
	cfg := app.GetConfig()
	cfg.AccessPasswordHash = "" // 不下发哈希
	writeJSON(w, map[string]any{
		"version":    app.Version,
		"base":       app.Base,
		"ramMb":      app.TotalRAMMB(),
		"availRamMb":  app.AvailRAMMB(),
		"port":        s.port,
		"serversRoot": app.ServersRoot(),
		"backupsRoot": app.BackupsRoot(),
		"config":      cfg,
		"lanSet":     app.GetConfig().AccessPasswordHash != "",
		"autoStart":  autostart.Enabled(), // 开机自启真值以注册表为准
		"ips":        localIPs(),
	})
}

// isLoopbackReq 判断请求是否来自本机（限制仅本机可弹系统对话框 / 开资源管理器）。
func isLoopbackReq(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if ip := net.ParseIP(host); ip != nil {
		return ip.IsLoopback()
	}
	return host == "localhost"
}

// handlePickDir 弹出系统文件夹选择对话框，返回所选目录（取消则 path 为空）。仅本机可用。
func (s *Server) handlePickDir(w http.ResponseWriter, r *http.Request) {
	if !isLoopbackReq(r) {
		writeErr(w, 403, fmt.Errorf("文件夹选择仅支持在本机操作（远程管理时请手动填写路径）"))
		return
	}
	path, err := pickFolder()
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, map[string]string{"path": path})
}

// handleOpenPath 在资源管理器中打开指定目录。仅本机可用。
func (s *Server) handleOpenPath(w http.ResponseWriter, r *http.Request) {
	if !isLoopbackReq(r) {
		writeErr(w, 403, fmt.Errorf("打开目录仅支持在本机操作"))
		return
	}
	var body struct {
		Path string `json:"path"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, err)
		return
	}
	p := filepath.Clean(strings.TrimSpace(body.Path))
	if st, err := os.Stat(p); err != nil || !st.IsDir() {
		writeErr(w, 400, fmt.Errorf("目录不存在"))
		return
	}
	_ = exec.Command("explorer.exe", p).Start()
	writeJSON(w, "ok")
}

// pickFolder 通过 PowerShell 调用系统 FolderBrowserDialog（-STA），返回所选目录。
func pickFolder() (string, error) {
	const ps = "Add-Type -AssemblyName System.Windows.Forms | Out-Null; " +
		"$f = New-Object System.Windows.Forms.FolderBrowserDialog; " +
		"$f.Description = 'Choose a folder for AutoMCHUB'; $f.ShowNewFolderButton = $true; " +
		"if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($f.SelectedPath) }"
	cmd := exec.Command("powershell", "-STA", "-NoProfile", "-NonInteractive", "-Command", ps)
	cmd.Env = procutil.CleanEnv()
	var out bytes.Buffer
	cmd.Stdout = &out
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("打开文件夹对话框失败: %w", err)
	}
	return strings.TrimSpace(out.String()), nil
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

// ---------- 壁纸个性化（程序旁 bg/ 目录） ----------

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
		Source      *string `json:"source"`
		CFApiKey    *string `json:"cfApiKey"`
		WebhookURL  *string `json:"webhookUrl"`
		UpdateRepo         *string `json:"updateRepo"`
		CheckUpdateOnStart *bool   `json:"checkUpdateOnStart"`
		ServersDir         *string `json:"serversDir"`
		BackupsDir         *string `json:"backupsDir"`
		BackupKeep         *int    `json:"backupKeep"`
		Onboarded          *bool   `json:"onboarded"`
		MinimizeToTray     *bool   `json:"minimizeToTray"`
		AutoStart          *bool   `json:"autoStart"`
		ListenLAN          *bool   `json:"listenLan"`
		LanPassword        *string `json:"lanPassword"` // 明文仅在本次请求中出现，存储为 SHA-256
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, err)
		return
	}
	c := app.GetConfig()
	if body.Source != nil {
		c.Source = *body.Source
	}
	if body.CFApiKey != nil {
		c.CFApiKey = strings.TrimSpace(*body.CFApiKey)
	}
	if body.WebhookURL != nil {
		u := strings.TrimSpace(*body.WebhookURL)
		if u != "" && !strings.HasPrefix(u, "http://") && !strings.HasPrefix(u, "https://") {
			writeErr(w, 400, fmt.Errorf("Webhook 地址需以 http(s):// 开头"))
			return
		}
		c.WebhookURL = u
	}
	if body.UpdateRepo != nil {
		c.UpdateRepo = strings.TrimSpace(*body.UpdateRepo)
	}
	if body.CheckUpdateOnStart != nil {
		c.CheckUpdateOnStart = *body.CheckUpdateOnStart
	}
	if body.ServersDir != nil {
		d := strings.TrimSpace(*body.ServersDir)
		if d != "" {
			if err := os.MkdirAll(d, 0o755); err != nil {
				writeErr(w, 400, fmt.Errorf("存放目录不可用: %w", err))
				return
			}
		}
		c.ServersDir = d
	}
	if body.BackupsDir != nil {
		d := strings.TrimSpace(*body.BackupsDir)
		if d != "" {
			if err := os.MkdirAll(d, 0o755); err != nil {
				writeErr(w, 400, fmt.Errorf("备份目录不可用: %w", err))
				return
			}
		}
		c.BackupsDir = d
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
	if body.MinimizeToTray != nil {
		c.MinimizeToTray = *body.MinimizeToTray
	}
	if body.AutoStart != nil {
		// 开机自启真值落在注册表（非 config.json），写失败即报错、不改其它配置
		if err := autostart.Set(*body.AutoStart); err != nil {
			writeErr(w, 500, fmt.Errorf("设置开机自启失败: %w", err))
			return
		}
	}
	if body.LanPassword != nil && *body.LanPassword != "" {
		sum := sha256.Sum256([]byte(*body.LanPassword))
		c.AccessPasswordHash = hex.EncodeToString(sum[:])
	}
	if body.ListenLAN != nil {
		if *body.ListenLAN && c.AccessPasswordHash == "" {
			writeErr(w, 400, fmt.Errorf("开启局域网访问前请先设置访问密码"))
			return
		}
		c.ListenLAN = *body.ListenLAN
	}
	app.SetConfig(c)
	writeJSON(w, app.GetConfig())
}

// ---------- 自动更新 ----------

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

// handleImportModpack 接收整合包上传（multipart）并启动导入任务。
func (s *Server) handleImportModpack(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 4<<30)
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		writeErr(w, 400, fmt.Errorf("上传解析失败: %w", err))
		return
	}
	file, hdr, err := r.FormFile("file")
	if err != nil {
		writeErr(w, 400, fmt.Errorf("缺少整合包文件"))
		return
	}
	defer file.Close()
	base := filepath.Base(hdr.Filename)
	if base == "" || base == "." {
		base = "modpack.zip"
	}
	dest := filepath.Join(app.CacheDir, "import", fmt.Sprintf("%d-%s", time.Now().UnixMilli(), base))
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		writeErr(w, 500, err)
		return
	}
	out, err := os.Create(dest)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	_, cerr := io.Copy(out, file)
	if werr := out.Close(); cerr == nil {
		cerr = werr
	}
	if cerr != nil {
		writeErr(w, 500, fmt.Errorf("保存上传文件失败: %w", cerr))
		return
	}
	pack, err := modpack.Parse(dest)
	if err != nil {
		os.Remove(dest)
		writeErr(w, 400, err)
		return
	}
	atoi := func(s string, def int) int {
		if n, err := strconv.Atoi(s); err == nil {
			return n
		}
		return def
	}
	req := inst.CreateReq{
		Name:        r.FormValue("name"),
		XmxMB:       atoi(r.FormValue("xmxMb"), 4096),
		Port:        atoi(r.FormValue("port"), 25565),
		EULA:        r.FormValue("eula") == "true",
		OnlineMode:  r.FormValue("onlineMode") == "true",
		AllowFlight: r.FormValue("allowFlight") == "true",
		MOTD:        r.FormValue("motd"),
		Root:        r.FormValue("root"),
	}
	id, err := s.mgr.ImportModpackAsync(pack, req, app.GetConfig().CFApiKey)
	if err != nil {
		os.Remove(dest)
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, map[string]any{
		"taskId": id,
		"pack":   map[string]any{"name": pack.Name, "mc": pack.MC, "core": pack.Core, "loader": pack.Loader, "files": len(pack.Files) + len(pack.CFRefs)},
	})
}

// ---------- 备份 ----------

func (s *Server) handleListBackups(w http.ResponseWriter, r *http.Request) {
	list, err := s.mgr.ListBackups(r.PathValue("name"))
	if err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, list)
}

func (s *Server) handleCreateBackup(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Label string `json:"label"`
	}
	_ = readJSON(r, &body)
	f, err := s.mgr.CreateBackup(r.PathValue("name"), body.Label)
	if err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, map[string]string{"file": f})
}

func (s *Server) handleRestoreBackup(w http.ResponseWriter, r *http.Request) {
	var body struct {
		File string `json:"file"`
	}
	if err := readJSON(r, &body); err != nil || body.File == "" {
		writeErr(w, 400, fmt.Errorf("缺少备份文件名"))
		return
	}
	if err := s.mgr.RestoreBackup(r.PathValue("name"), body.File); err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, "ok")
}

func (s *Server) handleDeleteBackup(w http.ResponseWriter, r *http.Request) {
	f := r.URL.Query().Get("file")
	if f == "" {
		writeErr(w, 400, fmt.Errorf("缺少备份文件名"))
		return
	}
	if err := s.mgr.DeleteBackup(r.PathValue("name"), f); err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, "ok")
}

// ---------- 玩家 ----------

func (s *Server) handleGetPlayers(w http.ResponseWriter, r *http.Request) {
	pl, err := s.mgr.GetPlayers(r.PathValue("name"))
	if err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, pl)
}

func (s *Server) handlePlayerAction(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Action string `json:"action"`
		Player string `json:"player"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, err)
		return
	}
	if err := s.mgr.PlayerAction(r.PathValue("name"), body.Action, body.Player); err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, "ok")
}

// ---------- 运维策略 ----------

func (s *Server) handleGetPolicies(w http.ResponseWriter, r *http.Request) {
	i, err := s.mgr.Get(r.PathValue("name"))
	if err != nil {
		writeErr(w, 404, err)
		return
	}
	p := i.PoliciesSnapshot()
	if p.Schedules == nil {
		p.Schedules = []inst.Schedule{}
	}
	writeJSON(w, p)
}

func (s *Server) handleSetPolicies(w http.ResponseWriter, r *http.Request) {
	var p inst.Policies
	if err := readJSON(r, &p); err != nil {
		writeErr(w, 400, err)
		return
	}
	if err := s.mgr.UpdatePolicies(r.PathValue("name"), p); err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, "ok")
}

func (s *Server) handleCores(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, mcsrc.Cores())
}

func (s *Server) handleMCVersions(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	core := mcsrc.Core(r.URL.Query().Get("core"))
	if !mcsrc.ValidCore(core) {
		writeErr(w, 400, fmt.Errorf("未知核心: %s", core))
		return
	}
	snapshots := r.URL.Query().Get("snapshots") == "1"
	vers, err := mcsrc.ListVersions(ctx, core, snapshots)
	if err != nil {
		writeErr(w, 502, err)
		return
	}
	writeJSON(w, vers)
}

func (s *Server) handleBuilds(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	core := mcsrc.Core(r.URL.Query().Get("core"))
	mc := r.URL.Query().Get("mc")
	if !mcsrc.ValidCore(core) || mc == "" {
		writeErr(w, 400, fmt.Errorf("参数缺失"))
		return
	}
	builds, err := mcsrc.ListBuilds(ctx, core, mc)
	if err != nil {
		writeErr(w, 502, err)
		return
	}
	writeJSON(w, builds)
}

func (s *Server) handleJavas(w http.ResponseWriter, r *http.Request) {
	scanned := java.Cached()
	if scanned == nil {
		scanned = []java.ScannedJava{}
	}
	portable := java.Installed()
	if portable == nil {
		portable = []java.Info{}
	}
	writeJSON(w, map[string]any{"portable": portable, "scanned": scanned})
}

func (s *Server) handleJavaScan(w http.ResponseWriter, r *http.Request) {
	list := java.Scan()
	if list == nil {
		list = []java.ScannedJava{}
	}
	writeJSON(w, list)
}

func (s *Server) handleJavaAdd(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path string `json:"path"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, err)
		return
	}
	j, err := java.AddManual(strings.TrimSpace(body.Path))
	if err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, j)
}

// ---------- 实例 ----------

type instSummary struct {
	Name      string `json:"name"`
	Core      string `json:"core"`
	Kind      string `json:"kind"`
	MC        string `json:"mc"`
	Build     string `json:"build"`
	JavaMajor int    `json:"javaMajor"`
	XmxMB     int    `json:"xmxMb"`
	XmsMB     int    `json:"xmsMb"`
	Port      int    `json:"port"`
	Status    string `json:"status"`
	MOTD      string `json:"motd"`
	Dir       string `json:"dir"`
	CreatedAt string `json:"createdAt"`
	ConsoleEncoding string `json:"consoleEncoding"`
	OnlineCount int      `json:"onlineCount"`
	UptimeSec   int      `json:"uptimeSec"`
	MaxPlayers  int      `json:"maxPlayers"`
	ExtraJVM    []string `json:"extraJvm"`
}

func summarize(i *inst.Instance) instSummary {
	motd := ""
	maxP := 20
	if p, err := inst.LoadProps(i.PropsPath()); err == nil {
		motd, _ = p.Get("motd")
		if v, ok := p.Get("max-players"); ok {
			if n, e := strconv.Atoi(strings.TrimSpace(v)); e == nil && n > 0 {
				maxP = n
			}
		}
	}
	enc := i.ConsoleEncoding
	if enc == "" {
		enc = "auto"
	}
	return instSummary{
		Name: i.Name, Core: string(i.Core), Kind: string(mcsrc.KindOf(i.Core)),
		MC: i.MC, Build: i.Build,
		JavaMajor: i.JavaMajor, XmxMB: i.XmxMB, XmsMB: i.XmsMB,
		Port: i.Port(), Status: i.Status(), MOTD: motd, Dir: i.Dir,
		CreatedAt: i.CreatedAt.Format("2006-01-02 15:04"),
		ConsoleEncoding: enc,
		OnlineCount: i.OnlineCount(), UptimeSec: i.UptimeSec(), MaxPlayers: maxP,
		ExtraJVM: i.ExtraJVMSnapshot(),
	}
}

func (s *Server) handleListInstances(w http.ResponseWriter, r *http.Request) {
	var out []instSummary
	for _, i := range s.mgr.List() {
		out = append(out, summarize(i))
	}
	if out == nil {
		out = []instSummary{}
	}
	writeJSON(w, out)
}

func (s *Server) handleCreateInstance(w http.ResponseWriter, r *http.Request) {
	var req inst.CreateReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, 400, err)
		return
	}
	id, err := s.mgr.CreateAsync(req)
	if err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, map[string]string{"taskId": id})
}

func (s *Server) handleTask(w http.ResponseWriter, r *http.Request) {
	t := s.mgr.Tasks.Get(r.PathValue("id"))
	if t == nil {
		writeErr(w, 404, fmt.Errorf("任务不存在"))
		return
	}
	writeJSON(w, t.Snapshot())
}

func (s *Server) instAction(fn func(*inst.Manager, string) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")
		if err := fn(s.mgr, name); err != nil {
			writeErr(w, 400, err)
			return
		}
		writeJSON(w, "ok")
	}
}

func (s *Server) handleCommand(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Cmd string `json:"cmd"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, err)
		return
	}
	if err := s.mgr.Command(r.PathValue("name"), body.Cmd); err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, "ok")
}

// handleOpenDir 在资源管理器打开实例目录或其白名单子目录（sub 查询参数）。
func (s *Server) handleOpenDir(w http.ResponseWriter, r *http.Request) {
	if err := s.mgr.OpenDir(r.PathValue("name"), r.URL.Query().Get("sub")); err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, "ok")
}

func (s *Server) handleDelete(w http.ResponseWriter, r *http.Request) {
	files := r.URL.Query().Get("files") == "1"
	if err := s.mgr.Delete(r.PathValue("name"), files); err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, "ok")
}

// handleInstStart 启动实例，成功后拉起绑定的跟随隧道。
func (s *Server) handleInstStart(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if err := s.mgr.Start(name); err != nil {
		writeErr(w, 400, err)
		return
	}
	s.tun.StartBound(name)
	writeJSON(w, "ok")
}

// ---------- 穿透 ----------

func (s *Server) handleListTunnels(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.tun.List())
}

func (s *Server) handleAddTunnel(w http.ResponseWriter, r *http.Request) {
	var t tunnel.Tunnel
	if err := readJSON(r, &t); err != nil {
		writeErr(w, 400, err)
		return
	}
	nt, err := s.tun.Add(t)
	if err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, nt)
}

func (s *Server) handleUpdateTunnel(w http.ResponseWriter, r *http.Request) {
	var t tunnel.Tunnel
	if err := readJSON(r, &t); err != nil {
		writeErr(w, 400, err)
		return
	}
	if err := s.tun.Update(r.PathValue("id"), t); err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, "ok")
}

func (s *Server) handleDeleteTunnel(w http.ResponseWriter, r *http.Request) {
	if err := s.tun.Delete(r.PathValue("id")); err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, "ok")
}

func (s *Server) handleTunnelStart(w http.ResponseWriter, r *http.Request) {
	if err := s.tun.Start(r.PathValue("id")); err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, "ok")
}

func (s *Server) handleTunnelStop(w http.ResponseWriter, r *http.Request) {
	if err := s.tun.Stop(r.PathValue("id")); err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, "ok")
}

func (s *Server) handleTunnelConsole(w http.ResponseWriter, r *http.Request) {
	s.streamConsole(w, r, s.tun.Console(r.PathValue("id")))
}

// handleConsole 通过 SSE 推送实例控制台输出（先回放历史，再实时跟踪）。
func (s *Server) handleConsole(w http.ResponseWriter, r *http.Request) {
	i, err := s.mgr.Get(r.PathValue("name"))
	if err != nil {
		writeErr(w, 404, err)
		return
	}
	s.streamConsole(w, r, i.Console)
}

func (s *Server) streamConsole(w http.ResponseWriter, r *http.Request, con *procutil.Console) {
	fl, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, 500, fmt.Errorf("streaming unsupported"))
		return
	}
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")

	replay, ch, cancel := con.Subscribe()
	defer cancel()
	send := func(line string) bool {
		b, _ := json.Marshal(line)
		_, err := fmt.Fprintf(w, "data: %s\n\n", b)
		return err == nil
	}
	for _, l := range replay {
		if !send(l) {
			return
		}
	}
	fl.Flush()
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case l := <-ch:
			if !send(l) {
				return
			}
			// 批量吸收积压行后统一 flush
			for drained := false; !drained; {
				select {
				case l = <-ch:
					if !send(l) {
						return
					}
				default:
					drained = true
				}
			}
			fl.Flush()
		case <-heartbeat.C:
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return
			}
			fl.Flush()
		}
	}
}

func (s *Server) handleGetProps(w http.ResponseWriter, r *http.Request) {
	i, err := s.mgr.Get(r.PathValue("name"))
	if err != nil {
		writeErr(w, 404, err)
		return
	}
	p, err := inst.LoadProps(i.PropsPath())
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	pairs := p.Pairs()
	if pairs == nil {
		pairs = []inst.KV{}
	}
	writeJSON(w, map[string]any{"pairs": pairs, "running": i.Status() != "stopped"})
}

func (s *Server) handleSetProps(w http.ResponseWriter, r *http.Request) {
	i, err := s.mgr.Get(r.PathValue("name"))
	if err != nil {
		writeErr(w, 404, err)
		return
	}
	var body struct {
		Pairs []inst.KV `json:"pairs"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, err)
		return
	}
	p, err := inst.LoadProps(i.PropsPath())
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	for _, kv := range body.Pairs {
		key := strings.TrimSpace(kv.Key)
		if key == "" || strings.ContainsAny(key, "=\n\r") {
			continue
		}
		p.Set(key, strings.Trim(kv.Value, "\r\n"))
	}
	if err := p.Save(i.PropsPath()); err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, "ok")
}

func (s *Server) handleSetSettings(w http.ResponseWriter, r *http.Request) {
	var body struct {
		XmxMB           int       `json:"xmxMb"`
		XmsMB           int       `json:"xmsMb"`
		ConsoleEncoding string    `json:"consoleEncoding"`
		ExtraJVM        *[]string `json:"extraJvm"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, err)
		return
	}
	if err := s.mgr.UpdateSettings(r.PathValue("name"), body.XmxMB, body.XmsMB, body.ConsoleEncoding, body.ExtraJVM); err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, "ok")
}
