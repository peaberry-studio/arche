use std::env;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::thread;

use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use url::Url;

const MENU_ID_SHOW_CONTROL_PANEL: &str = "runtime_show_control_panel";
const MENU_ID_OPEN_WORKSPACE: &str = "runtime_open_workspace";
const MENU_ID_START: &str = "runtime_start";
const MENU_ID_STOP: &str = "runtime_stop";
const MENU_ID_REFRESH_STATUS: &str = "runtime_refresh_status";
const MENU_ID_VIEW_LOGS: &str = "runtime_view_logs";
const MENU_ID_QUIT: &str = "runtime_quit";

static START_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

#[derive(Serialize)]
struct CommandResult {
    ok: bool,
    output: String,
}

#[derive(Clone, Serialize)]
struct RuntimeCommandErrorEvent {
    action: String,
    error: String,
}

#[derive(Clone, Serialize)]
struct RuntimeCommandProgressEvent {
    action: String,
    stream: String,
    phase: Option<String>,
    message: String,
}

#[derive(Clone, Serialize)]
struct RuntimeCommandFinishedEvent {
    action: String,
    ok: bool,
    output: String,
}

fn resolve_runtime_root(app: Option<&AppHandle>) -> Result<PathBuf, String> {
    if let Ok(value) = env::var("ARCHE_DESKTOP_RUNTIME_ROOT") {
        let path = PathBuf::from(value);
        if path.exists() {
            return Ok(path);
        }
    }

    let cwd = env::current_dir().map_err(|error| error.to_string())?;
    let local_candidate = cwd.join("../runtime");
    if local_candidate.exists() {
        return Ok(local_candidate);
    }

    let from_src_tauri = cwd.join("../../runtime");
    if from_src_tauri.exists() {
        return Ok(from_src_tauri);
    }

    if let Some(handle) = app {
        if let Ok(resource_dir) = handle.path().resource_dir() {
            let direct = resource_dir.join("runtime");
            if direct.exists() {
                return Ok(direct);
            }

            for nested in find_runtime_candidates(&resource_dir) {
                if nested.exists() {
                    return Ok(nested);
                }
            }
        }
    }

    Err("unable to resolve runtime root; set ARCHE_DESKTOP_RUNTIME_ROOT".to_string())
}

fn find_runtime_candidates(resource_dir: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(level1) = fs::read_dir(resource_dir) {
        for entry1 in level1.flatten() {
            let path1 = entry1.path();
            if path1.is_dir() {
                let runtime1 = path1.join("runtime");
                if runtime1.join("vm/macos/start-stack.sh").exists() {
                    candidates.push(runtime1);
                }

                if let Ok(level2) = fs::read_dir(&path1) {
                    for entry2 in level2.flatten() {
                        let path2 = entry2.path();
                        if path2.is_dir() {
                            let runtime2 = path2.join("runtime");
                            if runtime2.join("vm/macos/start-stack.sh").exists() {
                                candidates.push(runtime2);
                            }
                        }
                    }
                }
            }
        }
    }

    candidates
}

fn run_script(script: &Path, runtime_root: &Path) -> Result<String, String> {
    let output = Command::new("bash")
        .arg(script)
        .arg(runtime_root)
        .output()
        .map_err(|error| format!("failed to execute {}: {}", script.display(), error))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!(
            "command failed: {}\nstdout:\n{}\nstderr:\n{}",
            script.display(),
            stdout,
            stderr
        ))
    }
}

fn parse_progress_line(line: &str) -> (Option<String>, String) {
    if let Some(payload) = line.strip_prefix("ARCHE_PROGRESS|") {
        let mut parts = payload.splitn(2, '|');
        if let (Some(phase), Some(message)) = (parts.next(), parts.next()) {
            return (Some(phase.to_string()), message.to_string());
        }
    }

    (None, line.to_string())
}

fn emit_runtime_progress(app: &AppHandle, action: &str, stream: &str, line: &str) {
    if line.trim().is_empty() {
        return;
    }

    let (phase, message) = parse_progress_line(line.trim());
    let _ = app.emit(
        "runtime-command-progress",
        RuntimeCommandProgressEvent {
            action: action.to_string(),
            stream: stream.to_string(),
            phase,
            message,
        },
    );
}

fn emit_runtime_finished(app: &AppHandle, action: &str, ok: bool, output: String) {
    let _ = app.emit(
        "runtime-command-finished",
        RuntimeCommandFinishedEvent {
            action: action.to_string(),
            ok,
            output,
        },
    );
}

