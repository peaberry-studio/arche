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
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	defaultAddr        = "0.0.0.0:4097"
	defaultWorkspace   = "/workspace"
	maxBodyBytes       = 20 << 20
	maxUploadBodyBytes = 100 << 20
	uploadReadTimeout  = 10 * time.Minute
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
	Path       string `json:"path"`
	Status     string `json:"status"`
	Additions  int    `json:"additions"`
	Deletions  int    `json:"deletions"`
	Diff       string `json:"diff"`
	Conflicted bool   `json:"conflicted"`
}

type gitDiffResponse struct {
	Ok    bool           `json:"ok"`
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

type gitDiscardRequest struct {
	Path string `json:"path"`
}

type gitDiscardResponse struct {
	Ok   bool   `json:"ok"`
	Path string `json:"path"`
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

type fileListRequest struct {
	Path         string `json:"path"`
	Recursive    bool   `json:"recursive"`
	MarkdownOnly bool   `json:"markdownOnly,omitempty"`
	MaxEntries   int    `json:"maxEntries,omitempty"`
}

type fileListEntry struct {
	Path       string `json:"path"`
	Name       string `json:"name"`
	Type       string `json:"type"`
	Size       int64  `json:"size"`
	ModifiedAt int64  `json:"modifiedAt"`
}

type fileListResponse struct {
	Ok      bool            `json:"ok"`
	Entries []fileListEntry `json:"entries"`
}

const maxMarkdownListEntries = 200

var errFileListLimitReached = errors.New("file_list_limit_reached")

type fileWriteRequest struct {
	Path         string `json:"path"`
	Content      string `json:"content"`
	Encoding     string `json:"encoding,omitempty"`
	ExpectedHash string `json:"expectedHash"`
}

type fileWriteResponse struct {
	Ok   bool   `json:"ok"`
	Path string `json:"path"`
	Hash string `json:"hash"`
}

type fileUploadResponse struct {
	Ok         bool   `json:"ok"`
	Path       string `json:"path"`
	Hash       string `json:"hash"`
	Size       int64  `json:"size"`
	ModifiedAt int64  `json:"modifiedAt"`
}

type fileDeleteRequest struct {
	Path string `json:"path"`
}

type fileDeleteResponse struct {
	Ok      bool   `json:"ok"`
	Path    string `json:"path"`
	Deleted bool   `json:"deleted"`
}

type fileRenameRequest struct {
	Path    string `json:"path"`
	NewPath string `json:"newPath"`
}

type fileRenameResponse struct {
	Ok      bool   `json:"ok"`
	Path    string `json:"path"`
	NewPath string `json:"newPath"`
}

type fileApplyPatchRequest struct {
	Patch string `json:"patch"`
}

type fileApplyPatchResponse struct {
	Ok bool `json:"ok"`
}

type syncKbResponse struct {
	Ok            bool     `json:"ok"`
	Status        string   `json:"status"`
	Message       string   `json:"message,omitempty"`
	Conflicts     []string `json:"conflicts,omitempty"`
	GithubStatus  string   `json:"githubStatus,omitempty"`
	GithubMessage string   `json:"githubMessage,omitempty"`
}

type syncStatusResponse struct {
	Ok           bool     `json:"ok"`
	HasConflicts bool     `json:"hasConflicts"`
	Conflicts    []string `json:"conflicts,omitempty"`
}

type publishKbResponse struct {
	Ok            bool     `json:"ok"`
	Status        string   `json:"status"`
	CommitHash    string   `json:"commitHash,omitempty"`
	Files         []string `json:"files,omitempty"`
	Message       string   `json:"message,omitempty"`
	GithubStatus  string   `json:"githubStatus,omitempty"`
	GithubMessage string   `json:"githubMessage,omitempty"`
}

type kbGithubRemoteRequest struct {
	Branch       string `json:"branch,omitempty"`
	RepoCloneUrl string `json:"repoCloneUrl"`
	Token        string `json:"token"`
}

type kbSyncRequest struct {
	Github *kbGithubRemoteRequest `json:"github,omitempty"`
}

type kbPublishRequest struct {
	Github *kbGithubRemoteRequest `json:"github,omitempty"`
}

type kbGithubRemoteConfig struct {
	Branch       string
	RepoCloneUrl string
	Token        string
}

type githubSyncResult struct {
	Ok        bool
	Status    string
	Message   string
	Conflicts []string
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
	mux.HandleFunc("/git/discard", s.withAuth(s.handleGitDiscard))
	mux.HandleFunc("/files/read", s.withAuth(s.handleFileRead))
	mux.HandleFunc("/files/list", s.withAuth(s.handleFileList))
	mux.HandleFunc("/files/upload", s.withAuth(s.handleFileUpload))
	mux.HandleFunc("/files/write", s.withAuth(s.handleFileWrite))
	mux.HandleFunc("/files/delete", s.withAuth(s.handleFileDelete))
	mux.HandleFunc("/files/rename", s.withAuth(s.handleFileRename))
	mux.HandleFunc("/files/apply_patch", s.withAuth(s.handleApplyPatch))
	mux.HandleFunc("/kb/sync", s.withAuth(s.handleKbSync))
	mux.HandleFunc("/kb/status", s.withAuth(s.handleKbStatus))
	mux.HandleFunc("/kb/publish", s.withAuth(s.handleKbPublish))

	server := &http.Server{
		Addr:              *addr,
		Handler:           logRequests(mux),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       uploadReadTimeout,
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
	diffBase := "HEAD"
	if len(entries) == 0 && s.mergeInProgress(r.Context()) {
		entries, err = s.diffEntriesAgainstBase(r.Context(), "MERGE_HEAD")
		if err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		diffBase = "MERGE_HEAD"
	}
	if len(entries) == 0 {
		kbBranch := s.resolveKbBranch(r.Context())
		if s.remoteBranchExists(r.Context(), kbBranch) && s.localHeadDiffersFromKb(r.Context(), kbBranch) {
			diffBase = "kb/" + kbBranch
			entries, err = s.diffEntriesAgainstBase(r.Context(), diffBase)
			if err != nil {
				writeError(w, http.StatusBadGateway, err.Error())
				return
			}
		}
	}
	if len(entries) == 0 {
		writeJSON(w, http.StatusOK, gitDiffResponse{Ok: true, Diffs: []gitDiffEntry{}})
		return
	}
	diffs := make([]gitDiffEntry, 0, len(entries))

	for _, entry := range entries {
		diffArgs := []string{"git", "diff", "--no-color", diffBase, "--", entry.Path}
		numstatArgs := []string{"git", "diff", "--numstat", diffBase, "--", entry.Path}
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
			Path:       entry.Path,
			Status:     entry.Status,
			Additions:  additions,
			Deletions:  deletions,
			Diff:       strings.TrimSpace(diffOut),
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

func (s *server) handleGitDiscard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}

	var req gitDiscardRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}

	relPath, absPath, err := s.resolveRelPath(req.Path)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	entries, statusErr := s.gitStatusEntries(r.Context(), relPath)
	if statusErr != nil {
		writeError(w, http.StatusBadGateway, statusErr.Error())
		return
	}

	var entry *gitStatusEntry
	for i := range entries {
		if entries[i].Path == relPath {
			entry = &entries[i]
			break
		}
	}
	if entry == nil {
		writeError(w, http.StatusNotFound, "not_modified")
		return
	}

	// Untracked files can be safely removed without involving git.
	if entry.Untracked {
		if err := os.Remove(absPath); err != nil && !errors.Is(err, os.ErrNotExist) {
			writeError(w, http.StatusInternalServerError, "delete_failed")
			return
		}
		writeJSON(w, http.StatusOK, gitDiscardResponse{Ok: true, Path: req.Path})
		return
	}

	// Best-effort: clear index state for this path (helps with conflict stages).
	_, resetErrOut, resetCode, resetExecErr := runCmd(r.Context(), s.workspace, []string{
		"git", "reset", "-q", "--", relPath,
	})
	if resetExecErr != nil {
		writeError(w, http.StatusBadGateway, "git_reset_failed")
		return
	}
	if resetCode != 0 {
		msg := strings.TrimSpace(resetErrOut)
		// Ignore common "pathspec" errors (e.g. when the path only exists in the index).
		if msg != "" && !strings.Contains(strings.ToLower(msg), "pathspec") {
			writeError(w, http.StatusBadGateway, msg)
			return
		}
	}

	// If the path exists in HEAD, restore it. Otherwise, drop it from the index and delete it.
	_, _, catCode, _ := runCmd(r.Context(), s.workspace, []string{
		"git", "cat-file", "-e", "HEAD:" + relPath,
	})

	if catCode == 0 {
		_, checkoutErr, checkoutCode, checkoutExecErr := runCmd(r.Context(), s.workspace, []string{
			"git", "checkout", "--", relPath,
		})
		if checkoutExecErr != nil || checkoutCode != 0 {
			msg := strings.TrimSpace(checkoutErr)
			if msg == "" {
				msg = "git_checkout_failed"
			}
			writeError(w, http.StatusBadGateway, msg)
			return
		}

		writeJSON(w, http.StatusOK, gitDiscardResponse{Ok: true, Path: req.Path})
		return
	}

	// New tracked file (not in HEAD).
	_, rmErr, rmCode, rmExecErr := runCmd(r.Context(), s.workspace, []string{
		"git", "rm", "-f", "--cached", "--", relPath,
	})
	if rmExecErr != nil {
		writeError(w, http.StatusBadGateway, "git_rm_failed")
		return
	}
	if rmCode != 0 {
		// If it wasn't in the index, keep going.
		_ = rmErr
	}

	if err := os.Remove(absPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		writeError(w, http.StatusInternalServerError, "delete_failed")
		return
	}
	writeJSON(w, http.StatusOK, gitDiscardResponse{Ok: true, Path: req.Path})
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
	if err := s.ensurePathWithinWorkspace(path); err != nil {
		writeError(w, http.StatusForbidden, err.Error())
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

func (s *server) handleFileList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}

	var req fileListRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}

	path := s.workspace
	if strings.TrimSpace(req.Path) != "" {
		var err error
		path, err = s.resolvePath(req.Path)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	if err := s.ensurePathWithinWorkspace(path); err != nil {
		writeError(w, http.StatusForbidden, err.Error())
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
	if !info.IsDir() {
		writeError(w, http.StatusBadRequest, "not_directory")
		return
	}

	workspaceAbs, err := filepath.Abs(s.workspace)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "workspace_invalid")
		return
	}

	maxEntries := 0
	if req.MarkdownOnly {
		maxEntries = req.MaxEntries
		if maxEntries <= 0 || maxEntries > maxMarkdownListEntries {
			maxEntries = maxMarkdownListEntries
		}
	}

	entries := make([]fileListEntry, 0)
	appendEntry := func(absPath string, entryInfo os.FileInfo) error {
		if req.MarkdownOnly && (!entryInfo.Mode().IsRegular() || !strings.EqualFold(filepath.Ext(entryInfo.Name()), ".md")) {
			return nil
		}
		rel, relErr := filepath.Rel(workspaceAbs, absPath)
		if relErr != nil {
			return relErr
		}

		entryType := "file"
		size := entryInfo.Size()
		if entryInfo.IsDir() {
			entryType = "directory"
			size = 0
		}

		entries = append(entries, fileListEntry{
			Path:       filepath.ToSlash(rel),
			Name:       entryInfo.Name(),
			Type:       entryType,
			Size:       size,
			ModifiedAt: entryInfo.ModTime().UnixMilli(),
		})
		return nil
	}

	if req.Recursive {
		walkErr := filepath.WalkDir(path, func(currentPath string, dirEntry os.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if currentPath == path {
				return nil
			}
			if req.MarkdownOnly && dirEntry.IsDir() {
				switch dirEntry.Name() {
				case ".arche", ".git", "node_modules":
					return filepath.SkipDir
				}
			}

			entryInfo, infoErr := dirEntry.Info()
			if infoErr != nil {
				return infoErr
			}

			if appendErr := appendEntry(currentPath, entryInfo); appendErr != nil {
				return appendErr
			}
			if maxEntries > 0 && len(entries) >= maxEntries {
				return errFileListLimitReached
			}
			return nil
		})
		if walkErr != nil && !errors.Is(walkErr, errFileListLimitReached) {
			writeError(w, http.StatusInternalServerError, "list_failed")
			return
		}
	} else {
		dirEntries, readErr := os.ReadDir(path)
		if readErr != nil {
			writeError(w, http.StatusInternalServerError, "list_failed")
			return
		}

		for _, dirEntry := range dirEntries {
			entryInfo, infoErr := dirEntry.Info()
			if infoErr != nil {
				writeError(w, http.StatusInternalServerError, "list_failed")
				return
			}

			entryPath := filepath.Join(path, dirEntry.Name())
			if appendErr := appendEntry(entryPath, entryInfo); appendErr != nil {
				writeError(w, http.StatusInternalServerError, "list_failed")
				return
			}
			if maxEntries > 0 && len(entries) >= maxEntries {
				break
			}
		}
	}

	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Path < entries[j].Path
	})

	writeJSON(w, http.StatusOK, fileListResponse{
		Ok:      true,
		Entries: entries,
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
	if err := s.ensurePathWithinWorkspace(path); err != nil {
		writeError(w, http.StatusForbidden, err.Error())
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

	if req.Encoding != "" && req.Encoding != "utf-8" && req.Encoding != "base64" {
		writeError(w, http.StatusBadRequest, "invalid_encoding")
		return
	}

	decodedContent := []byte(req.Content)
	if req.Encoding == "base64" {
		binaryContent, decodeErr := base64.StdEncoding.DecodeString(req.Content)
		if decodeErr != nil {
			writeError(w, http.StatusBadRequest, "invalid_base64")
			return
		}
		decodedContent = binaryContent
	}

	if err := writeFileAtomic(path, decodedContent, 0o644); err != nil {
		writeError(w, http.StatusInternalServerError, "write_failed")
		return
	}

	relPath, relErr := s.relPathForAbs(path)
	if relErr != nil {
		writeError(w, http.StatusBadRequest, relErr.Error())
		return
	}
	if err := s.stageResolvedFileIfConflicted(r.Context(), relPath, decodedContent); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
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

func (s *server) handleFileUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}

	_, absPath, err := s.resolveRelPath(r.URL.Query().Get("path"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := os.MkdirAll(filepath.Dir(absPath), 0o755); err != nil {
		writeError(w, http.StatusInternalServerError, "mkdir_failed")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBodyBytes)
	uploadResult, err := writeStreamFileAtomic(absPath, r.Body, 0o644)
	if err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			writeError(w, http.StatusRequestEntityTooLarge, "file_too_large")
			return
		}
		if errors.Is(r.Context().Err(), context.Canceled) {
			writeError(w, http.StatusRequestTimeout, "upload_canceled")
			return
		}

		writeError(w, http.StatusInternalServerError, "write_failed")
		return
	}

	uploadedRelPath, err := s.relPathForAbs(uploadResult.Path)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "stat_failed")
		return
	}

	info, err := os.Stat(uploadResult.Path)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "stat_failed")
		return
	}

	writeJSON(w, http.StatusOK, fileUploadResponse{
		Ok:         true,
		Path:       uploadedRelPath,
		Hash:       uploadResult.Hash,
		Size:       uploadResult.Size,
		ModifiedAt: info.ModTime().UnixMilli(),
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
	if err := s.ensurePathWithinWorkspace(path); err != nil {
		writeError(w, http.StatusForbidden, err.Error())
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

func (s *server) handleFileRename(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}

	var req fileRenameRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}

	oldPath, err := s.resolvePath(req.Path)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.ensurePathWithinWorkspace(oldPath); err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}
	newPath, err := s.resolvePath(req.NewPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.ensurePathWithinWorkspace(newPath); err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}

	oldInfo, err := os.Stat(oldPath)
	if err != nil {
		if os.IsNotExist(err) {
			writeError(w, http.StatusNotFound, "not_found")
			return
		}
		writeError(w, http.StatusInternalServerError, "stat_failed")
		return
	}
	if oldInfo.IsDir() {
		writeError(w, http.StatusBadRequest, "is_directory")
		return
	}

	if oldPath == newPath {
		writeJSON(w, http.StatusOK, fileRenameResponse{
			Ok:      true,
			Path:    req.Path,
			NewPath: req.NewPath,
		})
		return
	}

	if _, err := os.Stat(newPath); err == nil {
		writeError(w, http.StatusConflict, "already_exists")
		return
	} else if !errors.Is(err, os.ErrNotExist) {
		writeError(w, http.StatusInternalServerError, "stat_failed")
		return
	}

	if err := os.MkdirAll(filepath.Dir(newPath), 0o755); err != nil {
		writeError(w, http.StatusInternalServerError, "mkdir_failed")
		return
	}

	if err := os.Rename(oldPath, newPath); err != nil {
		writeError(w, http.StatusInternalServerError, "rename_failed")
		return
	}

	writeJSON(w, http.StatusOK, fileRenameResponse{
		Ok:      true,
		Path:    req.Path,
		NewPath: req.NewPath,
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

	var req kbSyncRequest
	if err := decodeOptionalJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}

	githubRemote, hasGithubRemote, githubConfigErr := normalizeGithubRemote(req.Github)
	if githubConfigErr != "" {
		writeJSON(w, http.StatusOK, syncKbResponse{
			Ok:      false,
			Status:  "error",
			Message: githubConfigErr,
		})
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

	conflicts := s.listConflictFiles(r.Context())
	if len(conflicts) > 0 {
		writeJSON(w, http.StatusOK, syncKbResponse{
			Ok:        true,
			Status:    "conflicts",
			Message:   "Merge has conflicts that need to be resolved",
			Conflicts: conflicts,
		})
		return
	}

	if _, _, commitErrMsg := s.commitWorkspaceChangesIfNeeded(r.Context()); commitErrMsg != "" {
		writeJSON(w, http.StatusOK, syncKbResponse{
			Ok:      false,
			Status:  "error",
			Message: commitErrMsg,
		})
		return
	}

	mergeOk, conflicts, mergeErrMsg := s.fetchAndMergeKb(r.Context())
	if mergeOk {
		if hasGithubRemote {
			githubResult := s.syncGithubRemote(r.Context(), githubRemote)
			if !githubResult.Ok {
				status := "error"
				if githubResult.Status == "conflicts" {
					status = "conflicts"
				}
				writeJSON(w, http.StatusOK, syncKbResponse{
					Ok:            status == "conflicts",
					Status:        status,
					Message:       githubResult.Message,
					Conflicts:     githubResult.Conflicts,
					GithubStatus:  githubResult.Status,
					GithubMessage: githubResult.Message,
				})
				return
			}

			writeJSON(w, http.StatusOK, syncKbResponse{
				Ok:           true,
				Status:       "synced",
				Message:      "KB synchronized successfully",
				GithubStatus: githubResult.Status,
			})
			return
		}

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

	var req kbPublishRequest
	if err := decodeOptionalJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}

	githubRemote, hasGithubRemote, githubConfigErr := normalizeGithubRemote(req.Github)
	if githubConfigErr != "" {
		writeJSON(w, http.StatusOK, publishKbResponse{
			Ok:      false,
			Status:  "error",
			Message: githubConfigErr,
		})
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

	committedLocalChanges, files, commitErrMsg := s.commitWorkspaceChangesIfNeeded(r.Context())
	if commitErrMsg != "" {
		writeJSON(w, http.StatusOK, publishKbResponse{
			Ok:      false,
			Status:  "error",
			Message: commitErrMsg,
		})
		return
	}

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
	if hasGithubRemote {
		githubResult := s.syncGithubRemote(r.Context(), githubRemote)
		if !githubResult.Ok {
			status := "error"
			resultFiles := files
			if githubResult.Status == "conflicts" {
				status = "conflicts"
				resultFiles = githubResult.Conflicts
			} else if githubResult.Status == "push_rejected" {
				status = "push_rejected"
			}

			writeJSON(w, http.StatusOK, publishKbResponse{
				Ok:            false,
				Status:        status,
				Files:         resultFiles,
				Message:       githubResult.Message,
				GithubStatus:  githubResult.Status,
				GithubMessage: githubResult.Message,
			})
			return
		}

		if files == nil || len(files) == 0 {
			files = s.changedFilesToPublish(r.Context(), kbBranch)
		}

		hashOut, _, _, _ := runCmd(r.Context(), s.workspace, []string{
			"git", "rev-parse", "--short", "HEAD",
		})
		commitHash := strings.TrimSpace(hashOut)
		status := "published"
		if !committedLocalChanges && githubResult.Status == "up_to_date" {
			status = "nothing_to_publish"
		}

		writeJSON(w, http.StatusOK, publishKbResponse{
			Ok:           true,
			Status:       status,
			CommitHash:   commitHash,
			Files:        files,
			GithubStatus: githubResult.Status,
		})
		return
	}

	if !s.localHeadDiffersFromKb(r.Context(), kbBranch) {
		writeJSON(w, http.StatusOK, publishKbResponse{
			Ok:      true,
			Status:  "nothing_to_publish",
			Message: "Nothing to publish.",
		})
		return
	}

	if len(files) == 0 {
		files = s.changedFilesToPublish(r.Context(), kbBranch)
	}

	hashOut, _, _, _ := runCmd(r.Context(), s.workspace, []string{
		"git", "rev-parse", "--short", "HEAD",
	})
	commitHash := strings.TrimSpace(hashOut)

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
	args := []string{"git", "-c", "core.quotepath=false", "status", "--porcelain=v1", "-z", "--untracked-files=all"}
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

func (s *server) mergeInProgress(ctx context.Context) bool {
	_, _, code, execErr := runCmd(ctx, s.workspace, []string{
		"git", "rev-parse", "-q", "--verify", "MERGE_HEAD",
	})
	return execErr == nil && code == 0
}

func (s *server) diffEntriesAgainstBase(ctx context.Context, base string) ([]gitStatusEntry, error) {
	out, stderr, code, err := runCmd(ctx, s.workspace, []string{
		"git", "diff", "--name-only", "-z", base, "--",
	})
	if err != nil || code != 0 {
		msg := strings.TrimSpace(stderr)
		if msg == "" {
			msg = "git_diff_failed"
		}
		return nil, errors.New(msg)
	}

	parts := bytes.Split([]byte(out), []byte{0})
	entries := make([]gitStatusEntry, 0, len(parts))
	seen := map[string]bool{}
	for _, part := range parts {
		path := string(part)
		if path == "" || seen[path] || isInternalWorkspacePath(path) {
			continue
		}
		seen[path] = true

		status := "modified"
		if _, statErr := os.Stat(filepath.Join(s.workspace, filepath.FromSlash(path))); errors.Is(statErr, os.ErrNotExist) {
			status = "deleted"
		}
		entries = append(entries, gitStatusEntry{Path: path, Status: status})
	}

	return entries, nil
}

func (s *server) commitWorkspaceChangesIfNeeded(ctx context.Context) (bool, []string, string) {
	entries, statusErr := s.gitStatusEntries(ctx)
	if statusErr != nil {
		return false, nil, statusErr.Error()
	}

	if len(entries) == 0 && !s.mergeInProgress(ctx) {
		return false, []string{}, ""
	}

	_, addErr, addCode, addExecErr := runCmd(ctx, s.workspace, []string{
		"git", "add", "-A",
	})
	if addExecErr != nil || addCode != 0 {
		msg := strings.TrimSpace(addErr)
		if msg == "" {
			msg = "git_add_failed"
		}
		return false, nil, "git add failed: " + msg
	}

	statOut, _, _, _ := runCmd(ctx, s.workspace, []string{
		"git", "diff", "--cached", "--stat",
	})
	commitMessage := generateCommitMessage(statOut)

	_, commitErr, commitCode, commitExecErr := runCmd(ctx, s.workspace, []string{
		"git", "commit", "-m", commitMessage,
	})
	if commitExecErr != nil || commitCode != 0 {
		msg := strings.TrimSpace(commitErr)
		if msg == "" {
			msg = "git_commit_failed"
		}
		return false, nil, "git commit failed: " + msg
	}

	filesOut, _, _, _ := runCmd(ctx, s.workspace, []string{
		"git", "diff-tree", "--no-commit-id", "--name-only", "-r", "-m", "HEAD",
	})
	return true, splitUniqueLines(filesOut), ""
}

func (s *server) stageResolvedFileIfConflicted(ctx context.Context, relPath string, content []byte) error {
	if hasGitConflictBoundary(content) {
		return nil
	}

	entries, statusErr := s.gitStatusEntries(ctx, relPath)
	if statusErr != nil {
		return nil
	}

	conflicted := false
	for _, entry := range entries {
		if entry.Path == relPath && entry.Conflicted {
			conflicted = true
			break
		}
	}
	if !conflicted {
		return nil
	}

	_, addErr, addCode, addExecErr := runCmd(ctx, s.workspace, []string{
		"git", "add", "--", relPath,
	})
	if addExecErr != nil || addCode != 0 {
		msg := strings.TrimSpace(addErr)
		if msg == "" {
			msg = "git_add_failed"
		}
		return errors.New(msg)
	}

	return nil
}

func hasGitConflictBoundary(content []byte) bool {
	for _, line := range bytes.Split(content, []byte{'\n'}) {
		line = bytes.TrimSuffix(line, []byte{'\r'})
		if bytes.HasPrefix(line, []byte("<<<<<<<")) || bytes.HasPrefix(line, []byte(">>>>>>>")) {
			return true
		}
	}
	return false
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

func (s *server) localHeadDiffersFromKb(ctx context.Context, branch string) bool {
	headOut, _, headCode, _ := runCmd(ctx, s.workspace, []string{
		"git", "rev-parse", "HEAD",
	})
	if headCode != 0 {
		return false
	}
	head := strings.TrimSpace(headOut)
	if head == "" {
		return false
	}
	if !s.remoteBranchExists(ctx, branch) {
		return true
	}

	remoteOut, _, remoteCode, _ := runCmd(ctx, s.workspace, []string{
		"git", "rev-parse", "refs/remotes/kb/" + branch,
	})
	return remoteCode != 0 || head != strings.TrimSpace(remoteOut)
}

func (s *server) changedFilesToPublish(ctx context.Context, branch string) []string {
	if s.remoteBranchExists(ctx, branch) {
		filesOut, _, code, _ := runCmd(ctx, s.workspace, []string{
			"git", "diff", "--name-only", "kb/" + branch + "...HEAD",
		})
		if code == 0 {
			files := splitLines(filesOut)
			if len(files) > 0 {
				return files
			}
		}
	}

	filesOut, _, code, _ := runCmd(ctx, s.workspace, []string{
		"git", "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD",
	})
	if code != 0 {
		return nil
	}
	return splitLines(filesOut)
}

func normalizeGithubRemote(req *kbGithubRemoteRequest) (kbGithubRemoteConfig, bool, string) {
	if req == nil {
		return kbGithubRemoteConfig{}, false, ""
	}

	repoCloneUrl := strings.TrimSpace(req.RepoCloneUrl)
	token := strings.TrimSpace(req.Token)
	branch := strings.TrimSpace(req.Branch)
	if branch == "" {
		branch = "main"
	}

	if repoCloneUrl == "" || token == "" {
		return kbGithubRemoteConfig{}, false, "github_remote_incomplete"
	}
	if !isGithubCloneUrl(repoCloneUrl) {
		return kbGithubRemoteConfig{}, false, "github_remote_invalid_url"
	}
	if !isSafeGitBranch(branch) {
		return kbGithubRemoteConfig{}, false, "github_branch_invalid"
	}

	return kbGithubRemoteConfig{
		Branch:       branch,
		RepoCloneUrl: repoCloneUrl,
		Token:        token,
	}, true, ""
}

func isGithubCloneUrl(raw string) bool {
	parsed, err := url.Parse(raw)
	if err != nil {
		return false
	}
	return parsed.Scheme == "https" && strings.EqualFold(parsed.Host, "github.com") && parsed.Path != ""
}

func isSafeGitBranch(branch string) bool {
	if branch == "" || strings.HasPrefix(branch, "-") || strings.HasPrefix(branch, "/") || strings.HasSuffix(branch, "/") || strings.HasSuffix(branch, ".") {
		return false
	}
	if strings.Contains(branch, "..") || strings.Contains(branch, "//") || strings.Contains(branch, "@{") {
		return false
	}
	for _, r := range branch {
		if r <= ' ' || strings.ContainsRune("~^:?*[\\", r) {
			return false
		}
	}
	return true
}

func (s *server) syncGithubRemote(ctx context.Context, remote kbGithubRemoteConfig) githubSyncResult {
	if msg := s.ensureNamedRemote(ctx, "github", remote.RepoCloneUrl); msg != "" {
		return githubSyncResult{Ok: false, Status: "error", Message: msg}
	}

	fetchStatus, fetchMessage := s.fetchGithubBranch(ctx, remote)
	if fetchStatus == "auth_failed" || fetchStatus == "error" {
		return githubSyncResult{Ok: false, Status: fetchStatus, Message: fetchMessage}
	}

	if fetchStatus == "missing" {
		kbBranch := s.resolveKbBranch(ctx)
		if msg := s.pushCurrentToKb(ctx, kbBranch); msg != "" {
			return githubSyncResult{Ok: false, Status: "error", Message: msg}
		}
		return s.pushCurrentToGithub(ctx, remote)
	}

	mergeOk, mergeChanged, conflicts, mergeMessage := s.mergeRemoteTrackingBranch(ctx, "github", remote.Branch)
	if !mergeOk {
		if len(conflicts) > 0 {
			return githubSyncResult{
				Ok:        false,
				Status:    "conflicts",
				Message:   "Merge has conflicts that need to be resolved",
				Conflicts: conflicts,
			}
		}
		return githubSyncResult{Ok: false, Status: "error", Message: mergeMessage}
	}

	kbBranch := s.resolveKbBranch(ctx)
	if s.localHeadDiffersFromKb(ctx, kbBranch) {
		if msg := s.pushCurrentToKb(ctx, kbBranch); msg != "" {
			return githubSyncResult{Ok: false, Status: "error", Message: msg}
		}
	}

	pushResult := s.pushCurrentToGithub(ctx, remote)
	if pushResult.Ok && pushResult.Status == "up_to_date" && mergeChanged {
		pushResult.Status = "pulled"
	}
	return pushResult
}

func (s *server) ensureNamedRemote(ctx context.Context, name string, remoteUrl string) string {
	_, _, remoteCode, remoteExecErr := runCmd(ctx, s.workspace, []string{
		"git", "remote", "get-url", name,
	})
	if remoteExecErr == nil && remoteCode == 0 {
		_, stderr, code, execErr := runCmd(ctx, s.workspace, []string{
			"git", "remote", "set-url", name, remoteUrl,
		})
		if execErr == nil && code == 0 {
			return ""
		}
		msg := strings.TrimSpace(stderr)
		if msg == "" {
			msg = "remote_set_url_failed"
		}
		return msg
	}

	_, stderr, code, execErr := runCmd(ctx, s.workspace, []string{
		"git", "remote", "add", name, remoteUrl,
	})
	if execErr == nil && code == 0 {
		return ""
	}
	msg := strings.TrimSpace(stderr)
	if msg == "" {
		msg = "remote_add_failed"
	}
	return msg
}

func (s *server) fetchGithubBranch(ctx context.Context, remote kbGithubRemoteConfig) (string, string) {
	_, stderr, code, execErr := runGithubGit(ctx, s.workspace, remote.Token,
		"fetch", "github", "+refs/heads/"+remote.Branch+":refs/remotes/github/"+remote.Branch,
	)
	if execErr == nil && code == 0 {
		return "ok", ""
	}

	msg := sanitizeGithubMessage(strings.TrimSpace(stderr), remote.Token)
	if msg == "" {
		msg = "github_fetch_failed"
	}
	if isMissingRemoteRef(msg) {
		return "missing", "GitHub repository has no selected branch yet."
	}
	if isGithubAuthFailure(msg) {
		return "auth_failed", "GitHub authentication failed or repository access was denied."
	}
	return "error", "GitHub fetch failed: " + msg
}

func (s *server) mergeRemoteTrackingBranch(ctx context.Context, remote string, branch string) (bool, bool, []string, string) {
	stdout, stderr, code, execErr := runCmd(ctx, s.workspace, []string{
		"git", "merge", remote + "/" + branch, "--no-edit",
	})
	if execErr == nil && code == 0 {
		changed := !strings.Contains(strings.ToLower(stdout+stderr), "already up to date")
		return true, changed, nil, ""
	}

	if isUnrelatedHistoryError(stderr) {
		stdoutAllow, stderrAllow, codeAllow, execErrAllow := runCmd(ctx, s.workspace, []string{
			"git", "merge", remote + "/" + branch, "--no-edit", "--allow-unrelated-histories",
		})
		if execErrAllow == nil && codeAllow == 0 {
			changed := !strings.Contains(strings.ToLower(stdoutAllow+stderrAllow), "already up to date")
			return true, changed, nil, ""
		}

		conflicts := s.listConflictFiles(ctx)
		if len(conflicts) > 0 {
			return false, false, conflicts, "Merge has conflicts that need to be resolved"
		}

		msg := strings.TrimSpace(stderrAllow)
		if msg == "" {
			msg = "merge_failed"
		}
		return false, false, nil, "Merge failed: " + msg
	}

	conflicts := s.listConflictFiles(ctx)
	if len(conflicts) > 0 {
		return false, false, conflicts, "Merge has conflicts that need to be resolved"
	}

	msg := strings.TrimSpace(stderr)
	if msg == "" {
		msg = "merge_failed"
	}
	return false, false, nil, "Merge failed: " + msg
}

func (s *server) pushCurrentToKb(ctx context.Context, branch string) string {
	_, stderr, code, execErr := runCmd(ctx, s.workspace, []string{
		"git", "push", "kb", "HEAD:refs/heads/" + branch,
	})
	if execErr == nil && code == 0 {
		return ""
	}
	msg := strings.TrimSpace(stderr)
	if msg == "" {
		msg = "git_push_failed"
	}
	return "KB push failed: " + msg
}

func (s *server) pushCurrentToGithub(ctx context.Context, remote kbGithubRemoteConfig) githubSyncResult {
	stdout, stderr, code, execErr := runGithubGit(ctx, s.workspace, remote.Token,
		"push", "github", "HEAD:refs/heads/"+remote.Branch,
	)
	combined := sanitizeGithubMessage(strings.TrimSpace(stdout+"\n"+stderr), remote.Token)
	if execErr == nil && code == 0 {
		if strings.Contains(combined, "Everything up-to-date") {
			return githubSyncResult{Ok: true, Status: "up_to_date"}
		}
		return githubSyncResult{Ok: true, Status: "pushed"}
	}

	msg := combined
	if msg == "" {
		msg = "github_push_failed"
	}
	if isGithubAuthFailure(msg) {
		return githubSyncResult{Ok: false, Status: "auth_failed", Message: "GitHub authentication failed or repository access was denied."}
	}
	if strings.Contains(strings.ToLower(msg), "non-fast-forward") || strings.Contains(strings.ToLower(msg), "rejected") {
		return githubSyncResult{Ok: false, Status: "push_rejected", Message: msg}
	}
	return githubSyncResult{Ok: false, Status: "error", Message: "GitHub push failed: " + msg}
}

func runGithubGit(ctx context.Context, dir string, token string, args ...string) (string, string, int, error) {
	command := append([]string{"git"}, args...)
	return runCmdWithEnv(ctx, dir, command, githubGitEnv(token))
}

func githubGitEnv(token string) []string {
	credential := base64.StdEncoding.EncodeToString([]byte("x-access-token:" + token))
	return []string{
		"GIT_CONFIG_COUNT=1",
		"GIT_CONFIG_KEY_0=http.extraheader",
		"GIT_CONFIG_VALUE_0=AUTHORIZATION: basic " + credential,
		"GIT_TERMINAL_PROMPT=0",
	}
}

func sanitizeGithubMessage(message string, token string) string {
	if token == "" {
		return message
	}
	credential := base64.StdEncoding.EncodeToString([]byte("x-access-token:" + token))
	message = strings.ReplaceAll(message, token, "***")
	message = strings.ReplaceAll(message, credential, "***")
	return message
}

func isMissingRemoteRef(message string) bool {
	lower := strings.ToLower(message)
	return strings.Contains(lower, "couldn't find remote ref") || strings.Contains(lower, "could not find remote ref")
}

func isGithubAuthFailure(message string) bool {
	lower := strings.ToLower(message)
	return strings.Contains(lower, "authentication failed") ||
		strings.Contains(lower, "could not read username") ||
		strings.Contains(lower, "invalid credentials") ||
		strings.Contains(lower, "repository not found") ||
		strings.Contains(lower, "403") ||
		strings.Contains(lower, "401") ||
		strings.Contains(lower, "permission denied")
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
	Path       string
	Status     string
	Untracked  bool
	Conflicted bool
}

func isInternalWorkspacePath(path string) bool {
	// NOTE: This is the Go equivalent of @/lib/workspace-paths.ts normalizeWorkspacePath + isInternalWorkspacePath.
	// Keep both implementations in sync when changing path normalization rules.
	normalized := filepath.ToSlash(path)
	normalized = strings.TrimPrefix(normalized, "./")
	normalized = strings.TrimPrefix(normalized, "/")
	for strings.Contains(normalized, "//") {
		normalized = strings.ReplaceAll(normalized, "//", "/")
	}
	return normalized == ".arche" || strings.HasPrefix(normalized, ".arche/")
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
		if isInternalWorkspacePath(path) {
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
			Path:       path,
			Status:     fileStatus,
			Untracked:  untracked,
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

func splitUniqueLines(output string) []string {
	lines := splitLines(output)
	seen := map[string]bool{}
	result := make([]string, 0, len(lines))
	for _, line := range lines {
		if seen[line] {
			continue
		}
		seen[line] = true
		result = append(result, line)
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
	return runCmdWithEnv(ctx, dir, args, nil)
}

func runCmdWithEnv(ctx context.Context, dir string, args []string, env []string) (string, string, int, error) {
	if len(args) == 0 {
		return "", "", 1, errors.New("no_command")
	}
	cmd := exec.CommandContext(ctx, args[0], args[1:]...)
	cmd.Dir = dir
	if len(env) > 0 {
		cmd.Env = append(os.Environ(), env...)
	}
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
	relPath, err := s.relPathForAbs(abs)
	if err != nil {
		return "", "", err
	}
	return relPath, abs, nil
}

func (s *server) relPathForAbs(abs string) (string, error) {
	workspaceAbs, err := filepath.Abs(s.workspace)
	if err != nil {
		return "", errors.New("workspace_invalid")
	}
	relPath, err := filepath.Rel(workspaceAbs, abs)
	if err != nil {
		return "", errors.New("invalid_path")
	}
	if relPath == "." || relPath == "" {
		return "", errors.New("invalid_path")
	}
	return filepath.ToSlash(relPath), nil
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

type streamedFileResult struct {
	Path string
	Size int64
	Hash string
}

func writeStreamFileAtomic(path string, reader io.Reader, perm os.FileMode) (streamedFileResult, error) {
	dir := filepath.Dir(path)
	temp, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return streamedFileResult{}, err
	}
	tempName := temp.Name()
	defer os.Remove(tempName)
	defer temp.Close()

	hasher := sha256.New()
	size, err := io.Copy(io.MultiWriter(temp, hasher), reader)
	if err != nil {
		return streamedFileResult{}, err
	}
	if err := temp.Chmod(perm); err != nil {
		return streamedFileResult{}, err
	}
	if err := temp.Close(); err != nil {
		return streamedFileResult{}, err
	}
	finalPath, err := linkFileToUniquePath(tempName, path)
	if err != nil {
		return streamedFileResult{}, err
	}

	return streamedFileResult{
		Path: finalPath,
		Size: size,
		Hash: "sha256:" + hex.EncodeToString(hasher.Sum(nil)),
	}, nil
}

func linkFileToUniquePath(tempPath string, path string) (string, error) {
	candidate := path
	for attempt := 0; attempt < 10000; attempt += 1 {
		if err := os.Link(tempPath, candidate); err == nil {
			return candidate, nil
		} else if !errors.Is(err, os.ErrExist) {
			return "", err
		}

		candidate = nextUniquePath(path, attempt+1)
	}

	return "", errors.New("unique_path_exhausted")
}

func nextUniquePath(path string, index int) string {
	dir := filepath.Dir(path)
	name := filepath.Base(path)
	ext := filepath.Ext(name)
	base := strings.TrimSuffix(name, ext)
	return filepath.Join(dir, base+" ("+strconv.Itoa(index)+")"+ext)
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

func decodeOptionalJSON(w http.ResponseWriter, r *http.Request, target any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(target); err != nil {
		if errors.Is(err, io.EOF) {
			return nil
		}
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

func (s *server) ensurePathWithinWorkspace(absPath string) error {
	workspaceAbs, err := filepath.Abs(s.workspace)
	if err != nil {
		return errors.New("workspace_invalid")
	}
	cleaned := filepath.Clean(absPath)
	rel, err := filepath.Rel(workspaceAbs, cleaned)
	if err != nil {
		return errors.New("path_traversal_rejected")
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return errors.New("path_traversal_rejected")
	}
	return nil
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
