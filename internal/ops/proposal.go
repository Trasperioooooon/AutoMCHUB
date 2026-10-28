package ops

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"slices"
	"sort"
	"strings"
	"time"
)

// Proposal AI 发起的写操作先生成的提案（设计文档 §3.3）：等人在界面上确认，确认后按这里存下的参数原样执行，
// 不让 AI 再生成一遍参数。
type Proposal struct {
	ID      string    `json:"id"` // "p_8f2c1a9e3b7d"
	Op      string    `json:"op"`
	Title   string    `json:"title"`
	Level   Level     `json:"level"`
	Args    Args      `json:"args"` // 确认后原样执行的参数（规范化后的原文）
	Plan    *Plan     `json:"plan"`
	Caller  Caller    `json:"caller"` // 谁提出的
	Created time.Time `json:"created"`
	Expires time.Time `json:"expires"`
}

const maxPending = 100 // 同时等确认的提案上限，超出时挤掉最早的

func (p *Proposal) clone() *Proposal {
	c := *p
	c.Args = bytes.Clone(p.Args)
	return &c
}

func newID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return "p_" + hex.EncodeToString(b)
}

// propose 调用预览函数生成提案并存起来，不执行。
func (r *Registry) propose(ctx context.Context, c Caller, op *Op, args Args) (*Proposal, error) {
	plan := &Plan{Summary: op.Title}
	if op.Preview != nil {
		p, err := op.Preview(ctx, c, args)
		if err != nil {
			return nil, err
		}
		plan = p
	}
	now := r.now()
	p := &Proposal{ID: newID(), Op: op.Name, Title: op.Title, Level: op.Level, Args: bytes.Clone(args),
		Plan: plan, Caller: c, Created: now, Expires: now.Add(r.TTL)}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.gcLocked()
	for len(r.proposals) >= maxPending {
		oldest := ""
		for id, q := range r.proposals {
			if oldest == "" || q.Created.Before(r.proposals[oldest].Created) {
				oldest = id
			}
		}
		delete(r.proposals, oldest)
	}
	r.proposals[p.ID] = p
	return p.clone(), nil
}

// gcLocked 丢掉过期已久的提案。刚过期的再留一个有效期，确认时还能明确告诉用户「已过期」。
func (r *Registry) gcLocked() {
	now := r.now()
	for id, p := range r.proposals {
		if now.After(p.Expires.Add(r.TTL)) {
			delete(r.proposals, id)
		}
	}
}

// Pending 还在等确认、没有过期的提案，按提出的时间排序；session 不为空时只列这个会话的。
func (r *Registry) Pending(session string) []*Proposal {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.gcLocked()
	now := r.now()
	out := []*Proposal{}
	for _, p := range r.proposals {
		if now.After(p.Expires) || (session != "" && p.Caller.Session != session) {
			continue
		}
		out = append(out, p.clone())
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Created.Before(out[j].Created) })
	return out
}

// Confirm 人确认提案：先查确认的人有没有资格，再复查有效期和前置条件，最后按提案里存下的参数原样执行。
// 提案只能用一次：查过资格之后，不论成败都从等待列表里拿掉。ack 是危险操作的第二次确认
// （界面上「我知道这会让在线玩家掉线」那个勾选框）。
func (r *Registry) Confirm(ctx context.Context, approver Caller, id string, ack bool) (any, error) {
	r.mu.Lock()
	p := r.proposals[id]
	if p == nil {
		r.mu.Unlock()
		return nil, Errorf(404, "提案不存在，或者已经处理过了")
	}
	op := r.ops[p.Op]
	switch {
	case !approver.Source.Human():
		r.mu.Unlock()
		return nil, Errorf(403, "提案只能由人确认")
	case op.LocalOnly && !approver.Local:
		r.mu.Unlock()
		return nil, Errorf(403, "「%s」仅支持在本机确认", op.Title)
	case op.Level == Danger && !ack:
		r.mu.Unlock()
		return nil, Errorf(400, "这是危险操作，需要再确认一次")
	}
	delete(r.proposals, id)
	r.mu.Unlock()

	if r.now().After(p.Expires) {
		return nil, Errorf(410, "提案已过期，请让 AI 重新提出")
	}
	if op.Preview != nil {
		plan, err := op.Preview(ctx, p.Caller, p.Args)
		if err != nil {
			return nil, Errorf(409, "提案作废：%v。请让 AI 重新预览", err)
		}
		if changed := diffPre(p.Plan.Pre, plan.Pre); len(changed) > 0 {
			return nil, Errorf(409, "提案作废：预览之后%s变了，请让 AI 重新预览", strings.Join(changed, "、"))
		}
	}
	return r.exec(ctx, p.Caller, op, p.Args, p.ID, approver.Actor)
}

// Reject 人拒绝提案（理由由上层交还给 AI）。
func (r *Registry) Reject(approver Caller, id string) error {
	if !approver.Source.Human() {
		return Errorf(403, "提案只能由人处理")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.proposals[id] == nil {
		return Errorf(404, "提案不存在，或者已经处理过了")
	}
	delete(r.proposals, id)
	return nil
}

// diffPre 列出值变了（或多了、少了）的前置条件名称。
func diffPre(a, b map[string]string) []string {
	var out []string
	for k, v := range a {
		if w, ok := b[k]; !ok || w != v {
			out = append(out, k)
		}
	}
	for k := range b {
		if _, ok := a[k]; !ok {
			out = append(out, k)
		}
	}
	slices.Sort(out)
	return out
}
