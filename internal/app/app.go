// Package app 管理应用基础目录与全局配置。
package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

const Version = "2.0.0"

var (
	Base        string // 程序所在目录（数据自包含于此，不写注册表、不动环境变量）
	RuntimesDir string // 便携式 Java 运行时
	CacheDir    string // 下载缓存
	ServersDir  string // 服务器实例
	BackupsDir  string // 世界备份（独立于实例目录，删实例后仍保留）
)

type Config struct {
	Source             string `json:"source"`                       // auto | mirror | official
	CFApiKey           string `json:"cfApiKey,omitempty"`           // CurseForge API Key（导入 CF 整合包用，选填）
	WebhookURL         string `json:"webhookUrl,omitempty"`         // 事件推送地址（选填）
	UpdateRepo         string `json:"updateRepo,omitempty"`         // GitHub 更新仓库，如 user/AutoMCHUB
	ListenLAN          bool   `json:"listenLan,omitempty"`          // 允许局域网访问（需设置密码，重启生效）
	AccessPasswordHash string `json:"accessPasswordHash,omitempty"` // 远程访问密码的 SHA-256
}

var (
	cfgMu sync.RWMutex
	cfg   = Config{Source: "auto"}
)

func Init() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	base := filepath.Dir(exe)
	// go run 场景下可执行文件在临时目录，退回工作目录
	if strings.Contains(base, "go-build") || strings.HasPrefix(base, os.TempDir()) {
		if wd, werr := os.Getwd(); werr == nil {
			base = wd
		}
	}
	Base = base
	RuntimesDir = filepath.Join(base, "runtimes")
	CacheDir = filepath.Join(base, "cache")
	ServersDir = filepath.Join(base, "servers")
	BackupsDir = filepath.Join(base, "backups")
	for _, d := range []string{RuntimesDir, CacheDir, ServersDir, BackupsDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return err
		}
	}
	loadConfig()
	return nil
}

func configPath() string { return filepath.Join(Base, "config.json") }

func loadConfig() {
	b, err := os.ReadFile(configPath())
	if err != nil {
		return
	}
	var c Config
	if json.Unmarshal(b, &c) == nil && c.Source != "" {
		cfgMu.Lock()
		cfg = c
		cfgMu.Unlock()
	}
}

func GetConfig() Config {
	cfgMu.RLock()
	defer cfgMu.RUnlock()
	return cfg
}

func SetConfig(c Config) {
	if c.Source != "mirror" && c.Source != "official" {
		c.Source = "auto"
	}
	cfgMu.Lock()
	cfg = c
	cfgMu.Unlock()
	b, _ := json.MarshalIndent(c, "", "  ")
	_ = os.WriteFile(configPath(), b, 0o644)
}

func MirrorFirst() bool  { return GetConfig().Source != "official" }
func OfficialOnly() bool { return GetConfig().Source == "official" }
func MirrorOnly() bool   { return GetConfig().Source == "mirror" }

type memoryStatusEx struct {
	Length               uint32
	MemoryLoad           uint32
	TotalPhys            uint64
	AvailPhys            uint64
	TotalPageFile        uint64
	AvailPageFile        uint64
	TotalVirtual         uint64
	AvailVirtual         uint64
	AvailExtendedVirtual uint64
}

var procGlobalMemoryStatusEx = windows.NewLazySystemDLL("kernel32.dll").NewProc("GlobalMemoryStatusEx")

// TotalRAMMB 返回物理内存总量（MB），失败时返回保守值。
func TotalRAMMB() int {
	var m memoryStatusEx
	m.Length = uint32(unsafe.Sizeof(m))
	r, _, _ := procGlobalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&m)))
	if r == 0 {
		return 8192
	}
	return int(m.TotalPhys / (1024 * 1024))
}

// AvailRAMMB 返回当前可用物理内存（MB）；调用失败时返回 0（表示未知，
// 与 TotalRAMMB 的保守兜底 8192 区分，便于前端据 0 走降级逻辑）。
func AvailRAMMB() int {
	var m memoryStatusEx
	m.Length = uint32(unsafe.Sizeof(m))
	r, _, _ := procGlobalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&m)))
	if r == 0 {
		return 0
	}
	return int(m.AvailPhys / (1024 * 1024))
}
