// testctl 模拟 MineDeck，连上伙伴模组的本机控制端口发指令（协议草案见 companion/README.md）。
//
//	testctl -config <实例目录>/config/minedeck/companion.properties demo [-item oak_log] [-count 3]
//	testctl -config ... send '{"op":"status"}'
//	testctl -config ... repl            # 标准输入一行一条 JSON 指令
//
// 退出码：0 正常；1 本地错误；2 模组拒绝连接；3 连接中途断开；4 demo 没做成（任务失败、不够数或超时）。
package main

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	protoVersion = 1
	maxPayload   = 16 * 1024

	typeHello    = 0x01
	typeWelcome  = 0x02
	typeError    = 0x03
	typeRequest  = 0x10
	typeResponse = 0x11
	typeEvent    = 0x12
	typePing     = 0x20
	typePong     = 0x21
	typeStatus   = 0x30
	typeEnd      = 0x40
)

type frame struct {
	typ     byte
	payload []byte
}

func writeFrame(w io.Writer, typ byte, payload []byte) error {
	if len(payload) > maxPayload {
		return fmt.Errorf("帧太长：%d 字节", len(payload))
	}
	buf := make([]byte, 4+len(payload))
	buf[0] = typ
	binary.LittleEndian.PutUint16(buf[2:], uint16(len(payload)))
	copy(buf[4:], payload)
	_, err := w.Write(buf)
	return err
}

func readFrame(r io.Reader) (frame, error) {
	var h [4]byte
	if _, err := io.ReadFull(r, h[:]); err != nil {
		return frame{}, err
	}
	n := int(binary.LittleEndian.Uint16(h[2:]))
	if n > maxPayload {
		return frame{}, fmt.Errorf("帧太长：%d 字节", n)
	}
	p := make([]byte, n)
	if _, err := io.ReadFull(r, p); err != nil {
		return frame{}, err
	}
	return frame{h[0], p}, nil
}

// rejectError 模组用 ERROR 帧拒绝了连接。
type rejectError struct {
	code int
	msg  string
}

func (e *rejectError) Error() string {
	return fmt.Sprintf("模组拒绝：错误码 %d：%s", e.code, e.msg)
}

type client struct {
	c       net.Conn
	wmu     sync.Mutex
	nextID  int64
	mu      sync.Mutex
	waiting map[int64]chan map[string]any
	events  chan map[string]any
	done    chan struct{}
	err     error
	verbose bool
}

func dial(addr, token, name string, verbose bool) (*client, map[string]any, error) {
	c, err := net.DialTimeout("tcp", addr, 3*time.Second)
	if err != nil {
		return nil, nil, err
	}
	hello := []byte{byte(protoVersion), byte(protoVersion >> 8), byte(len(token))}
	hello = append(hello, token...)
	hello = append(hello, name...)
	if err := writeFrame(c, typeHello, hello); err != nil {
		c.Close()
		return nil, nil, err
	}
	_ = c.SetReadDeadline(time.Now().Add(5 * time.Second))
	f, err := readFrame(c)
	if err != nil {
		c.Close()
		return nil, nil, fmt.Errorf("等 WELCOME 时出错：%w", err)
	}
	_ = c.SetReadDeadline(time.Time{})
	switch f.typ {
	case typeWelcome:
	case typeError:
		c.Close()
		if len(f.payload) < 2 {
			return nil, nil, &rejectError{0, ""}
		}
		return nil, nil, &rejectError{int(binary.LittleEndian.Uint16(f.payload)), string(f.payload[2:])}
	default:
		c.Close()
		return nil, nil, fmt.Errorf("第一帧不是 WELCOME：0x%02x", f.typ)
	}
	if len(f.payload) < 2 {
		c.Close()
		return nil, nil, errors.New("WELCOME 太短")
	}
	var welcome map[string]any
	if err := json.Unmarshal(f.payload[2:], &welcome); err != nil {
		c.Close()
		return nil, nil, fmt.Errorf("WELCOME 不是 JSON：%w", err)
	}
	cl := &client{c: c, waiting: map[int64]chan map[string]any{}, events: make(chan map[string]any, 64),
		done: make(chan struct{}), verbose: verbose}
	go cl.readLoop()
	go cl.pingLoop()
	return cl, welcome, nil
}

func (cl *client) send(typ byte, p []byte) error {
	cl.wmu.Lock()
	defer cl.wmu.Unlock()
	return writeFrame(cl.c, typ, p)
}

