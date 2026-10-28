package inst

import "sort"

// SetStartHook 登记「起服务器进程之前」的回调（手动启动、定时重启、崩溃自动重启都会经过这里）。
// 音乐共享在这里写好桥接模组的配置和 voice_host：SVC 只在启动时读 voice_host。回调要快，出错只记日志。
func (m *Manager) SetStartHook(fn func(name string)) {
	m.autoMu.Lock()
	m.startHook = fn
	m.autoMu.Unlock()
}

// beforeStart 只在实例停着时调用回调（已经在运行的，Start 自己会报错）。
func (m *Manager) beforeStart(i *Instance) {
	m.autoMu.Lock()
	fn := m.startHook
	m.autoMu.Unlock()
	if fn != nil && i.Status() == "stopped" {
		fn(i.Name)
	}
}

// OnlinePlayers 当前在线的玩家（按名字排序）。
func (i *Instance) OnlinePlayers() []string {
	i.onlineMu.Lock()
	out := make([]string, 0, len(i.online))
	for n := range i.online {
		out = append(out, n)
	}
	i.onlineMu.Unlock()
	sort.Strings(out)
	return out
}
