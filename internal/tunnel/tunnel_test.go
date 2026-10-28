package tunnel

import (
	"bytes"
	"encoding/json"
	"html/template"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"minedeck/internal/app"
	"minedeck/internal/secret"
)

// tempBase 把程序目录和运行时目录换成临时的一份，测试结束后还原。
func tempBase(t *testing.T) {
	t.Helper()
	oldBase, oldRT := app.Base, app.RuntimesDir
	t.Cleanup(func() { app.Base, app.RuntimesDir = oldBase, oldRT })
	app.Base = t.TempDir()
	app.RuntimesDir = filepath.Join(app.Base, "runtimes")
}

func readFile(t *testing.T, p string) string {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

const nasty = `tok+en&"q'<x>\y 中文😀` // 含 html/template 会转义的字符、反斜杠、中文和 emoji

// 新增、修改隧道后 tunnels.json 里只有 DPAPI 密文；列表接口不下发凭据；凭据留空表示不修改。
func TestCredentialsEncryptedAtRest(t *testing.T) {
	tempBase(t)
	m := NewManager()
	a, err := m.Add(Tunnel{Provider: "openfrp", Name: "朋友联机", Credential: "openfrp-user-key-123", ProxyID: "42", LocalPort: 25565})
	if err != nil {
		t.Fatal(err)
	}
	if a.Credential != "" {
		t.Fatal("新增的响应不应回显凭据")
	}
	c, err := m.Add(Tunnel{Provider: "custom", Name: "自建", Credential: nasty, ServerAddr: "frp.example.com", ServerPort: 7000, RemotePort: 25566, LocalPort: 25565})
	if err != nil {
		t.Fatal(err)
	}
	disk := readFile(t, filepath.Join(app.Base, "tunnels.json"))
	if strings.Contains(disk, "openfrp-user-key-123") || strings.Contains(disk, "tok+en") || strings.Count(disk, `"dpapi:`) != 2 {
		t.Fatalf("tunnels.json 里有明文凭据：%s", disk)
	}
	for _, st := range m.List() {
		if st.Credential != "" {
			t.Fatalf("列表下发了凭据：%+v", st)
		}
	}
	// 留空不修改；填了就换成新的（同样加密）
	if err := m.Update(c.ID, Tunnel{Provider: "custom", Name: "自建", ServerAddr: "frp.example.com", ServerPort: 7000, RemotePort: 25567, LocalPort: 25565}); err != nil {
		t.Fatal(err)
	}
	if got, _ := secret.Unseal(m.get(c.ID).Credential); got != nasty {
		t.Fatalf("凭据留空修改后凭据变了：%q", got)
	}
	if err := m.Update(c.ID, Tunnel{Provider: "custom", Name: "自建", Credential: "new-token", ServerAddr: "frp.example.com", ServerPort: 7000, RemotePort: 25567, LocalPort: 25565}); err != nil {
		t.Fatal(err)
	}
	if got, _ := secret.Unseal(m.get(c.ID).Credential); got != "new-token" {
		t.Fatalf("新凭据没存上：%q", got)
	}
	if disk := readFile(t, filepath.Join(app.Base, "tunnels.json")); strings.Contains(disk, "new-token") {
		t.Fatal("修改后 tunnels.json 里有明文凭据")
	}
}

// 旧版 tunnels.json 的明文凭据：启动时加密写回；旧版留下的、写着明文 token 的 frpc 配置文件一并删掉。
func TestMigratePlaintextTunnels(t *testing.T) {
	tempBase(t)
	legacy := `{"seq":2,"tunnels":[
{"id":"tun1","provider":"natfrp","name":"樱花","credential":"sakura-access-key","proxyId":"9","localPort":25565,"autoStart":false},
{"id":"tun2","provider":"custom","name":"自建","credential":"custom-frps-token","serverAddr":"1.2.3.4","serverPort":7000,"remotePort":25566,"localPort":25565,"autoStart":false}]}`
	if err := os.WriteFile(filepath.Join(app.Base, "tunnels.json"), []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	dir := frpcDir("custom")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	old := "serverAddr = \"1.2.3.4\"\nserverPort = 7000\nloginFailExit = false\nauth.token = \"custom-frps-token\"\n"
	sample := "serverAddr = \"127.0.0.1\"\nserverPort = 7000\n" // frp 发行包自带的示例配置，不是我们写的
	for name, body := range map[string]string{"tun2.toml": old, "frpc.toml": sample} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	m := NewManager()
	disk := readFile(t, filepath.Join(app.Base, "tunnels.json"))
	if strings.Contains(disk, "sakura-access-key") || strings.Contains(disk, "custom-frps-token") || strings.Count(disk, `"dpapi:`) != 2 {
		t.Fatalf("迁移后 tunnels.json 仍有明文：%s", disk)
	}
	for id, want := range map[string]string{"tun1": "sakura-access-key", "tun2": "custom-frps-token"} {
		if got, err := secret.Unseal(m.get(id).Credential); got != want || err != nil {
			t.Fatalf("%s 迁移后解出 %q, %v", id, got, err)
		}
	}
	if _, err := os.Stat(filepath.Join(dir, "tun2.toml")); !os.IsNotExist(err) {
		t.Fatal("旧版带明文 token 的 frpc 配置没有删掉")
	}
	if _, err := os.Stat(filepath.Join(dir, "frpc.toml")); err != nil {
		t.Fatal("不该删 frp 自带的示例配置")
	}
	// 迁移结果再读一遍也一样（不会重复加密）
	if m2 := NewManager(); m2.get("tun2").Credential != m.get("tun2").Credential {
		t.Fatal("重启后凭据又被改写了")
	}
}

// 换了电脑或 Windows 用户：凭据解不开，列表里标出来，启动直接报错（不去下载 frpc、不起进程）。
func TestUnreadableCredential(t *testing.T) {
	tempBase(t)
	data := `{"seq":1,"tunnels":[{"id":"tun1","provider":"custom","name":"自建","credential":"dpapi:AAAA","serverAddr":"1.2.3.4","serverPort":7000,"remotePort":25566,"localPort":25565,"autoStart":false}]}`
	if err := os.WriteFile(filepath.Join(app.Base, "tunnels.json"), []byte(data), 0o600); err != nil {
		t.Fatal(err)
	}
	m := NewManager()
	if l := m.List(); len(l) != 1 || !l[0].CredBroken {
		t.Fatalf("应标出凭据解不开：%+v", l)
	}
	err := m.Start("tun1")
	if err == nil || !strings.Contains(err.Error(), "无法解开") {
		t.Fatalf("应拒绝启动：%v", err)
	}
	if _, err := os.Stat(frpcDir("custom")); !os.IsNotExist(err) {
		t.Fatal("凭据解不开时不应去准备 frpc")
	}
	// 重填凭据后恢复正常
	if err := m.Update("tun1", Tunnel{Provider: "custom", Name: "自建", Credential: "fresh", ServerAddr: "1.2.3.4", ServerPort: 7000, RemotePort: 25566, LocalPort: 25565}); err != nil {
		t.Fatal(err)
	}
	if l := m.List(); l[0].CredBroken {
		t.Fatal("重填后仍标着解不开")
	}
}

var escRe = regexp.MustCompile(`\\u([0-9A-F]{4})|\\U([0-9A-F]{8})`)

// renderLikeFrp 按 frp 0.61.1 读配置的办法处理：先用 html/template 代入环境变量，再还原 TOML 字符串里的 \u 转义，
// 取出 auth.token 的值。
func renderLikeFrp(t *testing.T, cfg string, env []string) (token string, ok bool) {
	t.Helper()
	envs := map[string]string{}
	for _, kv := range env {
		k, v, _ := strings.Cut(kv, "=")
		envs[k] = v
	}
	tpl, err := template.New("frp").Parse(cfg)
	if err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	if err := tpl.Execute(&out, map[string]any{"Envs": envs}); err != nil {
		t.Fatal(err)
	}
	m := regexp.MustCompile(`(?m)^auth\.token = "([^"]*)"$`).FindStringSubmatch(out.String())
	if m == nil {
		return "", false
	}
	return escRe.ReplaceAllStringFunc(m[1], func(s string) string {
		n, _ := strconv.ParseUint(s[2:], 16, 32)
		return string(rune(n))
	}), true
}

// 自定义 frps：配置文件里不再有 token，只有环境变量模板；token 经环境变量传给 frpc，按 frp 的渲染办法能原样还原。
func TestCustomFrpcConfigHasNoToken(t *testing.T) {
	tempBase(t)
	tun := &Tunnel{ID: "tun7", Provider: "custom", Credential: nasty, ServerAddr: "frp.example.com", ServerPort: 7000, RemotePort: 25566, LocalPort: 25565}
	args, env, err := customProvider{}.Launch(tun)
	if err != nil {
		t.Fatal(err)
	}
	if len(args) != 2 || args[0] != "-c" {
		t.Fatalf("启动参数不对：%v", args)
	}
	for _, a := range args {
		if strings.Contains(a, "tok+en") {
			t.Fatal("token 出现在命令行参数里")
		}
	}
	cfg := readFile(t, args[1])
	if strings.Contains(cfg, "tok+en") || strings.Contains(cfg, "中文") || !strings.HasPrefix(cfg, `auth.token = "{{ .Envs.MINEDECK_FRP_TOKEN }}"`) {
		t.Fatalf("配置文件里有明文 token，或模板不在第一行：\n%s", cfg)
	}
	if len(env) != 1 || !strings.HasPrefix(env[0], "MINEDECK_FRP_TOKEN=") || strings.Contains(env[0], "tok+en") {
		t.Fatalf("环境变量不对：%v", env)
	}
	if got, ok := renderLikeFrp(t, cfg, env); !ok || got != nasty {
		t.Fatalf("按 frp 的办法渲染出的 token = %q（%v），应为 %q", got, ok, nasty)
	}
	// 直接把原文放进环境变量会被 html/template 转义（这就是要先转成 \u 的原因）
	if got, _ := renderLikeFrp(t, cfg, []string{"MINEDECK_FRP_TOKEN=a+b&c"}); got == "a+b&c" {
		t.Fatal("预期 html/template 会转义 + 和 &")
	}
	// frps 没设 token：不写 auth.token，也不传环境变量
	tun.Credential = ""
	args, env, err = customProvider{}.Launch(tun)
	if err != nil || len(env) != 0 || strings.Contains(readFile(t, args[1]), "auth.token") {
		t.Fatalf("没有 token 时：env=%v err=%v\n%s", env, err, readFile(t, args[1]))
	}
}

// tunnels.json 的整体结构不变（老版本读得懂、字段没少）。
func TestTunnelsJSONShape(t *testing.T) {
	tempBase(t)
	m := NewManager()
	if _, err := m.Add(Tunnel{Provider: "openfrp", Name: "a", Credential: "k", ProxyID: "1", LocalPort: 25565}); err != nil {
		t.Fatal(err)
	}
	var data struct {
		Seq     int              `json:"seq"`
		Tunnels []map[string]any `json:"tunnels"`
	}
	if err := json.Unmarshal([]byte(readFile(t, filepath.Join(app.Base, "tunnels.json"))), &data); err != nil {
		t.Fatal(err)
	}
	if data.Seq != 1 || len(data.Tunnels) != 1 || data.Tunnels[0]["id"] != "tun1" || data.Tunnels[0]["proxyId"] != "1" {
		t.Fatalf("tunnels.json 结构变了：%+v", data)
	}
}
