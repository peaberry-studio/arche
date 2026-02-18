package main

import (
  "encoding/base64"
  "encoding/json"
  "context"
  "net/http"
  "net/http/httptest"
  "os"
  "path/filepath"
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

func mustJSON(t *testing.T, value any) string {
  t.Helper()
  encoded, err := json.Marshal(value)
  if err != nil {
    t.Fatalf("marshal json: %v", err)
  }
  return string(encoded)
}
