package app

import (
	"path/filepath"
	"slices"
	"testing"
)

// tempBase 把程序目录与内存配置换成临时的一份，测试结束后还原。
func tempBase(t *testing.T) {
	t.Helper()
	oldBase, oldServers := Base, ServersDir
	cfgMu.Lock()
	oldCfg := cfg
	cfgMu.Unlock()
	Base = t.TempDir()
	ServersDir = filepath.Join(Base, "servers")
	restart()
	t.Cleanup(func() {
		Base, ServersDir = oldBase, oldServers
		cfgMu.Lock()
		cfg = oldCfg
		cfgMu.Unlock()
	})
}

// restart 模拟重启：丢弃内存配置，按 config.json 重新加载。
func restart() {
	cfgMu.Lock()
	cfg = Config{Source: "auto", UpdateRepo: DefaultUpdateRepo}
	cfgMu.Unlock()
	loadConfig()
}

func setServersDir(t *testing.T, dir string) {
	t.Helper()
	if _, err := UpdateConfig(func(c *Config) error { c.ServersDir = dir; return nil }); err != nil {
		t.Fatal(err)
	}
}

// 回归：配置根 D 下的实例（含旧版本建的、从未进 Roots 的），改目录到 E 或恢复默认后重启仍要被扫描。
func TestServersDirChangeKeepsOldRoot(t *testing.T) {
	for _, tc := range []struct{ name, next string }{{"changeDir", "E"}, {"resetDefault", ""}} { // 改目录 / 恢复默认
		t.Run(tc.name, func(t *testing.T) {
			tempBase(t)
			d := filepath.Join(Base, "D", "MC")
			setServersDir(t, d)
			next := ""
			if tc.next != "" {
				next = filepath.Join(Base, tc.next, "MC")
			}
			setServersDir(t, next)
			restart()
			if roots := InstanceRoots(); !slices.Contains(roots, d) {
				t.Fatalf("重启后不再扫描旧根 %s：%v", d, roots)
			}
		})
	}
}

// 回归：RememberRoot 曾跳过当前配置根；现在只跳过内置根，并按 filepath.Clean 去重。
func TestRememberRoot(t *testing.T) {
	tempBase(t)
	d := filepath.Join(Base, "D", "MC")
	setServersDir(t, d)
	RememberRoot(d)
	RememberRoot(d + string(filepath.Separator))
	RememberRoot(ServersDir)
	restart()
	if got := GetConfig().Roots; !slices.Equal(got, []string{d}) {
		t.Fatalf("Roots = %v，应为 [%s]", got, d)
	}
}
