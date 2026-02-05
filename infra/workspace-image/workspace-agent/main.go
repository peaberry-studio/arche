package main

import (
  "bytes"
  "context"
  "crypto/sha256"
  "encoding/base64"
  "encoding/hex"
  "encoding/json"
  "errors"
  "flag"
  "io"
  "log"
  "net/http"
  "os"
  "os/exec"
  "path/filepath"
  "strconv"
  "strings"
  "time"
  "unicode/utf8"
)

const (
  defaultAddr      = "0.0.0.0:4097"
  defaultWorkspace = "/workspace"
  maxBodyBytes     = 20 << 20
)

type server struct {
  workspace string
  username  string
  password  string
}

type errorResponse struct {
  Ok    bool   `json:"ok"`
  Error string `json:"error"`
}

type gitDiffEntry struct {
  Path      string `json:"path"`
  Status    string `json:"status"`
  Additions int    `json:"additions"`
  Deletions int    `json:"deletions"`
  Diff      string `json:"diff"`
  Conflicted bool  `json:"conflicted"`
}

type gitDiffResponse struct {
  Ok    bool          `json:"ok"`
  Diffs []gitDiffEntry `json:"diffs"`
}

type gitConflictRequest struct {
  Path string `json:"path"`
}

type gitConflictResponse struct {
  Ok      bool   `json:"ok"`
  Path    string `json:"path"`
  Ours    string `json:"ours"`
  Theirs  string `json:"theirs"`
  Base    string `json:"base,omitempty"`
  Working string `json:"working,omitempty"`
}

type gitResolveRequest struct {
  Path     string `json:"path"`
  Strategy string `json:"strategy"`
  Content  string `json:"content,omitempty"`
}

type gitResolveResponse struct {
  Ok       bool   `json:"ok"`
  Path     string `json:"path"`
  Strategy string `json:"strategy"`
  Message  string `json:"message,omitempty"`
}

type fileReadRequest struct {
  Path string `json:"path"`
}

type fileReadResponse struct {
  Ok       bool   `json:"ok"`
  Path     string `json:"path"`
  Content  string `json:"content"`
  Encoding string `json:"encoding"`
  Hash     string `json:"hash"`
}

type fileWriteRequest struct {
  Path         string `json:"path"`
  Content      string `json:"content"`
  ExpectedHash string `json:"expectedHash"`
}

type fileWriteResponse struct {
  Ok   bool   `json:"ok"`
  Path string `json:"path"`
  Hash string `json:"hash"`
}

type fileDeleteRequest struct {
  Path string `json:"path"`
}

type fileDeleteResponse struct {
  Ok      bool   `json:"ok"`
  Path    string `json:"path"`
  Deleted bool   `json:"deleted"`
}

type fileApplyPatchRequest struct {
  Patch string `json:"patch"`
}

type fileApplyPatchResponse struct {
  Ok bool `json:"ok"`
}

type syncKbResponse struct {
  Ok        bool     `json:"ok"`
  Status    string   `json:"status"`
  Message   string   `json:"message,omitempty"`
  Conflicts []string `json:"conflicts,omitempty"`
}

type syncStatusResponse struct {
  Ok           bool     `json:"ok"`
  HasConflicts bool     `json:"hasConflicts"`
  Conflicts    []string `json:"conflicts,omitempty"`
}

type publishKbResponse struct {
  Ok         bool     `json:"ok"`
  Status     string   `json:"status"`
  CommitHash string   `json:"commitHash,omitempty"`
  Files      []string `json:"files,omitempty"`
  Message    string   `json:"message,omitempty"`
}

func main() {
  addr := flag.String("addr", getenv("WORKSPACE_AGENT_ADDR", defaultAddr), "listen address")
  workspace := flag.String("workspace", getenv("WORKSPACE_DIR", defaultWorkspace), "workspace root")
  flag.Parse()

  username := getenv("WORKSPACE_AGENT_USERNAME", "opencode")
  password := os.Getenv("WORKSPACE_AGENT_PASSWORD")
  if password == "" {
    password = os.Getenv("OPENCODE_SERVER_PASSWORD")
  }

  if password == "" {
    log.Printf("workspace-agent: missing OPENCODE_SERVER_PASSWORD")
    os.Exit(1)
  }

  s := &server{
    workspace: *workspace,
    username:  username,
    password:  password,
  }

  mux := http.NewServeMux()
  mux.HandleFunc("/health", s.withAuth(s.handleHealth))
  mux.HandleFunc("/git/diffs", s.withAuth(s.handleGitDiffs))
  mux.HandleFunc("/git/conflict", s.withAuth(s.handleGitConflict))
  mux.HandleFunc("/git/resolve", s.withAuth(s.handleGitResolve))
  mux.HandleFunc("/files/read", s.withAuth(s.handleFileRead))
  mux.HandleFunc("/files/write", s.withAuth(s.handleFileWrite))
  mux.HandleFunc("/files/delete", s.withAuth(s.handleFileDelete))
  mux.HandleFunc("/files/apply_patch", s.withAuth(s.handleApplyPatch))
  mux.HandleFunc("/kb/sync", s.withAuth(s.handleKbSync))
  mux.HandleFunc("/kb/status", s.withAuth(s.handleKbStatus))
  mux.HandleFunc("/kb/publish", s.withAuth(s.handleKbPublish))

  server := &http.Server{
    Addr:              *addr,
    Handler:           logRequests(mux),
    ReadHeaderTimeout: 5 * time.Second,
    ReadTimeout:       15 * time.Second,
    WriteTimeout:      30 * time.Second,
    IdleTimeout:       60 * time.Second,
  }

  log.Printf("workspace-agent listening on http://%s", *addr)
  if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
    log.Fatalf("workspace-agent failed: %v", err)
  }
}

