package events

import (
	"sync"
	"testing"
	"time"
)

// 同一订阅者必须按发布顺序收到事件（回归：曾经逐事件 go h(e) 派发导致乱序）。
func TestOrderedDelivery(t *testing.T) {
	const n = 200 // 少于 queueSize，保证零丢弃
	var mu sync.Mutex
	var got []int
	done := make(chan struct{})
	Subscribe(func(e Event) {
		if e.Type != "test.order" {
			return
		}
		mu.Lock()
		got = append(got, e.Data["seq"].(int))
		if len(got) == n {
			close(done)
		}
		mu.Unlock()
	})
	for i := 0; i < n; i++ {
		Publish("test.order", map[string]any{"seq": i})
	}
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatalf("超时：只收到 %d/%d 个事件", len(got), n)
	}
	mu.Lock()
	defer mu.Unlock()
	for i, v := range got {
		if v != i {
			t.Fatalf("乱序：第 %d 个收到 seq=%d", i, v)
		}
	}
}

// 队列溢出时挤掉最旧、保住最新（末态事件价值更高），且顺序仍单调。
func TestOverflowKeepsNewest(t *testing.T) {
	const n = queueSize + 150
	gate := make(chan struct{})
	var mu sync.Mutex
	var got []int
	Subscribe(func(e Event) {
		if e.Type != "test.overflow" {
			return
		}
		<-gate // 卡住消费端，逼出溢出路径
		mu.Lock()
		got = append(got, e.Data["seq"].(int))
		mu.Unlock()
	})
	for i := 0; i < n; i++ {
		Publish("test.overflow", map[string]any{"seq": i})
	}
	close(gate)
	deadline := time.Now().Add(5 * time.Second)
	for {
		mu.Lock()
		l := len(got)
		last := -1
		if l > 0 {
			last = got[l-1]
		}
		mu.Unlock()
		if last == n-1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("超时：最后收到 seq=%d，期望 %d", last, n-1)
		}
		time.Sleep(10 * time.Millisecond)
	}
	mu.Lock()
	defer mu.Unlock()
	prev := -1
	for _, v := range got {
		if v <= prev {
			t.Fatalf("顺序未保持单调：%d 出现在 %d 之后", v, prev)
		}
		prev = v
	}
}
