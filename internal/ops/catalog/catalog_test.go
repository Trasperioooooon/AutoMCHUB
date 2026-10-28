package catalog

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"minedeck/internal/app"
	"minedeck/internal/inst"
	"minedeck/internal/ops"
	"minedeck/internal/tunnel"
)

// newCatalog 临时程序目录里放一个停止的实例「生存服」，建好注册表。
func newCatalog(t *testing.T) (*ops.Registry, string) {
	t.Helper()
	old := []string{app.Base, app.ServersDir, app.BackupsDir, app.CacheDir, app.RuntimesDir}
	t.Cleanup(func() {
		app.Base, app.ServersDir, app.BackupsDir, app.CacheDir, app.RuntimesDir = old[0], old[1], old[2], old[3], old[4]
	})
	app.Base = t.TempDir()
	app.ServersDir = filepath.Join(app.Base, "servers")
	app.BackupsDir = filepath.Join(app.Base, "backups")
	app.CacheDir = filepath.Join(app.Base, "cache")
	app.RuntimesDir = filepath.Join(app.Base, "runtimes")
	if _, err := app.UpdateConfig(func(c *app.Config) error { *c = app.Config{Source: "auto"}; return nil }); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(app.ServersDir, "s1")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	s, _ := json.Marshal(inst.Settings{Name: "生存服", Core: "paper", MC: "1.21.4", XmxMB: 2048, XmsMB: 1024})
	props := filepath.Join(dir, "server.properties")
	for p, body := range map[string]string{filepath.Join(dir, "instance.json"): string(s), props: "motd=hello\nmax-players=20\n"} {
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	mgr, err := inst.NewManager()
	if err != nil {
		t.Fatal(err)
	}
	return New(Env{Mgr: mgr, Tun: tunnel.NewManager(), Port: 27333}), props
}

// 风险等级和「仅本机」按设计文档 §3.3、§5.2 定。
func TestLevelsFollowDesign(t *testing.T) {
	reg, _ := newCatalog(t)
	want := map[ops.Level][]string{
		ops.Read: {"app.info", "app.update.check", "instance.list", "task.get", "instance.props.get", "instance.policies.get",
			"instance.backups.list", "instance.players.get", "instance.resources.search", "mc.cores", "mc.versions", "mc.builds",
			"java.list", "java.scan", "tunnel.list", "ops.log"},
		ops.Write: {"instance.create", "instance.start", "instance.settings.set", "instance.props.set", "instance.policies.set",
			"instance.backup.create", "instance.whitelist.add", "instance.whitelist.remove", "instance.resources.install", "tunnel.start"},
		ops.Danger: {"instance.stop", "instance.kill", "instance.command", "instance.backup.restore", "instance.players.op",
			"instance.players.deop", "instance.players.kick", "instance.players.ban", "instance.players.pardon", "tunnel.stop"},
		ops.HumanOnly: {"app.config.set", "app.shutdown", "app.update.apply", "host.pickdir", "host.openpath", "instance.import",
			"instance.delete", "instance.opendir", "instance.backup.delete", "java.add", "tunnel.add", "tunnel.update", "tunnel.delete",
			// AI 设置（第二阶段）：AI 永远看不到、也改不了自己的设置和 Key（§3.3）
			"ai.settings.get", "ai.provider.set", "ai.models.list", "ai.test", "ai.quota.set", "ai.prices.set", "ai.prices.refresh"},
	}

	// 音乐共享（第五阶段）：开始、停止广播这类操作只能由人来（§8.6）
	for level, names := range map[ops.Level][]string{
		ops.Read: {"music.status"}, ops.Write: {"music.bridge.install", "music.voicehost.set"},
		ops.HumanOnly: {"music.sources", "music.start", "music.stop", "music.settings.set", "music.system.confirm"},
	} {
		want[level] = append(want[level], names...)
	}

	n := 0
	for level, names := range want {
		for _, name := range names {
			n++
			op := reg.Op(name)
			if op == nil {
				t.Errorf("没有登记 %s", name)
				continue
			}
			if op.Level != level {
				t.Errorf("%s 的等级是 %s，应为 %s", name, op.Level, level)
			}
		}
	}
	if got := len(reg.List()); got != n {
		t.Errorf("登记了 %d 个操作，上表列了 %d 个", got, n)
	}
	var local []string
	for _, op := range reg.List() {
		if op.LocalOnly {
			local = append(local, op.Name)
		}
		if op.Title == "" {
			t.Errorf("%s 没有中文标题", op.Name)
		}
		if op.Params != nil {
			if _, err := json.Marshal(op.Params); err != nil {
				t.Errorf("%s 的参数说明编不成 JSON：%v", op.Name, err)
			}
		}
	}
	slices.Sort(local)
	if strings.Join(local, ",") != "ai.models.list,ai.prices.refresh,ai.prices.set,ai.provider.set,ai.quota.set,ai.test,"+
		"host.openpath,host.pickdir,instance.opendir,java.add"+
		",music.sources,music.start,music.system.confirm" { // 第五阶段
		t.Errorf("仅本机的操作：%v", local)
	}
}

// AI 的工具清单里没有仅人工的操作；游戏内 AI 现在一个工具都没有（game_info 等到第四阶段再开放）。
func TestAIToolLists(t *testing.T) {
	reg, _ := newCatalog(t)
	for _, op := range reg.Available(ops.Caller{Source: ops.SrcAssistant, Local: true}) {
		if op.Level == ops.HumanOnly {
			t.Errorf("助手的工具清单里有仅人工的操作 %s", op.Name)
		}
	}
	if n := len(reg.Available(ops.Caller{Source: ops.SrcAssistant, Local: true})); n != 16+10+10+3 { // +3：音乐共享（第五阶段）的读 1 + 写 2
		t.Errorf("助手能用 %d 个操作，应为读 16 + 写 10 + 危险 10 + 音乐共享 3", n)
	}
	if l := reg.Available(ops.Caller{Source: ops.SrcGameChat, Actor: "Steve"}); len(l) != 0 {
		t.Errorf("游戏内 AI 不该有工具：%v", l)
	}
}

// 真实操作上的提案：AI 提出改 server.properties，预览列出改前改后；确认前文件被别人改过，提案作废；
// 重新提出、文件没变时确认，按提案里的参数原样写进文件，操作记录写明提案编号和确认人。
func TestPropsProposalFlow(t *testing.T) {
	reg, props := newCatalog(t)
	ctx := context.Background()
	ai := ops.Caller{Source: ops.SrcAssistant, Actor: "本机", Session: "s1", Local: true}
	ui := ops.Caller{Source: ops.SrcUI, Actor: "本机", Local: true}
	args := ops.Args(`{"inst":"生存服","pairs":[{"key":"max-players","value":"10"},{"key":"motd","value":"hello"}]}`)
	propose := func() *ops.Proposal {
		t.Helper()
		res, err := reg.Do(ctx, ai, "instance.props.set", args)
		if err != nil {
			t.Fatal(err)
		}
		return res.(*ops.Proposal)
	}
	p := propose()
	if len(p.Plan.Changes) != 1 || p.Plan.Changes[0] != (ops.Change{What: "max-players", Before: "20", After: "10"}) {
		t.Fatalf("预览的改动不对（motd 没变不该列出来）：%+v", p.Plan.Changes)
	}
	read := func() string { b, _ := os.ReadFile(props); return string(b) }
	if !strings.Contains(read(), "max-players=20") {
		t.Fatal("没确认就改了文件")
	}
	// 确认前有人在别处改了这个文件
	if err := os.WriteFile(props, []byte("motd=changed elsewhere\nmax-players=20\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := reg.Confirm(ctx, ui, p.ID, false); ops.CodeOf(err) != 409 || !strings.Contains(err.Error(), "server.properties") {
		t.Fatalf("文件变了，提案应作废：%v", err)
	}
	if !strings.Contains(read(), "max-players=20") {
		t.Fatal("作废的提案不该改文件")
	}
	p = propose()
	if _, err := reg.Confirm(ctx, ui, p.ID, false); err != nil {
		t.Fatal(err)
	}
	if got := read(); !strings.Contains(got, "max-players=10") || !strings.Contains(got, "motd=hello") {
		t.Fatalf("没有按提案的参数写：%s", got)
	}
	recs, _ := reg.Log.Query(ops.Query{})
	if len(recs) != 1 || recs[0].Proposal != p.ID || recs[0].ApprovedBy != "本机" || recs[0].Src != ops.SrcAssistant || recs[0].Inst != "生存服" {
		t.Fatalf("操作记录：%+v", recs)
	}
	// 危险操作的预览带上警告；实例不存在时连提案都不生成
	res, err := reg.Do(ctx, ai, "instance.kill", ops.Args(`{"inst":"生存服"}`))
	if err != nil || res.(*ops.Proposal).Plan.Warning == "" {
		t.Fatalf("强杀的提案应带警告：%v %+v", err, res)
	}
	if _, err := reg.Do(ctx, ai, "instance.stop", ops.Args(`{"inst":"没有这个服"}`)); ops.CodeOf(err) != 404 {
		t.Fatalf("实例不存在时应直接报 404：%v", err)
	}
}
