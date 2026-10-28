package main

import (
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"minedeck/internal/music"
)

// 写出的 WAV 能被播放器直接打开：44 字节标准文件头、长度回填正确、数据为小端 16 位。
func TestWAVWriter(t *testing.T) {
	path := filepath.Join(t.TempDir(), "out.wav")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	w, err := newWAVWriter(f, 48000, 1)
	if err != nil {
		t.Fatal(err)
	}
	samples := []int16{0, 1, -1, 32767, -32768, 1234}
	if err := w.Write(samples[:2]); err != nil {
		t.Fatal(err)
	}
	if err := w.Finish(); err != nil { // 中途回填一次后还能接着写
		t.Fatal(err)
	}
	if err := w.Write(samples[2:]); err != nil {
		t.Fatal(err)
	}
	if err := w.Finish(); err != nil {
		t.Fatal(err)
	}
	f.Close()

	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	le := binary.LittleEndian
	if len(b) != 44+len(samples)*2 {
		t.Fatalf("文件长 %d 字节，应为 %d", len(b), 44+len(samples)*2)
	}
	checks := []struct {
		name      string
		got, want uint32
	}{
		{"RIFF 长度", le.Uint32(b[4:]), uint32(36 + len(samples)*2)},
		{"fmt 块长度", le.Uint32(b[16:]), 16},
		{"格式（PCM）", uint32(le.Uint16(b[20:])), 1},
		{"声道数", uint32(le.Uint16(b[22:])), 1},
		{"采样率", le.Uint32(b[24:]), 48000},
		{"每秒字节数", le.Uint32(b[28:]), 96000},
		{"块对齐", uint32(le.Uint16(b[32:])), 2},
		{"位数", uint32(le.Uint16(b[34:])), 16},
		{"data 长度", le.Uint32(b[40:]), uint32(len(samples) * 2)},
	}
	for _, c := range checks {
		if c.got != c.want {
			t.Errorf("%s = %d，应为 %d", c.name, c.got, c.want)
		}
	}
	if string(b[0:4]) != "RIFF" || string(b[8:16]) != "WAVEfmt " || string(b[36:40]) != "data" {
		t.Errorf("块标识不对：% X", b[:44])
	}
	for i, s := range samples {
		if got := int16(le.Uint16(b[44+i*2:])); got != s {
			t.Errorf("第 %d 个采样 = %d，应为 %d", i, got, s)
		}
	}
}

func TestParseCapture(t *testing.T) {
	c, err := parseCapture(strings.Fields("-pid 1234 -sec 5 -o a.wav"))
	if err != nil || c.pid != 1234 || c.sec != 5 || c.out != "a.wav" || c.system {
		t.Errorf("得到 %+v，%v", c, err)
	}
	c, err = parseCapture([]string{"-system"})
	if err != nil || !c.system || c.sec != 10 || c.out != "out.wav" || c.gain != 1 {
		t.Errorf("默认值不对：%+v，%v", c, err)
	}
	c, err = parseCapture(strings.Fields("-name cloudmusic.exe -ftm -format pcm16"))
	if err != nil || c.name != "cloudmusic.exe" || !c.ftm || c.format != "pcm16" {
		t.Errorf("得到 %+v，%v", c, err)
	}
	for _, args := range []string{
		"",                    // 没指定音源
		"-pid 1 -system",      // 指定了两个
		"-pid 1 -sec 0",       // 时长无效
		"-pid 1 -sec 4000",    // 太长
		"-pid 1 -gain 0",      // 增益无效
		"-system -ftm",        // -ftm 只用于按进程
		"-pid 1 extra",        // 多余参数
		"-pid -5",             // 负数
		"-pid 99999999999",    // 超出 32 位
		"-pid 1 -unknownflag", // 未知参数
	} {
		if _, err := parseCapture(strings.Fields(args)); err == nil {
			t.Errorf("%q 应报错", args)
		}
	}
}

func TestPickSource(t *testing.T) {
	list := []music.Source{ // ListSources 已按「正在播放、峰值高」排好序
		{PID: 30, Exe: "cloudmusic.exe", Playing: true, Peak: 0.4},
		{PID: 10, Exe: "chrome.exe", Playing: true, Peak: 0.2},
		{PID: 31, Exe: "cloudmusic.exe"},
		{PID: 40},
	}
	for _, name := range []string{"cloudmusic.exe", "CloudMusic.EXE", "cloudmusic"} {
		s, n, err := pickSource(list, name)
		if err != nil || s.PID != 30 || n != 2 {
			t.Errorf("%s：得到 PID %d（共 %d 个），%v", name, s.PID, n, err)
		}
	}
	_, _, err := pickSource(list, "QQMusic.exe")
	if err == nil || !strings.Contains(err.Error(), "chrome.exe") {
		t.Errorf("找不到时应列出现有程序：%v", err)
	}
}

func TestDBFS(t *testing.T) {
	cases := map[float64]string{1: "0.0 dBFS", 0.5: "-6.0 dBFS", 0.1: "-20.0 dBFS", 0: "静音"}
	for in, want := range cases {
		if got := dbfs(in); got != want {
			t.Errorf("dbfs(%v) = %q，应为 %q", in, got, want)
		}
	}
}

func TestHint(t *testing.T) {
	cases := []struct {
		err  error
		mode music.Mode
		want string
	}{
		{&music.HRError{Step: "按进程环回激活", Code: 0x8000000E}, music.ModeProcess, "-ftm"},
		{&music.HRError{Step: "按进程环回激活", Code: 0x80070002}, music.ModeProcess, "-system"},
		{&music.HRError{Step: "IAudioClient::Initialize", Code: 0x88890008}, music.ModeSystem, "-format native"},
		{&music.HRError{Step: "IAudioClient::Initialize", Code: 0x88890008}, music.ModeProcess, "-format pcm16"},
		{&music.HRError{Step: "GetDefaultAudioEndpoint", Code: 0x80070490}, music.ModeSystem, "播放设备"},
		{fmt.Errorf("%w（PID 3）", music.ErrProcessExited), music.ModeProcess, "退出"},
		{errors.New("等了 10s 还没收到 ActivateCompleted 回调"), music.ModeProcess, "-ftm"},
	}
	for _, c := range cases {
		if got := hint(c.err, c.mode); !strings.Contains(got, c.want) {
			t.Errorf("hint(%v) = %q，应含 %q", c.err, got, c.want)
		}
	}
	if got := hint(errors.New("别的错误"), music.ModeSystem); got != "" {
		t.Errorf("没有建议时应为空，得到 %q", got)
	}
}
