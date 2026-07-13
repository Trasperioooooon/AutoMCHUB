// Package autostart 管理 Windows 每用户开机自启（写 HKCU\...\Run，免管理员，随程序便携迁移）。
package autostart

import (
	"fmt"
	"os"
	"strings"

	"golang.org/x/sys/windows/registry"
)

const (
	runKey    = `Software\Microsoft\Windows\CurrentVersion\Run`
	valueName = "AutoMCHUB"
)

// command 返回写入 Run 键的命令行：带引号的 exe 绝对路径 + -minimized（随托盘静默启动）。
func command() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	return fmt.Sprintf(`"%s" -minimized`, exe), nil
}

// Enabled 报告开机自启是否已开启（Run 键存在且值非空）。
func Enabled() bool {
	k, err := registry.OpenKey(registry.CURRENT_USER, runKey, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer k.Close()
	v, _, err := k.GetStringValue(valueName)
	if err != nil {
		return false
	}
	return strings.TrimSpace(v) != ""
}

// Set 开启或关闭开机自启（幂等）。开启会以当前 exe 路径覆盖旧值，程序换目录后重开即修正。
func Set(on bool) error {
	k, _, err := registry.CreateKey(registry.CURRENT_USER, runKey, registry.SET_VALUE|registry.QUERY_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	if !on {
		// 删除不存在的值会报错，但目标状态（值缺失）已达成，视为成功
		_ = k.DeleteValue(valueName)
		return nil
	}
	cmd, err := command()
	if err != nil {
		return err
	}
	return k.SetStringValue(valueName, cmd)
}
