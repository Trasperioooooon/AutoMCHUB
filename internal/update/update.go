// Package update 自动更新：检查 GitHub Releases，下载新版 exe 并通过
// update.bat 在退出后原子替换（国内经 gh 加速镜像兜底）。
package update

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"automchub/internal/app"
	"automchub/internal/dl"
)

type Release struct {
	Tag      string `json:"tag"`
	Notes    string `json:"notes"`
	AssetURL string `json:"-"`
	Size     int64  `json:"sizeBytes"`
}

// ghMirrors 把 GitHub 直链包装为国内加速候选（顺序尝试）。
func ghMirrors(u string) []string {
	return []string{
		"https://ghfast.top/" + u,
		"https://gh-proxy.com/" + u,
		u,
	}
}

// Check 查询最新 Release；repo 形如 "user/AutoMCHUB"。
func Check(ctx context.Context, repo string) (*Release, bool, error) {
	repo = strings.Trim(strings.TrimSpace(repo), "/")
	if repo == "" || !strings.Contains(repo, "/") {
		return nil, false, fmt.Errorf("未配置更新仓库（在全局设置填写，如 yourname/AutoMCHUB）")
	}
	var rel struct {
		TagName string `json:"tag_name"`
		Body    string `json:"body"`
		Assets  []struct {
			Name string `json:"name"`
			URL  string `json:"browser_download_url"`
			Size int64  `json:"size"`
		} `json:"assets"`
	}
	api := "https://api.github.com/repos/" + repo + "/releases/latest"
	if err := dl.FetchJSON(ctx, []string{api}, &rel); err != nil {
		return nil, false, fmt.Errorf("检查更新失败（GitHub API 不可达）: %w", err)
	}
	if rel.TagName == "" {
		return nil, false, fmt.Errorf("仓库还没有发布任何 Release")
	}
	r := &Release{Tag: rel.TagName, Notes: rel.Body}
	for _, a := range rel.Assets {
		if strings.HasSuffix(strings.ToLower(a.Name), ".exe") {
			r.AssetURL, r.Size = a.URL, a.Size
			break
		}
	}
	return r, newer(rel.TagName, app.Version), nil
}

// newer 比较 "v1.2.3" 风格版本号。
func newer(tag, current string) bool {
	pa := verParts(tag)
	pb := verParts(current)
	for i := 0; i < 3; i++ {
		if pa[i] != pb[i] {
			return pa[i] > pb[i]
		}
	}
	return false
}

func verParts(v string) [3]int {
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	var out [3]int
	for i, p := range strings.SplitN(v, ".", 3) {
		if i >= 3 {
			break
		}
		p, _, _ = strings.Cut(p, "-")
		n, _ := strconv.Atoi(p)
		out[i] = n
	}
	return out
}

// Apply 下载新版并写入换血脚本；调用方随后应触发程序退出。
func Apply(ctx context.Context, r *Release) error {
	if r.AssetURL == "" {
		return fmt.Errorf("该 Release 未附带 exe 文件")
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	newExe := filepath.Join(app.Base, "AutoMCHUB.new.exe")
	cctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	if err := dl.Fetch(cctx, dl.Request{
		URLs: ghMirrors(r.AssetURL), Dest: newExe, MinSize: 4 << 20,
	}, nil); err != nil {
		return fmt.Errorf("下载新版本失败: %w", err)
	}
	// 轮询等待旧进程真正退出（而非固定延时），避免文件占用与双进程
	bat := fmt.Sprintf(`@echo off
cd /d "%s"
:wait
tasklist /FI "PID eq %d" 2>nul | find "%d" >nul && (ping 127.0.0.1 -n 2 >nul & goto wait)
move /y "AutoMCHUB.new.exe" "%s" >nul
start "" "%s"
del "%%~f0"
`, app.Base, os.Getpid(), os.Getpid(), filepath.Base(exe), filepath.Base(exe))
	batPath := filepath.Join(app.Base, "update.bat")
	if err := os.WriteFile(batPath, []byte(bat), 0o755); err != nil {
		return err
	}
	return runDetached(batPath)
}
