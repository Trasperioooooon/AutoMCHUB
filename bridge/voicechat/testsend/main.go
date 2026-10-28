// testsend 是 MineDeck 音乐共享桥接模组的测试发送端：连上模组、握手，然后按每 20 毫秒一帧发送
// 测试音或 WAV 文件里的声音。用来在没有 MineDeck 新版的情况下验证协议和整条链路。
//
// 常用：
//
//	testsend -config <实例目录>/config/minedeck/voicebridge.properties             # 发 30 秒 440 Hz
//	testsend -config ... -tone 0 -duration 0                                     # 一直发音阶，Ctrl+C 结束
//	testsend -config ... -wav 歌.wav -loop                                        # 循环发 WAV
//
// 退出码：0 正常结束；1 本地错误（参数、文件、连不上）；2 模组拒绝（ERROR 帧）；3 连接中途断开。
package main

import (
	"bufio"
	"context"
	"encoding/binary"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type options struct {
	addr      string
	token     string
	name      string
	reconnect bool
	stall     time.Duration
	quiet     bool
	interval  time.Duration
}

// serverError：模组回了 ERROR 帧。
type serverError struct {
	code int
	msg  string
}

func (e *serverError) Error() string {
	return fmt.Sprintf("模组拒绝：错误码 %d，%s", e.code, e.msg)
}

// endError：模组发来 END 主动结束。
type endError struct{ reason string }

func (e *endError) Error() string { return "模组结束了连接：" + e.reason }

func main() {
	var (
		configPath = flag.String("config", "", "模组的配置文件（从里面读 port 和 token），例如 <实例目录>/config/minedeck/voicebridge.properties")
		addr       = flag.String("addr", "", "模组地址；默认 127.0.0.1:<配置里的 port>，没有配置文件时 127.0.0.1:24470")
		token      = flag.String("token", "", "共享令牌；默认从 -config 读")
		name       = flag.String("name", "testsend", "广播者名字，会出现在模组日志里")
		tone       = flag.Float64("tone", 440, "正弦波频率（Hz）；0 表示播放 C 大调琶音")
		wavPath    = flag.String("wav", "", "发送这个 WAV 文件（16/24/32 位 PCM 或 32 位浮点，任意声道和采样率）")
		gain       = flag.Float64("gain", 0.3, "音量，0 到 1")
		duration   = flag.Duration("duration", 30*time.Second, "发送多久；0 表示一直发（WAV 不加 -loop 时播完就停）")
		loop       = flag.Bool("loop", false, "WAV 播完后从头再来")
		reconnect  = flag.Bool("reconnect", false, "断线后每 2 秒重连一次，直到发完或按 Ctrl+C")
		stall      = flag.Duration("stall", 0, "（测试用）握手后先这么久什么都不发，用来验证模组的心跳超时")
		quiet      = flag.Bool("quiet", false, "不打印模组发来的 STATUS")
		speed      = flag.Float64("speed", 1, "（测试用）发送速度倍数，比如 1.02 表示比实时快 2%，用来模拟两边时钟有偏差")
	)
	flag.Parse()

	if *speed < 0.5 || *speed > 2 {
		fatal(1, "-speed 要在 0.5 到 2 之间")
	}
	opts := options{addr: *addr, token: *token, name: *name, reconnect: *reconnect, stall: *stall, quiet: *quiet,
		interval: time.Duration(float64(20*time.Millisecond) / *speed)}
	if *configPath != "" {
		cfg, err := readProperties(*configPath)
		if err != nil {
			fatal(1, "读配置文件失败：%v", err)
		}
		if opts.addr == "" && cfg["port"] != "" {
			opts.addr = "127.0.0.1:" + cfg["port"]
		}
		if opts.token == "" {
			opts.token = cfg["token"]
		}
		if v := strings.ToLower(cfg["enabled"]); v != "true" && v != "1" && v != "yes" && v != "on" {
			fmt.Println("提示：配置文件里 enabled 不是 true，模组可能没有打开端口")
		}
	}
	if opts.addr == "" {
		opts.addr = "127.0.0.1:24470"
	}
	if opts.token == "" {
		fatal(1, "没有令牌：用 -config 指定模组配置文件，或者用 -token 直接给出")
	}

	if len(opts.token) > 255 {
		fatal(1, "令牌不能超过 255 字节")
	}
	gainSet := false
	flag.Visit(func(f *flag.Flag) { gainSet = gainSet || f.Name == "gain" })

	var src source
	if *wavPath != "" {
		pcm, err := loadWAV(*wavPath)
		if err != nil {
			fatal(1, "读 WAV 失败：%v", err)
		}
		fmt.Printf("WAV：%.1f 秒（已转成 48 kHz 单声道）\n", float64(len(pcm))/sampleRate)
		g := 1.0 // WAV 默认按原音量
		if gainSet {
			g = *gain
		}
		src = &pcmSource{data: pcm, gain: g, loop: *loop}
	} else {
		src = &toneSource{freq: *tone, gain: *gain}
	}
	frames := int64(-1)
	if *duration > 0 {
		frames = int64(*duration / (20 * time.Millisecond))
	}
	src = &limited{src: src, n: frames}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	for attempt := 1; ; attempt++ {
		done, err := stream(ctx, opts, src)
		if done {
			return
		}
		var se *serverError
		if errors.As(err, &se) && se.code != errBusy {
			fatal(2, "%v", err)
		}
		if !opts.reconnect {
			if se != nil {
				fatal(2, "%v", err)
			}
			fatal(3, "%v", err)
		}
		fmt.Printf("%v；2 秒后重连（第 %d 次）\n", err, attempt)
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
	}
}

// stream 连一次、发到结束。done 为真表示不用再重连了（发完了或用户按了 Ctrl+C）。
func stream(ctx context.Context, opts options, src source) (done bool, err error) {
	conn, err := net.DialTimeout("tcp", opts.addr, 3*time.Second)
	if err != nil {
		return false, fmt.Errorf("连不上 %s：%w", opts.addr, err)
	}
	defer conn.Close()

	hello, err := helloPayload(opts.token, opts.name)
	if err != nil {
		fatal(1, "%v", err)
	}
	if err := writeFrame(conn, typeHello, hello); err != nil {
		return false, err
	}
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	f, err := readFrame(conn)
	if err != nil {
		return false, fmt.Errorf("握手失败：%w", err)
	}
	switch f.typ {
	case typeWelcome:
		w, err := parseWelcome(f.payload)
		if err != nil {
			return false, err
		}
		fmt.Printf("握手成功：模组 %s，协议 %d，%d Hz，每帧 %d 个采样，%d 声道，当前听众 %d 位\n",
			w.modVersion, w.version, w.sampleRate, w.frameSamples, w.channels, w.listeners)
	case typeError:
		code, msg := parseError(f.payload)
		return false, &serverError{code, msg}
	default:
		return false, fmt.Errorf("握手失败：收到意外的帧类型 0x%02x", f.typ)
	}

	errc := make(chan error, 1)
	go readLoop(conn, opts.quiet, errc)

	if opts.stall > 0 {
		fmt.Printf("（测试）%s 内什么都不发\n", opts.stall)
		select {
		case err := <-errc:
			return false, err
		case <-time.After(opts.stall):
		}
	}

	next := time.Now()
	lastPing := time.Time{}
	var seq uint32
	for {
		select {
		case err := <-errc:
			return false, err
		case <-ctx.Done():
			_ = writeFrame(conn, typeEnd, []byte("用户停止"))
			fmt.Println("已停止")
			return true, nil
		default:
		}
		samples, ok := src.next()
		if !ok {
			_ = writeFrame(conn, typeEnd, []byte("发送完毕"))
			fmt.Printf("发送完毕，本次共 %d 帧\n", seq)
			time.Sleep(200 * time.Millisecond)
			return true, nil
		}
		if err := writeFrame(conn, typePCM, pcmFrame(seq, samples)); err != nil {
			return false, fmt.Errorf("发送失败：%w", err)
		}
		seq++
		if time.Since(lastPing) >= time.Second {
			lastPing = time.Now()
			var ts [8]byte
			binary.LittleEndian.PutUint64(ts[:], uint64(lastPing.UnixNano()))
			if err := writeFrame(conn, typePing, ts[:]); err != nil {
				return false, fmt.Errorf("发送失败：%w", err)
			}
		}
		next = next.Add(opts.interval)
		if d := time.Until(next); d > 0 {
			time.Sleep(d)
		} else if d < -100*time.Millisecond {
			next = time.Now() // 落后太多就重新对齐，不一口气补发
		}
	}
}

func readLoop(conn net.Conn, quiet bool, errc chan<- error) {
	var rtt time.Duration
	for {
		_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		f, err := readFrame(conn)
		if err != nil {
			var ne net.Error
			if errors.As(err, &ne) && ne.Timeout() {
				errc <- errors.New("心跳超时：5 秒没收到模组的数据")
			} else if errors.Is(err, io.EOF) {
				errc <- errors.New("模组关闭了连接")
			} else {
				errc <- fmt.Errorf("连接断开：%w", err)
			}
			return
		}
		switch f.typ {
		case typePong:
			if len(f.payload) == 8 {
				sent := int64(binary.LittleEndian.Uint64(f.payload))
				rtt = time.Since(time.Unix(0, sent))
			}
		case typeStatus:
			s, err := parseStatus(f.payload)
			if err == nil && !quiet {
				fmt.Printf("状态：听众 %d 位，缓冲 %d 帧，音源 %s，已收 %d 帧，已编码 %d，已发出 %d，丢弃 %d，欠载 %d，往返 %s\n",
					s.listeners, s.buffered, sourceName(s.source), s.received, s.played, s.sent, s.dropped, s.underruns,
					rtt.Round(100*time.Microsecond))
			}
		case typeEnd:
			errc <- &endError{reason: string(f.payload)}
			return
		case typeError:
			code, msg := parseError(f.payload)
			errc <- &serverError{code, msg}
			return
		}
	}
}

// readProperties 读模组的 .properties 配置（只处理 key=value 这种简单写法）。
func readProperties(path string) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	m := map[string]string{}
	sc := bufio.NewScanner(f)
	first := true
	for sc.Scan() {
		line := sc.Text()
		if first {
			line = strings.TrimPrefix(line, "\ufeff")
			first = false
		}
		line = strings.TrimSpace(line)
		if line == "" || line[0] == '#' || line[0] == '!' {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			k, v, ok = strings.Cut(line, ":")
		}
		if ok {
			m[strings.TrimSpace(k)] = strings.TrimSpace(v)
		}
	}
	if p := m["port"]; p != "" {
		if _, err := strconv.Atoi(p); err != nil {
			return nil, fmt.Errorf("port 不是数字：%q", p)
		}
	}
	return m, sc.Err()
}

func fatal(code int, format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(code)
}
