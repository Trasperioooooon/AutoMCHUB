package inst

import (
	"os"
	"path/filepath"
	"testing"

	"automchub/internal/app"
)

// tempInstance 把程序目录与内置根换成临时的一份（测试结束后还原），备份目录恢复默认，
// 并准备一个带 world 存档的停止态实例 s，返回 Manager 与实例目录。
func tempInstance(t *testing.T) (*Manager, string) {
	t.Helper()
	oldBase, oldServers, oldBackups := app.Base, app.ServersDir, app.BackupsDir
	t.Cleanup(func() { app.Base, app.ServersDir, app.BackupsDir = oldBase, oldServers, oldBackups })
	app.Base = t.TempDir()
	app.ServersDir = filepath.Join(app.Base, "servers")
	app.BackupsDir = filepath.Join(app.Base, "backups")
	setConfig(t, func(c *app.Config) { c.BackupsDir, c.BackupKeep = "", 0 })
	dir := filepath.Join(app.ServersDir, "s")
	writeLevel(t, dir, "current")
	m := &Manager{insts: map[string]*Instance{}, creating: map[string]bool{}}
	m.insts["s"] = &Instance{Settings: Settings{Name: "s"}, Dir: dir, Console: newConsole()}
	return m, dir
}

func setConfig(t *testing.T, mutate func(*app.Config)) {
	t.Helper()
	if _, err := app.UpdateConfig(func(c *app.Config) error { mutate(c); return nil }); err != nil {
		t.Fatal(err)
	}
}

func writeLevel(t *testing.T, dir, content string) {
	t.Helper()
	p := filepath.Join(dir, "world", "level.dat")
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func readLevel(t *testing.T, dir string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(dir, "world", "level.dat"))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// zipWorld 把 world 存为 content 后直接打包成 dest：自定文件名（时间戳）便于控制新旧顺序。
func zipWorld(t *testing.T, dir, content, dest string) {
	t.Helper()
	writeLevel(t, dir, content)
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := zipDirs(dir, []string{"world"}, dest); err != nil {
		t.Fatal(err)
	}
}

// 回归：份数已满时还原最旧的备份，还原前自动备份的滚动清理曾先把待还原的源备份删掉——
// 世界已清空、解压失败，那份备份也没了。
func TestRestoreOldestBackupAtKeep(t *testing.T) {
	m, dir := tempInstance(t)
	setConfig(t, func(c *app.Config) { c.BackupKeep = 2 })
	bdir := filepath.Join(app.BackupsDir, "s")
	zipWorld(t, dir, "old1", filepath.Join(bdir, "20200101-000000.zip"))
	zipWorld(t, dir, "old2", filepath.Join(bdir, "20200102-000000.zip"))
	writeLevel(t, dir, "current")
	if err := m.RestoreBackup("s", "20200101-000000.zip"); err != nil {
		t.Fatal(err)
	}
	if got := readLevel(t, dir); got != "old1" {
		t.Fatalf("level.dat = %q，应还原为 old1", got)
	}
	if _, err := os.Stat(filepath.Join(bdir, "20200101-000000.zip")); err != nil {
		t.Fatalf("待还原的源备份被滚动清理掉了: %v", err)
	}
}