func (s *server) withAuth(next http.HandlerFunc) http.HandlerFunc {
  return func(w http.ResponseWriter, r *http.Request) {
    username, password, ok := r.BasicAuth()
    if !ok || username != s.username || password != s.password {
      w.Header().Set("WWW-Authenticate", "Basic")
      writeError(w, http.StatusUnauthorized, "unauthorized")
      return
    }
    next(w, r)
  }
}

func (s *server) handleHealth(w http.ResponseWriter, r *http.Request) {
  if r.Method != http.MethodGet {
    writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
    return
  }
  writeJSON(w, http.StatusOK, map[string]any{
    "ok":      true,
    "service": "workspace-agent",
  })
}

func (s *server) handleGitDiffs(w http.ResponseWriter, r *http.Request) {
  if r.Method != http.MethodGet {
    writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
    return
  }

  entries, err := s.gitStatusEntries(r.Context())
  if err != nil {
    writeError(w, http.StatusBadGateway, err.Error())
    return
  }
  if len(entries) == 0 {
    writeJSON(w, http.StatusOK, gitDiffResponse{Ok: true, Diffs: []gitDiffEntry{}})
    return
  }
  diffs := make([]gitDiffEntry, 0, len(entries))

  for _, entry := range entries {
    diffArgs := []string{"git", "diff", "--no-color", "HEAD", "--", entry.Path}
    numstatArgs := []string{"git", "diff", "--numstat", "HEAD", "--", entry.Path}
    if entry.Untracked {
      diffArgs = []string{"git", "diff", "--no-color", "--no-index", "--", "/dev/null", entry.Path}
      numstatArgs = []string{"git", "diff", "--numstat", "--no-index", "--", "/dev/null", entry.Path}
    }

    diffOut, diffErr, diffCode, diffExecErr := runCmd(r.Context(), s.workspace, diffArgs)
    if diffExecErr != nil || diffCode > 1 {
      msg := strings.TrimSpace(diffErr)
      if msg == "" {
        msg = "git_diff_failed"
      }
      writeError(w, http.StatusBadGateway, msg)
      return
    }

    numstatOut, numstatErr, numstatCode, numstatExecErr := runCmd(r.Context(), s.workspace, numstatArgs)
    if numstatExecErr != nil || numstatCode > 1 {
      msg := strings.TrimSpace(numstatErr)
      if msg == "" {
        msg = "git_numstat_failed"
      }
      writeError(w, http.StatusBadGateway, msg)
      return
    }

    additions, deletions := parseNumstat(numstatOut)
    diffs = append(diffs, gitDiffEntry{
      Path:      entry.Path,
      Status:    entry.Status,
      Additions: additions,
      Deletions: deletions,
      Diff:      strings.TrimSpace(diffOut),
      Conflicted: entry.Conflicted,
    })
  }

  writeJSON(w, http.StatusOK, gitDiffResponse{Ok: true, Diffs: diffs})
}

