package update

import (
	"os/exec"

	"automchub/internal/procutil"
)

func runDetached(bat string) error {
	cmd := exec.Command("cmd", "/c", bat)
	procutil.HideWindow(cmd)
	// 注意：不加入 Job Object —— 更新脚本必须在本进程退出后继续存活
	return cmd.Start()
}
