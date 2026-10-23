package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestConnectorProxyRenewsAndStripsBrowserCredentials(t *testing.T) {
	issued, forwarded := 0, 0
	enabled := true
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/token") {
			username, password, ok := r.BasicAuth()
			if !ok || username != "opencode" || password != "fixture" || r.URL.Query().Get("workspace") != "alice" {
				t.Error("renewal must authenticate the current workspace")
			}
			if !enabled {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			issued++
			json.NewEncoder(w).Encode(connectorCredential{Token: fmt.Sprint(issued), ExpiresAt: time.Now().Add(time.Minute).Unix()})
			return
		}
		forwarded++
		if r.Header.Get("Authorization") != fmt.Sprintf("Bearer %d", issued) || r.URL.Path != "/conn-1/mcp" {
			t.Error("proxy must use only the fresh gateway token and fixed connector path")
		}
		for _, name := range []string{"Cookie", "X-Arche-Desktop-Token", "X-Forwarded-For", "Origin"} {
			if r.Header.Get(name) != "" {
				t.Errorf("forwarded browser credential: %s", name)
			}
		}
		if r.Header.Get("Mcp-Session-Id") != "session" {
			t.Error("lost MCP session")
		}
		w.Header().Set("Set-Cookie", "untrusted=value")
		w.Header().Set("Mcp-Session-Id", "session")
		w.WriteHeader(http.StatusAccepted)
		w.Write([]byte(`{"ok":true}`))
	}))
	defer backend.Close()
	s := &server{username: "opencode", password: "fixture", workspaceSlug: "alice", connectorGateway: backend.URL}
	request := func() *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, "/mcp/connectors/conn-1", strings.NewReader(`{"method":"tools/list"}`))
		r.Header.Set("Authorization", "Bearer "+connectorProxyToken("fixture", "conn-1"))
		for _, name := range []string{"Cookie", "X-Arche-Desktop-Token", "X-Forwarded-For", "Origin", "Mcp-Session-Id"} {
			r.Header.Set(name, "session")
		}
		w := httptest.NewRecorder()
		s.handleConnectorProxy(w, r)
		return w
	}
	for i := 0; i < 2; i++ {
		w := request()
		if w.Code != http.StatusAccepted || w.Header().Get("Set-Cookie") != "" || w.Body.String() != `{"ok":true}` {
			t.Fatalf("unexpected proxy response: %d %s", w.Code, w.Body.String())
		}
	}
	if issued != 2 || forwarded != 2 {
		t.Fatal("each request must renew before forwarding, without replaying operations")
	}
	enabled = false
	if w := request(); w.Code != http.StatusUnauthorized || forwarded != 2 {
		t.Fatal("revoked credentials must not reach the connector")
	}
}

func TestConnectorProxyRejectsOtherConnectorAndExpiredCredentials(t *testing.T) {
	issued := 0
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		issued++
		json.NewEncoder(w).Encode(connectorCredential{Token: "expired", ExpiresAt: 1})
	}))
	defer backend.Close()
	s := &server{username: "opencode", password: "fixture", workspaceSlug: "alice", connectorGateway: backend.URL}
	for _, id := range []string{"conn-2", "conn-1"} {
		r := httptest.NewRequest(http.MethodGet, "/mcp/connectors/"+id, nil)
		r.Header.Set("Authorization", "Bearer "+connectorProxyToken("fixture", "conn-1"))
		w := httptest.NewRecorder()
		s.handleConnectorProxy(w, r)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("accepted invalid credential for %s", id)
		}
	}
	if issued != 1 {
		t.Fatal("a different connector must not even attempt renewal")
	}
}

func TestConnectorRenewalDoesNotFollowRedirects(t *testing.T) {
	leaked := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { leaked = true }))
	defer target.Close()
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer backend.Close()
	s := &server{username: "opencode", password: "fixture", workspaceSlug: "alice", connectorGateway: backend.URL}
	_, err := s.renewConnectorCredential(context.Background(), "conn-1")
	if err == nil || leaked {
		t.Fatal("renewal must reject redirects without forwarding workspace credentials")
	}
}
