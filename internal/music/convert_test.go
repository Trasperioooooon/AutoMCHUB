package music

import (
	"encoding/binary"
	"math"
	"testing"
)

func TestFloatToInt16(t *testing.T) {
	cases := []struct {
		in   float32
		want int16
	}{
		{0, 0},
		{1, 32767},
		{-1, -32767},
		{1.5, 32767},   // 过载截断
		{-1.5, -32768}, // 过载截断
		{0.5, 16384},   // 16383.5 四舍五入
		{-0.5, -16384},
		{1.0 / 32767, 1},
		{float32(math.NaN()), 0},
		{float32(math.Inf(1)), 32767},
	}
	for _, c := range cases {
		if got := floatToInt16(c.in); got != c.want {
			t.Errorf("floatToInt16(%v) = %d，应为 %d", c.in, got, c.want)
		}
	}
}

func TestDownmixWeights(t *testing.T) {
	eq := func(a, b []float32) bool {
		if len(a) != len(b) {
			return false
		}
		for i := range a {
			if math.Abs(float64(a[i]-b[i])) > 1e-6 {
				return false
			}
		}
		return true
	}
	cases := []struct {
		channels int
		mask     uint32
		want     []float32
	}{
		{1, 0, []float32{1}},
		{2, 0, []float32{0.5, 0.5}},
		{2, 0x3, []float32{0.5, 0.5}},
		{6, 0, []float32{0.5, 0.5, 0.7071, 0, 0.3536, 0.3536}},     // 默认 5.1：FL FR FC LFE BL BR
		{6, 0x60F, []float32{0.5, 0.5, 0.7071, 0, 0.3536, 0.3536}}, // 5.1（侧环绕）
		{3, 0, []float32{1.0 / 3, 1.0 / 3, 1.0 / 3}},               // 没有默认排布：平均
		{4, 0x3, []float32{0.5, 0.5, 0, 0}},                        // 掩码只标了两个声道
	}
	for _, c := range cases {
		if got := downmixWeights(c.channels, c.mask); !eq(got, c.want) {
			t.Errorf("downmixWeights(%d, 0x%X) = %v，应为 %v", c.channels, c.mask, got, c.want)
		}
	}
}

// waveEx 手工拼一个 WAVEFORMATEXTENSIBLE。
func waveEx(subTag uint16, channels, rate, bits, blockAlign int, mask uint32) []byte {
	le := binary.LittleEndian
	b := make([]byte, 40)
	le.PutUint16(b[0:], waveFormatExtensible)
	le.PutUint16(b[2:], uint16(channels))
	le.PutUint32(b[4:], uint32(rate))
	le.PutUint32(b[8:], uint32(rate*blockAlign))
	le.PutUint16(b[12:], uint16(blockAlign))
	le.PutUint16(b[14:], uint16(bits))
	le.PutUint16(b[16:], 22)
	le.PutUint16(b[18:], uint16(bits))
	le.PutUint32(b[20:], mask)
	le.PutUint32(b[24:], uint32(subTag))
	copy(b[28:], ksSubtypeTail[:])
	return b
}

func TestParseWaveFormat(t *testing.T) {
	// 常见的设备混音格式：float32 立体声 48k；5.1 float；24 位放在 32 位容器里
	f, err := parseWaveFormat(waveEx(waveFormatIEEEFloat, 2, 48000, 32, 8, 0x3))
	if err != nil || f != (sampleFormat{Channels: 2, Rate: 48000, Bits: 32, Float: true, ChannelMask: 0x3}) {
		t.Errorf("float 立体声：%+v，%v", f, err)
	}
	f, err = parseWaveFormat(waveEx(waveFormatIEEEFloat, 6, 44100, 32, 24, 0x3F))
	if err != nil || f.Channels != 6 || f.Rate != 44100 || f.ChannelMask != 0x3F || !f.Float {
		t.Errorf("float 5.1：%+v，%v", f, err)
	}
	f, err = parseWaveFormat(waveEx(waveFormatPCM, 2, 96000, 32, 8, 0x3))
	if err != nil || f.Float || f.Bits != 32 {
		t.Errorf("int32 容器：%+v，%v", f, err)
	}

	bad := map[string][]byte{
		"太短":      make([]byte, 10),
		"扩展格式太短":  waveEx(waveFormatIEEEFloat, 2, 48000, 32, 8, 3)[:30],
		"块对齐不符":   waveEx(waveFormatIEEEFloat, 2, 48000, 32, 6, 3),
		"0 声道":    waveEx(waveFormatIEEEFloat, 0, 48000, 32, 0, 0),
		"8 位 PCM": waveEx(waveFormatPCM, 1, 8000, 8, 1, 0),
		"未知子格式": func() []byte {
			b := waveEx(waveFormatIEEEFloat, 2, 48000, 32, 8, 3)
			b[39] = 0
			return b
		}(),
		"MP3 标签": func() []byte {
			b := waveFormatBytes(stereoPCM48)
			b[0] = 0x55
			return b
		}(),
	}
	for name, b := range bad {
		if _, err := parseWaveFormat(b); err == nil {
			t.Errorf("%s：应报错", name)
		}
	}
}

