package web

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"minedeck/internal/app"
	"minedeck/internal/inst"
	"minedeck/internal/mcsrc"
	"minedeck/internal/modpack"
)

// handleImportModpack 接收整合包上传（multipart）并启动导入任务。
func (s *Server) handleImportModpack(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 4<<30)
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		writeErr(w, 400, fmt.Errorf("上传解析失败: %w", err))
		return
	}
	file, hdr, err := r.FormFile("file")
	if err != nil {
		writeErr(w, 400, fmt.Errorf("缺少整合包文件"))
		return
	}
	defer file.Close()
	base := filepath.Base(hdr.Filename)
	if base == "" || base == "." {
		base = "modpack.zip"
	}
	dest := filepath.Join(app.CacheDir, "import", fmt.Sprintf("%d-%s", time.Now().UnixMilli(), base))
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		writeErr(w, 500, err)
		return
	}
	out, err := os.Create(dest)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	_, cerr := io.Copy(out, file)
	if werr := out.Close(); cerr == nil {
		cerr = werr
	}
	if cerr != nil {
		writeErr(w, 500, fmt.Errorf("保存上传文件失败: %w", cerr))
		return
	}
	pack, err := modpack.Parse(dest)
	if err != nil {
		os.Remove(dest)
		writeErr(w, 400, err)
		return
	}
	atoi := func(s string, def int) int {
		if n, err := strconv.Atoi(s); err == nil {
			return n
		}
		return def
	}
	req := inst.CreateReq{
		Name:        r.FormValue("name"),
		XmxMB:       atoi(r.FormValue("xmxMb"), 4096),
		Port:        atoi(r.FormValue("port"), 25565),
		EULA:        r.FormValue("eula") == "true",
		OnlineMode:  r.FormValue("onlineMode") == "true",
		AllowFlight: r.FormValue("allowFlight") == "true",
		MOTD:        r.FormValue("motd"),
		Root:        r.FormValue("root"),
	}
	if !isLoopbackReq(r) {
		req.Root = "" // 同 handleCreateInstance：远程 / 局域网请求不得指定主机任意路径，强制落到默认根
	}
	id, err := s.mgr.ImportModpackAsync(pack, req, app.GetConfig().CFApiKey)
	if err != nil {
		os.Remove(dest)
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, map[string]any{
		"taskId": id,
		"pack":   map[string]any{"name": pack.Name, "mc": pack.MC, "core": pack.Core, "loader": pack.Loader, "files": len(pack.Files) + len(pack.CFRefs)},
	})
}

type instSummary struct {
	Name            string   `json:"name"`
	Core            string   `json:"core"`
	Kind            string   `json:"kind"`
	MC              string   `json:"mc"`
	Build           string   `json:"build"`
	JavaMajor       int      `json:"javaMajor"`
	XmxMB           int      `json:"xmxMb"`
	XmsMB           int      `json:"xmsMb"`
	Port            int      `json:"port"`
	Status          string   `json:"status"`
	MOTD            string   `json:"motd"`
	Dir             string   `json:"dir"`
	CreatedAt       string   `json:"createdAt"`
	ConsoleEncoding string   `json:"consoleEncoding"`
	OnlineCount     int      `json:"onlineCount"`
	UptimeSec       int      `json:"uptimeSec"`
	MaxPlayers      int      `json:"maxPlayers"`
	ExtraJVM        []string `json:"extraJvm"`
}

func summarize(i *inst.Instance) instSummary {
	motd := ""
	maxP := 20
	if p, err := inst.LoadProps(i.PropsPath()); err == nil {
		motd, _ = p.Get("motd")
		if v, ok := p.Get("max-players"); ok {
			if n, e := strconv.Atoi(strings.TrimSpace(v)); e == nil && n > 0 {
				maxP = n
			}
		}
	}
	xmx, xms, enc := i.MemSnapshot() // 加锁快照，避免与并发的 UpdateSettings 写入构成数据竞争
	if enc == "" {
		enc = "auto"
	}
	return instSummary{
		Name: i.Name, Core: string(i.Core), Kind: string(mcsrc.KindOf(i.Core)),
		MC: i.MC, Build: i.Build,
		JavaMajor: i.JavaMajor, XmxMB: xmx, XmsMB: xms,
		Port: i.Port(), Status: i.Status(), MOTD: motd, Dir: i.Dir,
		CreatedAt:       i.CreatedAt.Format("2006-01-02 15:04"),
		ConsoleEncoding: enc,
		OnlineCount:     i.OnlineCount(), UptimeSec: i.UptimeSec(), MaxPlayers: maxP,
		ExtraJVM: i.ExtraJVMSnapshot(),
	}
}

func (s *Server) handleListInstances(w http.ResponseWriter, r *http.Request) {
	var out []instSummary
	for _, i := range s.mgr.List() {
		out = append(out, summarize(i))
	}
	if out == nil {
		out = []instSummary{}
	}
	writeJSON(w, out)
}

func (s *Server) handleCreateInstance(w http.ResponseWriter, r *http.Request) {
	var req inst.CreateReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, 400, err)
		return
	}
	if !isLoopbackReq(r) {
		req.Root = "" // 远程 / 局域网请求不得指定主机任意路径，强制落到默认根，防越界写入
	}
	id, err := s.mgr.CreateAsync(req)
	if err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, map[string]string{"taskId": id})
}

func (s *Server) handleTask(w http.ResponseWriter, r *http.Request) {
	t := s.mgr.Tasks.Get(r.PathValue("id"))
	if t == nil {
		writeErr(w, 404, fmt.Errorf("任务不存在"))
		return
	}
	writeJSON(w, t.Snapshot())
}

func (s *Server) instAction(fn func(*inst.Manager, string) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")
		if err := fn(s.mgr, name); err != nil {
			writeErr(w, 400, err)
			return
		}
		writeJSON(w, "ok")
	}
}

func (s *Server) handleCommand(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Cmd string `json:"cmd"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, err)
		return
	}
	if err := s.mgr.Command(r.PathValue("name"), body.Cmd); err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, "ok")
}

func (s *Server) handleDelete(w http.ResponseWriter, r *http.Request) {
	files := r.URL.Query().Get("files") == "1"
	if err := s.mgr.Delete(r.PathValue("name"), files); err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, "ok")
}

// handleInstStart 启动实例，成功后拉起绑定的跟随隧道。
func (s *Server) handleInstStart(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if err := s.mgr.Start(name); err != nil {
		writeErr(w, 400, err)
		return
	}
	s.tun.StartBound(name)
	writeJSON(w, "ok")
}

func (s *Server) handleSetSettings(w http.ResponseWriter, r *http.Request) {
	var body struct {
		XmxMB           int       `json:"xmxMb"`
		XmsMB           int       `json:"xmsMb"`
		ConsoleEncoding string    `json:"consoleEncoding"`
		ExtraJVM        *[]string `json:"extraJvm"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, err)
		return
	}
	if err := s.mgr.UpdateSettings(r.PathValue("name"), body.XmxMB, body.XmsMB, body.ConsoleEncoding, body.ExtraJVM); err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, "ok")
}
