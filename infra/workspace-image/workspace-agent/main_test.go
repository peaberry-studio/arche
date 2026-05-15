package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestGitStatusEntriesReturnsNestedUntrackedFiles(t *testing.T) {
	workspace := t.TempDir()
	ctx := context.Background()

	runGit(t, ctx, workspace, "init", "-b", "main")
	runGit(t, ctx, workspace, "config", "user.email", "tests@example.com")
	runGit(t, ctx, workspace, "config", "user.name", "Workspace Agent Tests")

	baselineFile := filepath.Join(workspace, "README.md")
	if err := os.WriteFile(baselineFile, []byte("baseline\n"), 0o644); err != nil {
		t.Fatalf("write baseline file: %v", err)
	}

	runGit(t, ctx, workspace, "add", "README.md")
	runGit(t, ctx, workspace, "commit", "-m", "baseline")

	nestedPath := filepath.Join(workspace, "Outputs", "Communications", "2026-02-12 - Summary.md")
	if err := os.MkdirAll(filepath.Dir(nestedPath), 0o755); err != nil {
		t.Fatalf("create nested directory: %v", err)
	}
	if err := os.WriteFile(nestedPath, []byte("content\n"), 0o644); err != nil {
		t.Fatalf("write nested file: %v", err)
	}

	s := &server{workspace: workspace}
	entries, err := s.gitStatusEntries(ctx)
	if err != nil {
		t.Fatalf("gitStatusEntries failed: %v", err)
	}

	expected := filepath.ToSlash("Outputs/Communications/2026-02-12 - Summary.md")
	for _, entry := range entries {
		if entry.Path == expected {
			if entry.Untracked != true {
				t.Fatalf("expected untracked entry for %q", expected)
			}
			if entry.Status != "added" {
				t.Fatalf("expected status added for %q, got %q", expected, entry.Status)
			}
			return
		}
	}

	t.Fatalf("expected nested untracked file %q in status entries: %#v", expected, entries)
}

func runGit(t *testing.T, ctx context.Context, dir string, args ...string) {
	t.Helper()

	command := append([]string{"git"}, args...)
	_, stderr, code, err := runCmd(ctx, dir, command)
	if err != nil {
		t.Fatalf("git command failed (%v): %v", command, err)
	}
	if code != 0 {
		t.Fatalf("git command exited with code %d (%v): %s", code, command, stderr)
	}
}

func TestIsInternalWorkspacePath(t *testing.T) {
	cases := []struct {
		name string
		path string
		want bool
	}{
		{name: "dot arche", path: ".arche", want: true},
		{name: "attachments file", path: ".arche/attachments/file.txt", want: true},
		{name: "normal file", path: "normal/file.txt", want: false},
		{name: "empty", path: "", want: false},
		{name: "duplicate slashes", path: ".arche//attachments/file.txt", want: true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := isInternalWorkspacePath(tc.path)
			if got != tc.want {
				t.Fatalf("isInternalWorkspacePath(%q) = %v, want %v", tc.path, got, tc.want)
			}
		})
	}
}

func TestNormalizeGithubRemote(t *testing.T) {
	valid, ok, errMsg := normalizeGithubRemote(&kbGithubRemoteRequest{
		Branch:       "main",
		RepoCloneUrl: "https://github.com/acme/kb.git",
		Token:        "secret-token",
	})
	if !ok || errMsg != "" {
		t.Fatalf("expected valid remote, ok=%v err=%q", ok, errMsg)
	}
	if valid.Branch != "main" || valid.RepoCloneUrl != "https://github.com/acme/kb.git" {
		t.Fatalf("unexpected normalized remote: %+v", valid)
	}

	_, ok, errMsg = normalizeGithubRemote(&kbGithubRemoteRequest{
		Branch:       "../main",
		RepoCloneUrl: "https://github.com/acme/kb.git",
		Token:        "secret-token",
	})
	if ok || errMsg != "github_branch_invalid" {
		t.Fatalf("expected invalid branch, ok=%v err=%q", ok, errMsg)
	}

	_, ok, errMsg = normalizeGithubRemote(&kbGithubRemoteRequest{
		RepoCloneUrl: "https://example.com/acme/kb.git",
		Token:        "secret-token",
	})
	if ok || errMsg != "github_remote_invalid_url" {
		t.Fatalf("expected invalid url, ok=%v err=%q", ok, errMsg)
	}
}

