// Package events 进程内轻量事件总线：实例/备份/隧道等事件的发布订阅，
// 供 Webhook 推送与未来扩展使用。
package events

import (
	"sync"
	"time"
)

type Event struct {
	Type string         `json:"type"` // instance.start/stop/crash, player.join/leave, backup.done, tunnel.up/down
	Time time.Time      `json:"time"`
	Data map[string]any `json:"data"`
}

var (
	mu       sync.RWMutex
	handlers []func(Event)
)

func Subscribe(fn func(Event)) {
	mu.Lock()
	handlers = append(handlers, fn)
	mu.Unlock()
}

func Publish(typ string, data map[string]any) {
	e := Event{Type: typ, Time: time.Now(), Data: data}
	mu.RLock()
	hs := append([]func(Event){}, handlers...)
	mu.RUnlock()
	for _, h := range hs {
		go h(e) // 异步派发，绝不阻塞业务路径
	}
}
