// audiocap 是「音乐共享」声音采集的测试小工具：列出音源，按进程或整机录音，写出 48kHz、16 位、
// 单声道的 WAV 供试听。每一步都打印 HRESULT；输出同时追加到 exe 旁边的 audiocap.log，方便整个发回来排查。
//
//	audiocap list
//	audiocap capture -pid <进程ID> -sec 10 -o out.wav
//	audiocap capture -name cloudmusic.exe -sec 10 -o out.wav
//	audiocap capture -system -sec 10 -o out.wav
package main

import (
	"bufio"
	"errors"
	"flag"
	"fmt"
	"io"
	"math"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"minedeck/internal/music"
)

const version = "原型 2026-10-28"

const usageText = `audiocap —— MineDeck 音乐共享的声音采集测试工具（` + version + `）

用法：
  audiocap list
      列出正在用声音的程序：进程 ID（PID）、exe 名、是否在播放、当前峰值
  audiocap capture -name cloudmusic.exe -sec 10 -o out.wav
      按 exe 名找到进程，只录它（含子进程）的声音（需要 Win11）
  audiocap capture -pid 1234 -sec 10 -o out.wav
      只录进程 1234（含子进程）的声音（需要 Win11）
  audiocap capture -system -sec 10 -o out.wav
      整机录音：默认播放设备上的全部声音

capture 的其他参数（排查用）：
  -format float|pcm16|pcm16-44k|native   指定初始化格式；默认自动依次尝试（native 只用于 -system）
  -ftm                                   回调对象换一种写法（聚合自由线程封送器），按进程录音失败时试试
  -gain 1.0                              音量增益

每次运行的输出都会追加到 exe 旁边的 audiocap.log。`

func main() {
	os.Exit(run(os.Args[1:]))
}

func run(args []string) int {
	if len(args) == 0 { // 多半是双击打开的：显示用法，等回车再关窗口
		fmt.Println(usageText)
		fmt.Print("\n请在 PowerShell 或命令提示符里运行（见使用说明）。按回车键退出……")
		bufio.NewReader(os.Stdin).ReadString('\n')
		return 2
	}
	l := openLogger()
	defer l.close()
	l.printf("===== audiocap %s · %s · %s · %s/%s =====", strings.Join(args, " "),
		time.Now().Format("2006-01-02 15:04:05"), version, runtime.Version(), runtime.GOARCH)
	switch args[0] {
	case "list":
		return cmdList(l)
	case "capture":
		return cmdCapture(l, args[1:])
	case "help", "-h", "-help", "--help", "/?":
		l.printf("%s", usageText)
		return 0
	}
	l.printf("未知命令：%s\n\n%s", args[0], usageText)
	return 2
}

// logger 把输出同时写到控制台和日志文件；采集线程也会调用，所以加锁。
type logger struct {
	mu   sync.Mutex
	file *os.File
	path string
}

func openLogger() *logger {
	dir := "."
	if exe, err := os.Executable(); err == nil {
		dir = filepath.Dir(exe)
	}
	path := filepath.Join(dir, "audiocap.log")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		fmt.Fprintf(os.Stderr, "（写不了日志文件 %s：%v；只输出到屏幕）\n", path, err)
		return &logger{}
	}
	// 万一在 COM 回调里崩溃，Go 的崩溃信息也写进日志，不只留在会被关掉的窗口里
	if err := debug.SetCrashOutput(f, debug.CrashOptions{}); err != nil {
		fmt.Fprintf(os.Stderr, "（崩溃信息不能写进日志：%v）\n", err)
	}
	return &logger{file: f, path: path}
}

func (l *logger) printf(format string, a ...any) {
	line := fmt.Sprintf(format, a...)
	l.mu.Lock()
	defer l.mu.Unlock()
	fmt.Println(line)
	if l.file != nil {
		fmt.Fprintln(l.file, line)
	}
}

func (l *logger) close() {
	if l.file != nil {
		l.printf("（以上内容已追加到 %s）\n", l.path)
		l.file.Close()
	}
}

func printSystem(l *logger) music.Capability {
	c := music.Detect()
	l.printf("系统：%s", c)
	if c.Warn {
		l.printf("注意：这台电脑只能整机录音。%s", music.SystemWarning)
	}
	return c
}

