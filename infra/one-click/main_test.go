package main

import (
	"context"
	"io"
	"net/http"
	"os"
	"os/exec"
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

func TestValidateTemplatesAcceptsPRVersion(t *testing.T) {
	t.Parallel()

	if err := validateTemplates("pr-361"); err != nil {
		t.Fatalf("validateTemplates() error = %v", err)
	}
}

func TestRenderEnvFileSetsFlowSchedulerMode(t *testing.T) {
	t.Parallel()

	// Short placeholders: the PR secret scanner treats quoted password/secret
	// assignments of eight or more characters as potential hardcoded secrets.
	envFile := renderEnvFile(input{token: "sample", email: "admin@example.com", version: "v1.2.3"}, stateSecrets{
		PostgresPassword:          "pg-pass",
		SessionPepper:             "pepper",
		EncryptionKey:             "enc-key",
		InternalToken:             "int-token",
		GatewayTokenSecret:        "gw-sec",
		ConnectorOAuthStateSecret: "oauth",
		AdminPassword:             "admin",
	}, envPlaceholderDomain, envPlaceholderPublicBaseURL)
	if !strings.Contains(envFile, "ARCHE_FLOW_SCHEDULER_MODE=daemon") {
		t.Fatalf("renderEnvFile() should set ARCHE_FLOW_SCHEDULER_MODE=daemon:\n%s", envFile)
	}
}

func TestRenderBootstrapScriptWritesFlowSchedulerMode(t *testing.T) {
	t.Parallel()

	script := renderBootstrapScript(input{token: "sample", email: "admin@example.com", version: "v1.2.3"})
	if !strings.Contains(script, "ARCHE_FLOW_SCHEDULER_MODE=daemon") {
		t.Fatalf("renderBootstrapScript() should write ARCHE_FLOW_SCHEDULER_MODE=daemon to the env file:\n%s", script)
	}
}

func TestRenderUpdateScriptSetsFlowSchedulerModeAndStartsFlows(t *testing.T) {
	t.Parallel()

	script := renderUpdateScript("v1.2.3", "services:\n  web:\n")
	if !strings.Contains(script, "set_env ARCHE_FLOW_SCHEDULER_MODE daemon") {
		t.Fatalf("renderUpdateScript() should set ARCHE_FLOW_SCHEDULER_MODE via set_env:\n%s", script)
	}
	if !strings.Contains(script, "docker compose up -d web flows reaper") {
		t.Fatalf("renderUpdateScript() should bring up the flows and reaper services alongside web:\n%s", script)
	}
}

func TestUpdateDrainsLegacyWritersBeforeReplacingWorkspaceImage(t *testing.T) {
	for _, legacy := range []string{"web", "flows", "reaper", "", "inspection-error"} {
		t.Run(legacy, func(t *testing.T) {
			dir := t.TempDir()
			calls := filepath.Join(dir, "calls")
			docker := `#!/bin/sh
printf '%s\n' "$*" >> "$CALLS"
if [ "$1" = compose ] && [ "$2" = ps ]; then
  printf 'web\nflows\nreaper\n'
elif [ "$1" = inspect ]; then
  if [ "$LEGACY_CONTAINER" = inspection-error ]; then exit 1; fi
  if [ "$4" != "$LEGACY_CONTAINER" ]; then printf 'opencode-v2\n'; fi
fi
`
			if err := os.WriteFile(filepath.Join(dir, "docker"), []byte(docker), 0o755); err != nil {
				t.Fatal(err)
			}
			script := renderUpdateScript("latest", "services:\n  web:\n")
			start := strings.Index(script, "backend_ids=")
			end := strings.Index(script, "log 'Recreating web, flows, and reaper services'")
			if start < 0 || end <= start {
				t.Fatal("update script is missing its runtime upgrade fence")
			}
			command := exec.Command("bash", "-c", "set -euo pipefail\nlog() { :; }\nOPENCODE_IMAGE=fixture:latest\n"+script[start:end])
			command.Env = append(os.Environ(), "PATH="+dir+string(os.PathListSeparator)+os.Getenv("PATH"), "CALLS="+calls, "LEGACY_CONTAINER="+legacy)
			output, err := command.CombinedOutput()
			if legacy == "inspection-error" && err == nil || legacy != "inspection-error" && err != nil {
				t.Fatalf("update fence error = %v, output = %s", err, output)
			}
			recorded, err := os.ReadFile(calls)
			if err != nil {
				t.Fatal(err)
			}
			stop := strings.Index(string(recorded), "compose stop -t 10 web flows reaper")
			pull := strings.Index(string(recorded), "pull fixture:latest")
			if legacy == "inspection-error" {
				if pull >= 0 {
					t.Fatal("workspace image changed after an uncertain writer inspection")
				}
			} else if legacy != "" {
				if stop < 0 || pull <= stop {
					t.Fatalf("legacy writer was not drained before pull: %s", recorded)
				}
			} else if stop >= 0 || pull < 0 {
				t.Fatalf("compatible writers should keep running during pull: %s", recorded)
			}
		})
	}
}

func TestRenderComposeRunsFlowDaemon(t *testing.T) {
	t.Parallel()

	compose := renderCompose()
	if !strings.Contains(compose, "\n  flows:\n") {
		t.Fatalf("renderCompose() should declare a flows service:\n%s", compose)
	}
	if !strings.Contains(compose, "src/flow-daemon.ts") {
		t.Fatalf("renderCompose() should run the flow-daemon entrypoint:\n%s", compose)
	}
}

func TestRenderComposeRunsReaper(t *testing.T) {
	t.Parallel()

	compose := renderCompose()
	if !strings.Contains(compose, "\n  reaper:\n") {
		t.Fatalf("renderCompose() should declare a reaper service:\n%s", compose)
	}
	if !strings.Contains(compose, "src/reaper-daemon.ts") {
		t.Fatalf("renderCompose() should run the reaper-daemon entrypoint:\n%s", compose)
	}
}

func TestValidateVersionAcceptsPRVersion(t *testing.T) {
	t.Parallel()

	if err := validateVersion("pr-361"); err != nil {
		t.Fatalf("validateVersion() error = %v", err)
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

func TestComposeIsolatesControlPlane(t *testing.T) {
	compose := renderCompose()
	start := strings.Index(compose, "  docker-socket-proxy:\n    image:")
	end := strings.Index(compose[start:], "\n  postgres:") + start
	proxy := compose[start:end]
	if strings.Contains(proxy, "arche-internal") || !strings.Contains(proxy, "- arche-control") {
		t.Fatalf("socket proxy is not isolated: %s", proxy)
	}
	if !strings.Contains(proxy, "@sha256:") || !strings.Contains(compose, "name: arche-control\n    internal: true") {
		t.Fatal("control network or image pin missing")
	}
	if !strings.Contains(renderUpdateScript("latest", compose), "docker compose up -d web flows reaper docker-socket-proxy traefik") {
		t.Fatal("updates must migrate the proxy and Traefik networks")
	}
}

func TestGeneratedScriptsLoadEnvAsData(t *testing.T) {
	scripts := []string{renderUpdateScript("latest", renderCompose()), renderBootstrapScript(input{email: "test@example.com", version: "latest"})}
	for _, script := range scripts {
		dir := t.TempDir()
		marker := filepath.Join(dir, "executed")
		envPath := filepath.Join(dir, ".env")
		value := "$(touch " + marker + ")"
		if err := os.WriteFile(envPath, []byte("ARCHE_TEST_VALUE=\""+value+"\"\n"), 0600); err != nil {
			t.Fatal(err)
		}
		start := strings.Index(script, "while IFS=")
		end := strings.Index(script[start:], "done < /opt/arche/.env") + start + len("done < /opt/arche/.env")
		parser := strings.ReplaceAll(script[start:end], "/opt/arche/.env", shellQuote(envPath))
		command := exec.Command("bash", "-c", "set -eu\nlog() { :; }\n"+parser+"\nprintf '%s' \"$ARCHE_TEST_VALUE\"")
		output, err := command.CombinedOutput()
		if err != nil || string(output) != value {
			t.Fatalf("dotenv parser: %v, %s", err, output)
		}
		if _, err := os.Stat(marker); !os.IsNotExist(err) {
			t.Fatal("dotenv executed a command")
		}
	}
}

func TestBootstrapUsesSignedDistributionPackages(t *testing.T) {
	script := renderBootstrapScript(input{email: "test@example.com", version: "v1.2.3"})
	if strings.Contains(script, "get.docker.com") {
		t.Fatal("remote shell installer must not run")
	}
	if !strings.Contains(script, "apt-get install -y docker.io docker-compose-v2") {
		t.Fatal("expected distribution package installation")
	}
	if !strings.Contains(script, "./start.sh init") {
		t.Fatal("bootstrap must initialize users explicitly")
	}
	if !strings.Contains(renderCompose(), `!PathPrefix("/api/internal")`) {
		t.Fatal("public router exposes internal APIs")
	}
}
