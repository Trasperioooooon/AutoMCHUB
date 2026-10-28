package music

import (
	"encoding/binary"
	"fmt"
	"math"
	"strings"
)

// WAVEFORMATEX 的格式标签（mmreg.h）与声道位置（ksmedia.h）。
const (
	waveFormatPCM        = 0x0001
	waveFormatIEEEFloat  = 0x0003
	waveFormatExtensible = 0xFFFE

	speakerFrontLeft    = 0x1
	speakerFrontRight   = 0x2
	speakerFrontCenter  = 0x4
	speakerLowFrequency = 0x8
)

// ksSubtypeTail 是 KSDATAFORMAT_SUBTYPE_PCM / _IEEE_FLOAT 这两个 GUID 的后 12 字节；前 4 字节是格式标签。
var ksSubtypeTail = [12]byte{0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71}

// sampleFormat 描述采集流的采样格式（来自 WAVEFORMATEX / WAVEFORMATEXTENSIBLE）。
type sampleFormat struct {
	Channels    int
	Rate        int
	Bits        int  // 每个采样占的位数（容器）：16 / 24 / 32 / 64
	Float       bool // IEEE 浮点
	ChannelMask uint32
}

func (f sampleFormat) blockAlign() int { return f.Channels * f.Bits / 8 }

// kind 返回采样类型，如 float32、int16。
func (f sampleFormat) kind() string {
	if f.Float {
		return fmt.Sprintf("float%d", f.Bits)
	}
	return fmt.Sprintf("int%d", f.Bits)
}

func (f sampleFormat) String() string {
	return fmt.Sprintf("%s %d 声道 %dHz", f.kind(), f.Channels, f.Rate)
}

// parseWaveFormat 解析 WAVEFORMATEX（及其扩展 WAVEFORMATEXTENSIBLE）的原始字节。
func parseWaveFormat(b []byte) (sampleFormat, error) {
	if len(b) < 16 {
		return sampleFormat{}, fmt.Errorf("WAVEFORMATEX 只有 %d 字节", len(b))
	}
	le := binary.LittleEndian
	tag := le.Uint16(b[0:])
	f := sampleFormat{
		Channels: int(le.Uint16(b[2:])),
		Rate:     int(le.Uint32(b[4:])),
		Bits:     int(le.Uint16(b[14:])),
	}
	if tag == waveFormatExtensible {
		if len(b) < 40 {
			return f, fmt.Errorf("WAVEFORMATEXTENSIBLE 只有 %d 字节", len(b))
		}
		if [12]byte(b[28:40]) != ksSubtypeTail {
			return f, fmt.Errorf("不支持的子格式 %X", b[24:40])
		}
		f.ChannelMask = le.Uint32(b[20:])
		tag = uint16(le.Uint32(b[24:]))
	}
	switch {
	case tag == waveFormatPCM && (f.Bits == 16 || f.Bits == 24 || f.Bits == 32):
	case tag == waveFormatIEEEFloat && (f.Bits == 32 || f.Bits == 64):
		f.Float = true
	default:
		return f, fmt.Errorf("不支持的采样格式：标签 0x%04X，%d 位", tag, f.Bits)
	}
	if f.Channels < 1 || f.Rate < 1 {
		return f, fmt.Errorf("声道数 %d、采样率 %d 无效", f.Channels, f.Rate)
	}
	if ba := int(le.Uint16(b[12:])); ba != f.blockAlign() {
		return f, fmt.Errorf("nBlockAlign 为 %d，与 %d 声道 × %d 位不符", ba, f.Channels, f.Bits)
	}
	return f, nil
}

// waveFormatBytes 生成请求格式的字节：整数用普通 WAVEFORMATEX（同微软示例），
// 浮点用 WAVEFORMATEXTENSIBLE（同 OBS 的按进程采集）。
func waveFormatBytes(f sampleFormat) []byte {
	le := binary.LittleEndian
	n := 18
	if f.Float {
		n = 40
	}
	b := make([]byte, n)
	tag := uint16(waveFormatPCM)
	if f.Float {
		tag = waveFormatExtensible
	}
	le.PutUint16(b[0:], tag)
	le.PutUint16(b[2:], uint16(f.Channels))
	le.PutUint32(b[4:], uint32(f.Rate))
	le.PutUint32(b[8:], uint32(f.Rate*f.blockAlign()))
	le.PutUint16(b[12:], uint16(f.blockAlign()))
	le.PutUint16(b[14:], uint16(f.Bits))
	if f.Float {
		le.PutUint16(b[16:], 22)             // cbSize
		le.PutUint16(b[18:], uint16(f.Bits)) // wValidBitsPerSample
		le.PutUint32(b[20:], f.ChannelMask)
		le.PutUint32(b[24:], waveFormatIEEEFloat)
		copy(b[28:], ksSubtypeTail[:])
	}
	return b
}

// downmixWeights 返回混成单声道时各声道的权重：立体声为 (L+R)/2；中置 0.707；
// 环绕、后置、顶部等其余声道 0.354；低音声道不计入。mask 为 0 时按声道数取 Windows 默认排布，
// 没有默认排布的取平均。超出 mask 的声道没有位置，不计入。
func downmixWeights(channels int, mask uint32) []float32 {
	w := make([]float32, channels)
	if channels == 1 {
		w[0] = 1
		return w
	}
	if mask == 0 {
		mask = defaultChannelMask(channels)
	}
	if mask == 0 {
		for i := range w {
			w[i] = 1 / float32(channels)
		}
		return w
	}
	ch := 0
	for bit := uint32(1); bit != 0 && ch < channels; bit <<= 1 {
		if mask&bit == 0 {
			continue
		}
		switch bit {
		case speakerFrontLeft, speakerFrontRight:
			w[ch] = 0.5
		case speakerFrontCenter:
			w[ch] = 0.7071
		case speakerLowFrequency:
			w[ch] = 0
		default:
			w[ch] = 0.3536
		}
		ch++
	}
	return w
}