func TestSanitizeGithubMessageRedactsToken(t *testing.T) {
	token := "github-token"
	encoded := base64.StdEncoding.EncodeToString([]byte("x-access-token:" + token))
	message := "fatal: authentication failed for " + token + " header " + encoded

	sanitized := sanitizeGithubMessage(message, token)
	if strings.Contains(sanitized, token) || strings.Contains(sanitized, encoded) {
		t.Fatalf("expected token redacted, got %q", sanitized)
	}
	if !strings.Contains(sanitized, "***") {
		t.Fatalf("expected redaction marker, got %q", sanitized)
	}
}

func TestFileHandlersHappyPath(t *testing.T) {
	workspace := t.TempDir()
	s := &server{workspace: workspace}

	t.Run("handleFileWrite base64", func(t *testing.T) {
		payload := map[string]string{
			"path":     ".arche/attachments/hello.txt",
			"content":  base64.StdEncoding.EncodeToString([]byte("hello world")),
			"encoding": "base64",
		}
		req := httptest.NewRequest(http.MethodPost, "/files/write", strings.NewReader(mustJSON(t, payload)))
		recorder := httptest.NewRecorder()

		s.handleFileWrite(recorder, req)

		if recorder.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
		}
	})

	t.Run("handleFileList", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/files/list", strings.NewReader(`{"path":".arche/attachments","recursive":false}`))
		recorder := httptest.NewRecorder()

		s.handleFileList(recorder, req)

		if recorder.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
		}

		var response fileListResponse
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		if !response.Ok || len(response.Entries) != 1 {
			t.Fatalf("unexpected list response: %+v", response)
		}
	})

	t.Run("handleFileRename", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/files/rename", strings.NewReader(`{"path":".arche/attachments/hello.txt","newPath":".arche/attachments/renamed.txt"}`))
		recorder := httptest.NewRecorder()

		s.handleFileRename(recorder, req)

		if recorder.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
		}

		if _, err := os.Stat(filepath.Join(workspace, ".arche", "attachments", "renamed.txt")); err != nil {
			t.Fatalf("renamed file missing: %v", err)
		}
	})
}

