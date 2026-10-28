package web

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"minedeck/internal/mcsrc"
)

func (s *Server) handleCores(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, mcsrc.Cores())
}

func (s *Server) handleMCVersions(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	core := mcsrc.Core(r.URL.Query().Get("core"))
	if !mcsrc.ValidCore(core) {
		writeErr(w, 400, fmt.Errorf("未知核心: %s", core))
		return
	}
	snapshots := r.URL.Query().Get("snapshots") == "1"
	vers, err := mcsrc.ListVersions(ctx, core, snapshots)
	if err != nil {
		writeErr(w, 502, err)
		return
	}
	writeJSON(w, vers)
}

func (s *Server) handleBuilds(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	core := mcsrc.Core(r.URL.Query().Get("core"))
	mc := r.URL.Query().Get("mc")
	if !mcsrc.ValidCore(core) || mc == "" {
		writeErr(w, 400, fmt.Errorf("参数缺失"))
		return
	}
	builds, err := mcsrc.ListBuilds(ctx, core, mc)
	if err != nil {
		writeErr(w, 502, err)
		return
	}
	writeJSON(w, builds)
}