// 我们请求的格式：整数用 18 字节的 WAVEFORMATEX，浮点用 40 字节的 WAVEFORMATEXTENSIBLE；都能解析回原样。
func TestWaveFormatBytes(t *testing.T) {
	for _, f := range []sampleFormat{stereoFloat48, stereoPCM48, stereoPCM44} {
		b := waveFormatBytes(f)
		got, err := parseWaveFormat(b)
		if err != nil || got != f {
			t.Errorf("%s：解析回 %+v，%v", f, got, err)
		}
		le := binary.LittleEndian
		if f.Float {
			if len(b) != 40 || le.Uint16(b) != waveFormatExtensible || le.Uint16(b[16:]) != 22 || le.Uint32(b[24:]) != waveFormatIEEEFloat {
				t.Errorf("%s：WAVEFORMATEXTENSIBLE 字段不对 % X", f, b)
			}
		} else if len(b) != 18 || le.Uint16(b) != waveFormatPCM || le.Uint16(b[16:]) != 0 {
			t.Errorf("%s：WAVEFORMATEX 字段不对 % X", f, b)
		}
		if le.Uint32(b[8:]) != uint32(f.Rate*f.blockAlign()) {
			t.Errorf("%s：nAvgBytesPerSec = %d", f, le.Uint32(b[8:]))
		}
	}
}

// stereoFloat 生成交错排列的 float32 立体声字节。
func stereoFloat(frames int, l, r float32) []byte {
	b := make([]byte, 0, frames*8)
	for i := 0; i < frames; i++ {
		b = binary.LittleEndian.AppendUint32(b, math.Float32bits(l))
		b = binary.LittleEndian.AppendUint32(b, math.Float32bits(r))
	}
	return b
}

func collect(c *converter, data []byte, frames int, silent bool) []Frame {
	var out []Frame
	c.push(data, frames, silent, func(f Frame) { out = append(out, f) })
	return out
}

// 立体声下混为 (L+R)/2；按 960 个采样切帧，余下的留到下一个包；帧序号连续。
func TestConverterDownmixAndFraming(t *testing.T) {
	c, err := newConverter(stereoFloat48, 1)
	if err != nil {
		t.Fatal(err)
	}
	if got := collect(c, stereoFloat(1000, 0.5, -0.5), 1000, false); len(got) != 1 || got[0].Seq != 0 {
		t.Fatalf("1000 帧输入应切出 1 帧，得到 %d", len(got))
	} else if PeakOf(got[0].Samples) != 0 {
		t.Errorf("L=0.5、R=-0.5 下混应为 0，峰值 %v", PeakOf(got[0].Samples))
	}
	got := collect(c, stereoFloat(920, 0.25, 0.25), 920, false)
	if len(got) != 1 || got[0].Seq != 1 || len(got[0].Samples) != FrameSamples {
		t.Fatalf("再来 920 帧应凑满第 2 帧，得到 %d", len(got))
	}
	s := got[0].Samples
	if s[0] != 0 || s[39] != 0 || s[40] != 8192 || s[959] != 8192 { // 前 40 个是上一包剩下的 0
		t.Errorf("帧内容不对：s[0]=%d s[39]=%d s[40]=%d s[959]=%d", s[0], s[39], s[40], s[959])
	}
	if got := collect(c, stereoFloat(959, 0.1, 0.1), 959, false); len(got) != 0 {
		t.Errorf("不足一帧不应交出，得到 %d 帧", len(got))
	}
	if got := collect(c, stereoFloat(1, 0.1, 0.1), 1, false); len(got) != 1 || got[0].Seq != 2 {
		t.Errorf("凑满后应交出序号 2 的帧，得到 %v", got)
	}
}

// 静音包不读数据（数据可能是垃圾），按静音补零。
func TestConverterSilent(t *testing.T) {
	c, _ := newConverter(stereoFloat48, 1)
	got := collect(c, stereoFloat(960, 1, 1), 960, true)
	if len(got) != 1 || PeakOf(got[0].Samples) != 0 {
		t.Fatalf("静音包应得到 1 个全零帧，得到 %d 帧", len(got))
	}
	if got := collect(c, nil, 960, true); len(got) != 1 {
		t.Errorf("没有数据的静音包也应补零，得到 %d 帧", len(got))
	}
}

