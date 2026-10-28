package music

import "math"

const (
	rsZeroCrossings = 16   // 核两侧各取 16 个过零点
	rsTableStep     = 256  // 核函数查表精度：每个输入采样间隔 256 个点
	rsRolloff       = 0.94 // 截止频率比奈奎斯特频率低 6%，留出过渡带
)

// resampler 把单声道 float32 从一个采样率转换到另一个。只在系统不肯替我们转换时用
// （整机录音的混音格式不是 48kHz，或按进程录音只接受 44.1kHz）。
//
// 做法：加 Blackman 窗的 sinc 插值；截止频率取两个采样率中较低的奈奎斯特频率，降采样时不混叠。
// 输出位置用有理数记（每个输出前进 num/den 个输入），长时间运行不漂移。
type resampler struct {
	num, den  int       // 每个输出采样前进 num/den 个输入采样（已约分）
	pos, frac int       // 下一个输出采样的位置：buf[pos] 之后 frac/den 处
	reach     int       // 核在一侧覆盖的输入采样数
	table     []float32 // 核函数 h(x)，x 从 0 起，步长 1/rsTableStep
	buf       []float32 // 未用完的输入，前 reach 个是左侧历史
}

func newResampler(inRate, outRate int) *resampler {
	g := gcd(inRate, outRate)
	fc := rsRolloff // 截止频率，以输入的奈奎斯特频率为 1
	if outRate < inRate {
		fc *= float64(outRate) / float64(inRate)
	}
	half := rsZeroCrossings / fc // 核半宽（输入采样数）
	table := make([]float32, int(half*rsTableStep)+2)
	for i := range table {
		if x := float64(i) / rsTableStep; x < half {
			table[i] = float32(sincKernel(x, fc, half))
		}
	}
	reach := int(math.Ceil(half))
	return &resampler{
		num: inRate / g, den: outRate / g,
		pos: reach, reach: reach,
		table: table,
		buf:   make([]float32, reach, reach+4096), // 左侧先补零，第一个输出对齐第一个输入
	}
}

// sincKernel 是截止频率 fc 的低通 sinc，乘上半宽 half 的 Blackman 窗。
func sincKernel(x, fc, half float64) float64 {
	s := 1.0
	if x != 0 {
		a := math.Pi * fc * x
		s = math.Sin(a) / a
	}
	u := math.Pi * x / half
	return fc * s * (0.42 + 0.5*math.Cos(u) + 0.08*math.Cos(2*u))
}

// weight 查表并线性插值得到距离 d（输入采样数）处的核值。
func (r *resampler) weight(d float64) float32 {
	p := d * rsTableStep
	i := int(p)
	if i+1 >= len(r.table) {
		return 0
	}
	t := float32(p - float64(i))
	return r.table[i] + (r.table[i+1]-r.table[i])*t
}

// process 追加输入，把新算出的输出追加到 out 后返回。分块调用与一次性调用的结果完全相同。
func (r *resampler) process(in, out []float32) []float32 {
	r.buf = append(r.buf, in...)
	for r.pos+r.reach < len(r.buf) {
		t := float64(r.frac) / float64(r.den)
		var sum, wsum float32
		for j := r.pos - r.reach + 1; j <= r.pos+r.reach; j++ {
			w := r.weight(math.Abs(float64(j-r.pos) - t))
			sum += w * r.buf[j]
			wsum += w
		}
		if wsum > 0 {
			sum /= wsum // 归一化：直流增益恰为 1
		}
		out = append(out, sum)
		r.frac += r.num
		r.pos += r.frac / r.den
		r.frac %= r.den
	}
	if drop := r.pos - r.reach; drop > 0 { // 只留下一个输出要用的左侧历史
		r.buf = r.buf[:copy(r.buf, r.buf[drop:])]
		r.pos -= drop
	}
	return out
}

func gcd(a, b int) int {
	for b != 0 {
		a, b = b, a%b
	}
	return a
}
