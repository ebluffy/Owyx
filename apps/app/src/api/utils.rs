use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::Manager;
use tauri::Runtime;
use tauri_plugin_opener::OpenerExt;
use theseus::{
    handler,
    prelude::{CommandPayload, DirectoryInfo, app_db_backup_dir},
};
use tokio::io::AsyncReadExt;

use crate::api::{Result, TheseusSerializableError};
use dashmap::DashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use theseus::prelude::canonicalize;
use url::Url;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

pub fn init<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("utils")
        .invoke_handler(tauri::generate_handler![
            get_os,
            is_network_metered,
            should_disable_mouseover,
            highlight_in_folder,
            open_path,
            show_launcher_logs_folder,
            export_owyx_diagnostics_zip,
            show_app_db_backups_folder,
            progress_bars_list,
            get_opening_command,
            super::thumbnails::get_image_thumbnail,
            owyx_site_session_get,
            owyx_site_session_set,
            owyx_site_session_clear,
            owyx_site_browser_login,
            owyx_site_browser_login_cancel,
            owyx_sha256_file,
            owyx_ingest_pack_file,
        ])
        .build()
}

/// `%USERPROFILE%/owyx/site_session.json` (or `~/owyx/…`) — JWT outside webview localStorage.
fn owyx_site_session_path() -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| {
        theseus::Error::from(theseus::ErrorKind::OtherError(
            "Could not resolve home directory for Owyx site session"
                .to_string(),
        ))
    })?;
    Ok(home.join("owyx").join("site_session.json"))
}

#[tauri::command]
pub async fn owyx_site_session_get() -> Result<Option<String>> {
    let path = owyx_site_session_path()?;
    match tokio::fs::read_to_string(&path).await {
        Ok(raw) => Ok(Some(raw)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.into()),
    }
}

