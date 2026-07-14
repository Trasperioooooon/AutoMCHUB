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

// subscriber 每个订阅者一条串行队列：专属 goroutine 依发布顺序逐个执行回调，
// 保证同一订阅者收到的事件有序（此前逐事件 go h(e) 派发，start/stop 可能乱序送达）。
type subscriber struct {
	fn func(Event)
	ch chan Event
}

const queueSize = 256

var (
	mu   sync.RWMutex
	subs []*subscriber
)

func Subscribe(fn func(Event)) {
	s := &subscriber{fn: fn, ch: make(chan Event, queueSize)}
	mu.Lock()
	subs = append(subs, s)
	mu.Unlock()
	go func() {
		for e := range s.ch {
			s.fn(e)
		}
	}()
}

// Publish 异步派发，绝不阻塞业务路径：队列满时挤掉该订阅者最旧的事件
// （保最新优先——tunnel.down 之类的末态比积压的旧事件更有价值）。
func Publish(typ string, data map[string]any) {
	e := Event{Type: typ, Time: time.Now(), Data: data}
	mu.RLock()
	ss := append([]*subscriber{}, subs...)
	mu.RUnlock()
	for _, s := range ss {
		select {
		case s.ch <- e:
		default:
			select {
			case <-s.ch:
			default:
			}
			select {
			case s.ch <- e:
			default:
			}
		}
	}
}