func cmdList(l *logger) int {
	printSystem(l)
	list, err := music.ListSources()
	if err != nil {
		l.printf("列出音源时出错：%v", err)
		if len(list) == 0 {
			if h := hint(err, music.ModeSystem); h != "" {
				l.printf("建议：%s", h)
			}
			return 1
		}
	}
	if len(list) == 0 {
		l.printf("没有找到任何程序的音频会话。先打开音乐软件并开始播放，再运行一次。")
		return 0
	}
	l.printf("找到 %d 个程序（正在播放、声音大的排在前面）：", len(list))
	l.printf("  %-7s %-5s %-4s %-26s %s", "PID", "峰值", "状态", "程序", "播放设备 / 会话名")
	for _, s := range list {
		state := "未播放"
		if s.Playing {
			state = "播放中"
		}
		exe := s.Exe
		if exe == "" {
			exe = "（取不到 exe 名）"
		}
		extra := strings.Join(s.Devices, "、")
		if s.Name != "" {
			extra += " / " + s.Name
		}
		l.printf("  %-7d %4.0f%%  %s  %-26s %s", s.PID, s.Peak*100, state, exe, extra)
	}
	l.printf("按进程录音：audiocap capture -pid <PID> -sec 10 -o out.wav（或 -name <exe 名>）")
	return 0
}

type captureConfig struct {
	pid    uint32
	name   string
	system bool
	sec    float64
	out    string
	format string
	gain   float64
	ftm    bool
}

