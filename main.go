// AutoMCHUB — Windows 本地 Minecraft 服务器一键部署工具
// GUI = 内嵌 Web 界面 + WebView2 原生窗口（缺失 WebView2 时自动回退默认浏览器）。
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"time"

	"automchub/internal/app"
	"automchub/internal/inst"
	"automchub/internal/java"
	"automchub/internal/procutil"
	"automchub/internal/tunnel"
	"automchub/internal/update"
	"automchub/internal/web"
	"automchub/internal/webhook"

	webview2 "github.com/jchv/go-webview2"
)

func main() {
	nogui := flag.Bool("nogui", false, "仅启动本地服务，不打开窗口")
	port := flag.Int("port", 27333, "本地 Web 端口（被占用时自动改用随机端口）")
	flag.Parse()

	if err := app.Init(); err != nil {
		fatal("初始化数据目录失败: " + err.Error())
	}
	procutil.InitJob() // 确保程序退出后不残留 java/frpc 进程

	mgr, err := inst.NewManager()
	if err != nil {
		fatal("加载实例列表失败: " + err.Error())
	}
	tun := tunnel.NewManager()
	webhook.Init()
	go java.Scan() // 后台扫描本机已装 Java，创建实例时可直接复用

	bindHost := "127.0.0.1"
	if cfg := app.GetConfig(); cfg.ListenLAN && cfg.AccessPasswordHash != "" {
		bindHost = "0.0.0.0"
		log.Println("局域网访问已启用（密码保护），手机/其他设备可通过本机 IP 访问")
	}
	ln, err := net.Listen("tcp", fmt.Sprintf("%s:%d", bindHost, *port))
	if err != nil {
		ln, err = net.Listen("tcp", bindHost+":0")
		if err != nil {
			fatal("无法监听本地端口: " + err.Error())
		}
	}
	addr := ln.Addr().(*net.TCPAddr)
	url := fmt.Sprintf("http://127.0.0.1:%d/?token=%s", addr.Port, web.Token)
	go func() {
		if err := http.Serve(ln, web.New(mgr, tun, addr.Port)); err != nil {
			log.Println("HTTP 服务退出:", err)
		}
	}()
	log.Println("AutoMCHUB 已启动:", url)

	// 启动时静默检查更新（可在设置中开关；仅日志提示，不打断）
	if cfg := app.GetConfig(); cfg.CheckUpdateOnStart && cfg.UpdateRepo != "" {
		go func(repo string) {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			if rel, has, err := update.Check(ctx, repo); err == nil && has {
				log.Printf("发现新版本 %s（当前 v%s），可在设置中一键更新", rel.Tag, app.Version)
			}
		}(cfg.UpdateRepo)
	}

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt)
	web.OnShutdown = func() {
		select {
		case sig <- os.Interrupt:
		default:
		}
	}

	if *nogui {
		<-sig
	} else if !openWebView(url, sig) {
		log.Println("WebView2 不可用，使用默认浏览器打开界面")
		_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
		<-sig
	}

	log.Println("正在停止所有运行中的服务器与隧道...")
	tun.StopAll()
	mgr.ShutdownAll(30 * time.Second)
}

// openWebView 尝试以原生窗口运行界面；窗口关闭或收到中断信号时返回。
func openWebView(url string, sig chan os.Signal) (ok bool) {
	defer func() {
		if recover() != nil {
			ok = false
		}
	}()
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     false,
		AutoFocus: true,
		WindowOptions: webview2.WindowOptions{
			Title:  "AutoMCHUB · MC 一键开服",
			Width:  1280,
			Height: 850,
			Center: true,
		},
	})
	if w == nil {
		return false
	}
	defer w.Destroy()
	go func() {
		<-sig
		w.Terminate()
	}()
	w.Navigate(url)
	w.Run()
	return true
}

func fatal(msg string) {
	log.Println(msg)
	// GUI 子系统下没有控制台，弹窗提示
	_ = exec.Command("mshta", "javascript:alert('AutoMCHUB 启动失败：\\n"+msg+"');close()").Run()
	os.Exit(1)
}
