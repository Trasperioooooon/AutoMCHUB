package web

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"path/filepath"
	"time"

	"automchub/internal/dl"
	"automchub/internal/mcsrc"
)

// resourceSpec 按核心决定可安装的资源类型、Modrinth loader 过滤与安装目录。
func resourceSpec(core mcsrc.Core) (rtype string, loaders []string, dir string, ok bool) {
	switch core {
	case mcsrc.CoreFabric:
		return "mod", []string{"fabric"}, "mods", true
	case mcsrc.CoreForge:
		return "mod", []string{"forge"}, "mods", true
	case mcsrc.CoreNeoForge:
		return "mod", []string{"neoforge"}, "mods", true
	case mcsrc.CoreMohist:
		return "mod", []string{"forge"}, "mods", true
	case mcsrc.CoreBanner:
		return "mod", []string{"fabric"}, "mods", true
	case mcsrc.CorePaper, mcsrc.CorePurpur, mcsrc.CoreLeaves, mcsrc.CoreFolia:
		return "plugin", []string{"paper", "spigot", "bukkit"}, "plugins", true
	case mcsrc.CoreVelocity:
		return "plugin", []string{"velocity"}, "plugins", true
	case mcsrc.CoreWaterfall:
		return "plugin", []string{"waterfall", "bungeecord"}, "plugins", true
	}
	return "", nil, "", false
}

const modrinthAPI = "https://api.modrinth.com/v2"

func (s *Server) handleResourceSearch(w http.ResponseWriter, r *http.Request) {
	i, err := s.mgr.Get(r.PathValue("name"))
	if err != nil {
		writeErr(w, 404, err)
		return
	}
	rtype, loaders, _, ok := resourceSpec(i.Core)
	if !ok {
		writeErr(w, 400, fmt.Errorf("该核心不支持安装模组/插件"))
		return
	}
	// facets: 项目类型 + 加载器（同组 OR，跨组 AND）；插件不强卡 MC 版本（兼容面广）
	loaderFacet := make([]string, 0, len(loaders))
	for _, l := range loaders {
		loaderFacet = append(loaderFacet, "categories:"+l)
	}
	facets := []any{[]string{"project_type:" + rtype}, loaderFacet}
	if rtype == "mod" {
		facets = append(facets, []string{"versions:" + i.MC})
	}
	fb, _ := json.Marshal(facets)
	u := fmt.Sprintf("%s/search?limit=20&index=downloads&query=%s&facets=%s",
		modrinthAPI, url.QueryEscape(r.URL.Query().Get("q")), url.QueryEscape(string(fb)))
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	var resp struct {
		Hits []struct {
			ProjectID   string `json:"project_id"`
			Slug        string `json:"slug"`
			Title       string `json:"title"`
			Description string `json:"description"`
			Downloads   int64  `json:"downloads"`
			IconURL     string `json:"icon_url"`
		} `json:"hits"`
	}
	if err := dl.FetchJSON(ctx, []string{u}, &resp); err != nil {
		writeErr(w, 502, fmt.Errorf("Modrinth 搜索失败: %w", err))
		return
	}
	writeJSON(w, map[string]any{"type": rtype, "hits": resp.Hits})
}

func (s *Server) handleResourceInstall(w http.ResponseWriter, r *http.Request) {
	i, err := s.mgr.Get(r.PathValue("name"))
	if err != nil {
		writeErr(w, 404, err)
		return
	}
	var body struct {
		ProjectID string `json:"projectId"`
	}
	if err := readJSON(r, &body); err != nil || body.ProjectID == "" {
		writeErr(w, 400, fmt.Errorf("缺少项目 ID"))
		return
	}
	rtype, loaders, destDir, ok := resourceSpec(i.Core)
	if !ok {
		writeErr(w, 400, fmt.Errorf("该核心不支持安装模组/插件"))
		return
	}
	lj, _ := json.Marshal(loaders)
	u := fmt.Sprintf("%s/project/%s/version?loaders=%s",
		modrinthAPI, url.PathEscape(body.ProjectID), url.QueryEscape(string(lj)))
	if rtype == "mod" {
		gj, _ := json.Marshal([]string{i.MC})
		u += "&game_versions=" + url.QueryEscape(string(gj))
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	var versions []struct {
		Name  string `json:"name"`
		Files []struct {
			URL      string `json:"url"`
			Filename string `json:"filename"`
			Primary  bool   `json:"primary"`
			Hashes   struct {
				SHA1 string `json:"sha1"`
			} `json:"hashes"`
		} `json:"files"`
	}
	if err := dl.FetchJSON(ctx, []string{u}, &versions); err != nil {
		writeErr(w, 502, fmt.Errorf("获取版本信息失败: %w", err))
		return
	}
	if len(versions) == 0 {
		writeErr(w, 404, fmt.Errorf("该资源没有兼容 %s 的版本", i.MC))
		return
	}
	v := versions[0]
	if len(v.Files) == 0 {
		writeErr(w, 404, fmt.Errorf("该版本没有可下载文件"))
		return
	}
	file := v.Files[0]
	for _, f := range v.Files {
		if f.Primary {
			file = f
			break
		}
	}
	fname := filepath.Base(file.Filename)
	dest := filepath.Join(i.Dir, destDir, fname)
	if err := dl.Fetch(ctx, dl.Request{
		URLs: []string{file.URL}, Dest: dest, SHA1: file.Hashes.SHA1, MinSize: 1024,
	}, nil); err != nil {
		writeErr(w, 502, fmt.Errorf("下载失败: %w", err))
		return
	}
	writeJSON(w, map[string]string{"file": destDir + "/" + fname, "version": v.Name})
}