func TestHandleFileWriteStagesResolvedConflict(t *testing.T) {
	workspace := t.TempDir()
	ctx := context.Background()
	path := "Notes/Conflict.md"
	createMergeConflict(t, ctx, workspace, path)

	s := &server{workspace: workspace}
	payload := map[string]string{
		"path":    path,
		"content": "merged content\n",
	}
	req := httptest.NewRequest(http.MethodPost, "/files/write", strings.NewReader(mustJSON(t, payload)))
	recorder := httptest.NewRecorder()

	s.handleFileWrite(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	assertNoUnmergedEntries(t, ctx, workspace, path)
}

func TestHandleFileWriteKeepsConflictWhenMarkersRemain(t *testing.T) {
	workspace := t.TempDir()
	ctx := context.Background()
	path := "Notes/Conflict.md"
	createMergeConflict(t, ctx, workspace, path)

	s := &server{workspace: workspace}
	payload := map[string]string{
		"path":    path,
		"content": "<<<<<<< HEAD\nlocal\n=======\nremote\n>>>>>>> incoming\n",
	}
	req := httptest.NewRequest(http.MethodPost, "/files/write", strings.NewReader(mustJSON(t, payload)))
	recorder := httptest.NewRecorder()

	s.handleFileWrite(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	assertHasUnmergedEntries(t, ctx, workspace, path)
}

func TestHandleKbPublishCommitsResolvedMergeWithNoFileDiff(t *testing.T) {
	root := t.TempDir()
	workspace := filepath.Join(root, "workspace")
	remote := filepath.Join(root, "kb.git")
	remoteWork := filepath.Join(root, "remote-work")
	ctx := context.Background()
	path := "Notes/Conflict.md"

	if err := os.MkdirAll(workspace, 0o755); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	runGit(t, ctx, workspace, "init", "-b", "main")
	runGit(t, ctx, workspace, "config", "user.email", "tests@example.com")
	runGit(t, ctx, workspace, "config", "user.name", "Workspace Agent Tests")
	writeWorkspaceTestFile(t, workspace, path, "base\n")
	runGit(t, ctx, workspace, "add", path)
	runGit(t, ctx, workspace, "commit", "-m", "base")

	runGit(t, ctx, root, "init", "--bare", remote)
	runGit(t, ctx, workspace, "remote", "add", "kb", remote)
	runGit(t, ctx, workspace, "push", "-u", "kb", "main")

	runGit(t, ctx, root, "clone", remote, remoteWork)
	runGit(t, ctx, remoteWork, "config", "user.email", "tests@example.com")
	runGit(t, ctx, remoteWork, "config", "user.name", "Workspace Agent Tests")
	writeWorkspaceTestFile(t, remoteWork, path, "remote\n")
	runGit(t, ctx, remoteWork, "commit", "-am", "remote")
	runGit(t, ctx, remoteWork, "push", "origin", "main")

	writeWorkspaceTestFile(t, workspace, path, "local\n")
	runGit(t, ctx, workspace, "commit", "-am", "local")
	runGit(t, ctx, workspace, "fetch", "kb")
	_, _, mergeCode, mergeErr := runCmd(ctx, workspace, []string{"git", "merge", "kb/main", "--no-edit"})
	if mergeErr != nil {
		t.Fatalf("git merge failed to run: %v", mergeErr)
	}
	if mergeCode == 0 {
		t.Fatal("expected merge conflict")
	}

	s := &server{workspace: workspace}
	writePayload := map[string]string{
		"path":    path,
		"content": "local\n",
	}
	writeReq := httptest.NewRequest(http.MethodPost, "/files/write", strings.NewReader(mustJSON(t, writePayload)))
	writeRecorder := httptest.NewRecorder()
	s.handleFileWrite(writeRecorder, writeReq)
	if writeRecorder.Code != http.StatusOK {
		t.Fatalf("write status = %d, body = %s", writeRecorder.Code, writeRecorder.Body.String())
	}
	assertNoUnmergedEntries(t, ctx, workspace, path)

	diffReq := httptest.NewRequest(http.MethodGet, "/git/diffs", nil)
	diffRecorder := httptest.NewRecorder()
	s.handleGitDiffs(diffRecorder, diffReq)
	if diffRecorder.Code != http.StatusOK {
		t.Fatalf("diff status = %d, body = %s", diffRecorder.Code, diffRecorder.Body.String())
	}
	var diffResponse gitDiffResponse
	if err := json.Unmarshal(diffRecorder.Body.Bytes(), &diffResponse); err != nil {
		t.Fatalf("decode diff response: %v", err)
	}
	if len(diffResponse.Diffs) != 1 || diffResponse.Diffs[0].Path != path || diffResponse.Diffs[0].Conflicted {
		t.Fatalf("unexpected resolved merge diffs: %+v", diffResponse.Diffs)
	}
	if !strings.Contains(diffResponse.Diffs[0].Diff, "-remote") || !strings.Contains(diffResponse.Diffs[0].Diff, "+local") {
		t.Fatalf("expected diff against remote side, got %q", diffResponse.Diffs[0].Diff)
	}

	publishReq := httptest.NewRequest(http.MethodPost, "/kb/publish", strings.NewReader("{}"))
	publishRecorder := httptest.NewRecorder()
	s.handleKbPublish(publishRecorder, publishReq)
	if publishRecorder.Code != http.StatusOK {
		t.Fatalf("publish status = %d, body = %s", publishRecorder.Code, publishRecorder.Body.String())
	}

	var response publishKbResponse
	if err := json.Unmarshal(publishRecorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode publish response: %v", err)
	}
	if response.Status != "published" {
		t.Fatalf("publish status = %q, body = %s", response.Status, publishRecorder.Body.String())
	}
	if s.mergeInProgress(ctx) {
		t.Fatal("expected merge to be concluded")
	}
}

func TestHandleKbSyncTurnsLocalChangesIntoResolvableConflicts(t *testing.T) {
	root := t.TempDir()
	workspace := filepath.Join(root, "workspace")
	remote := filepath.Join(root, "kb.git")
	remoteWork := filepath.Join(root, "remote-work")
	ctx := context.Background()
	path := "Notes/Conflict.md"

	if err := os.MkdirAll(workspace, 0o755); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	runGit(t, ctx, workspace, "init", "-b", "main")
	runGit(t, ctx, workspace, "config", "user.email", "tests@example.com")
	runGit(t, ctx, workspace, "config", "user.name", "Workspace Agent Tests")
	writeWorkspaceTestFile(t, workspace, path, "base\n")
	runGit(t, ctx, workspace, "add", path)
	runGit(t, ctx, workspace, "commit", "-m", "base")

	runGit(t, ctx, root, "init", "--bare", remote)
	runGit(t, ctx, workspace, "remote", "add", "kb", remote)
	runGit(t, ctx, workspace, "push", "-u", "kb", "main")

	runGit(t, ctx, root, "clone", remote, remoteWork)
	runGit(t, ctx, remoteWork, "config", "user.email", "tests@example.com")
	runGit(t, ctx, remoteWork, "config", "user.name", "Workspace Agent Tests")
	writeWorkspaceTestFile(t, remoteWork, path, "remote\n")
	runGit(t, ctx, remoteWork, "commit", "-am", "remote")
	runGit(t, ctx, remoteWork, "push", "origin", "main")

	writeWorkspaceTestFile(t, workspace, path, "local\n")
	s := &server{workspace: workspace}
	req := httptest.NewRequest(http.MethodPost, "/kb/sync", strings.NewReader("{}"))
	recorder := httptest.NewRecorder()
	s.handleKbSync(recorder, req)
	if recorder.Code != http.StatusOK {
		t.Fatalf("sync status = %d, body = %s", recorder.Code, recorder.Body.String())
	}

	var response syncKbResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode sync response: %v", err)
	}
	if response.Status != "conflicts" || len(response.Conflicts) != 1 || response.Conflicts[0] != path {
		t.Fatalf("unexpected sync response: %+v", response)
	}
	assertHasUnmergedEntries(t, ctx, workspace, path)
}

func TestHandleFileUploadWritesStreamedFile(t *testing.T) {
	workspace := t.TempDir()
	s := &server{workspace: workspace}

	req := httptest.NewRequest(
		http.MethodPost,
		"/files/upload?path=.arche/attachments/upload.bin",
		strings.NewReader("streamed upload"),
	)
	recorder := httptest.NewRecorder()

	s.handleFileUpload(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}

	var response fileUploadResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if !response.Ok {
		t.Fatalf("expected ok response: %+v", response)
	}
	if response.Path != ".arche/attachments/upload.bin" {
		t.Fatalf("path = %q", response.Path)
	}
	if response.Size != int64(len("streamed upload")) {
		t.Fatalf("size = %d", response.Size)
	}

	expectedSum := sha256.Sum256([]byte("streamed upload"))
	expectedHash := "sha256:" + hex.EncodeToString(expectedSum[:])
	if response.Hash != expectedHash {
		t.Fatalf("hash = %q, want %q", response.Hash, expectedHash)
	}
	if response.ModifiedAt <= 0 {
		t.Fatalf("modifiedAt = %d", response.ModifiedAt)
	}

	data, err := os.ReadFile(filepath.Join(workspace, ".arche", "attachments", "upload.bin"))
	if err != nil {
		t.Fatalf("read uploaded file: %v", err)
	}
	if string(data) != "streamed upload" {
		t.Fatalf("uploaded data = %q", string(data))
	}
}

func TestHandleFileUploadRejectsOversizedBody(t *testing.T) {
	workspace := t.TempDir()
	s := &server{workspace: workspace}

	req := httptest.NewRequest(
		http.MethodPost,
		"/files/upload?path=.arche/attachments/too-big.bin",
		strings.NewReader(strings.Repeat("x", maxUploadBodyBytes+1)),
	)
	req.Header.Set("Content-Length", strconv.Itoa(maxUploadBodyBytes+1))
	recorder := httptest.NewRecorder()

	s.handleFileUpload(recorder, req)

	if recorder.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}

	var response errorResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Error != "file_too_large" {
		t.Fatalf("error = %q", response.Error)
	}
}

