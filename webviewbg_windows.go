package main

// 冷启动不白闪：WebView2 在页面画出第一帧之前，用控制器的 DefaultBackgroundColor（默认白色）填充窗口。
// 微软 WebView2 SDK 的文档（ICoreWebView2Controller2::put_DefaultBackgroundColor）说明：这个颜色也可以用环境变量
// WEBVIEW2_DEFAULT_BACKGROUND_COLOR 设置，而且比用 API 设置更早生效，能避免短暂的白闪；取值是十六进制 AARRGGBB
// （可加 0x 前缀），前两位是不透明度，不足 8 位会被补成透明色；只支持完全不透明（FF）或完全透明（00）。
// 环境变量只在创建控制器时生效一次，所以必须在 webview2.NewWithOptions 之前设置。
//
// 颜色取前端上报、存在 config.json 里的标题栏底色（chromeColor，见 app.Config）；还没有上报过时，
// 按 Windows「应用使用浅色模式」取默认方案「方块」的标题栏色。页面里的启动画面也用同一个颜色铺底，两者无缝衔接。

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"strings"

	"golang.org/x/sys/windows/registry"

	"minedeck/internal/app"
)

// 默认方案「方块」的标题栏底色（--chrome），须与 internal/web/ui/themes.css 一致（internal/themes 的测试会核对）。
const (
	defaultChromeLight = "#eae5d7"
	defaultChromeDark  = "#0e1210"
)

// webviewBackground 返回 WEBVIEW2_DEFAULT_BACKGROUND_COLOR 的取值（完全不透明的 AARRGGBB）。
func webviewBackground() string {
	c, ok := app.ParseHexColor(app.GetConfig().ChromeColor)
	if !ok { // 没上报过，或 config.json 被手改成了别的写法
		c = defaultChromeDark
		if systemUsesLightTheme() {
			c = defaultChromeLight
		}
	}
	return "FF" + strings.ToUpper(c[1:])
}

// systemUsesLightTheme 读 HKCU\…\Themes\Personalize 的 AppsUseLightTheme（0 = 深色），读不到按浅色处理（系统默认值）。
func systemUsesLightTheme() bool {
	k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`, registry.QUERY_VALUE)
	if err != nil {
		return true
	}
	defer k.Close()
	v, _, err := k.GetIntegerValue("AppsUseLightTheme")
	return err != nil || v != 0
}

// setWebViewBackground 在创建 WebView2 之前设置默认底色。每次都覆盖：自动更新重启时，新进程会从旧进程继承旧值。
func setWebViewBackground() {
	_ = os.Setenv("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", webviewBackground())
}

// bootID 每次进程启动生成一次，经 WebView2 的文档创建脚本注入为 window.__MD_BOOT。
// 前端用它和 sessionStorage 比对：只在本次启动后第一次加载页面时播放启动画面，刷新页面不再播。
var bootID = func() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}()
