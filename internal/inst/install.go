package inst

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"automchub/internal/app"
	"automchub/internal/dl"
	"automchub/internal/java"
	"automchub/internal/mcsrc"
	"automchub/internal/tasks"
)

type CreateReq struct {
	Name        string     `json:"name"`
	Core        mcsrc.Core `json:"core"`
	MC          string     `json:"mc"`
	Build       string     `json:"build"`
	XmxMB       int        `json:"xmxMb"`
	Port        int        `json:"port"`
	EULA        bool       `json:"eula"`
	OnlineMode  bool       `json:"onlineMode"`
	AllowFlight bool       `json:"allowFlight"`
	MOTD        string     `json:"motd"`
}

// createSteps 创建流水线的步骤名（整合包导入在其后追加额外步骤）。
var createSteps = []string{"解析版本信息", "准备 Java 运行时", "下载服务端核心", "安装服务端", "写入配置文件", "生成启动脚本"}

// validateCreate 校验创建请求并返回目标目录（供普通创建与整合包导入共用）。
func (m *Manager) validateCreate(req *CreateReq) (string, error) {
	req.Name = strings.TrimSpace(req.Name)
	if err := validateName(req.Name); err != nil {
		return "", err
	}
	if !mcsrc.ValidCore(req.Core) {
		return "", fmt.Errorf("未知核心类型: %s", req.Core)
	}
	if req.MC == "" {
		return "", fmt.Errorf("请选择版本")
	}
	// 代理端不运行 Minecraft 本体，无需 Mojang EULA
	if !req.EULA && mcsrc.KindOf(req.Core) != mcsrc.KindProxy {
		return "", fmt.Errorf("需要同意 Minecraft EULA 才能开服")
	}
	// Mohist/Banner 的 javaagent 自举对非 ASCII 路径不兼容（实测中文实例名必崩）
	if (req.Core == mcsrc.CoreMohist || req.Core == mcsrc.CoreBanner) && !isASCII(req.Name) {
		return "", fmt.Errorf("Mohist/Banner 核心与中文路径不兼容，请使用纯英文实例名（如 my-server）")
	}
	if req.Port <= 0 || req.Port > 65535 {
		req.Port = 25565
	}
	if req.XmxMB < 512 {
		req.XmxMB = 2048
	}
	dir := filepath.Join(app.ServersDir, req.Name)
	m.mu.Lock()
	_, exists := m.insts[req.Name]
	m.mu.Unlock()
	if exists {
		return "", fmt.Errorf("实例名已存在: %s", req.Name)
	}
	if _, err := os.Stat(dir); err == nil {
		return "", fmt.Errorf("目录已存在: %s", dir)
	}
	return dir, nil
}

// CreateAsync 校验请求并启动后台创建任务，返回任务 ID。
func (m *Manager) CreateAsync(req CreateReq) (string, error) {
	dir, err := m.validateCreate(&req)
	if err != nil {
		return "", err
	}
	t, ctx := m.Tasks.New(fmt.Sprintf("创建实例 %s（%s %s）", req.Name, req.Core, req.MC), createSteps)
	go func() {
		if err := m.runCreate(ctx, t, req, dir); err != nil {
			t.Fail(err)
			os.RemoveAll(dir) // 清理半成品目录（缓存保留，重试无需重新下载）
			return
		}
		t.Finish(req.Name)
	}()
	return t.ID(), nil
}