func (cl *client) readLoop() {
	defer close(cl.done)
	for {
		f, err := readFrame(cl.c)
		if err != nil {
			cl.err = err
			return
		}
		switch f.typ {
		case typeResponse:
			var m map[string]any
			if json.Unmarshal(f.payload, &m) != nil {
				continue
			}
			fmt.Println("← RESPONSE", string(f.payload))
			id, _ := m["id"].(float64)
			cl.mu.Lock()
			ch := cl.waiting[int64(id)]
			delete(cl.waiting, int64(id))
			cl.mu.Unlock()
			if ch != nil {
				ch <- m
			}
		case typeEvent:
			fmt.Println("← EVENT", string(f.payload))
			var m map[string]any
			if json.Unmarshal(f.payload, &m) == nil {
				select {
				case cl.events <- m:
				default:
				}
			}
		case typeStatus:
			if cl.verbose {
				fmt.Println("← STATUS", string(f.payload))
			}
		case typePong:
		case typeEnd:
			fmt.Println("← END", string(f.payload))
			cl.err = errors.New("模组结束了连接：" + string(f.payload))
			return
		case typeError:
			msg := ""
			if len(f.payload) >= 2 {
				msg = string(f.payload[2:])
			}
			fmt.Println("← ERROR", msg)
		default:
			fmt.Printf("← 未知帧 0x%02x（%d 字节）\n", f.typ, len(f.payload))
		}
	}
}

func (cl *client) pingLoop() {
	t := time.NewTicker(2 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-cl.done:
			return
		case <-t.C:
			ts := make([]byte, 8)
			binary.LittleEndian.PutUint64(ts, uint64(time.Now().UnixNano()))
			if cl.send(typePing, ts) != nil {
				return
			}
		}
	}
}

// call 发一条指令，等它的回复。
func (cl *client) call(req map[string]any, timeout time.Duration) (map[string]any, error) {
	cl.mu.Lock()
	cl.nextID++
	id := cl.nextID
	ch := make(chan map[string]any, 1)
	cl.waiting[id] = ch
	cl.mu.Unlock()
	req["id"] = id
	b, _ := json.Marshal(req)
	fmt.Println("→ REQUEST", string(b))
	if err := cl.send(typeRequest, b); err != nil {
		return nil, err
	}
	select {
	case m := <-ch:
		return m, nil
	case <-cl.done:
		return nil, fmt.Errorf("连接断开：%v", cl.err)
	case <-time.After(timeout):
		return nil, errors.New("等回复超时")
	}
}

// waitEvent 等一个满足条件的事件。
func (cl *client) waitEvent(match func(map[string]any) bool, timeout time.Duration) (map[string]any, error) {
	deadline := time.After(timeout)
	for {
		select {
		case ev := <-cl.events:
			if match(ev) {
				return ev, nil
			}
		case <-cl.done:
			return nil, fmt.Errorf("连接断开：%v", cl.err)
		case <-deadline:
			return nil, errors.New("等事件超时")
		}
	}
}

func (cl *client) close(reason string) {
	_ = cl.send(typeEnd, []byte(reason))
	time.Sleep(100 * time.Millisecond)
	cl.c.Close()
}

// readConfig 读 companion.properties 里的 port 和 token（只认最简单的 key=value）。
func readConfig(path string) (port int, token string, err error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return 0, "", err
	}
	port = 24480
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		switch strings.TrimSpace(k) {
		case "port":
			if port, err = strconv.Atoi(strings.TrimSpace(v)); err != nil {
				return 0, "", fmt.Errorf("port 不是数字：%v", err)
			}
		case "token":
			token = strings.TrimSpace(v)
		}
	}
	return port, token, nil
}