/// Stream SHA-256 of a local file without loading it into RAM (P3).
/// Restricted to the launcher settings/config trees (pack cache: `owyx-packs/`).
#[tauri::command]
pub async fn owyx_sha256_file(path: String) -> Result<String> {
    let requested = PathBuf::from(&path);
    let state = theseus::State::get().await?;
    // Ensure dirs exist so canonicalize succeeds and Windows `\\?\` prefixes match (P3-a).
    tokio::fs::create_dir_all(&state.directories.settings_dir).await?;
    tokio::fs::create_dir_all(&state.directories.config_dir).await?;
    let canonical =
        tokio::fs::canonicalize(&requested).await.map_err(|err| {
            theseus::Error::from(theseus::ErrorKind::InputError(format!(
                "cannot open path for sha256: {err}"
            )))
        })?;
    let settings = tokio::fs::canonicalize(&state.directories.settings_dir)
        .await
        .map_err(|err| {
            theseus::Error::from(theseus::ErrorKind::InputError(format!(
                "cannot resolve settings dir: {err}"
            )))
        })?;
    let config = tokio::fs::canonicalize(&state.directories.config_dir)
        .await
        .map_err(|err| {
            theseus::Error::from(theseus::ErrorKind::InputError(format!(
                "cannot resolve config dir: {err}"
            )))
        })?;
    if !owyx_sha256_path_allowed(&canonical, &settings, &config) {
        return Err(theseus::Error::from(theseus::ErrorKind::InputError(
            "sha256 path must be under the launcher data directory".to_string(),
        ))
        .into());
    }
    let meta = tokio::fs::metadata(&canonical).await?;
    if !meta.is_file() {
        return Err(theseus::Error::from(theseus::ErrorKind::InputError(
            "sha256 path is not a file".to_string(),
        ))
        .into());
    }
    let mut file = tokio::fs::File::open(&canonical).await?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = file.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Stream a local `.mrpack` / zip from `caches/exports/` to the site pack ingest API.
/// Avoids loading the archive into the WebView (JSON `number[]` IPC OOMs large packs).
#[tauri::command]
pub async fn owyx_ingest_pack_file(
    path: String,
    url: String,
    file_name: String,
    authorization: Option<String>,
    client_key: Option<String>,
    version: Option<String>,
    changelog: Option<String>,
    source_instance_hint: Option<String>,
) -> Result<serde_json::Value> {
    let requested = PathBuf::from(&path);
    let state = theseus::State::get().await?;
    let exports_dir = state.directories.caches_dir().join("exports");
    tokio::fs::create_dir_all(&exports_dir).await?;
    let exports = tokio::fs::canonicalize(&exports_dir).await.map_err(|err| {
        theseus::Error::from(theseus::ErrorKind::InputError(format!(
            "cannot resolve export cache: {err}"
        )))
    })?;
    let canonical = tokio::fs::canonicalize(&requested).await.map_err(|err| {
        theseus::Error::from(theseus::ErrorKind::InputError(format!(
            "cannot open pack for ingest: {err}"
        )))
    })?;
    if !canonical.starts_with(&exports) {
        return Err(theseus::Error::from(theseus::ErrorKind::InputError(
            "ingest path must be under caches/exports".to_string(),
        ))
        .into());
    }
    if !owyx_ingest_url_allowed(&url) {
        return Err(theseus::Error::from(theseus::ErrorKind::InputError(
            "ingest url host is not allowed".to_string(),
        ))
        .into());
    }

    let meta = tokio::fs::metadata(&canonical).await?;
    if !meta.is_file() {
        return Err(theseus::Error::from(theseus::ErrorKind::InputError(
            "ingest path is not a file".to_string(),
        ))
        .into());
    }
    let size_mb = (meta.len() / (1024 * 1024)).max(1);
    // Always delete the staged export — success, API error, or mid-upload failure.
    struct RemoveOnDrop(PathBuf);
    impl Drop for RemoveOnDrop {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }
    let _cleanup = RemoveOnDrop(canonical.clone());

    let safe_name = {
        let trimmed = file_name.trim();
        if trimmed.is_empty() {
            "pack.mrpack".to_string()
        } else {
            trimmed
                .chars()
                .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                    c
                } else {
                    '_'
                })
                .take(96)
                .collect()
        }
    };

    let part = reqwest::multipart::Part::file(&canonical)
        .await
        .map_err(|err| {
            theseus::Error::from(theseus::ErrorKind::OtherError(format!(
                "open pack for multipart: {err}"
            )))
        })?
        .file_name(safe_name)
        .mime_str("application/octet-stream")
        .map_err(|err| {
            theseus::Error::from(theseus::ErrorKind::OtherError(format!(
                "multipart mime: {err}"
            )))
        })?;

    let mut form = reqwest::multipart::Form::new().part("archive", part);
    if let Some(v) = version.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
        form = form.text("version", v);
    }
    if let Some(c) = changelog {
        form = form.text("changelog", c);
    }
    if let Some(hint) = source_instance_hint
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        form = form.text("sourceInstanceHint", hint);
    }

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|err| {
            theseus::Error::from(theseus::ErrorKind::OtherError(format!(
                "http client: {err}"
            )))
        })?;

    let mut request = client
        .post(&url)
        .multipart(form)
        .header(reqwest::header::ACCEPT, "application/json")
        .timeout(std::time::Duration::from_secs(
            (size_mb.saturating_mul(4)).max(180),
        ));
    if let Some(token) = authorization
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        request = request.header(
            reqwest::header::AUTHORIZATION,
            format!("Bearer {token}"),
        );
    }
    if let Some(key) = client_key
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        request = request.header("X-Owyx-Client-Key", key);
    }

    let response = request.send().await.map_err(|err| {
        theseus::Error::from(theseus::ErrorKind::OtherError(format!(
            "pack ingest request failed: {err}"
        )))
    })?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();

    let parsed: serde_json::Value =
        serde_json::from_str(&body).unwrap_or_else(|_| {
            serde_json::json!({ "error": body })
        });
    if !status.is_success() {
        let message = parsed
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("pack ingest failed");
        return Err(theseus::Error::from(theseus::ErrorKind::OtherError(
            format!("{message} ({status})"),
        ))
        .into());
    }
    Ok(parsed)
}

fn owyx_ingest_url_allowed(url: &str) -> bool {
    let Ok(parsed) = url::Url::parse(url) else {
        return false;
    };
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return false;
    }
    let Some(host) = parsed.host_str() else {
        return false;
    };
    let host = host.to_ascii_lowercase();
    host == "api.owyx.site"
        || host == "localhost"
        || host == "127.0.0.1"
        || host == "::1"
}

