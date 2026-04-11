package main

import (
	"context"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestShellQuoteUsesPOSIXSingleQuotes(t *testing.T) {
	t.Parallel()

	value := "price=$HOME 'quoted' `ticks`"
	got := shellQuote(value)
	want := `'price=$HOME '"'"'quoted'"'"' ` + "`ticks`'"
	if got != want {
		t.Fatalf("shellQuote() = %q, want %q", got, want)
	}
}

func TestParseStateSecretsFromEnv(t *testing.T) {
	t.Parallel()

	env := `
POSTGRES_PASSWORD=postgres
ARCHE_SESSION_PEPPER=session
ARCHE_ENCRYPTION_KEY=encryption
ARCHE_INTERNAL_TOKEN=internal
ARCHE_GATEWAY_TOKEN_SECRET=gateway
ARCHE_CONNECTOR_OAUTH_STATE_SECRET=oauth
ARCHE_SEED_ADMIN_PASSWORD=admin
`
	secrets, err := parseStateSecretsFromEnv(env)
	if err != nil {
		t.Fatalf("parseStateSecretsFromEnv() error = %v", err)
	}
	if secrets.AdminPassword != "admin" || secrets.PostgresPassword != "postgres" {
		t.Fatalf("parseStateSecretsFromEnv() returned wrong values: %+v", secrets)
	}
}

func TestParseStateSecretsFromEnvRequiresAllKeys(t *testing.T) {
	t.Parallel()

	_, err := parseStateSecretsFromEnv("POSTGRES_PASSWORD=postgres\n")
	if err == nil || !strings.Contains(err.Error(), "remote .env is missing required keys") {
		t.Fatalf("parseStateSecretsFromEnv() error = %v, want missing-key error", err)
	}
}

func TestReadStateAcceptsSSHPrivateKeyWithoutPassword(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "state.json")
	if err := os.WriteFile(path, []byte(`{
  "app_name": "arche",
  "version": "v1.2.3",
  "app_image": "ghcr.io/peaberry-studio/arche/web:v1.2.3",
  "workspace_image": "ghcr.io/peaberry-studio/arche/workspace:v1.2.3",
  "db_name": "arche",
  "deployment": {
    "ip_address": "203.0.113.10",
    "json_file": ""
  },
  "secrets": {
    "ssh_private_key": "PRIVATE KEY"
  }
}`), 0o600); err != nil {
		t.Fatal(err)
	}

	state, resolved, err := readState(path)
	if err != nil {
		t.Fatalf("readState() error = %v", err)
	}
	if resolved != path {
		t.Fatalf("readState() resolved path = %q, want %q", resolved, path)
	}
	if state.Secrets.SSHPrivateKey != "PRIVATE KEY" {
		t.Fatalf("readState() SSH key = %q", state.Secrets.SSHPrivateKey)
	}
	if state.Deployment.JSONFile != path {
		t.Fatalf("readState() JSON file = %q, want %q", state.Deployment.JSONFile, path)
	}
}

func TestStateForUpdateReadsManualSSHKey(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	keyPath := filepath.Join(dir, "deploy.pem")
	if err := os.WriteFile(keyPath, []byte("PRIVATE KEY\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	state, statePath, err := stateForUpdate(cliArgs{
		ipAddress:  "203.0.113.10",
		sshKeyPath: keyPath,
		publicURL:  "",
	})
	if err != nil {
		t.Fatalf("stateForUpdate() error = %v", err)
	}
	if statePath != "manual flags" {
		t.Fatalf("stateForUpdate() statePath = %q", statePath)
	}
	if state.Secrets.SSHPrivateKey != "PRIVATE KEY" {
		t.Fatalf("stateForUpdate() SSH key = %q", state.Secrets.SSHPrivateKey)
	}
	if state.Deployment.PublicURL != "https://arche-203-0-113-10.nip.io" {
		t.Fatalf("stateForUpdate() public URL = %q", state.Deployment.PublicURL)
	}
	if sshUserForState(state) != deploySSHUser {
		t.Fatalf("sshUserForState() = %q, want %q", sshUserForState(state), deploySSHUser)
	}
}

func TestDoClientRequestRetriesRateLimit(t *testing.T) {
	t.Parallel()

	attempts := 0
	client := &doClient{
		token: "test-token",
		http: &http.Client{
			Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				attempts++
				statusCode := http.StatusOK
				body := `{"ok":true}`
				headers := make(http.Header)
				if attempts == 1 {
					statusCode = http.StatusTooManyRequests
					body = `{"message":"slow down"}`
					headers.Set("Retry-After", "0")
				}
				return &http.Response{
					StatusCode: statusCode,
					Header:     headers,
					Body:       io.NopCloser(strings.NewReader(body)),
				}, nil
			}),
		},
		baseURL: "https://api.example.test",
	}
	var response struct {
		OK bool `json:"ok"`
	}
	if err := client.request(context.Background(), http.MethodGet, "/account", nil, &response); err != nil {
		t.Fatalf("request() error = %v", err)
	}
	if !response.OK {
		t.Fatalf("request() response = %+v", response)
	}
	if attempts != 2 {
		t.Fatalf("request() attempts = %d, want 2", attempts)
	}
}

func TestRenderUpdateScriptUsesSedForEnvReplacement(t *testing.T) {
	t.Parallel()

	script := renderUpdateScript("v1.2.3", "services:\n  web:\n")
	if !strings.Contains(script, `sed -i "/^${key}=/d"`) {
		t.Fatalf("renderUpdateScript() should use sed for key replacement:\n%s", script)
	}
	if strings.Contains(script, `grep -v "^${key}="`) {
		t.Fatalf("renderUpdateScript() should not use grep -v:\n%s", script)
	}
}

func TestValidateTemplates(t *testing.T) {
	t.Parallel()

	if err := validateTemplates("v1.2.3"); err != nil {
		t.Fatalf("validateTemplates() error = %v", err)
	}
}

func TestRenderCloudInitUsesDeployUserInsteadOfRoot(t *testing.T) {
	t.Parallel()

	cloudInit := renderCloudInit("ssh-rsa AAAATEST", "services:\n  web:\n", "#!/bin/bash\necho ok\n")
	if !strings.Contains(cloudInit, "disable_root: true") {
		t.Fatalf("renderCloudInit() should disable root login:\n%s", cloudInit)
	}
	if !strings.Contains(cloudInit, "name: "+deploySSHUser) {
		t.Fatalf("renderCloudInit() should create the deploy user:\n%s", cloudInit)
	}
	if strings.Contains(cloudInit, "name: root") {
		t.Fatalf("renderCloudInit() should not authorize root directly:\n%s", cloudInit)
	}
}

func TestDisplaySSHCommandUsesDeployUserForKeyBasedState(t *testing.T) {
	t.Parallel()

	state := deploymentState{
		Deployment: artifacts{
			IPAddress:      "203.0.113.10",
			SSHKeyFile:     "/tmp/key.pem",
			KnownHostsFile: "/tmp/known_hosts",
		},
		Secrets: stateSecrets{
			SSHPrivateKey: "PRIVATE KEY",
			SSHKnownHost:  "hostkey",
		},
	}
	target := sshTarget{ip: state.Deployment.IPAddress, user: sshUserForState(state), auth: sshAuthForState(state)}
	command := displaySSHCommand(target, state)
	if !strings.Contains(command, deploySSHUser+"@203.0.113.10") {
		t.Fatalf("displaySSHCommand() = %q", command)
	}
	if strings.Contains(command, rootSSHUser+"@203.0.113.10") {
		t.Fatalf("displaySSHCommand() should not target root: %q", command)
	}
}
