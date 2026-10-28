// Package web 提供本地 HTTP API 与内嵌 GUI 静态资源。
// 安全措施：仅绑定 127.0.0.1、Host 头校验、API 需随机 Token（防跨站请求）。
package web

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"strings"

	"minedeck/internal/app"
	"minedeck/internal/inst"
	"minedeck/internal/tunnel"
)

//go:embed ui
var uiFS embed.FS

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
	// 内嵌字体约 1.9 MB：带 ETag 可缓存，局域网手机再次打开只需一次 304
	mux.Handle("GET /fonts/", revalidate(sub, fileServer))
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

// splitHostPort 拆分 Host 头，正确处理裸 IPv6（如 ::1 / [::1]，有无端口皆可），
// 避免自写 LastIndex(":") 把 IPv6 环回地址切错导致 secure() 误判 403。
func splitHostPort(hp string) (string, string, error) {
	if h, p, err := net.SplitHostPort(hp); err == nil {
		return h, p, nil
	}
	return strings.Trim(hp, "[]"), "", nil // 无端口：裸主机名或裸 IPv6，去方括号
}

func noCache(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

// Go 内置的扩展名表没有 .woff2（Windows 上还会去查注册表，结果因机器而异），显式登记。
func init() { _ = mime.AddExtensionType(".woff2", "font/woff2") }

// revalidate 给体积较大的内嵌静态文件（字体）加强 ETag（内容的 SHA-256）与 Cache-Control: no-cache：
// 浏览器可以缓存，但每次使用前先带 If-None-Match 询问，内容没变就回 304，不重新下载；
// 换了版本 ETag 随内容变化，不会用到旧字体。304 由 http.FileServer 按已设置的 ETag 头自动处理。
func revalidate(fsys fs.FS, next http.Handler) http.Handler {
	etags := map[string]string{}
	_ = fs.WalkDir(fsys, "fonts", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if b, err := fs.ReadFile(fsys, p); err == nil {
			sum := sha256.Sum256(b)
			etags["/"+p] = `"` + hex.EncodeToString(sum[:16]) + `"`
		}
		return nil
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if tag, ok := etags[r.URL.Path]; ok {
			w.Header().Set("ETag", tag)
			w.Header().Set("Cache-Control", "no-cache")
		} else {
			w.Header().Set("Cache-Control", "no-store")
		}
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