#[cfg(test)]
mod owyx_ingest_url_tests {
    use super::owyx_ingest_url_allowed;

    #[test]
    fn allows_prod_and_loopback() {
        assert!(owyx_ingest_url_allowed(
            "https://api.owyx.site/api/admin/packs/x/ingest"
        ));
        assert!(owyx_ingest_url_allowed(
            "http://127.0.0.1:3001/api/admin/packs/x/ingest"
        ));
        assert!(owyx_ingest_url_allowed(
            "http://localhost:3001/api/admin/packs/x/ingest"
        ));
    }

    #[test]
    fn rejects_foreign_hosts() {
        assert!(!owyx_ingest_url_allowed(
            "https://evil.example/api/admin/packs/x/ingest"
        ));
        assert!(!owyx_ingest_url_allowed("file:///tmp/x"));
    }
}

/// Returns true when `path` is under settings or config (pack cache, sessions, etc.).
pub(crate) fn owyx_sha256_path_allowed(
    path: &Path,
    settings: &Path,
    config: &Path,
) -> bool {
    path.starts_with(settings) || path.starts_with(config)
}

#[tauri::command]
pub async fn owyx_site_session_set(payload: String) -> Result<()> {
    let path = owyx_site_session_path()?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    tokio::fs::write(&path, payload).await?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tokio::fs::set_permissions(
            &path,
            std::fs::Permissions::from_mode(0o600),
        )
        .await?;
    }
    #[cfg(windows)]
    {
        // Best-effort NTFS ACL: drop inheritance, grant only the current user.
        // Profile dirs are already user-scoped; this hardens against overly open
        // inherited ACEs (G10). Failure is non-fatal.
        if let Err(error) = restrict_windows_file_acl(&path).await {
            tracing::warn!(
                path = %path.display(),
                "Could not tighten site_session.json ACL: {error}"
            );
        }
    }
    Ok(())
}

#[cfg(windows)]
async fn restrict_windows_file_acl(
    path: &std::path::Path,
) -> std::io::Result<()> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let username = std::env::var_os("USERNAME").ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "USERNAME env var missing",
        )
    })?;
    let grant = format!("{}:(F)", username.to_string_lossy());
    let status = tokio::process::Command::new("icacls")
        .creation_flags(CREATE_NO_WINDOW)
        .arg(path)
        .args(["/inheritance:r", "/grant:r"])
        .arg(&grant)
        .output()
        .await?;
    if !status.status.success() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!(
                "icacls failed: {}",
                String::from_utf8_lossy(&status.stderr)
            ),
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn owyx_site_session_clear() -> Result<()> {
    let path = owyx_site_session_path()?;
    match tokio::fs::remove_file(&path).await {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err.into()),
    }
}

/// Open the Owyx site in the system browser and wait for a one-time auth code
/// on a loopback redirect (same pattern as Modrinth App OAuth).
#[tauri::command]
pub async fn owyx_site_browser_login<R: Runtime>(
    app: tauri::AppHandle<R>,
    site_base: String,
    state: String,
) -> Result<String> {
    if !is_allowed_owyx_site_base(&site_base) {
        return Err(TheseusSerializableError::Theseus(
            theseus::ErrorKind::OtherError(
                "Owyx site login URL is not allowed".into(),
            )
            .into(),
        ));
    }
    if !is_safe_owyx_auth_state(&state) {
        return Err(TheseusSerializableError::Theseus(
            theseus::ErrorKind::OtherError("Invalid Owyx auth state".into())
                .into(),
        ));
    }

    let (auth_code_recv_socket_tx, auth_code_recv_socket) =
        tokio::sync::oneshot::channel();
    let expected_state = state.clone();
    let auth_code = tokio::spawn(super::oauth_utils::auth_code_reply::listen(
        auth_code_recv_socket_tx,
        Some(expected_state),
    ));

    let auth_code_recv_socket = auth_code_recv_socket.await.unwrap()?;
    let base = site_base.trim_end_matches('/');
    let auth_request_uri = format!(
        "{base}/launcher-auth?port={}&state={}",
        auth_code_recv_socket.port(),
        urlencoding_encode(&state),
    );

    app.opener()
        .open_url(auth_request_uri, None::<&str>)
        .map_err(|e| {
            TheseusSerializableError::Theseus(
                theseus::ErrorKind::OtherError(format!(
                    "Failed to open Owyx site login URL: {e}"
                ))
                .into(),
            )
        })?;

    let Some(auth_code) = auth_code.await.unwrap()? else {
        return Err(TheseusSerializableError::Theseus(
            theseus::ErrorKind::OtherError("Login canceled".into()).into(),
        ));
    };

    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.set_focus();
    }

    Ok(auth_code)
}

