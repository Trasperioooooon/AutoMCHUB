package web

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"automchub/internal/app"
)

// 下发配置的响应一律不得含访问密码哈希（回归：PUT /api/config 曾原样回传整个 app.Config，
// 每次保存设置都把 accessPasswordHash 发给前端，局域网登录的手机也不例外）。
func TestConfigResponsesHidePasswordHash(t *testing.T) {
	app.Base = t.TempDir() // config.json 落到临时目录，不污染工作区
	h := New(nil, nil, 0)
	call := func(method, path, body string) string {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Host = "127.0.0.1"
		req.Header.Set("X-Token", Token)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s %s: HTTP %d %s", method, path, rec.Code, rec.Body)
		}
		return rec.Body.String()
	}

	put := call("PUT", "/api/config", `{"lanPassword":"correct horse","listenLan":true}`)
	hash := app.GetConfig().AccessPasswordHash
	if !strings.HasPrefix(hash, "$2") {
		t.Fatalf("密码未存为 bcrypt 哈希: %q", hash)
	}
	got := call("GET", "/api/app", "")
	for name, body := range map[string]string{"PUT /api/config": put, "GET /api/app": got} {
		if strings.Contains(body, "accessPasswordHash") || strings.Contains(body, hash) {
			t.Errorf("%s 响应泄露了密码哈希: %s", name, body)
		}
	}

	// 前端仍须拿到保存后的配置，并能经 lanSet 得知已设密码
	var p struct {
		Data app.Config `json:"data"`
	}
	if err := json.Unmarshal([]byte(put), &p); err != nil || !p.Data.ListenLAN {
		t.Errorf("PUT /api/config 未返回保存后的配置: %s", put)
	}
	var a struct {
		Data struct {
			Config app.Config `json:"config"`
			LanSet bool       `json:"lanSet"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(got), &a); err != nil || !a.Data.LanSet || !a.Data.Config.ListenLAN {
		t.Errorf("GET /api/app 未如实告知密码状态: %s", got)
	}
}
