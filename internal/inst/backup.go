package inst

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"automchub/internal/app"
	"automchub/internal/events"
)

type BackupInfo struct {
	File   string  `json:"file"`
	SizeMB float64 `json:"sizeMb"`
	Time   string  `json:"time"`
}

// backupDirOf 返回实例备份目录。filepath.Base 兜底：即便某个 instance.json 携带带路径
// 分隔符的异常 name（多根扫描可能拾取到），也不会让备份读写逃出备份根。
func backupDirOf(name string) string { return filepath.Join(app.BackupsRoot(), filepath.Base(name)) }

// worldDirs 返回实例的世界存档目录（vanilla 单目录 / bukkit 三目录）。
func (i *Instance) worldDirs() []string {
	level := "world"
	if p, err := LoadProps(i.PropsPath()); err == nil {
		if v, ok := p.Get("level-name"); ok && v != "" {
			level = v
		}
	}
	var out []string
	for _, d := range []string{level, level + "_nether", level + "_the_end"} {
		full := filepath.Join(i.Dir, d)
		if st, err := os.Stat(full); err == nil && st.IsDir() {
			out = append(out, d)
		}
	}
	return out
}

// ListBackups 列出实例的全部备份（新在前）。
func (m *Manager) ListBackups(name string) ([]BackupInfo, error) {
	if _, err := m.Get(name); err != nil {
		return nil, err
	}
	ents, err := os.ReadDir(backupDirOf(name))
	if err != nil {
		if os.IsNotExist(err) {
			return []BackupInfo{}, nil
		}
		return nil, err
	}
	var out []BackupInfo
	for _, e := range ents {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".zip") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		out = append(out, BackupInfo{
			File:   e.Name(),
			SizeMB: float64(info.Size()) / (1 << 20),
			Time:   info.ModTime().Format("2006-01-02 15:04:05"),
		})
	}
	sort.Slice(out, func(a, b int) bool { return out[a].File > out[b].File })
	return out, nil
}

// CreateBackup 备份世界存档；运行中执行热备（save-off → save-all → 压缩 → save-on）。
func (m *Manager) CreateBackup(name, label string) (string, error) {
	i, err := m.Get(name)
	if err != nil {
		return "", err
	}
	worlds := i.worldDirs()
	if len(worlds) == 0 {
		return "", fmt.Errorf("还没有世界存档（服务器从未启动过？）")
	}
	if i.Status() == "running" {
		i.Console.Append("[AutoMCHUB] 开始热备份：暂停自动保存...")
		_ = m.Command(name, "save-off")
		_ = m.Command(name, "save-all flush")
		i.waitConsole("Saved the game", 15*time.Second)
		defer func() {
			_ = m.Command(name, "save-on")
			i.Console.Append("[AutoMCHUB] 热备份完成，已恢复自动保存")
		}()
	}
	fname := time.Now().Format("20060102-150405")
	if label != "" {
		fname += "-" + sanitizeLabel(label)
	}
	fname += ".zip"
	dest := filepath.Join(backupDirOf(name), fname)
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return "", err
	}
	if err := zipDirs(i.Dir, worlds, dest); err != nil {
		os.Remove(dest)
		return "", fmt.Errorf("压缩备份失败: %w", err)
	}
	m.pruneBackups(name)
	events.Publish("backup.done", map[string]any{"instance": name, "file": fname})
	return fname, nil
}

// RestoreBackup 还原备份（仅停止状态；还原前自动再备份一次当前世界）。
func (m *Manager) RestoreBackup(name, file string) error {
	i, err := m.Get(name)
	if err != nil {
		return err
	}
	if i.Status() != "stopped" {
		return fmt.Errorf("请先停止服务器再还原备份")
	}
	src := filepath.Join(backupDirOf(name), filepath.Base(file))
	if _, err := os.Stat(src); err != nil {
		return fmt.Errorf("备份文件不存在: %s", file)
	}
	if len(i.worldDirs()) > 0 {
		if _, err := m.CreateBackup(name, "还原前自动"); err != nil {
			return fmt.Errorf("还原前自动备份失败，已中止: %w", err)
		}
	}
	for _, d := range i.worldDirs() {
		if err := os.RemoveAll(filepath.Join(i.Dir, d)); err != nil {
			return fmt.Errorf("清理旧世界失败: %w", err)
		}
	}
	if err := unzipTo(src, i.Dir); err != nil {
		return fmt.Errorf("解压备份失败: %w", err)
	}
	i.Console.Append("[AutoMCHUB] 世界已还原至备份 " + filepath.Base(file))
	return nil
}