fn run_script_with_progress(
    script: &Path,
    runtime_root: &Path,
    app: &AppHandle,
    action: &str,
) -> Result<String, String> {
    let mut child = Command::new("bash")
        .arg(script)
        .arg(runtime_root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("failed to execute {}: {}", script.display(), error))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| format!("failed to capture stdout for {}", script.display()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| format!("failed to capture stderr for {}", script.display()))?;

    let (tx, rx) = mpsc::channel::<(String, String)>();

    {
        let tx_stdout = tx.clone();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                if let Ok(value) = line {
                    let _ = tx_stdout.send(("stdout".to_string(), value));
                }
            }
        });
    }

    {
        let tx_stderr = tx.clone();
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines() {
                if let Ok(value) = line {
                    let _ = tx_stderr.send(("stderr".to_string(), value));
                }
            }
        });
    }

    drop(tx);

    let mut stdout_log = String::new();
    let mut stderr_log = String::new();

    for (stream, line) in rx {
        emit_runtime_progress(app, action, &stream, &line);
        if stream == "stdout" {
            stdout_log.push_str(&line);
            stdout_log.push('\n');
        } else {
            stderr_log.push_str(&line);
            stderr_log.push('\n');
        }
    }

    let status = child
        .wait()
        .map_err(|error| format!("failed to wait for {}: {}", script.display(), error))?;

    if status.success() {
        Ok(stdout_log.trim().to_string())
    } else {
        Err(format!(
            "command failed: {}\nstdout:\n{}\nstderr:\n{}",
            script.display(),
            stdout_log,
            stderr_log
        ))
    }
}

fn runtime_mode() -> String {
    env::var("ARCHE_DESKTOP_RUNTIME_MODE").unwrap_or_else(|_| "vm".to_string())
}

fn runtime_script(runtime_root: &Path, name: &str) -> PathBuf {
    let mode = runtime_mode();
    if mode == "podman" {
        return runtime_root.join(format!("macos/{name}"));
    }
    runtime_root.join(format!("{mode}/macos/{name}"))
}

fn show_control_window(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "unable to resolve control panel window".to_string())?;

    window.show().map_err(|error| error.to_string())?;
    window.unminimize().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

fn hide_control_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

fn ensure_workspace_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("workspace") {
        window.show().map_err(|error| error.to_string())?;
        window.unminimize().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    WebviewWindowBuilder::new(
        app,
        "workspace",
        WebviewUrl::External(
            Url::parse("http://127.0.0.1:4510").map_err(|error| error.to_string())?,
        ),
    )
    .title("Arche Workspace")
    .inner_size(1280.0, 860.0)
    .build()
    .map_err(|error| error.to_string())?;

    Ok(())
}

fn start_arche_inner(app: &AppHandle) -> Result<CommandResult, String> {
    let runtime_root = resolve_runtime_root(Some(app))?;
    let script = runtime_script(&runtime_root, "start-stack.sh");
    let output = run_script_with_progress(&script, &runtime_root, app, "start_arche")?;
    ensure_workspace_window(app)?;
    hide_control_window(app);

    Ok(CommandResult { ok: true, output })
}

fn start_arche_background(app: &AppHandle) -> Result<CommandResult, String> {
    if START_IN_PROGRESS.swap(true, Ordering::SeqCst) {
        return Err("start_arche already in progress".to_string());
    }

    let app_handle = app.clone();
    thread::spawn(move || {
        let result = start_arche_inner(&app_handle);
        START_IN_PROGRESS.store(false, Ordering::SeqCst);

        match result {
            Ok(command_result) => {
                emit_runtime_finished(
                    &app_handle,
                    "start_arche",
                    true,
                    command_result.output.clone(),
                );
                emit_refresh_request(&app_handle);
            }
            Err(error) => {
                emit_runtime_error(&app_handle, "start_arche", error);
            }
        }
    });

    Ok(CommandResult {
        ok: true,
        output: "start scheduled".to_string(),
    })
}

fn stop_arche_inner(app: &AppHandle) -> Result<CommandResult, String> {
    let runtime_root = resolve_runtime_root(Some(app))?;
    let script = runtime_script(&runtime_root, "stop-stack.sh");
    let output = run_script(&script, &runtime_root)?;

    Ok(CommandResult { ok: true, output })
}

fn status_arche_inner(app: &AppHandle) -> Result<serde_json::Value, String> {
    let runtime_root = resolve_runtime_root(Some(app))?;
    let script = runtime_script(&runtime_root, "status-stack.sh");
    let output = run_script(&script, &runtime_root)?;

    serde_json::from_str(&output).map_err(|error| format!("invalid status json: {}", error))
}

fn tail_logs_inner(app: &AppHandle) -> Result<String, String> {
    let runtime_root = resolve_runtime_root(Some(app))?;
    let script = runtime_script(&runtime_root, "logs-stack.sh");
    run_script(&script, &runtime_root)
}

