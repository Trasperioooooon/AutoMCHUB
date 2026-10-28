package web

import (
	"fmt"
	"net/http"
)

func (s *Server) handleListBackups(w http.ResponseWriter, r *http.Request) {
	list, err := s.mgr.ListBackups(r.PathValue("name"))
	if err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, list)
}

func (s *Server) handleCreateBackup(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Label string `json:"label"`
	}
	_ = readJSON(r, &body)
	f, err := s.mgr.CreateBackup(r.PathValue("name"), body.Label)
	if err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, map[string]string{"file": f})
}

func (s *Server) handleRestoreBackup(w http.ResponseWriter, r *http.Request) {
	var body struct {
		File string `json:"file"`
	}
	if err := readJSON(r, &body); err != nil || body.File == "" {
		writeErr(w, 400, fmt.Errorf("缺少备份文件名"))
		return
	}
	if err := s.mgr.RestoreBackup(r.PathValue("name"), body.File); err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, "ok")
}

func (s *Server) handleDeleteBackup(w http.ResponseWriter, r *http.Request) {
	f := r.URL.Query().Get("file")
	if f == "" {
		writeErr(w, 400, fmt.Errorf("缺少备份文件名"))
		return
	}
	if err := s.mgr.DeleteBackup(r.PathValue("name"), f); err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, "ok")
}
