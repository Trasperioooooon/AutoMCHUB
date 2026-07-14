// Package mcsrc 封装六种服务端核心的版本列表与下载直链解析，
// 全部支持 BMCLAPI 国内镜像与官方源的双源故障转移。
package mcsrc

type Core string

const (
	CoreVanilla   Core = "vanilla"
	CorePaper     Core = "paper"
	CorePurpur    Core = "purpur"
	CoreForge     Core = "forge"
	CoreNeoForge  Core = "neoforge"
	CoreFabric    Core = "fabric"
	CoreLeaves    Core = "leaves"
	CoreFolia     Core = "folia"
	CoreMohist    Core = "mohist"
	CoreBanner    Core = "banner"
	CoreVelocity  Core = "velocity"
	CoreWaterfall Core = "waterfall"
)

type MCVersion struct {
	ID     string `json:"id"`
	Type   string `json:"type"`
	Latest bool   `json:"latest"`
}

type BuildInfo struct {
	ID          string `json:"id"`
	Label       string `json:"label,omitempty"`
	Recommended bool   `json:"recommended,omitempty"`
}

// Artifact 描述一个待下载的服务端文件（多源 + 校验信息）。
type Artifact struct {
	URLs     []string
	SHA1     string
	SHA256   string
	MD5      string
	FileName string
	MinSize  int64
}
