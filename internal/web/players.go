package web

import (
	"net/http"
)

func (s *Server) handleGetPlayers(w http.ResponseWriter, r *http.Request) {
	pl, err := s.mgr.GetPlayers(r.PathValue("name"))
	if err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, pl)
}

func (s *Server) handlePlayerAction(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Action string `json:"action"`
		Player string `json:"player"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, err)
		return
	}
	if err := s.mgr.PlayerAction(r.PathValue("name"), body.Action, body.Player); err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, "ok")
}
