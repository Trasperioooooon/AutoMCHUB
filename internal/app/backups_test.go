package app

import (
	"path/filepath"
	"slices"
	"testing"
)

// tempBackupsBase 把程序目录、内置备份根与内存配置换成临时的一份，测试结束后还原。
func tempBackupsBase(t *testing.T) {
	t.Helper()
	oldBase, oldBackups := Base, BackupsDir
	cfgMu.Lock()
	oldCfg := cfg
	cfgMu.Unlock()
	Base = t.TempDir()
	BackupsDir = filepath.Join(Base, "backups")
	reloadConfig()
	t.Cleanup(func() {
		Base, BackupsDir = oldBase, oldBackups
		cfgMu.Lock()
		cfg = oldCfg
		cfgMu.Unlock()
	})
}

// reloadConfig 模拟重启：丢弃内存配置，按 config.json 重新加载。
func reloadConfig() {
	cfgMu.Lock()
	cfg = Config{Source: "auto", UpdateRepo: DefaultUpdateRepo}
	cfgMu.Unlock()
	loadConfig()
}

func setBackupsDir(t *testing.T, dir string) {
	t.Helper()
	if _, err := UpdateConfig(func(c *Config) error { c.BackupsDir = dir; return nil }); err != nil {
		t.Fatal(err)
	}
}

// 回归：备份根 D 下的备份，改目录到 E 或恢复默认后重启仍要参与查找；当前根排在最前（新备份写那里）。
func TestBackupsDirChangeKeepsOldRoot(t *testing.T) {
	for _, tc := range []struct{ name, next string }{{"changeDir", "E"}, {"resetDefault", ""}} { // 改目录 / 恢复默认
		t.Run(tc.name, func(t *testing.T) {
			tempBackupsBase(t)
			d := filepath.Join(Base, "D", "BK")
			setBackupsDir(t, d)
			next, cur := "", BackupsDir
			if tc.next != "" {
				next = filepath.Join(Base, tc.next, "BK")
				cur = next
			}
			setBackupsDir(t, next)
			reloadConfig()
			roots := AllBackupRoots()
			if BackupsRoot() != cur || len(roots) == 0 || roots[0] != cur {
				t.Fatalf("当前备份根应为 %s 且排在最前：BackupsRoot=%s，AllBackupRoots=%v", cur, BackupsRoot(), roots)
			}
			if !slices.Contains(roots, d) {
				t.Fatalf("重启后不再查找旧备份根 %s：%v", d, roots)
			}
		})
	}
}

// addBackupRoot 跳过空串与内置备份根（内置根总在 AllBackupRoots 里），并按 filepath.Clean 去重。
func TestAddBackupRoot(t *testing.T) {
	tempBackupsBase(t)
	d := filepath.Join(Base, "D", "BK")
	setBackupsDir(t, d)                            // 旧值为空：不记
	setBackupsDir(t, d+string(filepath.Separator)) // 旧值 D 记下
	setBackupsDir(t, BackupsDir)                   // 旧值 D\ 与 D 是同一目录：不重复记
	setBackupsDir(t, "")                           // 旧值是内置根：不记
	reloadConfig()
	if got := GetConfig().BackupRoots; !slices.Equal(got, []string{d}) {
		t.Fatalf("BackupRoots = %v，应为 [%s]", got, d)
	}
	if got, want := AllBackupRoots(), []string{BackupsDir, d}; !slices.Equal(got, want) {
		t.Fatalf("AllBackupRoots = %v，应为 %v", got, want)
	}
}
