package inst

import (
	"bufio"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"automchub/internal/events"
	"automchub/internal/mcsrc"
	"automchub/internal/procutil"

	"golang.org/x/text/encoding/simplifiedchinese"
)

// Console 与进程工具已提升至 procutil 供 inst/tunnel 共用，此处保留薄别名。

type Console = procutil.Console

func newConsole() *Console { return procutil.NewConsole() }

func assignToJob(p *os.Process) { procutil.AssignToJob(p) }

func cleanEnv() []string { return procutil.CleanEnv() }

func hideWindow(cmd *exec.Cmd) { procutil.HideWindow(cmd) }

// ---------- 服务器进程托管 ----------

type proc struct {
	cmd   *exec.Cmd
	stdin *bufio.Writer
	inMu  sync.Mutex
}

// CheckPort 预检端口是否可绑定（占用检测防呆）。
func CheckPort(port int) error {
	ln, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		return fmt.Errorf("端口 %d 已被其他程序占用，请在设置中修改 server-port 或关闭占用程序", port)
	}
	ln.Close()
	return nil
}

// Start 启动服务器进程。
func (m *Manager) Start(name string) error {
	i, err := m.Get(name)
	if err != nil {
		return err
	}
	i.procMu.Lock()
	defer i.procMu.Unlock()
	if i.state != "" && i.state != "stopped" {
		return fmt.Errorf("服务器当前状态为 %s", i.state)
	}
	if _, err := os.Stat(i.JavaPath); err != nil {
		return fmt.Errorf("Java 运行时缺失（%s），请勿手动删除 runtimes 目录；可删除实例后重新创建", i.JavaPath)
	}
	// 代理端端口在其自带配置文件中，跳过 server.properties 端口预检
	if mcsrc.KindOf(i.Core) != mcsrc.KindProxy {
		if err := CheckPort(i.Port()); err != nil {
			return err
		}
	}

	args := launchArgs(i)
	cmd := exec.Command(i.JavaPath, args...)
	cmd.Dir = i.Dir
	cmd.Env = cleanEnv()
	hideWindow(cmd)

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = cmd.Stdout

	i.Console.Append(fmt.Sprintf("[AutoMCHUB] 启动: java %s", strings.Join(args, " ")))
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("启动失败: %w", err)
	}
	assignToJob(cmd.Process)
	i.proc = &proc{cmd: cmd, stdin: bufio.NewWriter(stdin)}
	i.state = "starting"
	i.userStop = false
	i.startedAt = time.Now()
	i.runGen++
	gen := i.runGen // 本次运行的代号：崩溃重启只在无更新的运行发生时才生效
	i.clearOnline()

	go func() {
		sc := bufio.NewScanner(stdout)
		sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for sc.Scan() {
			line := strings.TrimRight(decodeConsole(sc.Bytes(), i.consoleEnc()), "\r")
			i.Console.Append(line)
			i.trackPlayers(line)
			if serverReady(line) {
				i.procMu.Lock()
				if i.state == "starting" {
					i.state = "running"
				}
				i.procMu.Unlock()
			}
		}
		err := cmd.Wait()
		i.procMu.Lock()
		wasUser := i.userStop
		crashPolicy := i.Policies.CrashRestart
		i.state = "stopped"
		i.proc = nil
		i.procMu.Unlock()
		i.clearOnline()
		if err != nil {
			i.Console.Append(fmt.Sprintf("[AutoMCHUB] 服务器进程已退出（%v）", err))
		} else {
			i.Console.Append("[AutoMCHUB] 服务器已正常关闭")
		}
		if wasUser {
			events.Publish("instance.stop", map[string]any{"instance": i.Name})
		} else {
			events.Publish("instance.crash", map[string]any{"instance": i.Name})
		}
		if !wasUser && crashPolicy {
			go m.crashRestart(i, gen)
		}
	}()
	events.Publish("instance.start", map[string]any{"instance": i.Name})
	return nil
}