func (m *Manager) runCreate(ctx context.Context, t *tasks.Task, req CreateReq, dir string) error {
	ctx, cancel := context.WithTimeout(ctx, 90*time.Minute)
	defer cancel()

	// ---- 步骤 0：解析版本信息 ----
	t.StartStep(0)
	kind := mcsrc.KindOf(req.Core)
	var meta *mcsrc.VersionMeta
	var javaMajor int
	if kind == mcsrc.KindProxy {
		javaMajor = mcsrc.FixedJavaOf(req.Core)
		t.Logf("代理端 %s 使用 Java %d", req.Core, javaMajor)
	} else {
		var err error
		meta, err = mcsrc.GetVersionMeta(ctx, req.MC)
		if err != nil {
			return err
		}
		javaMajor = meta.JavaMajor
		t.Logf("MC %s 需要 Java %d（来自官方元数据）", req.MC, javaMajor)
	}

	// ---- 步骤 1：准备 Java（本机已装 > 便携 > 下载） ----
	t.StartStep(1)
	javaPath, err := java.Resolve(ctx, javaMajor, t.Logf, t.ProgressFn(fmt.Sprintf("下载 Java %d", javaMajor)))
	if err != nil {
		return err
	}
	t.Logf("Java 就绪: %s", javaPath)

	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	// ---- 步骤 2：下载核心 ----
	t.StartStep(2)
	inst := &Instance{
		Settings: Settings{
			Name: req.Name, Core: req.Core, MC: req.MC, Build: req.Build,
			JavaMajor: javaMajor, JavaPath: javaPath,
			XmxMB: req.XmxMB, XmsMB: min(1024, req.XmxMB),
			CreatedAt: time.Now(),
		},
		Dir: dir, Console: newConsole(),
	}
	needInstaller := false
	switch req.Core {
	case mcsrc.CoreVanilla:
		if err := fetchToInstance(ctx, t, mcsrc.VanillaServerArtifact(meta), "vanilla/"+req.MC, dir, "server.jar"); err != nil {
			return err
		}
		inst.LaunchTarget = "jar:server.jar"

	case mcsrc.CoreFabric:
		installerV, err := mcsrc.FabricInstallerVersion(ctx)
		if err != nil {
			return err
		}
		loader := req.Build
		if loader == "" || loader == "latest" {
			loaders, err := mcsrc.FabricLoaders(ctx, req.MC)
			if err != nil {
				return err
			}
			loader = loaders[0].ID
			for _, l := range loaders {
				if l.Recommended {
					loader = l.ID
					break
				}
			}
			inst.Build = loader
		}
		art := mcsrc.FabricServerArtifact(req.MC, loader, installerV)
		if err := fetchToInstance(ctx, t, art, "fabric", dir, art.FileName); err != nil {
			return err
		}
		// 预下载原版 server.jar 并指向之，避免 Fabric 首启时从境外源慢速下载
		t.Logf("预下载原版服务端供 Fabric 使用")
		if err := fetchToInstance(ctx, t, mcsrc.VanillaServerArtifact(meta), "vanilla/"+req.MC, dir, "server.jar"); err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(dir, "fabric-server-launcher.properties"),
			[]byte("serverJar=server.jar\n"), 0o644); err != nil {
			return err
		}
		inst.LaunchTarget = "jar:" + art.FileName

	case mcsrc.CoreForge:
		art := mcsrc.ForgeInstallerArtifact(ctx, req.MC, req.Build)
		if err := fetchToInstance(ctx, t, art, "forge", dir, art.FileName); err != nil {
			return err
		}
		// 传统 Forge（<=1.16.5）安装器会直连 Mojang 下载原版服务端，
		// 预放置到其检查路径可让安装器校验哈希后跳过下载。
		if newer117, err := mcsrc.NewerOrEqual(ctx, req.MC, "1.17"); err == nil && !newer117 {
			t.Logf("预放置原版服务端（加速安装器）")
			if err := fetchToInstance(ctx, t, mcsrc.VanillaServerArtifact(meta), "vanilla/"+req.MC,
				dir, "minecraft_server."+req.MC+".jar"); err != nil {
				return err
			}
		}
		needInstaller = true

	case mcsrc.CoreNeoForge:
		_, paths, err := mcsrc.NeoBuilds(ctx, req.MC)
		if err != nil {
			return err
		}
		art := mcsrc.NeoInstallerArtifact(req.Build, paths[req.Build])
		if err := fetchToInstance(ctx, t, art, "neoforge", dir, art.FileName); err != nil {
			return err
		}
		// 预放置原版服务端到安装器的校验路径，跳过其直连 Mojang 的大文件下载
		t.Logf("预放置原版服务端（加速安装器）")
		preDest := filepath.Join("libraries", "net", "minecraft", "server", req.MC, "server-"+req.MC+".jar")
		if err := fetchToInstance(ctx, t, mcsrc.VanillaServerArtifact(meta), "vanilla/"+req.MC, dir, preDest); err != nil {
			return err
		}
		needInstaller = true

	default:
		// 通用 jar 型核心（Paper/Purpur/Leaves/Folia/Mohist/Banner/Velocity/Waterfall）
		art, err := mcsrc.GenericArtifact(ctx, req.Core, req.MC, req.Build)
		if err != nil {
			return err
		}
		if err := fetchToInstance(ctx, t, art, string(req.Core), dir, "server.jar"); err != nil {
			return err
		}
		inst.LaunchTarget = "jar:server.jar"
	}

	// ---- 步骤 3：运行安装器（仅 Forge/NeoForge） ----
	t.StartStep(3)
	if needInstaller {
		installerName := ""
		if req.Core == mcsrc.CoreForge {
			installerName = fmt.Sprintf("forge-%s-%s-installer.jar", req.MC, req.Build)
		} else {
			installerName = fmt.Sprintf("neoforge-%s-installer.jar", req.Build)
		}
		t.Logf("运行官方安装器（将从网络下载依赖库，耗时视网络情况数分钟）...")
		if err := runInstaller(ctx, t, javaPath, dir, installerName); err != nil {
			return err
		}
		target, err := locateLaunchTarget(dir, req.Core, ctx, req.MC)
		if err != nil {
			return err
		}
		inst.LaunchTarget = target
		t.Logf("启动目标: %s", target)
		os.Remove(filepath.Join(dir, installerName))
	} else {
		t.Logf("该核心无需安装步骤，跳过")
	}

	// ---- 步骤 4：写入配置 ----
	t.StartStep(4)
	if kind == mcsrc.KindProxy {
		t.Logf("代理端无需 EULA 与 server.properties，首次启动后在实例目录编辑其自带配置文件")
	} else {
		if err := os.WriteFile(filepath.Join(dir, "eula.txt"),
			[]byte("# 用户已在 AutoMCHUB 中确认同意 Minecraft EULA (https://aka.ms/MinecraftEULA)\neula=true\n"), 0o644); err != nil {
			return err
		}
		props, _ := LoadProps(filepath.Join(dir, "server.properties"))
		props.Set("server-port", fmt.Sprintf("%d", req.Port))
		props.Set("online-mode", boolStr(req.OnlineMode))
		props.Set("allow-flight", boolStr(req.AllowFlight))
		// 离线模式下 1.19+ 显式关闭聊天签名校验，规避代理/插件环境「无法验证安全档案」踢人
		if !req.OnlineMode {
			if ge, err := mcsrc.NewerOrEqual(ctx, req.MC, "1.19"); err == nil && ge {
				props.Set("enforce-secure-profile", "false")
			}
		}
		motd := req.MOTD
		if motd == "" {
			motd = "AutoMCHUB 服务器"
		}
		props.Set("motd", motd)
		if err := props.Save(filepath.Join(dir, "server.properties")); err != nil {
			return err
		}
		// log4shell 防护（老版本）
		if err := applyLog4jMitigation(ctx, t, inst); err != nil {
			return err
		}
	}

	// ---- 步骤 5：启动脚本 + 注册实例 ----
	t.StartStep(5)
	if err := writeRunBat(inst); err != nil {
		return err
	}
	if err := m.saveInstance(inst); err != nil {
		return err
	}
	m.mu.Lock()
	m.insts[req.Name] = inst
	m.mu.Unlock()
	t.Logf("实例创建完成 ✔")
	return nil
}