func parseCapture(args []string) (captureConfig, error) {
	fs := flag.NewFlagSet("capture", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	var c captureConfig
	pid := fs.Uint64("pid", 0, "")
	fs.StringVar(&c.name, "name", "", "")
	fs.BoolVar(&c.system, "system", false, "")
	fs.Float64Var(&c.sec, "sec", 10, "")
	fs.StringVar(&c.out, "o", "out.wav", "")
	fs.StringVar(&c.format, "format", "", "")
	fs.Float64Var(&c.gain, "gain", 1, "")
	fs.BoolVar(&c.ftm, "ftm", false, "")
	if err := fs.Parse(args); err != nil {
		return c, err
	}
	switch {
	case fs.NArg() > 0:
		return c, fmt.Errorf("多余的参数：%s", strings.Join(fs.Args(), " "))
	case *pid > math.MaxUint32:
		return c, fmt.Errorf("进程 ID 太大：%d", *pid)
	}
	c.pid = uint32(*pid)
	n := 0
	for _, set := range []bool{c.pid != 0, c.name != "", c.system} {
		if set {
			n++
		}
	}
	switch {
	case n != 1:
		return c, errors.New("-pid、-name、-system 要指定一个，且只能指定一个")
	case c.sec <= 0 || c.sec > 3600:
		return c, errors.New("-sec 要在 0 到 3600 秒之间")
	case c.out == "":
		return c, errors.New("-o 不能为空")
	case c.gain <= 0 || c.gain > 16:
		return c, errors.New("-gain 要在 0 到 16 之间")
	case c.ftm && c.system:
		return c, errors.New("-ftm 只用于按进程录音")
	}
	return c, nil
}

// pickSource 按 exe 名（不分大小写，可省略 .exe）找进程。列表已按「正在播放、峰值高」排序，取第一个匹配的。
func pickSource(list []music.Source, name string) (music.Source, int, error) {
	want := strings.TrimSuffix(strings.ToLower(name), ".exe")
	var matches []music.Source
	var names []string
	for _, s := range list {
		exe := strings.TrimSuffix(strings.ToLower(s.Exe), ".exe")
		if exe == want {
			matches = append(matches, s)
		}
		if s.Exe != "" {
			names = append(names, s.Exe)
		}
	}
	if len(matches) == 0 {
		have := "没有任何程序"
		if len(names) > 0 {
			have = strings.Join(names, "、")
		}
		return music.Source{}, 0, fmt.Errorf("没有找到 %s 的音频会话（现在有：%s）。先让它开始播放，再用 audiocap list 看看", name, have)
	}
	return matches[0], len(matches), nil
}

// hint 根据错误给出下一步建议。
func hint(err error, mode music.Mode) string {
	if errors.Is(err, music.ErrProcessExited) {
		return "目标程序退出了。重新打开它、开始播放后再试。"
	}
	var he *music.HRError
	if errors.As(err, &he) {
		switch he.Code {
		case 0x8000000E: // E_ILLEGAL_METHOD_CALL
			return "系统不接受回调对象。请加 -ftm 再试一次，两次的结果都发回来。"
		case 0x80070490: // E_NOTFOUND
			return "没找到播放设备：确认插着耳机或音箱，并在「设置 → 系统 → 声音」里选了输出设备。"
		case 0x88890010: // AUDCLNT_E_SERVICE_NOT_RUNNING
			return "Windows 音频服务没有运行：在「服务」里启动 Windows Audio 后再试。"
		case 0x88890004: // AUDCLNT_E_DEVICE_INVALIDATED
			return "播放设备失效了（拔出或切换了默认设备），重新运行即可。"
		case 0x88890008, 0x80070057: // AUDCLNT_E_UNSUPPORTED_FORMAT、E_INVALIDARG
			if mode == music.ModeSystem {
				return "系统不接受这种格式。试试加 -format native。"
			}
			return "系统不接受这种格式。分别试试 -format pcm16 和 -format pcm16-44k。"
		case 0x80070002, 0x80004001: // ERROR_FILE_NOT_FOUND、E_NOTIMPL
			if mode == music.ModeProcess {
				return "这台电脑可能不支持按进程录音（需要 Win11）。可以先用 -system 整机录音试试。"
			}
		}
		return ""
	}
	if strings.Contains(err.Error(), "ActivateCompleted") {
		return "没等到系统的回调。请加 -ftm 再试一次，两次的结果都发回来。"
	}
	return ""
}

// dbfs 把 0–1 的峰值写成 dBFS（满刻度为 0 dB）。
func dbfs(peak float64) string {
	if peak <= 0 {
		return "静音"
	}
	return fmt.Sprintf("%.1f dBFS", 20*math.Log10(peak))
}

func cmdCapture(l *logger, args []string) int {
	cfg, err := parseCapture(args)
	if err != nil {
		l.printf("参数错误：%v\n\n%s", err, usageText)
		return 2
	}
	capab := printSystem(l)
	opts := music.Options{Mode: music.ModeProcess, PID: cfg.pid, Format: cfg.format, Gain: cfg.gain, FTM: cfg.ftm, Queue: 250}
	if cfg.system {
		opts.Mode = music.ModeSystem
	}
	if cfg.name != "" {
		list, err := music.ListSources()
		if err != nil {
			l.printf("列出音源时出错：%v", err)
		}
		src, n, err := pickSource(list, cfg.name)
		if err != nil {
			l.printf("%v", err)
			l.printf("结果：失败")
			return 1
		}
		opts.PID = src.PID
		state := "未播放"
		if src.Playing {
			state = "播放中"
		}
		l.printf("按名字 %s 找到 %d 个进程，选用 PID %d（%s，峰值 %.0f%%）", cfg.name, n, src.PID, state, src.Peak*100)
	}
	if opts.Mode == music.ModeProcess {
		l.printf("模式：按进程录音，目标 PID %d（含子进程）", opts.PID)
		if capab.Mode != music.ModeProcess {
			l.printf("注意：系统版本号低于 %d，按进程录音大概率失败；可以改用 -system", music.ProcessLoopbackMinBuild)
		}
	} else {
		l.printf("模式：整机录音（默认播放设备）")
		l.printf("注意：%s", music.SystemWarning)
	}

	out, err := filepath.Abs(cfg.out)
	if err != nil {
		out = cfg.out
	}
	file, err := os.Create(out)
	if err != nil {
		l.printf("建不了输出文件：%v", err)
		return 1
	}
	wav, err := newWAVWriter(file, music.SampleRate, 1)
	if err != nil {
		file.Close()
		l.printf("写不了输出文件：%v", err)
		return 1
	}

	opts.Log = func(msg string) { l.printf("  [步骤] %s", msg) }
	l.printf("启动采集……")
	c, err := music.Start(opts)
	if err != nil {
		l.printf("启动失败：%v", err)
		if h := hint(err, opts.Mode); h != "" {
			l.printf("建议：%s", h)
		}
		file.Close()
		os.Remove(out)
		l.printf("结果：失败")
		return 1
	}
	info := c.Info()
	conv := "系统转换"
	if !info.SystemConvert {
		conv = "系统不转换"
	}
	if info.Device != "" {
		l.printf("播放设备：%s", info.Device)
	}
	l.printf("采集格式：%s（初始化格式 %s，%s，缓冲 %d 帧）", info.Input, info.Format, conv, info.BufferFrames)
	process := info.Convert
	if process == "" {
		process = "无"
	}
	l.printf("本程序处理：%s；输出 48000Hz 16 位单声道，每帧 960 个采样（20ms）", process)
	l.printf("开始录音 %g 秒（按 Ctrl+C 可提前结束）……", cfg.sec)

	frames, peak, writeErr := record(l, c, wav, time.Duration(cfg.sec*float64(time.Second)))
	capErr := c.Err()
	if err := wav.Finish(); err != nil && writeErr == nil {
		writeErr = err
	}
	if err := file.Close(); err != nil && writeErr == nil {
		writeErr = err
	}

	st := c.Stats()
	audio := float64(frames) * music.FrameDuration.Seconds()
	expect := int(cfg.sec * 50)
	l.printf("结束：共 %d 帧，合 %.2f 秒音频（录 %g 秒应约 %d 帧）", frames, audio, cfg.sec, expect)
	avg := 0.0
	if st.Packets > 0 {
		avg = float64(st.InFrames) / float64(st.Packets)
	}
	l.printf("统计：收到 %d 个包（平均每包 %.0f 个采样帧），静音包 %d，断档 %d，丢帧 %d", st.Packets, avg, st.SilentPackets, st.Discontinuities, st.Dropped)
	l.printf("最大峰值：%s", dbfs(peak))
	switch {
	case frames == 0:
		l.printf("提示：一帧都没收到。确认目标程序在出声；按进程录音要选对进程（用 list 查看哪个 PID 在播放）。")
	case peak == 0:
		l.printf("提示：录到的全是静音。确认目标程序在播放、音量不为 0；按进程录音要选对进程。")
	case frames < expect*9/10:
		l.printf("提示：帧数比时长少，可能这段时间里目标程序有一阵没出声（没有声音时系统可能不送数据）。")
	}
	if writeErr != nil {
		l.printf("写 WAV 出错：%v", writeErr)
	} else {
		l.printf("已写出 %s（%d KB），双击即可播放。", out, (wav.Bytes()+44)/1024)
	}
	if capErr != nil {
		l.printf("采集中途出错：%v", capErr)
		if h := hint(capErr, opts.Mode); h != "" {
			l.printf("建议：%s", h)
		}
	}
	if capErr != nil || writeErr != nil {
		l.printf("结果：失败")
		return 1
	}
	l.printf("结果：成功。请试听 %s，并把 audiocap.log 发回来。", filepath.Base(out))
	return 0
}

// record 把帧写进 WAV，直到时间到、Ctrl+C 或采集出错；每秒打印一次进度。返回帧数和最大峰值。
func record(l *logger, c *music.Capture, wav *wavWriter, dur time.Duration) (frames int, peak float64, writeErr error) {
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt)
	defer signal.Stop(sig)
	deadline := time.NewTimer(dur)
	defer deadline.Stop()
	tick := time.NewTicker(time.Second)
	defer tick.Stop()

	begin := time.Now()
	secFrames, secPeak := 0, 0.0
	for {
		select {
		case f, ok := <-c.Frames():
			if !ok { // 采集已结束（Stop 或出错），剩下的帧也都取完了
				l.printf("录音结束，实际用时 %.2f 秒", time.Since(begin).Seconds())
				return frames, peak, writeErr
			}
			frames++
			secFrames++
			p := music.PeakOf(f.Samples)
			peak, secPeak = math.Max(peak, p), math.Max(secPeak, p)
			if writeErr == nil {
				if writeErr = wav.Write(f.Samples); writeErr != nil {
					l.printf("写 WAV 出错，停止录音：%v", writeErr)
					c.Stop()
				}
			}
		case <-tick.C:
			l.printf("  %3.0f 秒：共 %d 帧，这 1 秒 %d 帧，峰值 %s", time.Since(begin).Seconds(), frames, secFrames, dbfs(secPeak))
			secFrames, secPeak = 0, 0
		case <-deadline.C:
			c.Stop() // 等采集线程退出；之后通道里剩下的帧照常取完
		case <-sig:
			l.printf("收到 Ctrl+C，停止录音")
			c.Stop()
		}
	}
}
