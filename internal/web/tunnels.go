package web

import (
	"net/http"

	"minedeck/internal/tunnel"
)

func (s *Server) handleListTunnels(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.tun.List())
}

func (s *Server) handleAddTunnel(w http.ResponseWriter, r *http.Request) {
	var t tunnel.Tunnel
	if err := readJSON(r, &t); err != nil {
		writeErr(w, 400, err)
		return
	}
	nt, err := s.tun.Add(t)
	if err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, nt)
}

func (s *Server) handleUpdateTunnel(w http.ResponseWriter, r *http.Request) {
	var t tunnel.Tunnel
	if err := readJSON(r, &t); err != nil {
		writeErr(w, 400, err)
		return
	}
	if err := s.tun.Update(r.PathValue("id"), t); err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, "ok")
}

func (s *Server) handleDeleteTunnel(w http.ResponseWriter, r *http.Request) {
	if err := s.tun.Delete(r.PathValue("id")); err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, "ok")
}

func (s *Server) handleTunnelStart(w http.ResponseWriter, r *http.Request) {
	if err := s.tun.Start(r.PathValue("id")); err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, "ok")
}

func (s *Server) handleTunnelStop(w http.ResponseWriter, r *http.Request) {
	if err := s.tun.Stop(r.PathValue("id")); err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, "ok")
}
