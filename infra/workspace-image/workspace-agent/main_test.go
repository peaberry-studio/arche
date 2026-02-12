package main

import (
  "context"
  "os"
  "path/filepath"
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

  nestedPath := filepath.Join(workspace, "Outputs", "Comunicaciones", "2026-02-12 - Resumen.md")
  if err := os.MkdirAll(filepath.Dir(nestedPath), 0o755); err != nil {
    t.Fatalf("create nested directory: %v", err)
  }
  if err := os.WriteFile(nestedPath, []byte("contenido\n"), 0o644); err != nil {
    t.Fatalf("write nested file: %v", err)
  }

  s := &server{workspace: workspace}
  entries, err := s.gitStatusEntries(ctx)
  if err != nil {
    t.Fatalf("gitStatusEntries failed: %v", err)
  }

  expected := filepath.ToSlash("Outputs/Comunicaciones/2026-02-12 - Resumen.md")
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
