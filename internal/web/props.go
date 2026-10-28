package web

import (
	"net/http"
	"strings"

	"minedeck/internal/inst"
)

func (s *Server) handleGetProps(w http.ResponseWriter, r *http.Request) {
	i, err := s.mgr.Get(r.PathValue("name"))
	if err != nil {
		writeErr(w, 404, err)
		return
	}
	p, err := inst.LoadProps(i.PropsPath())
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	pairs := p.Pairs()
	if pairs == nil {
		pairs = []inst.KV{}
	}
	writeJSON(w, map[string]any{"pairs": pairs, "running": i.Status() != "stopped"})
}

func (s *Server) handleSetProps(w http.ResponseWriter, r *http.Request) {
	i, err := s.mgr.Get(r.PathValue("name"))
	if err != nil {
		writeErr(w, 404, err)
		return
	}
	var body struct {
		Pairs []inst.KV `json:"pairs"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, err)
		return
	}
	p, err := inst.LoadProps(i.PropsPath())
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	for _, kv := range body.Pairs {
		key := strings.TrimSpace(kv.Key)
		if key == "" || strings.ContainsAny(key, "=\n\r") {
			continue
		}
		p.Set(key, strings.ReplaceAll(strings.ReplaceAll(kv.Value, "\r", " "), "\n", " ")) // 值内换行→空格，防拆行注入额外 key=value（如 enable-rcon）
	}
	if err := p.Save(i.PropsPath()); err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, "ok")
}