#[tauri::command]
pub fn owyx_site_browser_login_cancel() {
    super::oauth_utils::auth_code_reply::stop_listeners();
}

fn is_allowed_owyx_site_base(site_base: &str) -> bool {
    let Ok(url) = Url::parse(site_base.trim()) else {
        return false;
    };
    if url.scheme() != "https" && url.scheme() != "http" {
        return false;
    }
    let path = url.path().trim_end_matches('/');
    if !path.is_empty() {
        return false;
    }
    if url.query().is_some() || url.fragment().is_some() {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host.to_ascii_lowercase();
    if host == "owyx.site" || host == "www.owyx.site" {
        return url.scheme() == "https";
    }
    #[cfg(debug_assertions)]
    {
        (host == "localhost" || host == "127.0.0.1")
            && (url.scheme() == "http" || url.scheme() == "https")
    }
    #[cfg(not(debug_assertions))]
    {
        false
    }
}

fn is_safe_owyx_auth_state(state: &str) -> bool {
    let bytes = state.as_bytes();
    (16..=128).contains(&bytes.len())
        && bytes
            .iter()
            .all(|b| b.is_ascii_alphanumeric() || *b == b'-' || *b == b'_')
}

fn urlencoding_encode(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut out = String::with_capacity(value.len());
    for b in value.bytes() {
        match b {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'~' => {
                out.push(b as char);
            }
            _ => {
                out.push('%');
                out.push(HEX[(b >> 4) as usize] as char);
                out.push(HEX[(b & 0xf) as usize] as char);
            }
        }
    }
    out
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(clippy::enum_variant_names)]
pub enum OS {
    Windows,
    Linux,
    MacOS,
}

/// Gets OS
#[tauri::command]
pub fn get_os() -> OS {
    #[cfg(target_os = "windows")]
    let os = OS::Windows;
    #[cfg(target_os = "linux")]
    let os = OS::Linux;
    #[cfg(target_os = "macos")]
    let os = OS::MacOS;
    os
}

#[tauri::command]
pub async fn is_network_metered() -> Result<bool> {
    Ok(theseus::prelude::is_network_metered().await?)
}

// Lists active progress bars
// Create a new HashMap with the same keys
// Values provided should not be used directly, as they are not guaranteed to be up-to-date
#[tauri::command]
pub async fn progress_bars_list()
-> Result<DashMap<uuid::Uuid, theseus::LoadingBar>> {
    let res = theseus::EventState::list_progress_bars().await?;
    Ok(res)
}

// disables mouseover and fixes a random crash error only fixed by recent versions of macos
#[tauri::command]
pub async fn should_disable_mouseover() -> bool {
    if cfg!(target_os = "macos") {
        // We try to match version to 12.2 or higher. If unrecognizable to pattern or lower, we default to the css with disabled mouseover for safety
        if let tauri_plugin_os::Version::Semantic(major, minor, _) =
            tauri_plugin_os::version()
            && major >= 12
            && minor >= 3
        {
            // Mac os version is 12.3 or higher, we allow mouseover
            return false;
        }
        true
    } else {
        // Not macos, we allow mouseover
        false
    }
}

#[tauri::command]
pub async fn highlight_in_folder<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: PathBuf,
) {
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(e) = app.opener().reveal_item_in_dir(path) {
            tracing::error!("Failed to highlight file in folder: {}", e);
        }
    })
    .await
    .ok();
}