func TestConverterIntegerFormats(t *testing.T) {
	le := binary.LittleEndian
	// int16 立体声：(16384 + 16384) / 2 → 0.5 → 16384
	c, _ := newConverter(sampleFormat{Channels: 2, Rate: 48000, Bits: 16}, 1)
	var b []byte
	for i := 0; i < 960; i++ {
		b = le.AppendUint16(b, 16384)
		b = le.AppendUint16(b, 16384)
	}
	if got := collect(c, b, 960, false); len(got) != 1 || got[0].Samples[0] != 16384 {
		t.Errorf("int16：%v", got)
	}
	// int24 单声道：0x400000 是 0.5，0xC00000 是 -0.5
	c, _ = newConverter(sampleFormat{Channels: 1, Rate: 48000, Bits: 24}, 1)
	b = b[:0]
	for i := 0; i < 960; i++ {
		v := uint32(0x400000)
		if i%2 == 1 {
			v = 0xC00000
		}
		b = append(b, byte(v), byte(v>>8), byte(v>>16))
	}
	if got := collect(c, b, 960, false); len(got) != 1 || got[0].Samples[0] != 16384 || got[0].Samples[1] != -16384 {
		t.Errorf("int24：%v", got[0].Samples[:2])
	}
	// int32 单声道：0x40000000 是 0.5
	c, _ = newConverter(sampleFormat{Channels: 1, Rate: 48000, Bits: 32}, 1)
	b = b[:0]
	for i := 0; i < 960; i++ {
		b = le.AppendUint32(b, 0x40000000)
	}
	if got := collect(c, b, 960, false); len(got) != 1 || got[0].Samples[0] != 16384 {
		t.Errorf("int32：%v", got[0].Samples[:1])
	}
	// float64 单声道
	c, _ = newConverter(sampleFormat{Channels: 1, Rate: 48000, Bits: 64, Float: true}, 1)
	b = b[:0]
	for i := 0; i < 960; i++ {
		b = le.AppendUint64(b, math.Float64bits(-0.5))
	}
	if got := collect(c, b, 960, false); len(got) != 1 || got[0].Samples[0] != -16384 {
		t.Errorf("float64：%v", got[0].Samples[:1])
	}
}

func TestConverterGain(t *testing.T) {
	c, _ := newConverter(stereoFloat48, 2)
	got := collect(c, stereoFloat(960, 0.75, 0.75), 960, false)
	if len(got) != 1 || got[0].Samples[0] != 32767 {
		t.Errorf("增益 2 倍后应截断到 32767，得到 %v", got[0].Samples[0])
	}
}

func TestNewConverterRejects(t *testing.T) {
	for _, f := range []sampleFormat{
		{Channels: 1, Rate: 48000, Bits: 8},
		{Channels: 2, Rate: 48000, Bits: 16, Float: true},
		{Channels: 0, Rate: 48000, Bits: 16},
		{Channels: 2, Rate: 0, Bits: 16},
	} {
		if _, err := newConverter(f, 1); err == nil {
			t.Errorf("%+v 应报错", f)
		}
	}
}

// 44.1kHz 输入：1 秒约 50 帧，1kHz 正弦重采样后仍是 1kHz（数过零点）。
func TestConverterResamples44k(t *testing.T) {
	c, err := newConverter(stereoPCM44, 1)
	if err != nil {
		t.Fatal(err)
	}
	if d := c.describe(); d != "下混 2→1，重采样 44100→48000Hz" {
		t.Errorf("describe() = %q", d)
	}
	var b []byte
	for i := 0; i < 44100; i++ {
		v := uint16(int16(16000 * math.Sin(2*math.Pi*1000*float64(i)/44100)))
		b = binary.LittleEndian.AppendUint16(b, v)
		b = binary.LittleEndian.AppendUint16(b, v)
	}
	var samples []int16
	for off := 0; off < 44100; off += 441 { // 按 10ms 一包送入
		for _, f := range collect(c, b[off*4:(off+441)*4], 441, false) {
			samples = append(samples, f.Samples...)
		}
	}
	if n := len(samples) / FrameSamples; n < 49 || n > 50 {
		t.Fatalf("1 秒应得到约 50 帧，得到 %d", n)
	}
	crossings := 0
	for i := 1000; i < len(samples); i++ {
		if (samples[i-1] < 0) != (samples[i] < 0) {
			crossings++
		}
	}
	want := 2 * 1000 * float64(len(samples)-1000) / SampleRate
	if math.Abs(float64(crossings)-want) > 3 {
		t.Errorf("过零点 %d 个，1kHz 应约 %.0f 个", crossings, want)
	}
	if p := PeakOf(samples); math.Abs(p-16000.0/32768) > 0.01 {
		t.Errorf("峰值 %.3f，应约 %.3f", p, 16000.0/32768)
	}
}

func TestConverterDescribe(t *testing.T) {
	c, _ := newConverter(stereoFloat48, 1)
	if d := c.describe(); d != "下混 2→1，float32→int16" {
		t.Errorf("describe() = %q", d)
	}
	c, _ = newConverter(sampleFormat{Channels: 1, Rate: 48000, Bits: 16}, 1.5)
	if d := c.describe(); d != "增益 ×1.50" {
		t.Errorf("describe() = %q", d)
	}
}
