package main

// 无边框窗口（去掉系统标题栏，改由前端 HUD 充当标题栏）。
// 手法：拦 WM_NCCALCSIZE，先让系统算出标准边框，再把客户区顶边恢复到窗口顶——
// 即「去掉标题栏、保留原生左右下缩放边框与 DWM 阴影/圆角」。WebView2 子窗口铺满客户区、
// 会吞掉命中测试，故拖动窗口与最小化/最大化/关闭改由 Bind 暴露给前端顶栏调用（见 main.go）。

import "unsafe"

const (
	_WM_NCCALCSIZE    = 0x0083
	_WM_NCLBUTTONDOWN = 0x00A1
	_HTCAPTION        = 2

	_SW_MAXIMIZE = 3
	_SW_MINIMIZE = 6

	_SWP_NOSIZE       = 0x0001
	_SWP_NOMOVE       = 0x0002
	_SWP_NOZORDER     = 0x0004
	_SWP_FRAMECHANGED = 0x0020
)

var (
	pDefWindowProcW = user32t.NewProc("DefWindowProcW")
	pIsZoomed       = user32t.NewProc("IsZoomed")
	pReleaseCapture = user32t.NewProc("ReleaseCapture")
	pSetWindowPos   = user32t.NewProc("SetWindowPos")
)

type nccRect struct{ Left, Top, Right, Bottom int32 }

type nccalcsizeParams struct {
	Rgrc  [3]nccRect
	Lppos uintptr
}

// framelessNCCalcSize 处理 WM_NCCALCSIZE。返回 (ret, handled)；未接管时调用方转交默认过程。
func framelessNCCalcSize(hwnd, wparam, lparam uintptr) (ret uintptr, handled bool) {
	if wparam == 0 { // 非计算请求，交给默认过程
		return 0, false
	}
	// lparam 由系统指向一个 NCCALCSIZE_PARAMS，在本次消息处理期间有效。
	// go vet 会对 uintptr→unsafe.Pointer 报「possible misuse」——这是 WndProc 回调解引用参数的
	// 固有写法（go-webview2 处理 WM_GETMINMAXINFO 亦然），此处安全，为已知误报。
	p := (*nccalcsizeParams)(unsafe.Pointer(lparam)) //nolint:govet
	origTop := p.Rgrc[0].Top
	pDefWindowProcW.Call(hwnd, _WM_NCCALCSIZE, wparam, lparam) // 先算标准边框（含侧/底缩放边框）
	if !isZoomed(hwnd) {
		p.Rgrc[0].Top = origTop // 非最大化：客户区顶到窗口顶，抹掉标题栏（最大化时保留系统计算以适配工作区/任务栏）
	}
	return 0, true
}

func isZoomed(hwnd uintptr) bool {
	r, _, _ := pIsZoomed.Call(hwnd)
	return r != 0
}

// applyFrameless 子类化生效后触发一次边框重算，让去标题栏立即生效。
func applyFrameless(hwnd uintptr) {
	pSetWindowPos.Call(hwnd, 0, 0, 0, 0, 0, _SWP_NOMOVE|_SWP_NOSIZE|_SWP_NOZORDER|_SWP_FRAMECHANGED)
}

// hostStartDrag 从当前光标发起原生窗口拖动（前端顶栏空白处 mousedown 调用）。
func hostStartDrag(hwnd uintptr) {
	pReleaseCapture.Call()
	pSendMessageW.Call(hwnd, _WM_NCLBUTTONDOWN, _HTCAPTION, 0)
}

func hostMinimize(hwnd uintptr) { pShowWindow.Call(hwnd, _SW_MINIMIZE) }

// postWindowClose 请求关闭窗口（走 WM_CLOSE，交由托盘逻辑决定最小化到托盘或真正退出）。
func postWindowClose(hwnd uintptr) { pPostMessage.Call(hwnd, _WM_CLOSE, 0, 0) }

func hostMaximizeToggle(hwnd uintptr) {
	if isZoomed(hwnd) {
		pShowWindow.Call(hwnd, _SW_RESTORE)
	} else {
		pShowWindow.Call(hwnd, _SW_MAXIMIZE)
	}
}
