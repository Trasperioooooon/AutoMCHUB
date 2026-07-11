// Package tunnel 内网穿透：托管各服务商的 frpc 客户端进程，
// 把本地 MC 服务器端口映射到公网。隧道的创建/删除在服务商官网完成，
// 本包负责凭据保存、frpc 下载、一键启动、公网地址提取与状态管理。
package tunnel

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"automchub/internal/app"
	"automchub/internal/events"
	"automchub/internal/procutil"
)

// Tunnel 一条穿透隧道的配置。
type Tunnel struct {
	ID         string `json:"id"`
	Provider   string `json:"provider"` // openfrp | natfrp | custom
	Name       string `json:"name"`
	Credential string `json:"credential"`          // openfrp 用户密钥 / natfrp 访问密钥 / custom auth token
	ProxyID    string `json:"proxyId,omitempty"`   // openfrp 隧道ID / natfrp 隧道ID
	ServerAddr string `json:"serverAddr,omitempty"` // custom: frps 地址
	ServerPort int    `json:"serverPort,omitempty"` // custom: frps 端口
	RemotePort int    `json:"remotePort,omitempty"` // custom: 公网端口
	LocalPort  int    `json:"localPort"`            // 本地 MC 端口
	Bound      string `json:"boundInstance,omitempty"`
	AutoStart  bool   `json:"autoStart"` // 跟随绑定实例启动
	PublicAddr string `json:"publicAddr,omitempty"`
}

type runState struct {
	cmd     *exec.Cmd
	stdin   *bufio.Writer
	stopped bool // 用户主动停止
}

type Manager struct {
	mu       sync.Mutex
	tunnels  []*Tunnel
	seq      int
	running  map[string]*runState
	consoles map[string]*procutil.Console
}

func NewManager() *Manager {
	m := &Manager{running: map[string]*runState{}, consoles: map[string]*procutil.Console{}}
	m.load()
	return m
}

func (m *Manager) file() string { return filepath.Join(app.Base, "tunnels.json") }

func (m *Manager) load() {
	b, err := os.ReadFile(m.file())
	if err != nil {
		return
	}
	var data struct {
		Seq     int       `json:"seq"`
		Tunnels []*Tunnel `json:"tunnels"`
	}
	if json.Unmarshal(b, &data) == nil {
		m.tunnels, m.seq = data.Tunnels, data.Seq
	}
}

func (m *Manager) save() {
	data := struct {
		Seq     int       `json:"seq"`
		Tunnels []*Tunnel `json:"tunnels"`
	}{m.seq, m.tunnels}
	if b, err := json.MarshalIndent(data, "", "  "); err == nil {
		_ = os.WriteFile(m.file(), b, 0o600) // 凭据文件收紧权限
	}
}

// Status 隧道运行状态。
type Status struct {
	Tunnel
	Running bool `json:"running"`
}

func (m *Manager) List() []Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]Status, 0, len(m.tunnels))
	for _, t := range m.tunnels {
		st := Status{Tunnel: *t, Running: m.running[t.ID] != nil}
		st.Credential = "" // 凭据绝不下发（前端无需回显）
		out = append(out, st)
	}
	return out
}

func (m *Manager) get(id string) *Tunnel {
	for _, t := range m.tunnels {
		if t.ID == id {
			return t
		}
	}
	return nil
}

// Console 返回隧道的日志缓冲（惰性创建）。
func (m *Manager) Console(id string) *procutil.Console {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.consoles[id] == nil {
		m.consoles[id] = procutil.NewConsole()
	}
	return m.consoles[id]
}