func (s *server) handleGitConflict(w http.ResponseWriter, r *http.Request) {
  if r.Method != http.MethodPost {
    writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
    return
  }

  var req gitConflictRequest
  if err := decodeJSON(w, r, &req); err != nil {
    writeError(w, http.StatusBadRequest, "invalid_json")
    return
  }

  relPath, absPath, err := s.resolveRelPath(req.Path)
  if err != nil {
    writeError(w, http.StatusBadRequest, err.Error())
    return
  }

  entries, _ := s.gitStatusEntries(r.Context(), relPath)
  conflicted := false
  for _, e := range entries {
    if e.Conflicted {
      conflicted = true
      break
    }
  }
  if !conflicted {
    writeError(w, http.StatusNotFound, "not_conflicted")
    return
  }

  ours, err := s.readGitStage(r.Context(), 2, relPath)
  if err != nil {
    writeError(w, http.StatusBadGateway, "git_show_failed")
    return
  }

  theirs, err := s.readGitStage(r.Context(), 3, relPath)
  if err != nil {
    writeError(w, http.StatusBadGateway, "git_show_failed")
    return
  }

  base, err := s.readGitStage(r.Context(), 1, relPath)
  if err != nil {
    writeError(w, http.StatusBadGateway, "git_show_failed")
    return
  }

  working := ""
  if data, err := os.ReadFile(absPath); err == nil {
    working = string(data)
  }

  writeJSON(w, http.StatusOK, gitConflictResponse{
    Ok:      true,
    Path:    req.Path,
    Ours:    ours,
    Theirs:  theirs,
    Base:    base,
    Working: working,
  })
}

func (s *server) handleGitResolve(w http.ResponseWriter, r *http.Request) {
  if r.Method != http.MethodPost {
    writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
    return
  }

  var req gitResolveRequest
  if err := decodeJSON(w, r, &req); err != nil {
    writeError(w, http.StatusBadRequest, "invalid_json")
    return
  }

  relPath, absPath, err := s.resolveRelPath(req.Path)
  if err != nil {
    writeError(w, http.StatusBadRequest, err.Error())
    return
  }

  switch req.Strategy {
  case "ours":
    _, checkoutErr, checkoutCode, checkoutExecErr := runCmd(r.Context(), s.workspace, []string{
      "git", "checkout", "--ours", "--", relPath,
    })
    if checkoutExecErr != nil || checkoutCode != 0 {
      msg := strings.TrimSpace(checkoutErr)
      if msg == "" {
        msg = "git_checkout_failed"
      }
      writeError(w, http.StatusBadGateway, msg)
      return
    }
  case "theirs":
    _, checkoutErr, checkoutCode, checkoutExecErr := runCmd(r.Context(), s.workspace, []string{
      "git", "checkout", "--theirs", "--", relPath,
    })
    if checkoutExecErr != nil || checkoutCode != 0 {
      msg := strings.TrimSpace(checkoutErr)
      if msg == "" {
        msg = "git_checkout_failed"
      }
      writeError(w, http.StatusBadGateway, msg)
      return
    }
  case "manual":
    if err := os.MkdirAll(filepath.Dir(absPath), 0o755); err != nil {
      writeError(w, http.StatusInternalServerError, "mkdir_failed")
      return
    }
    if err := writeFileAtomic(absPath, []byte(req.Content), 0o644); err != nil {
      writeError(w, http.StatusInternalServerError, "write_failed")
      return
    }
  default:
    writeError(w, http.StatusBadRequest, "invalid_strategy")
    return
  }

  _, addErr, addCode, addExecErr := runCmd(r.Context(), s.workspace, []string{
    "git", "add", "--", relPath,
  })
  if addExecErr != nil || addCode != 0 {
    msg := strings.TrimSpace(addErr)
    if msg == "" {
      msg = "git_add_failed"
    }
    writeError(w, http.StatusBadGateway, msg)
    return
  }

  writeJSON(w, http.StatusOK, gitResolveResponse{
    Ok:       true,
    Path:     req.Path,
    Strategy: req.Strategy,
  })
}

func (s *server) handleFileRead(w http.ResponseWriter, r *http.Request) {
  if r.Method != http.MethodPost {
    writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
    return
  }

  var req fileReadRequest
  if err := decodeJSON(w, r, &req); err != nil {
    writeError(w, http.StatusBadRequest, "invalid_json")
    return
  }

  path, err := s.resolvePath(req.Path)
  if err != nil {
    writeError(w, http.StatusBadRequest, err.Error())
    return
  }

  info, err := os.Stat(path)
  if err != nil {
    if os.IsNotExist(err) {
      writeError(w, http.StatusNotFound, "not_found")
      return
    }
    writeError(w, http.StatusInternalServerError, "stat_failed")
    return
  }
  if info.IsDir() {
    writeError(w, http.StatusBadRequest, "is_directory")
    return
  }

  data, err := os.ReadFile(path)
  if err != nil {
    writeError(w, http.StatusInternalServerError, "read_failed")
    return
  }

  content, encoding := encodeContent(data)
  writeJSON(w, http.StatusOK, fileReadResponse{
    Ok:       true,
    Path:     req.Path,
    Content:  content,
    Encoding: encoding,
    Hash:     hashBytes(data),
  })
}

