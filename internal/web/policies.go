package web

import (
	"net/http"

	"minedeck/internal/inst"
)

func (s *Server) handleGetPolicies(w http.ResponseWriter, r *http.Request) {
	i, err := s.mgr.Get(r.PathValue("name"))
	if err != nil {
		writeErr(w, 404, err)
		return
	}
	p := i.PoliciesSnapshot()
	if p.Schedules == nil {
		p.Schedules = []inst.Schedule{}
	}
	writeJSON(w, p)
}

func (s *Server) handleSetPolicies(w http.ResponseWriter, r *http.Request) {
	var p inst.Policies
	if err := readJSON(r, &p); err != nil {
		writeErr(w, 400, err)
		return
	}
	if err := s.mgr.UpdatePolicies(r.PathValue("name"), p); err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, "ok")
}
