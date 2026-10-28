package web

import (
	"fmt"
	"net/http"
	"strings"

	"minedeck/internal/java"
)

func (s *Server) handleJavas(w http.ResponseWriter, r *http.Request) {
	scanned := java.Cached()
	if scanned == nil {
		scanned = []java.ScannedJava{}
	}
	portable := java.Installed()
	if portable == nil {
		portable = []java.Info{}
	}
	writeJSON(w, map[string]any{"portable": portable, "scanned": scanned})
}

func (s *Server) handleJavaScan(w http.ResponseWriter, r *http.Request) {
	list := java.Scan()
	if list == nil {
		list = []java.ScannedJava{}
	}
	writeJSON(w, list)
}

func (s *Server) handleJavaAdd(w http.ResponseWriter, r *http.Request) {
	// 仅限本机：请求体 path 会被作为可执行文件运行（java -version），远程/局域网不得指定主机任意路径
	if !isLoopbackReq(r) {
		writeErr(w, 403, fmt.Errorf("添加本机 Java 仅支持在本机操作"))
		return
	}
	var body struct {
		Path string `json:"path"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, err)
		return
	}
	j, err := java.AddManual(strings.TrimSpace(body.Path))
	if err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, j)
}