func (s *server) handleFileWrite(w http.ResponseWriter, r *http.Request) {
  if r.Method != http.MethodPost {
    writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
    return
  }

  var req fileWriteRequest
  if err := decodeJSON(w, r, &req); err != nil {
    writeError(w, http.StatusBadRequest, "invalid_json")
    return
  }

  path, err := s.resolvePath(req.Path)
  if err != nil {
    writeError(w, http.StatusBadRequest, err.Error())
    return
  }

  if req.ExpectedHash != "" {
    currentHash, ok, err := verifyExpectedHash(path, req.ExpectedHash)
    if err != nil {
      if errors.Is(err, os.ErrNotExist) {
        writeError(w, http.StatusNotFound, "not_found")
        return
      }
      writeError(w, http.StatusInternalServerError, "hash_check_failed")
      return
    }
    if !ok {
      writeJSON(w, http.StatusConflict, map[string]any{
        "ok":          false,
        "error":       "conflict",
        "currentHash": currentHash,
      })
      return
    }
  }

  if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
    writeError(w, http.StatusInternalServerError, "mkdir_failed")
    return
  }

  if err := writeFileAtomic(path, []byte(req.Content), 0o644); err != nil {
    writeError(w, http.StatusInternalServerError, "write_failed")
    return
  }

  data, err := os.ReadFile(path)
  if err != nil {
    writeError(w, http.StatusInternalServerError, "read_failed")
    return
  }

  writeJSON(w, http.StatusOK, fileWriteResponse{
    Ok:   true,
    Path: req.Path,
    Hash: hashBytes(data),
  })
}

func (s *server) handleFileDelete(w http.ResponseWriter, r *http.Request) {
  if r.Method != http.MethodPost {
    writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
    return
  }

  var req fileDeleteRequest
  if err := decodeJSON(w, r, &req); err != nil {
    writeError(w, http.StatusBadRequest, "invalid_json")
    return
  }

  path, err := s.resolvePath(req.Path)
  if err != nil {
    writeError(w, http.StatusBadRequest, err.Error())
    return
  }

  info, err := os.Stat(path)
  if err != nil {
    if os.IsNotExist(err) {
      writeError(w, http.StatusNotFound, "not_found")
      return
    }
    writeError(w, http.StatusInternalServerError, "stat_failed")
    return
  }
  if info.IsDir() {
    writeError(w, http.StatusBadRequest, "is_directory")
    return
  }

  if err := os.Remove(path); err != nil {
    writeError(w, http.StatusInternalServerError, "delete_failed")
    return
  }

  writeJSON(w, http.StatusOK, fileDeleteResponse{
    Ok:      true,
    Path:    req.Path,
    Deleted: true,
  })
}

func (s *server) handleApplyPatch(w http.ResponseWriter, r *http.Request) {
  if r.Method != http.MethodPost {
    writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
    return
  }

  var req fileApplyPatchRequest
  if err := decodeJSON(w, r, &req); err != nil {
    writeError(w, http.StatusBadRequest, "invalid_json")
    return
  }
  if strings.TrimSpace(req.Patch) == "" {
    writeError(w, http.StatusBadRequest, "empty_patch")
    return
  }

  cmd := exec.CommandContext(r.Context(), "git", "apply", "--whitespace=nowarn", "--")
  cmd.Dir = s.workspace
  cmd.Stdin = strings.NewReader(req.Patch)
  var stdout bytes.Buffer
  var stderr bytes.Buffer
  cmd.Stdout = &stdout
  cmd.Stderr = &stderr

  err := cmd.Run()
  if err != nil {
    msg := strings.TrimSpace(stderr.String())
    if msg == "" {
      msg = "apply_patch_failed"
    }
    writeJSON(w, http.StatusConflict, map[string]any{
      "ok":    false,
      "error": msg,
    })
    return
  }

  writeJSON(w, http.StatusOK, fileApplyPatchResponse{Ok: true})
}

