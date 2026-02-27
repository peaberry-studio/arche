use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use url::Url;

#[derive(Serialize)]
struct CommandResult {
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

fn ensure_workspace_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("workspace") {
        window.show().map_err(|error| error.to_string())?;
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

#[tauri::command]
fn start_arche(app: AppHandle) -> Result<CommandResult, String> {
    let runtime_root = resolve_runtime_root(Some(&app))?;
    let script = runtime_script(&runtime_root, "start-stack.sh");
    let output = run_script(&script, &runtime_root)?;
    ensure_workspace_window(&app)?;

    Ok(CommandResult { ok: true, output })
}

#[tauri::command]
fn stop_arche(app: AppHandle) -> Result<CommandResult, String> {
    let runtime_root = resolve_runtime_root(Some(&app))?;
    let script = runtime_script(&runtime_root, "stop-stack.sh");
    let output = run_script(&script, &runtime_root)?;

    Ok(CommandResult { ok: true, output })
}

#[tauri::command]
fn status_arche(app: AppHandle) -> Result<serde_json::Value, String> {
    let runtime_root = resolve_runtime_root(Some(&app))?;
    let script = runtime_script(&runtime_root, "status-stack.sh");
    let output = run_script(&script, &runtime_root)?;

    serde_json::from_str(&output).map_err(|error| format!("invalid status json: {}", error))
}

#[tauri::command]
fn tail_logs(app: AppHandle) -> Result<String, String> {
    let runtime_root = resolve_runtime_root(Some(&app))?;
    let script = runtime_script(&runtime_root, "logs-stack.sh");
    run_script(&script, &runtime_root)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