#[tauri::command]
pub async fn open_path<R: Runtime>(app: tauri::AppHandle<R>, path: PathBuf) {
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(e) =
            app.opener().open_path(path.to_string_lossy(), None::<&str>)
        {
            tracing::error!("Failed to open path: {}", e);
        }
    })
    .await
    .ok();
}

#[tauri::command]
pub async fn show_launcher_logs_folder<R: Runtime>(app: tauri::AppHandle<R>) {
    if let Some(d) = DirectoryInfo::global_handle_if_ready() {
        let path = d.launcher_logs_dir().unwrap_or_default();
        // failure to get folder just opens filesystem
        // (ie: if in debug mode only and launcher_logs never created)
        open_path(app, path).await;
    }
}

const OWYX_DIAG_LOG_FILES: usize = 6;
const OWYX_DIAG_LOG_MAX_BYTES: u64 = 512 * 1024;

#[tauri::command]
pub async fn export_owyx_diagnostics_zip(
    dest: PathBuf,
    report: String,
) -> Result<()> {
    let logs_dir = DirectoryInfo::global_handle_if_ready()
        .and_then(|d| d.launcher_logs_dir());

    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await.ok();
    }

    tauri::async_runtime::spawn_blocking(
        move || -> std::result::Result<(), String> {
            let file =
                std::fs::File::create(&dest).map_err(|e| e.to_string())?;
            let mut zip = ZipWriter::new(file);
            let options = SimpleFileOptions::default()
                .compression_method(CompressionMethod::Deflated);

            zip.start_file("owyx-diagnostics.txt", options)
                .map_err(|e| e.to_string())?;
            zip.write_all(report.as_bytes())
                .map_err(|e| e.to_string())?;

            if let Some(logs_dir) = logs_dir {
                let mut entries: Vec<(SystemTime, PathBuf)> = Vec::new();
                if let Ok(read_dir) = std::fs::read_dir(&logs_dir) {
                    for entry in read_dir.flatten() {
                        let path = entry.path();
                        let Ok(metadata) = entry.metadata() else {
                            continue;
                        };
                        if !metadata.is_file() {
                            continue;
                        }
                        let modified = metadata
                            .modified()
                            .or_else(|_| metadata.created())
                            .unwrap_or(SystemTime::UNIX_EPOCH);
                        entries.push((modified, path));
                    }
                }
                entries
                    .sort_by_key(|(modified, _)| std::cmp::Reverse(*modified));
                for (_, path) in entries.into_iter().take(OWYX_DIAG_LOG_FILES) {
                    let file_name = path
                        .file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or("launcher.log");
                    let archive_name = format!("launcher_logs/{file_name}");
                    let mut source = std::fs::File::open(&path)
                        .map_err(|e| e.to_string())?;
                    let len =
                        source.metadata().map_err(|e| e.to_string())?.len();
                    zip.start_file(archive_name, options)
                        .map_err(|e| e.to_string())?;
                    if len <= OWYX_DIAG_LOG_MAX_BYTES {
                        std::io::copy(&mut source, &mut zip)
                            .map_err(|e| e.to_string())?;
                    } else {
                        let start = len.saturating_sub(OWYX_DIAG_LOG_MAX_BYTES);
                        use std::io::{Read, Seek, SeekFrom};
                        source
                            .seek(SeekFrom::Start(start))
                            .map_err(|e| e.to_string())?;
                        let mut tail = Vec::new();
                        source
                            .read_to_end(&mut tail)
                            .map_err(|e| e.to_string())?;
                        let header = format!("[first {start} bytes omitted]\n");
                        zip.write_all(header.as_bytes())
                            .map_err(|e| e.to_string())?;
                        zip.write_all(&tail).map_err(|e| e.to_string())?;
                    }
                }
            }

            zip.finish().map_err(|e| e.to_string())?;
            Ok(())
        },
    )
    .await
    .map_err(|error| {
        TheseusSerializableError::Theseus(
            theseus::ErrorKind::OtherError(format!(
                "diagnostics zip task failed: {error}"
            ))
            .into(),
        )
    })?
    .map_err(|error| {
        TheseusSerializableError::Theseus(
            theseus::ErrorKind::OtherError(error).into(),
        )
    })?;

    Ok(())
}