// fetchAndMergeKb fetches from the kb remote and merges the remote branch.
// Returns (ok, conflicts, errMsg). If ok is true the merge succeeded (or there
// was no remote branch yet). If ok is false and conflicts is non-empty the merge
// produced conflicts. Otherwise errMsg describes the failure.
func (s *server) fetchAndMergeKb(ctx context.Context) (bool, []string, string) {
  _, fetchErr, fetchCode, fetchExecErr := runCmd(ctx, s.workspace, []string{
    "git", "fetch", "kb",
  })
  if fetchExecErr != nil || fetchCode != 0 {
    msg := strings.TrimSpace(fetchErr)
    if msg == "" {
      msg = "fetch_failed"
    }
    return false, nil, "Fetch failed: " + msg
  }

  kbBranch := s.resolveKbBranch(ctx)

  if !s.remoteBranchExists(ctx, kbBranch) {
    // First publish — nothing to merge.
    return true, nil, ""
  }

  _, mergeErr, mergeCode, mergeExecErr := runCmd(ctx, s.workspace, []string{
    "git", "merge", "kb/" + kbBranch, "--no-edit",
  })
  if mergeExecErr == nil && mergeCode == 0 {
    return true, nil, ""
  }

  if isUnrelatedHistoryError(mergeErr) {
    _, mergeErrAllow, mergeCodeAllow, mergeExecErrAllow := runCmd(ctx, s.workspace, []string{
      "git", "merge", "kb/" + kbBranch, "--no-edit", "--allow-unrelated-histories",
    })
    if mergeExecErrAllow == nil && mergeCodeAllow == 0 {
      return true, nil, ""
    }

    conflicts := s.listConflictFiles(ctx)
    if len(conflicts) > 0 {
      return false, conflicts, "Merge has conflicts that need to be resolved"
    }

    msg := strings.TrimSpace(mergeErrAllow)
    if msg == "" {
      msg = "merge_failed"
    }
    return false, nil, "Merge failed: " + msg
  }

  conflicts := s.listConflictFiles(ctx)
  if len(conflicts) > 0 {
    return false, conflicts, "Merge has conflicts that need to be resolved"
  }

  msg := strings.TrimSpace(mergeErr)
  if msg == "" {
    msg = "merge_failed"
  }
  return false, nil, "Merge failed: " + msg
}

func (s *server) handleKbSync(w http.ResponseWriter, r *http.Request) {
  if r.Method != http.MethodPost {
    writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
    return
  }

  _, _, remoteCode, remoteExecErr := runCmd(r.Context(), s.workspace, []string{
    "git", "remote", "get-url", "kb",
  })
  if remoteExecErr != nil || remoteCode != 0 {
    writeJSON(w, http.StatusOK, syncKbResponse{
      Ok:      false,
      Status:  "no_remote",
      Message: "KB remote not configured. Workspace may not have been initialized with KB.",
    })
    return
  }

  mergeOk, conflicts, mergeErrMsg := s.fetchAndMergeKb(r.Context())
  if mergeOk {
    writeJSON(w, http.StatusOK, syncKbResponse{
      Ok:      true,
      Status:  "synced",
      Message: "KB synchronized successfully",
    })
    return
  }

  if len(conflicts) > 0 {
    writeJSON(w, http.StatusOK, syncKbResponse{
      Ok:        true,
      Status:    "conflicts",
      Message:   "Merge has conflicts that need to be resolved",
      Conflicts: conflicts,
    })
    return
  }

  writeJSON(w, http.StatusOK, syncKbResponse{
    Ok:      false,
    Status:  "error",
    Message: mergeErrMsg,
  })
}

func (s *server) handleKbStatus(w http.ResponseWriter, r *http.Request) {
  if r.Method != http.MethodGet {
    writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
    return
  }

  conflicts := s.listConflictFiles(r.Context())
  writeJSON(w, http.StatusOK, syncStatusResponse{
    Ok:           true,
    HasConflicts: len(conflicts) > 0,
    Conflicts:    conflicts,
  })
}

