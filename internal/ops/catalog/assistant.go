package catalog

import (
	"net"
	"os"
	"path/filepath"

	"minedeck/internal/ai"
	"minedeck/internal/app"
	"minedeck/internal/assistant"
	"minedeck/internal/ops"
)

// NewAssistant 按程序目录建应用内助手：会话存在 <程序目录>/data/ai/sessions/，和网页接口共用同一个注册表（提案存在里面）。
// token 是 MineDeck 这次启动的访问令牌：和各种 Key 一样，原样出现在要发给 AI 的内容里就换成 ***。
func NewAssistant(reg *ops.Registry, aiSvc *ai.Service, token string) *assistant.Service {
	home, _ := os.UserHomeDir()
	r := &assistant.Redactor{Base: app.Base, Home: home, User: os.Getenv("USERNAME"), Computer: os.Getenv("COMPUTERNAME"), IPs: allIPs(),
		Secrets: func() []string {
			out := []string{token, app.CFKey(), app.GetConfig().AccessPasswordHash}
			if k, err := app.Secrets().Get(ai.KeyName); err == nil {
				out = append(out, k)
			}
			return out
		}}
	return assistant.New(assistant.Options{Ops: reg, AI: aiSvc, Dir: filepath.Join(app.Base, "data", "ai", "sessions"), Redact: r})
}

// allIPs 本机各网卡的地址（IPv4 和 IPv6，回环除外）。
func allIPs() []string {
	var out []string
	addrs, _ := net.InterfaceAddrs()
	for _, a := range addrs {
		if ipn, ok := a.(*net.IPNet); ok && !ipn.IP.IsLoopback() {
			out = append(out, ipn.IP.String())
		}
	}
	return out
}
