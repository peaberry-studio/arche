package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"regexp"
	"strings"
	"time"
)

var connectorIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,128}$`)

type connectorCredential struct {
	Token     string `json:"token"`
	ExpiresAt int64  `json:"expiresAt"`
}

func connectorProxyToken(password, id string) string {
	mac := hmac.New(sha256.New, []byte(password))
	mac.Write([]byte("arche-connector-proxy:" + id))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (s *server) renewConnectorCredential(ctx context.Context, id string) (connectorCredential, error) {
	var credential connectorCredential
	endpoint, err := url.Parse(strings.TrimRight(s.connectorGateway, "/") + "/" + id + "/token")
	if err != nil || endpoint.Host == "" || (endpoint.Scheme != "http" && endpoint.Scheme != "https") || s.workspaceSlug == "" {
		return credential, errors.New("connector_gateway_unavailable")
	}
	query := endpoint.Query()
	query.Set("workspace", s.workspaceSlug)
	endpoint.RawQuery = query.Encode()
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), nil)
	if err != nil {
		return credential, err
	}
	request.SetBasicAuth(s.username, s.password)
	client := &http.Client{
		Transport:     &http.Transport{},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	defer client.CloseIdleConnections()
	response, err := client.Do(request)
	if err != nil {
		return credential, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return credential, errors.New("connector_credential_rejected")
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 16<<10)).Decode(&credential); err != nil {
		return credential, err
	}
	if credential.Token == "" || credential.ExpiresAt <= time.Now().Unix() || credential.ExpiresAt > time.Now().Add(5*time.Minute).Unix()+1 {
		return credential, errors.New("invalid_connector_credential")
	}
	return credential, nil
}

func (s *server) handleConnectorProxy(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/mcp/connectors/")
	if !connectorIDPattern.MatchString(id) {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if r.Method != http.MethodPost && r.Method != http.MethodGet && r.Method != http.MethodDelete {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	expected := "Bearer " + connectorProxyToken(s.password, id)
	if !hmac.Equal([]byte(r.Header.Get("Authorization")), []byte(expected)) {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	credential, err := s.renewConnectorCredential(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "connector_credential_unavailable")
		return
	}
	deadline := time.Unix(credential.ExpiresAt, 0)
	ctx, cancel := context.WithDeadline(r.Context(), deadline)
	defer cancel()
	_ = http.NewResponseController(w).SetWriteDeadline(deadline)
	r = r.WithContext(ctx)
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	target, err := url.Parse(strings.TrimRight(s.connectorGateway, "/") + "/" + id + "/mcp")
	if err != nil {
		writeError(w, http.StatusBadGateway, "connector_gateway_unavailable")
		return
	}
	transport := &http.Transport{ResponseHeaderTimeout: 4 * time.Minute}
	defer transport.CloseIdleConnections()
	proxy := &httputil.ReverseProxy{
		Transport:     transport,
		FlushInterval: -1,
		Rewrite: func(request *httputil.ProxyRequest) {
			request.Out.URL = target
			request.Out.URL.RawQuery = request.In.URL.RawQuery
			request.Out.Host = target.Host
			request.Out.Header = make(http.Header)
			for _, name := range []string{"Content-Type", "Accept", "Mcp-Protocol-Version", "Mcp-Session-Id", "Last-Event-Id"} {
				for _, value := range request.In.Header.Values(name) {
					request.Out.Header.Add(name, value)
				}
			}
			request.Out.Header.Set("Authorization", "Bearer "+credential.Token)
		},
		ModifyResponse: func(response *http.Response) error {
			response.Header.Del("Set-Cookie")
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			writeError(w, http.StatusBadGateway, "connector_gateway_failed")
		},
	}
	proxy.ServeHTTP(w, r)
}
