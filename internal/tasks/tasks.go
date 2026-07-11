// Package tasks 提供后台任务（如实例创建）的进度跟踪，供前端轮询。
package tasks

import (
	"context"
	"fmt"
	"strconv"
	"sync"
)

type Step struct {
	Name   string `json:"name"`
	Status string `json:"status"` // pending | running | done | error
}

type Snapshot struct {
	ID     string   `json:"id"`
	Title  string   `json:"title"`
	Steps  []Step   `json:"steps"`
	Log    []string `json:"log"`
	Label  string   `json:"label"`
	Done   int64    `json:"done"`
	Total  int64    `json:"total"`
	Ended  bool     `json:"ended"`
	Err    string   `json:"error,omitempty"`
	Result string   `json:"result,omitempty"`
}

type Task struct {
	id     string
	title  string
	mu     sync.Mutex
	steps  []Step
	log    []string
	label  string
	done   int64
	total  int64
	ended  bool
	err    string
	result string
	cancel context.CancelFunc
}

type Manager struct {
	mu  sync.Mutex
	seq int
	m   map[string]*Task
}

func NewManager() *Manager { return &Manager{m: map[string]*Task{}} }

// New 创建任务并返回其生命周期 context。
func (mg *Manager) New(title string, steps []string) (*Task, context.Context) {
	mg.mu.Lock()
	defer mg.mu.Unlock()
	mg.seq++
	t := &Task{id: "t" + strconv.Itoa(mg.seq), title: title}
	for _, s := range steps {
		t.steps = append(t.steps, Step{Name: s, Status: "pending"})
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.cancel = cancel
	mg.m[t.id] = t
	return t, ctx
}

func (mg *Manager) Get(id string) *Task {
	mg.mu.Lock()
	defer mg.mu.Unlock()
	return mg.m[id]
}

func (t *Task) ID() string { return t.id }

// StartStep 将第 i 步标记为运行中（前序步骤自动标记完成）。
func (t *Task) StartStep(i int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	for j := range t.steps {
		if j < i && t.steps[j].Status == "running" {
			t.steps[j].Status = "done"
		}
	}
	if i >= 0 && i < len(t.steps) {
		t.steps[i].Status = "running"
	}
	t.label, t.done, t.total = "", 0, 0
}

func (t *Task) Logf(format string, a ...any) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.log = append(t.log, fmt.Sprintf(format, a...))
	if len(t.log) > 400 {
		t.log = t.log[len(t.log)-400:]
	}
}

// ProgressFn 返回带标签的进度回调。
func (t *Task) ProgressFn(label string) func(done, total int64) {
	return func(done, total int64) {
		t.mu.Lock()
		t.label, t.done, t.total = label, done, total
		t.mu.Unlock()
	}
}

func (t *Task) Finish(result string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	for j := range t.steps {
		if t.steps[j].Status == "running" || t.steps[j].Status == "pending" {
			t.steps[j].Status = "done"
		}
	}
	t.ended, t.result = true, result
	t.cancel()
}

func (t *Task) Fail(err error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	for j := range t.steps {
		if t.steps[j].Status == "running" {
			t.steps[j].Status = "error"
		}
	}
	t.ended = true
	t.err = err.Error()
	t.log = append(t.log, "❌ "+err.Error())
	t.cancel()
}

func (t *Task) Snapshot() Snapshot {
	t.mu.Lock()
	defer t.mu.Unlock()
	s := Snapshot{
		ID: t.id, Title: t.title, Label: t.label,
		Done: t.done, Total: t.total,
		Ended: t.ended, Err: t.err, Result: t.result,
	}
	s.Steps = append(s.Steps, t.steps...)
	s.Log = append(s.Log, t.log...)
	return s
}