func TestHandleFileUploadKeepsExistingFileAndCreatesUniqueName(t *testing.T) {
	workspace := t.TempDir()
	s := &server{workspace: workspace}

	originalPath := filepath.Join(workspace, ".arche", "attachments", "report.pdf")
	if err := os.MkdirAll(filepath.Dir(originalPath), 0o755); err != nil {
		t.Fatalf("create attachments directory: %v", err)
	}
	if err := os.WriteFile(originalPath, []byte("original"), 0o644); err != nil {
		t.Fatalf("write original file: %v", err)
	}

	req := httptest.NewRequest(
		http.MethodPost,
		"/files/upload?path=.arche/attachments/report.pdf",
		strings.NewReader("replacement"),
	)
	recorder := httptest.NewRecorder()

	s.handleFileUpload(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}

	var response fileUploadResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Path != ".arche/attachments/report (1).pdf" {
		t.Fatalf("path = %q", response.Path)
	}

	originalData, err := os.ReadFile(originalPath)
	if err != nil {
		t.Fatalf("read original file: %v", err)
	}
	if string(originalData) != "original" {
		t.Fatalf("original data = %q", string(originalData))
	}

	uploadedData, err := os.ReadFile(filepath.Join(workspace, ".arche", "attachments", "report (1).pdf"))
	if err != nil {
		t.Fatalf("read uploaded file: %v", err)
	}
	if string(uploadedData) != "replacement" {
		t.Fatalf("uploaded data = %q", string(uploadedData))
	}
}

