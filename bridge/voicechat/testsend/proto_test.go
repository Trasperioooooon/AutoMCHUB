package main

import (
	"bytes"
	"encoding/binary"
	"math"
	"testing"
)

func TestFrameRoundTrip(t *testing.T) {
	samples := make([]int16, frameSamples)
	for i := range samples {
		samples[i] = int16(i*37 - 16000)
	}
	var buf bytes.Buffer
	if err := writeFrame(&buf, typePCM, pcmFrame(7, samples)); err != nil {
		t.Fatal(err)
	}
	raw := buf.Bytes()
	if len(raw) != headerSize+pcmPayload {
		t.Fatalf("PCM 帧长度 %d，应为 %d", len(raw), headerSize+pcmPayload)
	}
	if raw[0] != typePCM || raw[1] != 0 || binary.LittleEndian.Uint16(raw[2:]) != pcmPayload {
		t.Fatalf("帧头不对：% x", raw[:4])
	}
	f, err := readFrame(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	if binary.LittleEndian.Uint32(f.payload) != 7 {
		t.Fatal("序号不对")
	}
	for i, want := range samples {
		if got := int16(binary.LittleEndian.Uint16(f.payload[4+2*i:])); got != want {
			t.Fatalf("第 %d 个采样 %d，应为 %d", i, got, want)
		}
	}
}

func TestHelloLayout(t *testing.T) {
	p, err := helloPayload("0123456789abcdef", "房主")
	if err != nil {
		t.Fatal(err)
	}
	if binary.LittleEndian.Uint16(p) != protoVersion || p[2] != 16 || string(p[3:19]) != "0123456789abcdef" || string(p[19:]) != "房主" {
		t.Fatalf("HELLO 布局不对：% x", p)
	}
	if _, err := helloPayload(string(make([]byte, 256)), ""); err == nil {
		t.Fatal("超长令牌应该报错")
	}
}

func TestParseStatus(t *testing.T) {
	p := make([]byte, 25)
	binary.LittleEndian.PutUint16(p[0:], 2)
	binary.LittleEndian.PutUint16(p[2:], 3)
	p[4] = 1
	binary.LittleEndian.PutUint32(p[5:], 100)
	binary.LittleEndian.PutUint32(p[9:], 99)
	binary.LittleEndian.PutUint32(p[13:], 98)
	binary.LittleEndian.PutUint32(p[17:], 1)
	binary.LittleEndian.PutUint32(p[21:], 2)
	s, err := parseStatus(p)
	if err != nil {
		t.Fatal(err)
	}
	if s.listeners != 2 || s.buffered != 3 || s.source != 1 || s.received != 100 || s.played != 99 || s.sent != 98 || s.dropped != 1 || s.underruns != 2 {
		t.Fatalf("解析结果不对：%+v", s)
	}
}

func wavBytes(format, channels, rate, bits int, data []byte) []byte {
	var b bytes.Buffer
	le := binary.LittleEndian
	b.WriteString("RIFF")
	_ = binary.Write(&b, le, uint32(36+len(data)))
	b.WriteString("WAVEfmt ")
	_ = binary.Write(&b, le, uint32(16))
	_ = binary.Write(&b, le, uint16(format))
	_ = binary.Write(&b, le, uint16(channels))
	_ = binary.Write(&b, le, uint32(rate))
	_ = binary.Write(&b, le, uint32(rate*channels*bits/8))
	_ = binary.Write(&b, le, uint16(channels*bits/8))
	_ = binary.Write(&b, le, uint16(bits))
	b.WriteString("data")
	_ = binary.Write(&b, le, uint32(len(data)))
	b.Write(data)
	return b.Bytes()
}

func TestDecodeWAVStereo16Resampled(t *testing.T) {
	// 44.1 kHz 立体声：左声道 +0.5，右声道 -0.5 → 混成单声道应该是 0
	const n = 44100
	data := make([]byte, n*4)
	for i := 0; i < n; i++ {
		binary.LittleEndian.PutUint16(data[i*4:], uint16(int16(16384)))
		binary.LittleEndian.PutUint16(data[i*4+2:], uint16(0xC000)) // -16384
	}
	pcm, err := decodeWAV(wavBytes(1, 2, 44100, 16, data))
	if err != nil {
		t.Fatal(err)
	}
	if len(pcm) != 48000 {
		t.Fatalf("重采样后应为 48000 个采样，实际 %d", len(pcm))
	}
	for i, v := range pcm {
		if math.Abs(float64(v)) > 1e-6 {
			t.Fatalf("第 %d 个采样 %v，应为 0", i, v)
		}
	}
}

func TestDecodeWAVFloatMono(t *testing.T) {
	data := make([]byte, 4*3)
	for i, v := range []float32{0.25, -0.5, 1} {
		binary.LittleEndian.PutUint32(data[i*4:], math.Float32bits(v))
	}
	pcm, err := decodeWAV(wavBytes(3, 1, 48000, 32, data))
	if err != nil {
		t.Fatal(err)
	}
	if len(pcm) != 3 || pcm[0] != 0.25 || pcm[1] != -0.5 || pcm[2] != 1 {
		t.Fatalf("解码结果不对：%v", pcm)
	}
	if _, err := decodeWAV(wavBytes(1, 1, 48000, 8, []byte{1, 2})); err == nil {
		t.Fatal("8 位 WAV 应该报不支持")
	}
}

func TestLimitedSource(t *testing.T) {
	src := &limited{src: &toneSource{freq: 440, gain: 0.3}, n: 3}
	for i := 0; i < 3; i++ {
		f, ok := src.next()
		if !ok || len(f) != frameSamples {
			t.Fatalf("第 %d 帧不对", i)
		}
	}
	if _, ok := src.next(); ok {
		t.Fatal("应该只给 3 帧")
	}
}
