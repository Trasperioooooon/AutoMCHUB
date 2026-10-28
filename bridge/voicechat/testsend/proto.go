package main

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
)

// 协议第 1 版，和模组里的 Protocol.java 一一对应。说明见 bridge/voicechat/README.md 的「协议」一节。
// 每帧：类型 1 字节 | 保留 1 字节（填 0） | 内容长度 2 字节 | 内容。所有整数都是小端。
const (
	protoVersion = 1
	sampleRate   = 48000
	frameSamples = 960
	headerSize   = 4
	maxPayload   = 4096
	pcmPayload   = 4 + frameSamples*2

	typeHello   = 0x01
	typeWelcome = 0x02
	typeError   = 0x03
	typePCM     = 0x10
	typePing    = 0x20
	typePong    = 0x21
	typeStatus  = 0x30
	typeEnd     = 0x40

	errBadToken = 1
	errVersion  = 2
	errBusy     = 3
	errProtocol = 4
	errDisabled = 5
)

type frame struct {
	typ     byte
	payload []byte
}

func writeFrame(w io.Writer, typ byte, payload []byte) error {
	if len(payload) > maxPayload {
		return fmt.Errorf("帧太长：%d 字节", len(payload))
	}
	buf := make([]byte, headerSize+len(payload))
	buf[0] = typ
	binary.LittleEndian.PutUint16(buf[2:], uint16(len(payload)))
	copy(buf[headerSize:], payload)
	_, err := w.Write(buf)
	return err
}

func readFrame(r io.Reader) (frame, error) {
	var h [headerSize]byte
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
	return frame{typ: h[0], payload: p}, nil
}

// HELLO：协议版本 2 字节 | 令牌长度 1 字节 | 令牌 | 广播者名字（剩下的全部，可以为空）。
func helloPayload(token, name string) ([]byte, error) {
	if len(token) > 255 {
		return nil, errors.New("令牌不能超过 255 字节")
	}
	p := make([]byte, 3, 3+len(token)+len(name))
	binary.LittleEndian.PutUint16(p, protoVersion)
	p[2] = byte(len(token))
	p = append(p, token...)
	p = append(p, name...)
	return p, nil
}

// PCM：序号 4 字节 | 960 个 16 位小端采样（48 kHz 单声道）。
func pcmFrame(seq uint32, samples []int16) []byte {
	p := make([]byte, pcmPayload)
	binary.LittleEndian.PutUint32(p, seq)
	for i := 0; i < frameSamples && i < len(samples); i++ {
		binary.LittleEndian.PutUint16(p[4+2*i:], uint16(samples[i]))
	}
	return p
}

type welcome struct {
	version      int
	sampleRate   int
	frameSamples int
	channels     int
	listeners    int
	modVersion   string
}

// WELCOME：协议版本 2 | 采样率 4 | 每帧采样数 2 | 声道数 1 | 当前听众数 2 | 模组版本（剩下的全部）。
func parseWelcome(p []byte) (welcome, error) {
	if len(p) < 11 {
		return welcome{}, fmt.Errorf("WELCOME 太短：%d 字节", len(p))
	}
	return welcome{
		version:      int(binary.LittleEndian.Uint16(p[0:])),
		sampleRate:   int(binary.LittleEndian.Uint32(p[2:])),
		frameSamples: int(binary.LittleEndian.Uint16(p[6:])),
		channels:     int(p[8]),
		listeners:    int(binary.LittleEndian.Uint16(p[9:])),
		modVersion:   string(p[11:]),
	}, nil
}

type status struct {
	listeners, buffered, source                int
	received, played, sent, dropped, underruns uint32
}

// STATUS（模组每 2 秒发一次）：听众数 2 | 缓冲帧数 2 | 音源 1 | 收到 4 | 编码 4 | 发出 4 | 丢弃 4 | 欠载 4。
// 计数都从这次连接开始算。
func parseStatus(p []byte) (status, error) {
	if len(p) < 25 {
		return status{}, fmt.Errorf("STATUS 太短：%d 字节", len(p))
	}
	le := binary.LittleEndian
	return status{
		listeners: int(le.Uint16(p[0:])),
		buffered:  int(le.Uint16(p[2:])),
		source:    int(p[4]),
		received:  le.Uint32(p[5:]),
		played:    le.Uint32(p[9:]),
		sent:      le.Uint32(p[13:]),
		dropped:   le.Uint32(p[17:]),
		underruns: le.Uint32(p[21:]),
	}, nil
}

// ERROR：错误码 2 | 说明（UTF-8）。
func parseError(p []byte) (int, string) {
	if len(p) < 2 {
		return 0, ""
	}
	return int(binary.LittleEndian.Uint16(p)), string(p[2:])
}

func sourceName(s int) string {
	switch s {
	case 1:
		return "广播"
	case 2:
		return "自测音"
	default:
		return "无"
	}
}