func (s *server) handleKbPublish(w http.ResponseWriter, r *http.Request) {
  if r.Method != http.MethodPost {
    writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
    return
  }

  _, _, remoteCode, remoteExecErr := runCmd(r.Context(), s.workspace, []string{
    "git", "remote", "get-url", "kb",
  })
  if remoteExecErr != nil || remoteCode != 0 {
    writeJSON(w, http.StatusOK, publishKbResponse{
      Ok:      false,
      Status:  "no_remote",
      Message: "KB remote not configured.",
    })
    return
  }

  conflicts := s.listConflictFiles(r.Context())
  if len(conflicts) > 0 {
    writeJSON(w, http.StatusOK, publishKbResponse{
      Ok:      false,
      Status:  "conflicts",
      Files:   conflicts,
      Message: "Resolve conflicts before publishing.",
    })
    return
  }

  statusOut, statusErr, statusCode, statusExecErr := runCmd(r.Context(), s.workspace, []string{
    "git", "status", "--porcelain",
  })
  if statusExecErr != nil || statusCode != 0 {
    msg := strings.TrimSpace(statusErr)
    if msg == "" {
      msg = "git_status_failed"
    }
    writeJSON(w, http.StatusOK, publishKbResponse{
      Ok:      false,
      Status:  "error",
      Message: msg,
    })
    return
  }

  if strings.TrimSpace(statusOut) == "" {
    writeJSON(w, http.StatusOK, publishKbResponse{
      Ok:      true,
      Status:  "nothing_to_publish",
      Message: "Nothing to publish.",
    })
    return
  }

  _, addErr, addCode, addExecErr := runCmd(r.Context(), s.workspace, []string{
    "git", "add", "-A",
  })
  if addExecErr != nil || addCode != 0 {
    msg := strings.TrimSpace(addErr)
    if msg == "" {
      msg = "git_add_failed"
    }
    writeJSON(w, http.StatusOK, publishKbResponse{
      Ok:      false,
      Status:  "error",
      Message: "git add failed: " + msg,
    })
    return
  }

  statOut, _, _, _ := runCmd(r.Context(), s.workspace, []string{
    "git", "diff", "--cached", "--stat",
  })
  commitMessage := generateCommitMessage(statOut)

  _, commitErr, commitCode, commitExecErr := runCmd(r.Context(), s.workspace, []string{
    "git", "commit", "-m", commitMessage,
  })
  if commitExecErr != nil || commitCode != 0 {
    msg := strings.TrimSpace(commitErr)
    if msg == "" {
      msg = "git_commit_failed"
    }
    writeJSON(w, http.StatusOK, publishKbResponse{
      Ok:      false,
      Status:  "error",
      Message: "git commit failed: " + msg,
    })
    return
  }

  hashOut, _, _, _ := runCmd(r.Context(), s.workspace, []string{
    "git", "rev-parse", "--short", "HEAD",
  })
  commitHash := strings.TrimSpace(hashOut)

  filesOut, _, _, _ := runCmd(r.Context(), s.workspace, []string{
    "git", "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD",
  })
  files := splitLines(filesOut)

  // Fetch and merge remote before pushing to avoid rejected pushes.
  mergeOk, mergeConflicts, mergeErrMsg := s.fetchAndMergeKb(r.Context())
  if !mergeOk {
    if len(mergeConflicts) > 0 {
      writeJSON(w, http.StatusOK, publishKbResponse{
        Ok:      false,
        Status:  "conflicts",
        Files:   mergeConflicts,
        Message: "Merge conflicts during publish. Resolve and retry.",
      })
      return
    }
    writeJSON(w, http.StatusOK, publishKbResponse{
      Ok:      false,
      Status:  "error",
      Message: mergeErrMsg,
    })
    return
  }

  kbBranch := s.resolveKbBranch(r.Context())
  _, pushErr, pushCode, pushExecErr := runCmd(r.Context(), s.workspace, []string{
    "git", "push", "kb", "HEAD:refs/heads/" + kbBranch,
  })
  if pushExecErr != nil || pushCode != 0 {
    msg := strings.TrimSpace(pushErr)
    if msg == "" {
      msg = "git_push_failed"
    }
    writeJSON(w, http.StatusOK, publishKbResponse{
      Ok:         false,
      Status:     "push_rejected",
      CommitHash: commitHash,
      Files:      files,
      Message:    msg,
    })
    return
  }

  writeJSON(w, http.StatusOK, publishKbResponse{
    Ok:         true,
    Status:     "published",
    CommitHash: commitHash,
    Files:      files,
  })
}

func (s *server) gitStatusEntries(ctx context.Context, paths ...string) ([]gitStatusEntry, error) {
  args := []string{"git", "-c", "core.quotepath=false", "status", "--porcelain=v1", "-z"}
  if len(paths) > 0 {
    args = append(args, "--")
    args = append(args, paths...)
  }
  out, stderr, code, err := runCmd(ctx, s.workspace, args)
  if err != nil || code != 0 {
    msg := strings.TrimSpace(stderr)
    if msg == "" {
      msg = "git_status_failed"
    }
    return nil, errors.New(msg)
  }
  return parseGitStatus(out), nil
}

func (s *server) listConflictFiles(ctx context.Context) []string {
  entries, _ := s.gitStatusEntries(ctx)
  var result []string
  for _, e := range entries {
    if e.Conflicted {
      result = append(result, e.Path)
    }
  }
  return result
}

func isUnrelatedHistoryError(message string) bool {
  msg := strings.ToLower(message)
  return strings.Contains(msg, "unrelated histories")
}

func (s *server) resolveKbBranch(ctx context.Context) string {
  _, _, _, _ = runCmd(ctx, s.workspace, []string{
    "git", "remote", "set-head", "kb", "-a",
  })

  headOut, _, headCode, _ := runCmd(ctx, s.workspace, []string{
    "git", "symbolic-ref", "-q", "--short", "refs/remotes/kb/HEAD",
  })
  headRef := strings.TrimSpace(headOut)
  if headCode == 0 && strings.HasPrefix(headRef, "kb/") {
    branch := strings.TrimPrefix(headRef, "kb/")
    if branch != "" {
      return branch
    }
  }

  if s.remoteBranchExists(ctx, "main") {
    return "main"
  }
  if s.remoteBranchExists(ctx, "master") {
    return "master"
  }

  current := s.currentBranch(ctx)
  if current != "" && s.remoteBranchExists(ctx, current) {
    return current
  }

  return "main"
}