func main() {
	config := flag.String("config", "", "伙伴模组的配置文件 config/minedeck/companion.properties")
	addr := flag.String("addr", "", "直接指定地址（127.0.0.1:端口），和 -token 一起用")
	token := flag.String("token", "", "令牌")
	verbose := flag.Bool("v", false, "也打印每 2 秒一次的 STATUS")
	flag.Usage = func() {
		fmt.Fprintln(os.Stderr, "用法：testctl -config <companion.properties> demo|send <JSON>|repl [参数]")
		flag.PrintDefaults()
	}
	flag.Parse()
	if *config != "" {
		port, tok, err := readConfig(*config)
		if err != nil {
			fail(1, "读配置失败：%v", err)
		}
		*addr = fmt.Sprintf("127.0.0.1:%d", port)
		if *token == "" {
			*token = tok
		}
	}
	if *addr == "" || flag.NArg() == 0 {
		flag.Usage()
		os.Exit(1)
	}
	cl, welcome, err := dial(*addr, *token, "testctl", *verbose)
	// 上一个连接刚断开时模组可能还没收拾完，"已经有一个控制连接"就隔半秒再试，最多 5 秒
	for i := 0; i < 10 && err != nil; i++ {
		var re *rejectError
		if !errors.As(err, &re) || re.code != 3 {
			break
		}
		time.Sleep(500 * time.Millisecond)
		cl, welcome, err = dial(*addr, *token, "testctl", *verbose)
	}
	if err != nil {
		var re *rejectError
		if errors.As(err, &re) {
			fail(2, "%v", err)
		}
		fail(1, "连接 %s 失败：%v", *addr, err)
	}
	wb, _ := json.Marshal(welcome)
	fmt.Println("← WELCOME", string(wb))

	switch flag.Arg(0) {
	case "send":
		var req map[string]any
		if err := json.Unmarshal([]byte(flag.Arg(1)), &req); err != nil {
			fail(1, "指令不是 JSON：%v", err)
		}
		res, err := cl.call(req, 10*time.Second)
		if err != nil {
			fail(3, "%v", err)
		}
		cl.close("testctl 发完了")
		if ok, _ := res["ok"].(bool); !ok {
			os.Exit(4)
		}
	case "repl":
		go func() {
			sc := bufio.NewScanner(os.Stdin)
			for sc.Scan() {
				line := strings.TrimSpace(sc.Text())
				if line == "" {
					continue
				}
				var req map[string]any
				if err := json.Unmarshal([]byte(line), &req); err != nil {
					fmt.Println("不是 JSON：", err)
					continue
				}
				go func() { _, _ = cl.call(req, 30*time.Second) }()
			}
			cl.close("标准输入结束")
		}()
		<-cl.done
	case "demo":
		fs := flag.NewFlagSet("demo", flag.ExitOnError)
		item := fs.String("item", "oak_log", "要采集的物品")
		count := fs.Int("count", 3, "数量")
		name := fs.String("name", "MineDeck伙伴", "伙伴的名字")
		timeout := fs.Duration("timeout", 5*time.Minute, "采集最多等多久")
		keep := fs.Bool("keep", false, "做完不移除伙伴")
		_ = fs.Parse(flag.Args()[1:])
		os.Exit(demo(cl, *name, *item, *count, *timeout, *keep))
	default:
		fail(1, "不认识的命令：%s", flag.Arg(0))
	}
}

func demo(cl *client, name, item string, count int, timeout time.Duration, keep bool) int {
	res, err := cl.call(map[string]any{"op": "spawn", "name": name}, 10*time.Second)
	if err != nil {
		fmt.Println("spawn 出错：", err)
		return 3
	}
	if ok, _ := res["ok"].(bool); !ok && res["code"] != "already_spawned" {
		return 4
	}
	// 控制器在伙伴第一次 tick 时创建，等它准备好
	ready := false
	for i := 0; i < 20 && !ready; i++ {
		st, err := cl.call(map[string]any{"op": "status"}, 10*time.Second)
		if err != nil {
			return 3
		}
		if c, ok := st["companion"].(map[string]any); ok {
			ready, _ = c["engineReady"].(bool)
		}
		if !ready {
			time.Sleep(500 * time.Millisecond)
		}
	}
	if !ready {
		fmt.Println("伙伴的 PlayerEngine 控制器一直没准备好")
		return 4
	}
	res, err = cl.call(map[string]any{"op": "collect", "item": item, "count": count}, 10*time.Second)
	if err != nil {
		return 3
	}
	if ok, _ := res["ok"].(bool); !ok {
		return 4
	}
	taskID := res["task"].(map[string]any)["id"].(float64)
	start := time.Now()
	ev, err := cl.waitEvent(func(m map[string]any) bool {
		if m["event"] != "task_finished" {
			return false
		}
		t, _ := m["task"].(map[string]any)
		return t != nil && t["id"] == taskID
	}, timeout)
	code := 0
	if err != nil {
		fmt.Println("采集没等到结果：", err)
		code = 4
		_, _ = cl.call(map[string]any{"op": "stop"}, 10*time.Second)
	} else {
		fmt.Printf("采集结束：result=%v 背包里共 %v 个，这次多了 %v 个（要 %v 个），用时 %.1f 秒\n", ev["result"], ev["have"], ev["gained"], ev["want"], time.Since(start).Seconds())
		if ev["result"] != "done" {
			code = 4
		}
	}
	st, err := cl.call(map[string]any{"op": "status"}, 10*time.Second)
	if err == nil {
		if c, ok := st["companion"].(map[string]any); ok {
			b, _ := json.Marshal(c["inventory"])
			fmt.Println("伙伴背包：", string(b))
		}
	}
	if !keep {
		if _, err := cl.call(map[string]any{"op": "despawn"}, 10*time.Second); err == nil {
			_, _ = cl.waitEvent(func(m map[string]any) bool { return m["event"] == "removed" }, 10*time.Second)
		}
	}
	cl.close("demo 结束")
	return code
}

func fail(code int, format string, a ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", a...)
	os.Exit(code)
}
