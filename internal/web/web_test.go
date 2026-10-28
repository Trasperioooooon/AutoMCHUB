package web

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"minedeck/internal/app"
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

// 内嵌字体：按 font/woff2 下发，带 ETag 且允许缓存（每次先问一下）；同一 ETag 再请求回 304，不重下 1.9 MB。
// 页面与脚本仍然 no-store，改了前端立即生效。
func TestFontsServedWithETag(t *testing.T) {
	app.Base = t.TempDir()
	h := New(nil, nil, 0)
	get := func(path, inm string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest("GET", path, nil)
		req.Host = "127.0.0.1"
		if inm != "" {
			req.Header.Set("If-None-Match", inm)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	for _, f := range []string{"Geist-latin.woff2", "GeistMono-latin.woff2", "NotoSansSC-gb2312.woff2"} {
		rec := get("/fonts/"+f, "")
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: HTTP %d", f, rec.Code)
		}
		if ct := rec.Header().Get("Content-Type"); ct != "font/woff2" {
			t.Errorf("%s: Content-Type = %q", f, ct)
		}
		tag := rec.Header().Get("ETag")
		if !strings.HasPrefix(tag, `"`) || rec.Header().Get("Cache-Control") != "no-cache" {
			t.Errorf("%s: ETag = %q, Cache-Control = %q", f, tag, rec.Header().Get("Cache-Control"))
		}
		if body := rec.Body.Bytes(); len(body) < 4 || string(body[:4]) != "wOF2" {
			t.Errorf("%s: 不是 WOFF2 文件", f)
		}
		if again := get("/fonts/"+f, tag); again.Code != http.StatusNotModified {
			t.Errorf("%s: 带 If-None-Match 再请求应回 304，实际 %d", f, again.Code)
		}
	}
	if rec := get("/fonts/fonts.css", ""); rec.Code != http.StatusOK || !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/css") {
		t.Errorf("fonts.css: HTTP %d, Content-Type %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	if cc := get("/app.css", "").Header().Get("Cache-Control"); cc != "no-store" {
		t.Errorf("页面应保持 no-store，实际 %q", cc)
	}
}