fn emit_refresh_request(app: &AppHandle) {
    let _ = app.emit("runtime-refresh-requested", ());
}

fn emit_runtime_error(app: &AppHandle, action: &str, error: String) {
    let _ = show_control_window(app);
    let _ = app.emit(
        "runtime-command-error",
        RuntimeCommandErrorEvent {
            action: action.to_string(),
            error,
        },
    );
    emit_refresh_request(app);
}

fn build_menu(app: &AppHandle) -> Result<Menu<tauri::Wry>, tauri::Error> {
    let show_control_panel_item = MenuItem::with_id(
        app,
        MENU_ID_SHOW_CONTROL_PANEL,
        "Open Control Panel",
        true,
        Some("CmdOrCtrl+Shift+P"),
    )?;
    let open_workspace_item = MenuItem::with_id(
        app,
        MENU_ID_OPEN_WORKSPACE,
        "Open Workspace",
        true,
        Some("CmdOrCtrl+Shift+W"),
    )?;
    let start_item = MenuItem::with_id(
        app,
        MENU_ID_START,
        "Start Arche",
        true,
        Some("CmdOrCtrl+Shift+S"),
    )?;
    let stop_item = MenuItem::with_id(
        app,
        MENU_ID_STOP,
        "Stop Arche",
        true,
        Some("CmdOrCtrl+Shift+X"),
    )?;
    let refresh_status_item = MenuItem::with_id(
        app,
        MENU_ID_REFRESH_STATUS,
        "Refresh Status",
        true,
        Some("CmdOrCtrl+Shift+R"),
    )?;
    let view_logs_item = MenuItem::with_id(
        app,
        MENU_ID_VIEW_LOGS,
        "View Logs",
        true,
        Some("CmdOrCtrl+Shift+L"),
    )?;
    let quit_item = MenuItem::with_id(app, MENU_ID_QUIT, "Quit Arche", true, Some("CmdOrCtrl+Q"))?;
    let separator_1 = PredefinedMenuItem::separator(app)?;
    let separator_2 = PredefinedMenuItem::separator(app)?;

    let runtime_submenu = Submenu::with_items(
        app,
        "Runtime",
        true,
        &[
            &show_control_panel_item,
            &open_workspace_item,
            &separator_1,
            &start_item,
            &stop_item,
            &refresh_status_item,
            &view_logs_item,
            &separator_2,
            &quit_item,
        ],
    )?;

    Menu::with_items(app, &[&runtime_submenu])
}

fn handle_menu_event(app: &AppHandle, menu_id: &str) {
    match menu_id {
        MENU_ID_SHOW_CONTROL_PANEL => {
            if let Err(error) = show_control_window(app) {
                emit_runtime_error(app, "show_control_panel", error);
                return;
            }
            emit_refresh_request(app);
        }
        MENU_ID_OPEN_WORKSPACE => {
            if let Err(error) = ensure_workspace_window(app) {
                emit_runtime_error(app, "open_workspace", error);
                return;
            }
            hide_control_window(app);
        }
        MENU_ID_START => {
            if let Err(error) = start_arche_background(app).map(|_| ()) {
                emit_runtime_error(app, "start_arche", error);
            }
        }
        MENU_ID_STOP => {
            let app_handle = app.clone();
            thread::spawn(move || {
                if let Err(error) = stop_arche_inner(&app_handle).map(|_| ()) {
                    emit_runtime_error(&app_handle, "stop_arche", error);
                    return;
                }
                emit_refresh_request(&app_handle);
            });
        }
        MENU_ID_REFRESH_STATUS | MENU_ID_VIEW_LOGS => {
            if let Err(error) = show_control_window(app) {
                emit_runtime_error(app, "refresh", error);
                return;
            }
            emit_refresh_request(app);
        }
        MENU_ID_QUIT => {
            app.exit(0);
        }
        _ => {}
    }
}

#[tauri::command]
fn start_arche(app: AppHandle) -> Result<CommandResult, String> {
    start_arche_background(&app)
}

#[tauri::command]
fn stop_arche(app: AppHandle) -> Result<CommandResult, String> {
    stop_arche_inner(&app)
}

#[tauri::command]
fn status_arche(app: AppHandle) -> Result<serde_json::Value, String> {
    status_arche_inner(&app)
}

#[tauri::command]
fn tail_logs(app: AppHandle) -> Result<String, String> {
    tail_logs_inner(&app)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle();
            let menu = build_menu(&app_handle)?;
            app.set_menu(menu)?;

            Ok(())
        })
        .on_menu_event(|app, event| {
            handle_menu_event(app, event.id().as_ref());
        })
        .invoke_handler(tauri::generate_handler![
            start_arche,
            stop_arche,
            status_arche,
            tail_logs
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run()
}
