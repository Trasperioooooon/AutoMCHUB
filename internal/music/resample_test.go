package music

import (
	"math"
	"math/rand"
	"testing"
)

func sine(n, rate int, freq, amp float64) []float32 {
	s := make([]float32, n)
	for i := range s {
		s[i] = float32(amp * math.Sin(2*math.Pi*freq*float64(i)/float64(rate)))
	}
	return s
}

func rms(s []float32) float64 {
	var sum float64
	for _, v := range s {
		sum += float64(v) * float64(v)
	}
	return math.Sqrt(sum / float64(len(s)))
}

// 直流增益恰为 1（每个输出都按核权重之和归一化）。
func TestResampleDC(t *testing.T) {
	r := newResampler(44100, 48000)
	in := make([]float32, 4410)
	for i := range in {
		in[i] = 0.5
	}
	out := r.process(in, nil)
	for i := 100; i < len(out); i++ {
		if math.Abs(float64(out[i])-0.5) > 1e-4 {
			t.Fatalf("out[%d] = %v，应为 0.5", i, out[i])
		}
	}
}

// 44.1k → 48k 的 1kHz 正弦：第 k 个输出对应输入的 k×44100/48000 处，和理想正弦逐点比较。
func TestResampleSine(t *testing.T) {
	r := newResampler(44100, 48000)
	out := r.process(sine(44100, 44100, 1000, 0.8), nil)
	want := sine(len(out), 48000, 1000, 0.8)
	maxErr := 0.0
	for i := 100; i < len(out); i++ {
		maxErr = math.Max(maxErr, math.Abs(float64(out[i]-want[i])))
	}
	if maxErr > 2e-3 {
		t.Errorf("与理想正弦的最大误差 %.5f，应小于 0.002", maxErr)
	}
}

// 96k → 48k：通带内的 1kHz 不衰减；高于新奈奎斯特频率（24kHz）的 30kHz 被滤掉，不会混叠成 18kHz。
func TestResampleDownAntiAlias(t *testing.T) {
	pass := newResampler(96000, 48000).process(sine(96000, 96000, 1000, 1), nil)
	if g := rms(pass[200:]) * math.Sqrt2; math.Abs(g-1) > 0.01 {
		t.Errorf("1kHz 增益 %.4f，应约为 1", g)
	}
	stop := newResampler(96000, 48000).process(sine(96000, 96000, 30000, 1), nil)
	if g := rms(stop[200:]) * math.Sqrt2; g > 0.01 {
		t.Errorf("30kHz 残留 %.4f（%.1f dB），应低于 -40 dB", g, 20*math.Log10(g))
	}
}

// 分块送入与一次送入的结果完全相同；输出个数符合采样率之比。
func TestResampleChunked(t *testing.T) {
	in := sine(20000, 44100, 440, 0.7)
	whole := newResampler(44100, 48000).process(in, nil)

	r := newResampler(44100, 48000)
	rng := rand.New(rand.NewSource(1))
	var parts []float32
	for off := 0; off < len(in); {
		n := min(1+rng.Intn(700), len(in)-off)
		parts = r.process(in[off:off+n], parts)
		off += n
	}
	if len(parts) != len(whole) {
		t.Fatalf("分块输出 %d 个，一次输出 %d 个", len(parts), len(whole))
	}
	for i := range whole {
		if parts[i] != whole[i] {
			t.Fatalf("第 %d 个输出不同：%v ≠ %v", i, parts[i], whole[i])
		}
	}
	want := float64(len(in)-r.reach) * 48000 / 44100
	if math.Abs(float64(len(whole))-want) > 2 {
		t.Errorf("输出 %d 个，应约 %.0f 个", len(whole), want)
	}
}

func TestGCD(t *testing.T) {
	if g := gcd(44100, 48000); g != 300 {
		t.Errorf("gcd(44100, 48000) = %d", g)
	}
	if g := gcd(96000, 48000); g != 48000 {
		t.Errorf("gcd(96000, 48000) = %d", g)
	}
}
