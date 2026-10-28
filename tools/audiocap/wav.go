package main

import (
	"encoding/binary"
	"errors"
	"io"
)

// maxWAVData 是 WAV 数据块的上限（RIFF 长度字段是 32 位）。
const maxWAVData = 0xFFFFFFFF - 36

// wavWriter 写 16 位 PCM 的 WAV：先写长度为 0 的文件头，Finish 时回填长度，所以中途出错留下的文件头也合法。
type wavWriter struct {
	w        io.WriteSeeker
	rate     int
	channels int
	n        uint32 // 已写的数据字节数
	buf      []byte
}

func newWAVWriter(w io.WriteSeeker, rate, channels int) (*wavWriter, error) {
	ww := &wavWriter{w: w, rate: rate, channels: channels}
	if _, err := w.Write(ww.header()); err != nil {
		return nil, err
	}
	return ww, nil
}

// header 是 44 字节的标准文件头：RIFF、fmt （PCM）、data。
func (w *wavWriter) header() []byte {
	le := binary.LittleEndian
	b := make([]byte, 44)
	copy(b[0:], "RIFF")
	le.PutUint32(b[4:], 36+w.n)
	copy(b[8:], "WAVEfmt ")
	le.PutUint32(b[16:], 16)
	le.PutUint16(b[20:], 1) // PCM
	le.PutUint16(b[22:], uint16(w.channels))
	le.PutUint32(b[24:], uint32(w.rate))
	le.PutUint32(b[28:], uint32(w.rate*w.channels*2))
	le.PutUint16(b[32:], uint16(w.channels*2))
	le.PutUint16(b[34:], 16)
	copy(b[36:], "data")
	le.PutUint32(b[40:], w.n)
	return b
}

// Write 追加采样（多声道时交错排列）。
func (w *wavWriter) Write(samples []int16) error {
	if uint64(w.n)+uint64(len(samples))*2 > maxWAVData {
		return errors.New("WAV 文件超过 4GB 上限")
	}
	w.buf = w.buf[:0]
	for _, s := range samples {
		w.buf = binary.LittleEndian.AppendUint16(w.buf, uint16(s))
	}
	if _, err := w.w.Write(w.buf); err != nil {
		return err
	}
	w.n += uint32(len(w.buf))
	return nil
}

// Finish 回填文件头里的长度，并把写位置移回末尾（之后还能接着写）。不关闭底层文件。
func (w *wavWriter) Finish() error {
	if _, err := w.w.Seek(0, io.SeekStart); err != nil {
		return err
	}
	if _, err := w.w.Write(w.header()); err != nil {
		return err
	}
	_, err := w.w.Seek(0, io.SeekEnd)
	return err
}

// Bytes 返回已写的数据字节数。
func (w *wavWriter) Bytes() uint32 { return w.n }