#[tauri::command]
pub async fn show_app_db_backups_folder<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<()> {
    let path = app_db_backup_dir()?;
    tokio::fs::create_dir_all(&path).await?;
    open_path(app, path).await;
    Ok(())
}

// Get opening command
// For example, if a user clicks on an .mrpack to open the app.
// This should be called once and only when the app is done booting up and ready to receive a command
// Returns a Command struct- see events.js
#[tauri::command]
#[cfg(target_os = "macos")]
pub async fn get_opening_command(
    state: tauri::State<'_, crate::macos::deep_link::InitialPayload>,
) -> Result<Option<CommandPayload>> {
    let payload = state.payload.lock().await;
    let cmd_arg = std::env::args_os()
        .nth(1)
        .map(|path| path.to_string_lossy().to_string());

    return if let Some(payload) = payload.as_ref() {
        tracing::info!("opening command {payload}");

        Ok(Some(handler::parse_command(payload).await?))
    } else if let Some(cmd_arg) = cmd_arg {
        tracing::info!("opening command {cmd_arg:?}");

        Ok(Some(handler::parse_command(&cmd_arg).await?))
    } else {
        Ok(None)
    };
}

#[tauri::command]
#[cfg(not(target_os = "macos"))]
pub async fn get_opening_command() -> Result<Option<CommandPayload>> {
    // Tauri is not CLI, we use arguments as path to file to call
    let cmd_arg = std::env::args_os().nth(1);

    tracing::info!("opening command {cmd_arg:?}");

    let cmd_arg = cmd_arg.map(|path| path.to_string_lossy().to_string());
    if let Some(cmd) = cmd_arg {
        tracing::debug!("Opening command: {:?}", cmd);
        return Ok(Some(handler::parse_command(&cmd).await?));
    }
    Ok(None)
}

// helper function called when redirected by a weblink (ie: modrith://do-something) or when redirected by a .mrpack file (in which case its a filepath)
// We hijack the deep link library (which also contains functionality for instance-checking)
pub async fn handle_command(command: String) -> Result<()> {
    tracing::info!("handle command: {command}");
    Ok(theseus::handler::parse_and_emit_command(&command).await?)
}

// Remove when (and if) https://github.com/tauri-apps/tauri/issues/12022 is implemented
pub(crate) fn tauri_convert_file_src(path: &Path) -> Result<Url> {
    #[cfg(any(windows, target_os = "android"))]
    const BASE: &str = "http://asset.localhost/";
    #[cfg(not(any(windows, target_os = "android")))]
    const BASE: &str = "asset://localhost/";

    macro_rules! theseus_try {
        ($test:expr) => {
            match $test {
                Ok(val) => val,
                Err(e) => {
                    return Err(TheseusSerializableError::Theseus(e.into()))
                }
            }
        };
    }

    let path = theseus_try!(canonicalize(path));
    let path = path.to_string_lossy();
    let encoded = urlencoding::encode(&path);

    Ok(theseus_try!(Url::parse(&format!("{BASE}{encoded}"))))
}

#[cfg(test)]
mod owyx_sha256_tests {
    use super::owyx_sha256_path_allowed;
    use std::path::Path;

    #[test]
    fn allows_paths_under_settings_or_config() {
        let settings = Path::new("/data/settings");
        let config = Path::new("/data/config");
        assert!(owyx_sha256_path_allowed(
            Path::new("/data/settings/owyx-packs/a.mrpack"),
            settings,
            config,
        ));
        assert!(owyx_sha256_path_allowed(
            Path::new("/data/config/owyx-packs/b.zip"),
            settings,
            config,
        ));
    }

    #[test]
    fn rejects_paths_outside_launcher_dirs() {
        let settings = Path::new("/data/settings");
        let config = Path::new("/data/config");
        assert!(!owyx_sha256_path_allowed(
            Path::new("/tmp/evil.mrpack"),
            settings,
            config,
        ));
        assert!(!owyx_sha256_path_allowed(
            Path::new("/data/settings-evil/x"),
            settings,
            config,
        ));
    }
}