// Stop 优雅停止：发送 stop 命令，超时 30 秒后强杀。
func (m *Manager) Stop(name string) error {
	i, err := m.Get(name)
	if err != nil {
		return err
	}
	i.procMu.Lock()
	p := i.proc
	if p == nil || i.state == "stopped" {
		i.procMu.Unlock()
		return fmt.Errorf("服务器未在运行")
	}
	i.state = "stopping"
	i.userStop = true
	i.procMu.Unlock()

	i.Console.Append("[AutoMCHUB] 正在保存世界并停止服务器...")
	_ = writeLine(p, "stop")
	go func() {
		deadline := time.After(30 * time.Second)
		tick := time.NewTicker(500 * time.Millisecond)
		defer tick.Stop()
		for {
			select {
			case <-deadline:
				// 仅当仍是本次要停止的那个进程时才强杀——否则可能误杀期间已重启的新进程
				i.procMu.Lock()
				if i.proc == p {
					i.Console.Append("[AutoMCHUB] 停止超时，强制结束进程")
					_ = p.cmd.Process.Kill()
				}
				i.procMu.Unlock()
				return
			case <-tick.C:
				i.procMu.Lock()
				gone := i.proc != p // 本次进程已退出（i.proc 置空或已换成新一次运行）
				i.procMu.Unlock()
				if gone {
					return
				}
			}
		}
	}()
	return nil
}

// Kill 立即强制结束进程。
func (m *Manager) Kill(name string) error {
	i, err := m.Get(name)
	if err != nil {
		return err
	}
	i.procMu.Lock()
	defer i.procMu.Unlock()
	if i.proc == nil {
		return fmt.Errorf("服务器未在运行")
	}
	i.userStop = true
	i.Console.Append("[AutoMCHUB] 强制结束进程")
	return i.proc.cmd.Process.Kill()
}

// Command 向服务器控制台发送命令。
func (m *Manager) Command(name, cmd string) error {
	i, err := m.Get(name)
	if err != nil {
		return err
	}
	i.procMu.Lock()
	p := i.proc
	i.procMu.Unlock()
	if p == nil {
		return fmt.Errorf("服务器未在运行")
	}
	cmd = strings.TrimSpace(cmd)
	if cmd == "" {
		return nil
	}
	i.Console.Append("> " + cmd)
	return writeLine(p, cmd)
}

func writeLine(p *proc, line string) error {
	p.inMu.Lock()
	defer p.inMu.Unlock()
	if _, err := p.stdin.WriteString(line + "\n"); err != nil {
		return err
	}
	return p.stdin.Flush()
}

// serverReady 识别各核心的"启动完成"输出。
func serverReady(line string) bool {
	switch {
	case strings.Contains(line, "Done (") && strings.Contains(line, ")!"): // vanilla/paper/forge/velocity 等
		return true
	case strings.Contains(line, "Mohist 启动成功"), strings.Contains(line, "Mohist started"): // Mohist 中/英
		return true
	case strings.Contains(line, "Listening on /"): // BungeeCord/Waterfall
		return true
	}
	return false
}

// decodeConsole 按实例配置解码服务器输出（解决老 Forge 包 GBK 中文乱码）。
func decodeConsole(b []byte, enc string) string {
	switch enc {
	case "utf-8":
		return string(b)
	case "gbk":
		if d, err := simplifiedchinese.GBK.NewDecoder().Bytes(b); err == nil {
			return string(d)
		}
	default: // auto：优先 UTF-8，非法字节序列则按 GBK 解
		if utf8.Valid(b) {
			return string(b)
		}
		if d, err := simplifiedchinese.GBK.NewDecoder().Bytes(b); err == nil {
			return string(d)
		}
	}
	return string(b)
}

// ShutdownAll 程序退出前优雅停止所有运行中的服务器。
func (m *Manager) ShutdownAll(wait time.Duration) {
	var running []string
	for _, i := range m.List() {
		if i.Status() != "stopped" {
			running = append(running, i.Name)
		}
	}
	for _, n := range running {
		_ = m.Stop(n)
	}
	if len(running) == 0 {
		return
	}
	deadline := time.After(wait)
	tick := time.NewTicker(300 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case <-deadline:
			return
		case <-tick.C:
			all := true
			for _, n := range running {
				if i, err := m.Get(n); err == nil && i.Status() != "stopped" {
					all = false
				}
			}
			if all {
				return
			}
		}
	}
}

// OpenDir 在资源管理器中打开实例目录，或其白名单子目录（sub，做穿越防护）。
func (m *Manager) OpenDir(name, sub string) error {
	i, err := m.Get(name)
	if err != nil {
		return err
	}
	target := i.Dir
	if sub = strings.TrimSpace(sub); sub != "" {
		clean := filepath.Clean(sub)
		if filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
			return fmt.Errorf("非法子目录")
		}
		target = filepath.Join(i.Dir, clean)
	}
	if st, err := os.Stat(target); err != nil || !st.IsDir() {
		return fmt.Errorf("目录尚不存在（服务器可能还没生成它）")
	}
	return exec.Command("explorer.exe", filepath.Clean(target)).Start()
}