func boolStr(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

func isASCII(s string) bool {
	for _, r := range s {
		if r > 127 {
			return false
		}
	}
	return true
}

// fetchToInstance 下载工件到共享缓存，再复制进实例目录。
func fetchToInstance(ctx context.Context, t *tasks.Task, art mcsrc.Artifact, cacheKey, dir, destName string) error {
	cachePath := filepath.Join(app.CacheDir, filepath.FromSlash(cacheKey), art.FileName)
	if err := dl.Fetch(ctx, dl.Request{
		URLs: art.URLs, Dest: cachePath,
		SHA1: art.SHA1, SHA256: art.SHA256, MD5: art.MD5, MinSize: art.MinSize,
	}, t.ProgressFn("下载 "+art.FileName)); err != nil {
		return err
	}
	return copyFile(cachePath, filepath.Join(dir, destName))
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	_, cerr := io.Copy(out, in)
	if werr := out.Close(); cerr == nil {
		cerr = werr
	}
	return cerr
}

// runInstaller 以匹配的 Java 运行 Forge/NeoForge 官方安装器（--installServer）。
// 加固：镜像参数（--mirror 指向 BMCLAPI）+ 网络抖动自动重试。
func runInstaller(ctx context.Context, t *tasks.Task, javaExe, dir, installerJar string) error {
	var lastErr error
	for attempt := 1; attempt <= 3; attempt++ {
		if attempt > 1 {
			t.Logf("安装器第 %d 次重试（多为瞬时网络问题，已下载的库会被复用）...", attempt)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(3 * time.Second):
			}
		}
		lastErr = runInstallerOnce(ctx, t, javaExe, dir, installerJar)
		if lastErr == nil {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
	}
	return fmt.Errorf("安装器多次运行失败: %w（可查看实例目录 installer.jar.log；也可在全局设置切换下载源后重试）", lastErr)
}

func runInstallerOnce(ctx context.Context, t *tasks.Task, javaExe, dir, installerJar string) error {
	cctx, cancel := context.WithTimeout(ctx, 40*time.Minute)
	defer cancel()
	args := []string{"-jar", installerJar, "--installServer", "."}
	if !app.OfficialOnly() {
		args = append(args, "--mirror", "https://bmclapi2.bangbang93.com/maven/")
	}
	cmd := exec.CommandContext(cctx, javaExe, args...)
	cmd.Dir = dir
	cmd.Env = cleanEnv()
	hideWindow(cmd)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = cmd.Stdout
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("无法启动安装器: %w", err)
	}
	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line != "" {
			t.Logf("[安装器] %s", line)
		}
	}
	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("安装器退出异常: %w", err)
	}
	return nil
}