// Add 新增隧道配置。
func (m *Manager) Add(t Tunnel) (*Tunnel, error) {
	if err := validate(&t); err != nil {
		return nil, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.seq++
	t.ID = "tun" + strconv.Itoa(m.seq)
	nt := &t
	m.tunnels = append(m.tunnels, nt)
	m.save()
	resp := *nt
	resp.Credential = "" // 响应不回显凭据
	return &resp, nil
}

// Update 更新隧道配置（运行中不可改）。
func (m *Manager) Update(id string, t Tunnel) error {
	if err := validate(&t); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.running[id] != nil {
		return fmt.Errorf("请先停止隧道再修改")
	}
	old := m.get(id)
	if old == nil {
		return fmt.Errorf("隧道不存在")
	}
	t.ID = id
	if t.Credential == "" {
		t.Credential = old.Credential // 凭据留空表示不修改（列表接口不回显凭据）
	}
	*old = t
	m.save()
	return nil
}

func (m *Manager) Delete(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.running[id] != nil {
		return fmt.Errorf("请先停止隧道再删除")
	}
	for i, t := range m.tunnels {
		if t.ID == id {
			m.tunnels = append(m.tunnels[:i], m.tunnels[i+1:]...)
			m.save()
			return nil
		}
	}
	return fmt.Errorf("隧道不存在")
}

func validate(t *Tunnel) error {
	t.Name = strings.TrimSpace(t.Name)
	t.Credential = strings.TrimSpace(t.Credential)
	if t.Name == "" {
		return fmt.Errorf("请填写隧道名称")
	}
	switch t.Provider {
	case "openfrp", "natfrp":
		if t.Credential == "" || strings.TrimSpace(t.ProxyID) == "" {
			return fmt.Errorf("请填写凭据与隧道 ID（在服务商官网创建隧道后获取）")
		}
	case "custom":
		if t.ServerAddr == "" || t.ServerPort <= 0 || t.RemotePort <= 0 {
			return fmt.Errorf("自定义 frps 需填写服务器地址、端口与公网远程端口")
		}
		if t.LocalPort <= 0 {
			return fmt.Errorf("请填写本地端口（MC 服务器端口）")
		}
	default:
		return fmt.Errorf("未知服务商: %s", t.Provider)
	}
	return nil
}

// Start 启动隧道的 frpc 进程。
func (m *Manager) Start(id string) error {
	m.mu.Lock()
	t := m.get(id)
	if t == nil {
		m.mu.Unlock()
		return fmt.Errorf("隧道不存在")
	}
	if m.running[id] != nil {
		m.mu.Unlock()
		return fmt.Errorf("隧道已在运行")
	}
	m.mu.Unlock()

	con := m.Console(id)
	p := providerOf(t.Provider)
	if p == nil {
		return fmt.Errorf("未知服务商: %s", t.Provider)
	}
	exe, err := p.EnsureFrpc(con)
	if err != nil {
		con.Append("[AutoMCHUB] ❌ " + err.Error())
		return err
	}
	args, err := p.LaunchArgs(t)
	if err != nil {
		con.Append("[AutoMCHUB] ❌ " + err.Error())
		return err
	}
	cmd := exec.Command(exe, args...)
	cmd.Dir = filepath.Dir(exe)
	// frpc 会读取 HTTP_PROXY 等环境变量并把与 frps 的连接送进 HTTP 代理
	//（且不遵守 NO_PROXY），穿透流量必须直连，故剥离代理变量。
	cmd.Env = dropProxyEnv(procutil.CleanEnv())
	procutil.HideWindow(cmd)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = cmd.Stdout
	con.Append(fmt.Sprintf("[AutoMCHUB] 启动 frpc（%s）...", t.Provider))
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("frpc 启动失败: %w", err)
	}
	procutil.AssignToJob(cmd.Process)
	rs := &runState{cmd: cmd, stdin: bufio.NewWriter(stdin)}
	m.mu.Lock()
	m.running[id] = rs
	m.mu.Unlock()

	go func() {
		sc := bufio.NewScanner(stdout)
		sc.Buffer(make([]byte, 0, 64*1024), 512*1024)
		for sc.Scan() {
			line := strings.TrimRight(sc.Text(), "\r")
			con.Append(line)
			m.handleLine(t, rs, line)
		}
		_ = cmd.Wait()
		m.mu.Lock()
		userStopped := rs.stopped
		delete(m.running, id)
		m.mu.Unlock()
		if userStopped {
			con.Append("[AutoMCHUB] 隧道已停止")
		} else {
			con.Append("[AutoMCHUB] frpc 意外退出（检查凭据/隧道 ID 是否正确，或查看上方日志）")
			events.Publish("tunnel.down", map[string]any{"tunnel": t.Name})
		}
	}()
	return nil
}