func (s *server) remoteBranchExists(ctx context.Context, branch string) bool {
  _, _, code, _ := runCmd(ctx, s.workspace, []string{
    "git", "show-ref", "--verify", "--quiet", "refs/remotes/kb/" + branch,
  })
  return code == 0
}

func (s *server) currentBranch(ctx context.Context) string {
  out, _, code, _ := runCmd(ctx, s.workspace, []string{
    "git", "rev-parse", "--abbrev-ref", "HEAD",
  })
  if code != 0 {
    return ""
  }
  branch := strings.TrimSpace(out)
  if branch == "" || branch == "HEAD" {
    return ""
  }
  return branch
}

type gitStatusEntry struct {
  Path      string
  Status    string
  Untracked bool
  Conflicted bool
}

func parseGitStatus(output string) []gitStatusEntry {
  raw := []byte(output)
  if len(raw) == 0 {
    return nil
  }
  parts := bytes.Split(raw, []byte{0})
  results := make([]gitStatusEntry, 0, len(parts))
  for i := 0; i < len(parts); i++ {
    entry := parts[i]
    if len(entry) == 0 {
      continue
    }
    // git status --porcelain=v1 -z output is:
    //   XY<space>PATH\0
    // where X and Y can be spaces. Do NOT split on the first space.
    if len(entry) < 4 {
      continue
    }
    statusField := string(entry[:2])
    if statusField == "!!" {
      continue
    }

    // After the two status characters there is a single space.
    // We keep the raw path as-is (no TrimSpace) because it is a filename.
    path := string(entry[3:])

    // For renames/copies, git status -z provides a second NUL-separated path.
    // The first path is the source; the second is the destination.
    if len(statusField) > 0 && (statusField[0] == 'R' || statusField[0] == 'C') {
      if i+1 < len(parts) && len(parts[i+1]) > 0 {
        path = string(parts[i+1])
        i++
      }
    }

    if path == "" {
      continue
    }

    untracked := statusField == "??"
    conflicted := strings.Contains(statusField, "U") || statusField == "AA" || statusField == "DD"
    fileStatus := "modified"
    if untracked || strings.Contains(statusField, "A") || (len(statusField) > 0 && statusField[0] == 'C') {
      fileStatus = "added"
    } else if strings.Contains(statusField, "D") {
      fileStatus = "deleted"
    }

    results = append(results, gitStatusEntry{
      Path:      path,
      Status:    fileStatus,
      Untracked: untracked,
      Conflicted: conflicted,
    })
  }
  return results
}

func parseNumstat(output string) (int, int) {
  line := ""
  for _, candidate := range strings.Split(strings.TrimSpace(output), "\n") {
    if strings.TrimSpace(candidate) != "" {
      line = candidate
      break
    }
  }
  if line == "" {
    return 0, 0
  }
  fields := strings.Split(line, "\t")
  if len(fields) < 2 {
    return 0, 0
  }
  add := parseNum(fields[0])
  del := parseNum(fields[1])
  return add, del
}

func parseNum(value string) int {
  if value == "-" {
    return 0
  }
  parsed, err := strconv.Atoi(value)
  if err != nil {
    return 0
  }
  return parsed
}

func splitLines(output string) []string {
  lines := strings.Split(output, "\n")
  result := make([]string, 0, len(lines))
  for _, line := range lines {
    trimmed := strings.TrimSpace(line)
    if trimmed != "" {
      result = append(result, trimmed)
    }
  }
  return result
}

func generateCommitMessage(statOutput string) string {
  lines := splitLines(statOutput)
  fileNames := make([]string, 0, len(lines))

  for _, line := range lines {
    if !strings.Contains(line, "|") {
      continue
    }
    parts := strings.Split(line, "|")
    if len(parts) == 0 {
      continue
    }
    name := strings.TrimSpace(parts[0])
    if name != "" {
      fileNames = append(fileNames, name)
    }
  }

  if len(fileNames) == 0 {
    return "Update files"
  }
  if len(fileNames) <= 3 {
    return "Update " + strings.Join(fileNames, ", ")
  }
  return "Update " + strconv.Itoa(len(fileNames)) + " files"
}

func runCmd(ctx context.Context, dir string, args []string) (string, string, int, error) {
  if len(args) == 0 {
    return "", "", 1, errors.New("no_command")
  }
  cmd := exec.CommandContext(ctx, args[0], args[1:]...)
  cmd.Dir = dir
  var stdout bytes.Buffer
  var stderr bytes.Buffer
  cmd.Stdout = &stdout
  cmd.Stderr = &stderr
  err := cmd.Run()
  if err != nil {
    var exitErr *exec.ExitError
    if errors.As(err, &exitErr) {
      return stdout.String(), stderr.String(), exitErr.ExitCode(), nil
    }
    return stdout.String(), stderr.String(), 1, err
  }
  return stdout.String(), stderr.String(), 0, nil
}