// locateLaunchTarget 在安装完成的目录中定位启动方式。
func locateLaunchTarget(dir string, core mcsrc.Core, ctx context.Context, mc string) (string, error) {
	// 现代 Forge / NeoForge：@参数文件
	for _, pattern := range []string{
		"libraries/net/minecraftforge/forge/*/win_args.txt",
		"libraries/net/neoforged/neoforge/*/win_args.txt",
	} {
		if ms, _ := filepath.Glob(filepath.Join(dir, filepath.FromSlash(pattern))); len(ms) > 0 {
			rel, err := filepath.Rel(dir, ms[0])
			if err != nil {
				return "", err
			}
			return "args:" + filepath.ToSlash(rel), nil
		}
	}
	// 传统 Forge（<=1.16.5）：直接生成的 forge-*.jar
	if ms, _ := filepath.Glob(filepath.Join(dir, "forge-*.jar")); len(ms) > 0 {
		for _, m := range ms {
			base := filepath.Base(m)
			if !strings.Contains(base, "installer") {
				return "jar:" + base, nil
			}
		}
	}
	return "", fmt.Errorf("安装器未生成可识别的服务端启动文件，请查看实例目录中的 installer.log")
}

// applyLog4jMitigation 依据 Mojang 官方公告为老版本添加 log4shell 缓解。
func applyLog4jMitigation(ctx context.Context, t *tasks.Task, i *Instance) error {
	newer1181, err := mcsrc.NewerOrEqual(ctx, i.MC, "1.18.1")
	if err != nil || newer1181 {
		return err
	}
	i.ExtraJVM = append(i.ExtraJVM, "-Dlog4j2.formatMsgNoLookups=true")
	newer117, err := mcsrc.NewerOrEqual(ctx, i.MC, "1.17")
	if err != nil {
		return err
	}
	if !newer117 { // 1.12.2 ~ 1.16.5：官方 xml 配置
		const xmlURL = "https://launcher.mojang.com/v1/objects/02937d122c86ce73319ef9975b58896fc1b491d1/log4j2_112-116.xml"
		dest := filepath.Join(i.Dir, "log4j2_112-116.xml")
		if err := dl.Fetch(ctx, dl.Request{URLs: mcsrc.URLPair(xmlURL), Dest: dest, MinSize: 100}, nil); err != nil {
			t.Logf("log4j 防护配置下载失败（不影响开服，仅安全性降低）: %v", err)
			return nil
		}
		i.ExtraJVM = append(i.ExtraJVM, "-Dlog4j.configurationFile=log4j2_112-116.xml")
		t.Logf("已启用 log4shell 漏洞缓解（Mojang 官方方案）")
	}
	return nil
}

// launchArgs 构造 JVM 启动参数（进程托管与 run.bat 共用同一套逻辑）。
func launchArgs(i *Instance) []string {
	args := []string{
		fmt.Sprintf("-Xms%dM", i.XmsMB),
		fmt.Sprintf("-Xmx%dM", i.XmxMB),
		"-Dfile.encoding=UTF-8",
	}
	args = append(args, i.ExtraJVM...)
	if rest, ok := strings.CutPrefix(i.LaunchTarget, "args:"); ok {
		args = append(args, "@"+filepath.FromSlash(rest), "nogui")
	} else if rest, ok := strings.CutPrefix(i.LaunchTarget, "jar:"); ok {
		args = append(args, "-jar", rest, "nogui")
	}
	return args
}

// writeRunBat 生成可手动双击的启动脚本（与 GUI 内启动等效）。
func writeRunBat(i *Instance) error {
	var sb strings.Builder
	sb.WriteString("@echo off\r\n")
	sb.WriteString("chcp 65001 >nul\r\n")
	sb.WriteString(fmt.Sprintf("title %s - AutoMCHUB\r\n", i.Name))
	sb.WriteString("cd /d \"%~dp0\"\r\n")
	sb.WriteString(fmt.Sprintf("\"%s\"", i.JavaPath))
	for _, a := range launchArgs(i) {
		if strings.ContainsAny(a, " \t") {
			sb.WriteString(fmt.Sprintf(" \"%s\"", a))
		} else {
			sb.WriteString(" " + a)
		}
	}
	sb.WriteString("\r\npause\r\n")
	// 现代 Forge/NeoForge 同步维护 user_jvm_args.txt，便于手动使用官方 run.bat 的用户
	if strings.HasPrefix(i.LaunchTarget, "args:") {
		content := fmt.Sprintf("# AutoMCHUB 生成\n-Xms%dM\n-Xmx%dM\n", i.XmsMB, i.XmxMB)
		_ = os.WriteFile(filepath.Join(i.Dir, "user_jvm_args.txt"), []byte(content), 0o644)
	}
	return os.WriteFile(filepath.Join(i.Dir, "run.bat"), []byte(sb.String()), 0o644)
}
