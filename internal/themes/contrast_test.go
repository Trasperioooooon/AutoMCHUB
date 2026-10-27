// Package themes 只含测试：校验前端配色方案（internal/web/ui/themes.css）的 WCAG 对比度。
// 不依赖 Windows 专属代码，任何平台都能跑：go test ./internal/themes/
package themes

import (
	"fmt"
	"math"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

type rgba struct{ r, g, b, a float64 }

var (
	reComment = regexp.MustCompile(`(?s)/\*.*?\*/`)
	reBlock   = regexp.MustCompile(`((?:\[data-[^{]+)|:root)\s*\{([^}]*)\}`)
	reVar     = regexp.MustCompile(`(--[\w-]+)\s*:\s*([^;]+);`)
	reScheme  = regexp.MustCompile(`^\[data-scheme="(\w+)"\]\[data-theme="(light|dark)"\]$`)
	reAccent  = regexp.MustCompile(`^\[data-accent="(\w+)"\]\[data-theme="(light|dark)"\]$`)
	reHex     = regexp.MustCompile(`^#([0-9a-f]{3}|[0-9a-f]{6})$`)
	reRGB     = regexp.MustCompile(`^rgba?\(([^)]+)\)$`)
)

func parseColor(s string) (rgba, error) {
	s = strings.ToLower(strings.TrimSpace(s))
	if m := reHex.FindStringSubmatch(s); m != nil {
		h := m[1]
		if len(h) == 3 {
			h = string([]byte{h[0], h[0], h[1], h[1], h[2], h[2]})
		}
		v, _ := strconv.ParseUint(h, 16, 32)
		return rgba{float64(v >> 16 & 255), float64(v >> 8 & 255), float64(v & 255), 1}, nil
	}
	if m := reRGB.FindStringSubmatch(s); m != nil {
		p := strings.Split(m[1], ",")
		if len(p) < 3 {
			return rgba{}, fmt.Errorf("颜色分量不足: %s", s)
		}
		f := make([]float64, 4)
		f[3] = 1
		for i := range p {
			v, err := strconv.ParseFloat(strings.TrimSpace(p[i]), 64)
			if err != nil {
				return rgba{}, fmt.Errorf("无法解析颜色: %s", s)
			}
			f[i] = v
		}
		return rgba{f[0], f[1], f[2], f[3]}, nil
	}
	return rgba{}, fmt.Errorf("无法解析颜色: %s", s)
}

// over 把半透明前景 alpha 合成到不透明背景上。
func over(fg, bg rgba) rgba {
	a := fg.a
	return rgba{fg.r*a + bg.r*(1-a), fg.g*a + bg.g*(1-a), fg.b*a + bg.b*(1-a), 1}
}

func luminance(c rgba) float64 {
	ch := func(v float64) float64 {
		v /= 255
		if v <= 0.04045 {
			return v / 12.92
		}
		return math.Pow((v+0.055)/1.055, 2.4)
	}
	return 0.2126*ch(c.r) + 0.7152*ch(c.g) + 0.0722*ch(c.b)
}

func ratio(x, y rgba) float64 {
	a, b := luminance(x), luminance(y)
	if a < b {
		a, b = b, a
	}
	return (a + 0.05) / (b + 0.05)
}

type palette map[string]string

// pair 计算 fg 叠在 bg 上的对比度；bg 半透明时先合成到 base 上。
func (p palette) pair(fg, bg, base string) (float64, error) {
	b, err := parseColor(p[bg])
	if err != nil {
		return 0, fmt.Errorf("%s: %w", bg, err)
	}
	if b.a < 1 {
		under, err := parseColor(p[base])
		if err != nil {
			return 0, fmt.Errorf("%s: %w", base, err)
		}
		b = over(b, under)
	}
	f, err := parseColor(p[fg])
	if err != nil {
		return 0, fmt.Errorf("%s: %w", fg, err)
	}
	if f.a < 1 {
		f = over(f, b)
	}
	return ratio(f, b), nil
}

type check struct {
	fg, bg, base string
	min          float64
}

// 与 design-system/MASTER.md「配色方案」一节的约定一致：正文 / 小字 ≥ 4.5，图形 ≥ 3。
func schemeChecks() []check {
	surfaces := []string{"--bg", "--surface", "--chrome", "--overlay"}
	var cs []check
	for _, s := range append(append([]string{}, surfaces...), "--surface-2") {
		cs = append(cs, check{"--text", s, "", 4.5})
	}
	for _, s := range surfaces {
		cs = append(cs, check{"--muted", s, "", 4.5})
	}
	cs = append(cs,
		check{"--text", "--accent-subtle", "--chrome", 4.5}, // 当前导航项
		check{"--text", "--hover", "--chrome", 4.5},
		check{"--on-danger", "--danger-solid", "", 4.5},
		check{"--on-danger", "--danger-solid-hov", "", 4.5},
	)
	for _, k := range []string{"success", "warning", "danger"} {
		for _, s := range []string{"--surface", "--bg"} {
			cs = append(cs, check{"--" + k + "-text", s, "", 4.5}, check{"--" + k + "-text", "--" + k + "-subtle", s, 4.5})
		}
	}
	for _, k := range []string{"fg", "cmd", "warn", "err"} {
		cs = append(cs, check{"--term-" + k, "--term-bg", "", 4.5})
	}
	return append(cs, accentChecks()...)
}

func accentChecks() []check {
	var cs []check
	for _, s := range []string{"--bg", "--surface", "--chrome", "--overlay"} {
		cs = append(cs, check{"--accent-text", s, "", 4.5})
	}
	return append(cs,
		check{"--accent-text", "--accent-subtle", "--surface", 4.5},
		check{"--muted", "--accent-subtle", "--surface", 4.5}, // 选中版本行的类型 / 发布日期副行
		check{"--on-accent", "--accent-solid", "", 4.5},
		check{"--on-accent", "--accent-solid-hov", "", 4.5},
		check{"--accent", "--surface", "", 3},
		check{"--accent", "--bg", "", 3},
	)
}

func TestThemeContrast(t *testing.T) {
	raw, err := os.ReadFile("../web/ui/themes.css")
	if err != nil {
		t.Fatal(err)
	}
	css := reComment.ReplaceAllString(string(raw), "")
	schemes := map[string]map[string]palette{} // scheme → mode → 变量
	accents := map[string]map[string]palette{}
	for _, m := range reBlock.FindAllStringSubmatch(css, -1) {
		sel := strings.TrimSpace(m[1])
		vars := palette{}
		for _, v := range reVar.FindAllStringSubmatch(m[2], -1) {
			vars[v[1]] = strings.TrimSpace(v[2])
		}
		if s := reScheme.FindStringSubmatch(sel); s != nil {
			if schemes[s[1]] == nil {
				schemes[s[1]] = map[string]palette{}
			}
			schemes[s[1]][s[2]] = vars
		} else if a := reAccent.FindStringSubmatch(sel); a != nil {
			if accents[a[1]] == nil {
				accents[a[1]] = map[string]palette{}
			}
			accents[a[1]][a[2]] = vars
		}
	}
	if len(schemes) < 6 || len(accents) < 8 {
		t.Fatalf("解析到的方案 / 强调色数量异常：%d / %d", len(schemes), len(accents))
	}
	n := 0
	run := func(ctx string, p palette, cs []check) {
		for _, c := range cs {
			n++
			r, err := p.pair(c.fg, c.bg, c.base)
			if err != nil {
				t.Errorf("%s: %v", ctx, err)
				continue
			}
			if r < c.min {
				on := c.bg
				if c.base != "" {
					on += "@" + c.base
				}
				t.Errorf("%s: %s 叠在 %s 上对比度 %.2f < %.1f", ctx, c.fg, on, r, c.min)
			}
		}
	}
	for name, modes := range schemes {
		for _, mode := range []string{"light", "dark"} {
			base, ok := modes[mode]
			if !ok {
				t.Errorf("方案 %s 缺少 %s 模式", name, mode)
				continue
			}
			run(name+"/"+mode, base, schemeChecks())
			for acc, am := range accents {
				merged := palette{}
				for k, v := range base {
					merged[k] = v
				}
				for k, v := range am[mode] {
					merged[k] = v
				}
				run(name+"/"+mode+"+"+acc, merged, accentChecks())
			}
		}
	}
	t.Logf("校验 %d 个方案 × 2 模式 + %d 种强调色，共 %d 组对比度", len(schemes), len(accents), n)
}
