package inst

import (
	"fmt"
	"time"
)

// Schedule 定时任务：每天 At（HH:MM）执行。
type Schedule struct {
	Type string `json:"type"` // restart | command | backup
	At   string `json:"at"`   // "HH:MM"
	Args string `json:"args,omitempty"`
}

// Policies 实例运维策略。
type Policies struct {
	CrashRestart bool       `json:"crashRestart"`
	Schedules    []Schedule `json:"schedules,omitempty"`
}

// UpdatePolicies 更新实例策略。
func (m *Manager) UpdatePolicies(name string, p Policies) error {
	i, err := m.Get(name)
	if err != nil {
		return err
	}
	for _, s := range p.Schedules {
		if s.Type != "restart" && s.Type != "command" && s.Type != "backup" {
			return fmt.Errorf("未知任务类型: %s", s.Type)
		}
		var h, mi int
		if _, err := fmt.Sscanf(s.At, "%d:%d", &h, &mi); err != nil || h < 0 || h > 23 || mi < 0 || mi > 59 {
			return fmt.Errorf("时间格式应为 HH:MM: %s", s.At)
		}
		if s.Type == "command" && s.Args == "" {
			return fmt.Errorf("定时命令不能为空")
		}
	}
	i.procMu.Lock()
	i.Policies = p
	i.procMu.Unlock()
	return m.saveInstance(i)
}

// crashRestartLoop 崩溃后按退避策略自动重启（10s/30s/60s，连续 3 次放弃；
// 正常运行超过 10 分钟后计数清零）。
func (m *Manager) crashRestart(i *Instance) {
	i.procMu.Lock()
	if time.Since(i.startedAt) > 10*time.Minute {
		i.crashCount = 0
	}
	i.crashCount++
	n := i.crashCount
	i.procMu.Unlock()
	if n > 3 {
		i.Console.Append("[AutoMCHUB] ⚠ 连续崩溃 3 次，已停止自动重启。请检查上方日志排查原因。")
		return
	}
	delay := []time.Duration{10 * time.Second, 30 * time.Second, 60 * time.Second}[n-1]
	i.Console.Append(fmt.Sprintf("[AutoMCHUB] 检测到服务器异常退出，%v 后自动重启（第 %d/3 次）...", delay, n))
	time.Sleep(delay)
	if i.Status() != "stopped" {
		return // 用户已手动处理
	}
	if err := m.Start(i.Name); err != nil {
		i.Console.Append("[AutoMCHUB] 自动重启失败: " + err.Error())
	}
}

// startScheduler 全局定时任务调度（每 20 秒检查一次到点任务）。
func (m *Manager) startScheduler() {
	go func() {
		fired := map[string]string{}
		tick := time.NewTicker(20 * time.Second)
		defer tick.Stop()
		for range tick.C {
			now := time.Now()
			hhmm := now.Format("15:04")
			stamp := now.Format("2006-01-02 ") + hhmm
			for _, i := range m.List() {
				i.procMu.Lock()
				scheds := append([]Schedule{}, i.Policies.Schedules...)
				i.procMu.Unlock()
				for idx, s := range scheds {
					if s.At != hhmm {
						continue
					}
					key := fmt.Sprintf("%s|%d|%s", i.Name, idx, s.Type)
					if fired[key] == stamp {
						continue
					}
					fired[key] = stamp
					go m.execSchedule(i, s)
				}
			}
		}
	}()
}

func (m *Manager) execSchedule(i *Instance, s Schedule) {
	switch s.Type {
	case "command":
		if i.Status() == "running" {
			_ = m.Command(i.Name, s.Args)
		}
	case "backup":
		if _, err := m.CreateBackup(i.Name, "定时"); err != nil {
			i.Console.Append("[AutoMCHUB] 定时备份失败: " + err.Error())
		} else {
			i.Console.Append("[AutoMCHUB] 定时备份完成")
		}
	case "restart":
		if i.Status() != "running" {
			return
		}
		i.Console.Append("[AutoMCHUB] 定时重启：60 秒后重启服务器")
		_ = m.Command(i.Name, "say §c服务器将在 60 秒后定时重启，请注意安全下线！")
		time.Sleep(50 * time.Second)
		_ = m.Command(i.Name, "say §c10 秒后重启！")
		time.Sleep(10 * time.Second)
		if err := m.Stop(i.Name); err != nil {
			return
		}
		for k := 0; k < 80; k++ { // 最多等 40 秒
			if i.Status() == "stopped" {
				break
			}
			time.Sleep(500 * time.Millisecond)
		}
		if i.Status() == "stopped" {
			if err := m.Start(i.Name); err != nil {
				i.Console.Append("[AutoMCHUB] 定时重启失败: " + err.Error())
			}
		}
	}
}