func mustJSON(t *testing.T, value any) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal json: %v", err)
	}
	return string(encoded)
}

func createMergeConflict(t *testing.T, ctx context.Context, workspace string, path string) {
	t.Helper()

	runGit(t, ctx, workspace, "init", "-b", "main")
	runGit(t, ctx, workspace, "config", "user.email", "tests@example.com")
	runGit(t, ctx, workspace, "config", "user.name", "Workspace Agent Tests")

	writeWorkspaceTestFile(t, workspace, path, "base\n")
	runGit(t, ctx, workspace, "add", path)
	runGit(t, ctx, workspace, "commit", "-m", "base")

	runGit(t, ctx, workspace, "checkout", "-b", "incoming")
	writeWorkspaceTestFile(t, workspace, path, "remote\n")
	runGit(t, ctx, workspace, "commit", "-am", "remote")

	runGit(t, ctx, workspace, "checkout", "main")
	writeWorkspaceTestFile(t, workspace, path, "local\n")
	runGit(t, ctx, workspace, "commit", "-am", "local")

	_, _, code, err := runCmd(ctx, workspace, []string{"git", "merge", "incoming"})
	if err != nil {
		t.Fatalf("git merge failed to run: %v", err)
	}
	if code == 0 {
		t.Fatal("expected merge conflict")
	}
	assertHasUnmergedEntries(t, ctx, workspace, path)
}

func writeWorkspaceTestFile(t *testing.T, workspace string, path string, content string) {
	t.Helper()

	absPath := filepath.Join(workspace, filepath.FromSlash(path))
	if err := os.MkdirAll(filepath.Dir(absPath), 0o755); err != nil {
		t.Fatalf("create test file directory: %v", err)
	}
	if err := os.WriteFile(absPath, []byte(content), 0o644); err != nil {
		t.Fatalf("write test file: %v", err)
	}
}

func assertHasUnmergedEntries(t *testing.T, ctx context.Context, workspace string, path string) {
	t.Helper()

	out, stderr, code, err := runCmd(ctx, workspace, []string{"git", "ls-files", "-u", "--", path})
	if err != nil || code != 0 {
		t.Fatalf("git ls-files failed: code=%d err=%v stderr=%s", code, err, stderr)
	}
	if strings.TrimSpace(out) == "" {
		t.Fatal("expected unmerged index entries")
	}
}

func assertNoUnmergedEntries(t *testing.T, ctx context.Context, workspace string, path string) {
	t.Helper()

	out, stderr, code, err := runCmd(ctx, workspace, []string{"git", "ls-files", "-u", "--", path})
	if err != nil || code != 0 {
		t.Fatalf("git ls-files failed: code=%d err=%v stderr=%s", code, err, stderr)
	}
	if strings.TrimSpace(out) != "" {
		t.Fatalf("expected no unmerged index entries, got %q", out)
	}
}