func (s *server) readGitStage(ctx context.Context, stage int, relPath string) (string, error) {
  spec := ":" + strconv.Itoa(stage) + ":" + relPath
  out, _, code, execErr := runCmd(ctx, s.workspace, []string{
    "git", "show", spec,
  })
  if execErr != nil {
    return "", execErr
  }
  if code != 0 {
    return "", nil
  }
  return out, nil
}

func (s *server) resolveRelPath(rel string) (string, string, error) {
  abs, err := s.resolvePath(rel)
  if err != nil {
    return "", "", err
  }
  workspaceAbs, err := filepath.Abs(s.workspace)
  if err != nil {
    return "", "", errors.New("workspace_invalid")
  }
  relPath, err := filepath.Rel(workspaceAbs, abs)
  if err != nil {
    return "", "", errors.New("invalid_path")
  }
  if relPath == "." || relPath == "" {
    return "", "", errors.New("invalid_path")
  }
  return filepath.ToSlash(relPath), abs, nil
}

func writeFileAtomic(path string, data []byte, perm os.FileMode) error {
  dir := filepath.Dir(path)
  temp, err := os.CreateTemp(dir, ".tmp-*")
  if err != nil {
    return err
  }
  tempName := temp.Name()
  defer os.Remove(tempName)

  if _, err := temp.Write(data); err != nil {
    temp.Close()
    return err
  }
  if err := temp.Chmod(perm); err != nil {
    temp.Close()
    return err
  }
  if err := temp.Close(); err != nil {
    return err
  }
  return os.Rename(tempName, path)
}

func verifyExpectedHash(path string, expected string) (string, bool, error) {
  data, err := os.ReadFile(path)
  if err != nil {
    return "", false, err
  }
  currentHash := hashBytes(data)
  return currentHash, expected == currentHash, nil
}

func hashBytes(data []byte) string {
  sum := sha256.Sum256(data)
  return "sha256:" + hex.EncodeToString(sum[:])
}

func encodeContent(data []byte) (string, string) {
  if utf8.Valid(data) {
    return string(data), "utf-8"
  }
  return base64.StdEncoding.EncodeToString(data), "base64"
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) error {
  r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
  decoder := json.NewDecoder(r.Body)
  if err := decoder.Decode(target); err != nil {
    return err
  }
  if err := decoder.Decode(&struct{}{}); err != nil && !errors.Is(err, io.EOF) {
    return errors.New("unexpected_data")
  }
  return nil
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
  w.Header().Set("Content-Type", "application/json")
  w.WriteHeader(status)
  encoder := json.NewEncoder(w)
  encoder.SetEscapeHTML(false)
  _ = encoder.Encode(payload)
}

func writeError(w http.ResponseWriter, status int, message string) {
  writeJSON(w, status, errorResponse{Ok: false, Error: message})
}

func (s *server) resolvePath(rel string) (string, error) {
  if strings.TrimSpace(rel) == "" {
    return "", errors.New("path_required")
  }
  if strings.Contains(rel, "\x00") {
    return "", errors.New("invalid_path")
  }
  if filepath.IsAbs(rel) {
    return "", errors.New("absolute_paths_not_allowed")
  }

  cleaned := filepath.Clean(rel)
  if cleaned == "." || cleaned == "" {
    return "", errors.New("invalid_path")
  }
  if cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(os.PathSeparator)) {
    return "", errors.New("path_outside_workspace")
  }
  if cleaned == ".git" || strings.HasPrefix(cleaned, ".git"+string(os.PathSeparator)) {
    return "", errors.New("git_dir_not_allowed")
  }

  workspaceAbs, err := filepath.Abs(s.workspace)
  if err != nil {
    return "", errors.New("workspace_invalid")
  }
  abs := filepath.Join(workspaceAbs, cleaned)
  abs, err = filepath.Abs(abs)
  if err != nil {
    return "", errors.New("invalid_path")
  }

  if !strings.HasPrefix(abs+string(os.PathSeparator), workspaceAbs+string(os.PathSeparator)) && abs != workspaceAbs {
    return "", errors.New("path_outside_workspace")
  }
  return abs, nil
}

func getenv(key, fallback string) string {
  value := os.Getenv(key)
  if value == "" {
    return fallback
  }
  return value
}

func logRequests(next http.Handler) http.Handler {
  return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    start := time.Now()
    next.ServeHTTP(w, r)
    log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start))
  })
}