// defaultChannelMask 是 Windows 对常见声道数的默认排布（ksmedia.h 的 KSAUDIO_SPEAKER_*）。
func defaultChannelMask(channels int) uint32 {
	switch channels {
	case 2:
		return 0x3 // 立体声
	case 4:
		return 0x33 // 四声道
	case 6:
		return 0x3F // 5.1
	case 8:
		return 0x63F // 7.1
	}
	return 0
}

// floatToInt16 把 [-1, 1] 的浮点采样转成 16 位整数：乘 32767 后四舍五入，超出范围截断，NaN 记为 0。
func floatToInt16(x float32) int16 {
	v := float64(x) * 32767
	switch {
	case v != v:
		return 0
	case v >= 32767:
		return 32767
	case v <= -32768:
		return -32768
	}
	return int16(math.Round(v))
}

// converter 把采集到的包转换成 48kHz、16 位、单声道、每帧 960 个采样的帧。
type converter struct {
	in      sampleFormat
	weights []float32
	gain    float32
	rs      *resampler // 采样率已是 48kHz 时为 nil
	mono    []float32
	out     []float32
	pending []int16 // 不足一帧的部分
	seq     uint64
}

func newConverter(in sampleFormat, gain float64) (*converter, error) {
	switch {
	case in.Channels < 1 || in.Rate < 1:
		return nil, fmt.Errorf("采集格式无效：%s", in)
	case in.Float && (in.Bits == 32 || in.Bits == 64):
	case !in.Float && (in.Bits == 16 || in.Bits == 24 || in.Bits == 32):
	default:
		return nil, fmt.Errorf("不支持的采集格式：%s", in)
	}
	if gain <= 0 {
		gain = 1
	}
	c := &converter{in: in, weights: downmixWeights(in.Channels, in.ChannelMask), gain: float32(gain)}
	if in.Rate != SampleRate {
		c.rs = newResampler(in.Rate, SampleRate)
	}
	return c, nil
}

// describe 说明本包要做的处理，如「下混 2→1，重采样 44100→48000Hz」。
func (c *converter) describe() string {
	var parts []string
	if c.in.Channels > 1 {
		parts = append(parts, fmt.Sprintf("下混 %d→1", c.in.Channels))
	}
	if c.rs != nil {
		parts = append(parts, fmt.Sprintf("重采样 %d→%dHz", c.in.Rate, SampleRate))
	}
	if c.in.Float || c.in.Bits != 16 {
		parts = append(parts, c.in.kind()+"→int16")
	}
	if c.gain != 1 {
		parts = append(parts, fmt.Sprintf("增益 ×%.2f", c.gain))
	}
	return strings.Join(parts, "，")
}

// push 处理一个包：data 是 frames 个交错排列的采样帧；silent 为真时按静音补零，不读 data。
// 每凑满一帧调用一次 emit，不足一帧的部分留到下一个包。
func (c *converter) push(data []byte, frames int, silent bool, emit func(Frame)) {
	if frames <= 0 {
		return
	}
	c.mono = c.mono[:0]
	if ba := c.in.blockAlign(); !silent && len(data) < frames*ba {
		frames = len(data) / ba // 数据不足时只用完整的帧（正常不会发生）
	}
	if silent {
		for i := 0; i < frames; i++ {
			c.mono = append(c.mono, 0)
		}
	} else {
		c.decode(data, frames)
	}
	samples := c.mono
	if c.rs != nil {
		c.out = c.rs.process(c.mono, c.out[:0])
		samples = c.out
	}
	for _, x := range samples {
		c.pending = append(c.pending, floatToInt16(x*c.gain))
	}
	start := 0
	for len(c.pending)-start >= FrameSamples {
		s := make([]int16, FrameSamples)
		copy(s, c.pending[start:])
		start += FrameSamples
		emit(Frame{Seq: c.seq, Samples: s})
		c.seq++
	}
	c.pending = c.pending[:copy(c.pending, c.pending[start:])]
}

// decode 把交错排列的多声道采样按权重混成单声道浮点，追加到 c.mono。
func (c *converter) decode(data []byte, frames int) {
	le := binary.LittleEndian
	ch, bps := c.in.Channels, c.in.Bits/8
	for i := 0; i < frames; i++ {
		frame := data[i*ch*bps:]
		var sum float32
		for k := 0; k < ch; k++ {
			w := c.weights[k]
			if w == 0 {
				continue
			}
			p := frame[k*bps:]
			var x float32
			switch {
			case c.in.Float && bps == 4:
				x = math.Float32frombits(le.Uint32(p))
			case c.in.Float:
				x = float32(math.Float64frombits(le.Uint64(p)))
			case bps == 2:
				x = float32(int16(le.Uint16(p))) / 32768
			case bps == 3: // 24 位：放到 int32 的高 24 位再归一化，符号自然正确
				x = float32(int32(uint32(p[0])<<8|uint32(p[1])<<16|uint32(p[2])<<24)) / 2147483648
			default:
				x = float32(int32(le.Uint32(p))) / 2147483648
			}
			sum += w * x
		}
		if sum != sum { // NaN 不往后传（重采样会把它扩散到相邻采样）
			sum = 0
		}
		c.mono = append(c.mono, sum)
	}
}