// DeleteBackup 删除一个备份文件。
func (m *Manager) DeleteBackup(name, file string) error {
	if _, err := m.Get(name); err != nil {
		return err
	}
	p := filepath.Join(backupDirOf(name), filepath.Base(file))
	if !strings.HasSuffix(p, ".zip") {
		return fmt.Errorf("非法备份文件名")
	}
	return os.Remove(p)
}

func (m *Manager) pruneBackups(name string) {
	list, err := m.ListBackups(name)
	if err != nil {
		return
	}
	for i := app.BackupKeep(); i < len(list); i++ {
		// 自动清理最旧的（保留手动标签“还原前自动”同样计入总数）
		_ = os.Remove(filepath.Join(backupDirOf(name), list[i].File))
	}
}

func sanitizeLabel(s string) string {
	s = strings.Map(func(r rune) rune {
		if strings.ContainsRune(`\/:*?"<>| `, r) {
			return '_'
		}
		return r
	}, s)
	if len([]rune(s)) > 20 {
		s = string([]rune(s)[:20])
	}
	return s
}

// waitConsole 等待控制台出现指定子串（热备时等待 "Saved the game"）。
func (i *Instance) waitConsole(substr string, timeout time.Duration) bool {
	_, ch, cancel := i.Console.Subscribe()
	defer cancel()
	deadline := time.After(timeout)
	for {
		select {
		case line := <-ch:
			if strings.Contains(line, substr) {
				return true
			}
		case <-deadline:
			return false
		}
	}
}

// zipDirs 将 baseDir 下的若干子目录打包为 zip（跳过 session.lock）。
func zipDirs(baseDir string, dirs []string, dest string) error {
	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	zw := zip.NewWriter(f)
	var werr error
	for _, d := range dirs {
		root := filepath.Join(baseDir, d)
		werr = filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			if info.IsDir() || info.Name() == "session.lock" {
				return nil
			}
			rel, err := filepath.Rel(baseDir, p)
			if err != nil {
				return err
			}
			w, err := zw.Create(filepath.ToSlash(rel))
			if err != nil {
				return err
			}
			r, err := os.Open(p)
			if err != nil {
				return err
			}
			_, cerr := io.Copy(w, r)
			r.Close()
			return cerr
		})
		if werr != nil {
			break
		}
	}
	if cerr := zw.Close(); werr == nil {
		werr = cerr
	}
	if cerr := f.Close(); werr == nil {
		werr = cerr
	}
	return werr
}

// unzipTo 解压 zip 至目录（zip-slip 防护）。
func unzipTo(src, destDir string) error {
	zr, err := zip.OpenReader(src)
	if err != nil {
		return err
	}
	defer zr.Close()
	cleanDest := filepath.Clean(destDir)
	for _, f := range zr.File {
		name := strings.ReplaceAll(f.Name, "\\", "/")
		target := filepath.Join(cleanDest, filepath.FromSlash(name))
		if !strings.HasPrefix(target, cleanDest+string(os.PathSeparator)) {
			return fmt.Errorf("备份内含非法路径: %s", f.Name)
		}
		if f.FileInfo().IsDir() {
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		w, err := os.Create(target)
		if err != nil {
			rc.Close()
			return err
		}
		_, cerr := io.Copy(w, rc)
		rc.Close()
		if werr := w.Close(); cerr == nil {
			cerr = werr
		}
		if cerr != nil {
			return cerr
		}
	}
	return nil
}
