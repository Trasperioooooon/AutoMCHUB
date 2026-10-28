// Package catalog 登记 MineDeck 的具体操作。网页接口只做 HTTP 适配（解析请求 → ops.Do → 写回响应），
// 以后的 AI 助手也从这里拿工具清单（设计文档 §5.2）。各操作的处理逻辑原样搬自原来的网页处理函数，
// 响应内容和状态码不变。
package catalog

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"maps"
	"os"
	"path/filepath"

	"minedeck/internal/app"
	"minedeck/internal/inst"
	"minedeck/internal/ops"
	"minedeck/internal/tunnel"
)

// Env 操作要用到的东西，由 web.New 注入。
type Env struct {
	Mgr      *inst.Manager
	Tun      *tunnel.Manager
	Port     int    // 实际监听端口
	Shutdown func() // 退出程序（「退出 MineDeck」和自动更新用）
}

type cat struct {
	Env
	reg *ops.Registry
}

// New 建好注册表并登记全部操作；操作记录写在 <程序目录>/logs/ops/。
// 定时任务和崩溃自动重启也经 inst 的回调各记一条（来源 schedule）。
func New(env Env) *ops.Registry {
	reg := ops.NewRegistry(ops.NewLog(filepath.Join(app.Base, "logs", "ops")))
	c := &cat{Env: env, reg: reg}
	c.appOps()
	c.instanceOps()
	c.backupOps()
	c.playerOps()
	c.resourceOps()
	c.mcOps()
	c.tunnelOps()
	c.logOps()
	if env.Mgr != nil {
		env.Mgr.SetAutoHook(func(a inst.AutoAction) {
			reg.Record(ops.Caller{Source: ops.SrcSchedule, Actor: a.Actor, Local: true}, a.Op, ops.ArgsOf(a.Args), a.Err, a.Dur)
		})
	}
	return reg
}

// bind 把参数解码进 T；解不开按 400 报（多半是类型不对）。
func bind[T any](a ops.Args) (T, error) {
	var v T
	if err := a.Bind(&v); err != nil {
		return v, ops.Wrap(400, err)
	}
	return v, nil
}

// instArgs 只带实例名的参数。
type instArgs struct {
	Inst string `json:"inst"`
}

var instName = ops.String("实例名称（实例列表里的 name）").Len(1, 100)

// withInst 参数说明：实例名 inst（必填）加上 props。
func withInst(props map[string]*ops.Schema, required ...string) *ops.Schema {
	p := map[string]*ops.Schema{"inst": instName}
	maps.Copy(p, props)
	return ops.Object(p, append([]string{"inst"}, required...)...)
}

// get 取实例；找不到按 404 报（原来直接调 Manager.Get 的接口是 404，其余经 Manager 方法报的是 400）。
func (c *cat) get(name string) (*inst.Instance, error) {
	i, err := c.Mgr.Get(name)
	return i, ops.Wrap(404, err)
}

// statusPre 写操作预览的前置条件：实例当前的状态（确认时状态变了，提案作废）。
func (c *cat) statusPre(name string) (*inst.Instance, map[string]string, error) {
	i, err := c.get(name)
	if err != nil {
		return nil, nil, err
	}
	return i, map[string]string{"实例状态": i.Status()}, nil
}

// fileHash 文件内容的指纹；文件不存在记为「无」。
func fileHash(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return "无"
	}
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// onlineWarning 会让在线玩家掉线的操作，预览里写明当前在线人数。
func onlineWarning(i *inst.Instance, what string) string {
	if n := i.OnlineCount(); n > 0 {
		return fmt.Sprintf("%s：在线的 %d 人会掉线", what, n)
	}
	return what
}
