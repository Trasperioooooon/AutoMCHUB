package mcsrc

import (
	"context"
	"encoding/xml"
	"fmt"
	"net/url"
	"strings"

	"automchub/internal/app"
	"automchub/internal/dl"
)

const (
	neoBMCL  = "https://bmclapi2.bangbang93.com/neoforge"
	neoMaven = "https://maven.neoforged.net/releases/net/neoforged/neoforge"
	// NeoForge 与 Forge 在 1.20.1 时代纠缠不清，本工具从 1.20.2 起提供 NeoForge
	neoFloor = "1.20.2"
)

type neoEntry struct {
	Version       string `json:"version"`
	RawVersion    string `json:"rawVersion"`
	McVersion     string `json:"mcversion"`
	InstallerPath string `json:"installerPath"`
}

// NeoMCVersions 列出可用 NeoForge 的 MC 版本（>= 1.20.2 的正式版）。
func NeoMCVersions(ctx context.Context) ([]MCVersion, error) {
	all, err := vanillaVersions(ctx, false)
	if err != nil {
		return nil, err
	}
	_, idx, err := getManifest(ctx)
	if err != nil {
		return nil, err
	}
	var out []MCVersion
	for _, v := range all {
		if newerOrEqualIdx(idx, v.ID, neoFloor) {
			out = append(out, v)
		}
	}
	return out, nil
}

// NeoBuilds 列出某 MC 版本的全部 NeoForge 构建（新在前），并返回 version→installerPath 映射。
func NeoBuilds(ctx context.Context, mc string) ([]BuildInfo, map[string]string, error) {
	paths := map[string]string{}
	if !app.OfficialOnly() {
		var list []neoEntry
		if err := dl.FetchJSON(ctx, []string{neoBMCL + "/list/" + url.PathEscape(mc)}, &list); err == nil && len(list) > 0 {
			out := make([]BuildInfo, 0, len(list))
			for i := len(list) - 1; i >= 0; i-- { // 列表为旧在前
				e := list[i]
				out = append(out, BuildInfo{
					ID:          e.Version,
					Recommended: len(out) == 0 && !strings.Contains(e.Version, "beta"),
				})
				paths[e.Version] = e.InstallerPath
			}
			return out, paths, nil
		}
	}
	// 官方 maven-metadata.xml 兜底
	vers, err := neoMavenVersions(ctx, mc)
	if err != nil || len(vers) == 0 {
		if err == nil {
			err = fmt.Errorf("该版本暂无 NeoForge 构建")
		}
		return nil, nil, fmt.Errorf("获取 NeoForge 构建列表失败: %w", err)
	}
	out := make([]BuildInfo, 0, len(vers))
	for i := len(vers) - 1; i >= 0; i-- {
		out = append(out, BuildInfo{ID: vers[i], Recommended: len(out) == 0})
	}
	return out, paths, nil
}

// mcToNeoPrefixes MC 版本号 → NeoForge 版本前缀的启发式映射
// （如 1.21.1 → 21.1.，26.2 → 26.2. 或 26.2-）。
func mcToNeoPrefixes(mc string) []string {
	if strings.HasPrefix(mc, "1.") {
		rest := strings.TrimPrefix(mc, "1.")
		parts := strings.SplitN(rest, ".", 2)
		minor := parts[0]
		patch := "0"
		if len(parts) == 2 {
			patch = parts[1]
		}
		return []string{minor + "." + patch + "."}
	}
	return []string{mc + ".", mc + "-"}
}

func neoMavenVersions(ctx context.Context, mc string) ([]string, error) {
	b, err := dl.FetchBytes(ctx, []string{neoMaven + "/maven-metadata.xml"})
	if err != nil {
		return nil, err
	}
	var meta struct {
		Versioning struct {
			Versions struct {
				Version []string `xml:"version"`
			} `xml:"versions"`
		} `xml:"versioning"`
	}
	if err := xml.Unmarshal(b, &meta); err != nil {
		return nil, err
	}
	prefixes := mcToNeoPrefixes(mc)
	var out []string
	for _, v := range meta.Versioning.Versions.Version {
		for _, p := range prefixes {
			if strings.HasPrefix(v, p) {
				out = append(out, v)
				break
			}
		}
	}
	return out, nil
}

// NeoInstallerArtifact 解析 NeoForge 安装器下载信息。
func NeoInstallerArtifact(ver, installerPath string) Artifact {
	if installerPath == "" {
		installerPath = fmt.Sprintf("/maven/net/neoforged/neoforge/%s/neoforge-%s-installer.jar", ver, ver)
	}
	mirror := "https://bmclapi2.bangbang93.com" + installerPath
	official := fmt.Sprintf("%s/%s/neoforge-%s-installer.jar", neoMaven, ver, ver)
	return Artifact{
		URLs:     Order2(mirror, official),
		FileName: fmt.Sprintf("neoforge-%s-installer.jar", ver),
		MinSize:  512 * 1024,
	}
}
