//go:build !windows

// 非 Windows 平台桩：本项目仅面向 Windows，此桩仅为保证 internal/web 等包跨平台可编译。
package autostart

import "errors"

func Enabled() bool { return false }

func Set(on bool) error { return errors.New("开机自启仅支持 Windows") }