var addrRe = regexp.MustCompile(`([A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z0-9.-]+:\d{2,5}|\d{1,3}(?:\.\d{1,3}){3}:\d{2,5})`)

// handleLine 解析 frpc 输出：提取公网地址、自动应答服务条款确认。
func (m *Manager) handleLine(t *Tunnel, rs *runState, line string) {
	low := strings.ToLower(line)
	// 樱花 frpc 首次运行的服务条款确认
	if strings.Contains(line, "同意") && (strings.Contains(low, "y/n") || strings.Contains(line, "请输入")) {
		rs.stdin.WriteString("y\n")
		rs.stdin.Flush()
		return
	}
	success := strings.Contains(low, "start proxy success") ||
		strings.Contains(line, "启动成功") || strings.Contains(line, "映射启动成功") ||
		strings.Contains(line, "创建成功") || strings.Contains(low, "proxy added")
	hasAddr := addrRe.FindString(line)
	if t.Provider == "custom" && success {
		m.setPublicAddr(t, fmt.Sprintf("%s:%d", t.ServerAddr, t.RemotePort))
		return
	}
	if hasAddr != "" && (success || strings.Contains(line, "连接") || strings.Contains(low, "remote")) {
		// 排除明显的本地/服务器内部地址
		if !strings.HasPrefix(hasAddr, "127.") && !strings.HasPrefix(hasAddr, "0.0.0.0") {
			m.setPublicAddr(t, hasAddr)
		}
	}
}

func (m *Manager) setPublicAddr(t *Tunnel, addr string) {
	m.mu.Lock()
	changed := t.PublicAddr != addr
	t.PublicAddr = addr
	if changed {
		m.save()
	}
	m.mu.Unlock()
	if changed {
		m.Console(t.ID).Append("[AutoMCHUB] ✔ 公网地址: " + addr + "（把它发给朋友直连）")
		events.Publish("tunnel.up", map[string]any{"tunnel": t.Name, "addr": addr})
	}
}

// Stop 停止隧道。
func (m *Manager) Stop(id string) error {
	m.mu.Lock()
	rs := m.running[id]
	if rs == nil {
		m.mu.Unlock()
		return fmt.Errorf("隧道未在运行")
	}
	rs.stopped = true
	m.mu.Unlock()
	_ = rs.cmd.Process.Kill() // frpc 无状态，直接结束
	return nil
}

// StartBound 启动绑定到某实例且开启了跟随启动的隧道（实例启动后调用）。
func (m *Manager) StartBound(instance string) {
	m.mu.Lock()
	var ids []string
	for _, t := range m.tunnels {
		if t.Bound == instance && t.AutoStart && m.running[t.ID] == nil {
			ids = append(ids, t.ID)
		}
	}
	m.mu.Unlock()
	for _, id := range ids {
		id := id
		go func() {
			time.Sleep(2 * time.Second) // 等服务器进入启动流程
			if err := m.Start(id); err != nil {
				m.Console(id).Append("[AutoMCHUB] 跟随启动失败: " + err.Error())
			}
		}()
	}
}

func dropProxyEnv(env []string) []string {
	drop := map[string]bool{
		"HTTP_PROXY": true, "HTTPS_PROXY": true, "ALL_PROXY": true, "NO_PROXY": true,
	}
	out := env[:0]
	for _, kv := range env {
		k, _, _ := strings.Cut(kv, "=")
		if !drop[strings.ToUpper(k)] {
			out = append(out, kv)
		}
	}
	return out
}

// StopAll 程序退出前停止全部 frpc。
func (m *Manager) StopAll() {
	m.mu.Lock()
	var ids []string
	for id := range m.running {
		ids = append(ids, id)
	}
	m.mu.Unlock()
	for _, id := range ids {
		_ = m.Stop(id)
	}
}
