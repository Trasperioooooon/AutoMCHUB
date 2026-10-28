package web

import (
	"bytes"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"minedeck/internal/procutil"
)

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
		"$f.Description = 'Choose a folder for MineDeck'; $f.ShowNewFolderButton = $true; " +
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

// handleOpenDir 在资源管理器打开实例目录或其白名单子目录（sub 查询参数）。
// 与 pickdir/openpath 同理：资源管理器窗口开在主机桌面上，对远程用户无意义，故仅限本机。
func (s *Server) handleOpenDir(w http.ResponseWriter, r *http.Request) {
	if !isLoopbackReq(r) {
		writeErr(w, 403, fmt.Errorf("打开目录仅支持在本机操作（远程管理时请在主机上操作）"))
		return
	}
	if err := s.mgr.OpenDir(r.PathValue("name"), r.URL.Query().Get("sub")); err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, "ok")
}
