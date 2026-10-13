use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::LazyLock;
use tauri::{Emitter, Manager, Runtime};
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
            owyx_site_browser_login_open,
            owyx_sha256_file,
            owyx_ingest_pack_file,
            owyx_remove_export_file,
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
    let canonical = owyx_resolve_export_path(&path).await?;
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
                .map(|c| {
                    if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_')
                    {
                        c
                    } else {
                        '_'
                    }
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
    if let Some(v) = version
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
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
        request = request
            .header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"));
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
    let size_mb_u64 = size_mb;

    if !status.is_success() {
        let host = url::Url::parse(&url)
            .ok()
            .and_then(|u| u.host_str().map(|h| h.to_ascii_lowercase()));
        let message = owyx_ingest_error_message(
            status.as_u16(),
            &body,
            size_mb_u64,
            host.as_deref(),
        );
        return Err(theseus::Error::from(theseus::ErrorKind::OtherError(
            message,
        ))
        .into());
    }

    let parsed: serde_json::Value = serde_json::from_str(&body)
        .unwrap_or_else(|_| serde_json::json!({ "ok": true }));
    Ok(parsed)
}

/// Match `sanitizeOwyxApiBase`: any `https` host, or `http` only on loopback.
fn owyx_ingest_url_allowed(url: &str) -> bool {
    let Ok(parsed) = url::Url::parse(url) else {
        return false;
    };
    let Some(host) = parsed.host_str() else {
        return false;
    };
    let host = host.to_ascii_lowercase();
    match parsed.scheme() {
        "https" => true,
        "http" => host == "127.0.0.1" || host == "localhost" || host == "[::1]",
        _ => false,
    }
}

fn owyx_ingest_error_message(
    status: u16,
    body: &str,
    size_mb: u64,
    host: Option<&str>,
) -> String {
    if status == 413 {
        // Prefer the API's own JSON when multer rejected (true >512 MB case).
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(body)
            && let Some(message) = parsed
                .get("error")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
        {
            return format!("{message} ({status})");
        }
        // Under our API cap but still 413 → proxy/CDN (e.g. Cloudflare Free ~100 MB).
        if size_mb < 512 {
            let host_label = host.unwrap_or("the API host");
            // Only suggest grey-cloud for the API hostname — never apex owyx.site
            // (keep the website proxied; AR-3).
            let grey_hint = if host.is_some_and(|h| h == "api.owyx.site") {
                format!(
                    " — set {host_label} DNS to DNS-only (grey cloud), or host the archive via HTTP URL"
                )
            } else {
                " — check proxy/CDN body-size limits in front of this host, or host the archive via HTTP URL"
                    .to_string()
            };
            return format!(
                "ingest failed (413): upload blocked by a proxy/CDN in front of {host_label} (yours ~{size_mb} MB; e.g. Cloudflare Free ~100 MB){grey_hint}"
            );
        }
        return format!(
            "ingest failed (413): archive too large for the API (max 512 MB, yours ~{size_mb} MB)"
        );
    }
    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(body)
        && let Some(message) = parsed
            .get("error")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
    {
        return format!("{message} ({status})");
    }
    let snippet: String = body
        .chars()
        .filter(|c| !c.is_control() || *c == ' ')
        .take(120)
        .collect();
    let snippet = snippet.trim();
    if snippet.is_empty() || snippet.starts_with('<') {
        format!("pack ingest failed ({status})")
    } else {
        format!("pack ingest failed ({status}): {snippet}")
    }
}

/// Delete one staged export under `caches/exports/` (same path allowlist as ingest).
#[tauri::command]
pub async fn owyx_remove_export_file(path: String) -> Result<()> {
    let canonical = owyx_resolve_export_path(&path).await?;
    match tokio::fs::remove_file(&canonical).await {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err.into()),
    }
}

/// Drop leftover `caches/exports/*.mrpack` from aborted publishes (startup only).
pub async fn owyx_cleanup_export_cache_inner() -> theseus::Result<u32> {
    let state = theseus::State::get().await?;
    let dir = state.directories.caches_dir().join("exports");
    if !tokio::fs::try_exists(&dir).await.unwrap_or(false) {
        return Ok(0);
    }
    let mut removed = 0u32;
    let mut entries = tokio::fs::read_dir(&dir).await.map_err(|e| {
        theseus::Error::from(theseus::ErrorKind::FSError(format!(
            "read export cache: {e}"
        )))
    })?;
    while let Some(entry) = entries.next_entry().await.map_err(|e| {
        theseus::Error::from(theseus::ErrorKind::FSError(format!(
            "read export cache entry: {e}"
        )))
    })? {
        let path = entry.path();
        let is_mrpack = path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("mrpack"));
        if !is_mrpack {
            continue;
        }
        if tokio::fs::remove_file(&path).await.is_ok() {
            removed = removed.saturating_add(1);
        }
    }
    Ok(removed)
}

async fn owyx_resolve_export_path(path: &str) -> Result<PathBuf> {
    let requested = PathBuf::from(path);
    let state = theseus::State::get().await?;
    let exports_dir = state.directories.caches_dir().join("exports");
    tokio::fs::create_dir_all(&exports_dir).await?;
    let exports =
        tokio::fs::canonicalize(&exports_dir).await.map_err(|err| {
            theseus::Error::from(theseus::ErrorKind::InputError(format!(
                "cannot resolve export cache: {err}"
            )))
        })?;
    let canonical =
        tokio::fs::canonicalize(&requested).await.map_err(|err| {
            theseus::Error::from(theseus::ErrorKind::InputError(format!(
                "cannot resolve export path: {err}"
            )))
        })?;
    if !is_under(&canonical, &exports) {
        return Err(theseus::Error::from(theseus::ErrorKind::InputError(
            "path must be under caches/exports".to_string(),
        ))
        .into());
    }
    Ok(canonical)
}

/// True when `canonical` is `root` or a descendant (component-wise; resists `exports-evil`).
fn is_under(canonical: &Path, root: &Path) -> bool {
    canonical.starts_with(root)
}

#[cfg(test)]
mod owyx_export_path_tests {
    use super::is_under;
    use std::path::PathBuf;

    #[test]
    fn accepts_file_inside_exports() {
        let root = PathBuf::from("caches").join("exports");
        let child = root.join("uuid.mrpack");
        assert!(is_under(&child, &root));
        assert!(is_under(&root, &root));
    }

    #[test]
    fn rejects_sibling_parent_and_prefix_trick() {
        let root = PathBuf::from("caches").join("exports");
        assert!(!is_under(
            &PathBuf::from("caches").join("other").join("x.mrpack"),
            &root
        ));
        assert!(!is_under(&PathBuf::from("caches"), &root));
        assert!(!is_under(
            &PathBuf::from("caches")
                .join("exports-evil")
                .join("x.mrpack"),
            &root
        ));
        assert!(!is_under(&PathBuf::from("tmp").join("uuid.mrpack"), &root));
    }
}

#[cfg(test)]
mod owyx_ingest_url_tests {
    use super::{owyx_ingest_error_message, owyx_ingest_url_allowed};

    #[test]
    fn allows_any_https_and_loopback_http() {
        assert!(owyx_ingest_url_allowed(
            "https://api.owyx.site/api/admin/packs/x/ingest"
        ));
        assert!(owyx_ingest_url_allowed(
            "https://staging.example.com/api/admin/packs/x/ingest"
        ));
        assert!(owyx_ingest_url_allowed(
            "http://127.0.0.1:3001/api/admin/packs/x/ingest"
        ));
        assert!(owyx_ingest_url_allowed(
            "http://localhost:3001/api/admin/packs/x/ingest"
        ));
        assert!(owyx_ingest_url_allowed(
            "http://[::1]:3001/api/admin/packs/x/ingest"
        ));
    }

    #[test]
    fn rejects_http_non_loopback_and_foreign_schemes() {
        assert!(!owyx_ingest_url_allowed(
            "http://api.owyx.site/api/admin/packs/x/ingest"
        ));
        assert!(!owyx_ingest_url_allowed(
            "http://evil.example/api/admin/packs/x/ingest"
        ));
        assert!(!owyx_ingest_url_allowed("file:///tmp/x"));
    }

    #[test]
    fn formats_413_and_html_bodies() {
        assert!(
            owyx_ingest_error_message(413, "<html>big</html>", 600, None)
                .contains("max 512 MB")
        );
        let prod = owyx_ingest_error_message(
            413,
            "<html>cf</html>",
            114,
            Some("api.owyx.site"),
        );
        assert!(prod.contains("Cloudflare"));
        assert!(prod.contains("api.owyx.site"));
        assert!(prod.contains("grey cloud"));

        let loopback = owyx_ingest_error_message(
            413,
            "<html>cf</html>",
            50,
            Some("127.0.0.1"),
        );
        assert!(loopback.contains("127.0.0.1"));
        assert!(loopback.contains("proxy/CDN"));
        assert!(!loopback.contains("api.owyx.site"));
        assert!(!loopback.contains("grey cloud"));

        let apex = owyx_ingest_error_message(
            413,
            "<html>cf</html>",
            114,
            Some("owyx.site"),
        );
        assert!(apex.contains("owyx.site"));
        assert!(apex.contains("proxy/CDN"));
        assert!(!apex.contains("grey cloud"));

        assert!(
            owyx_ingest_error_message(
                413,
                r#"{"error":"archive too large (max 512 MB)"}"#,
                600,
                Some("api.owyx.site"),
            )
            .contains("archive too large (max 512 MB)")
        );
        assert_eq!(
            owyx_ingest_error_message(
                502,
                "<html>Bad Gateway</html>",
                10,
                None
            ),
            "pack ingest failed (502)"
        );
        assert_eq!(
            owyx_ingest_error_message(
                401,
                r#"{"error":"session expired"}"#,
                10,
                None,
            ),
            "session expired (401)"
        );
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OwyxSiteBrowserLoginReadyPayload {
    pub url: String,
    pub opened: bool,
}

static OWYX_BROWSER_LOGIN_CANCEL: LazyLock<tokio::sync::broadcast::Sender<()>> =
    LazyLock::new(|| tokio::sync::broadcast::channel(16).0);

struct ListenerAbortGuard<T> {
    handle: Option<tokio::task::JoinHandle<T>>,
}

impl<T> ListenerAbortGuard<T> {
    fn new(handle: tokio::task::JoinHandle<T>) -> Self {
        Self {
            handle: Some(handle),
        }
    }

    fn disarm(&mut self) -> Option<tokio::task::JoinHandle<T>> {
        self.handle.take()
    }

    async fn abort_and_await(&mut self) {
        if let Some(handle) = self.handle.take() {
            handle.abort();
            let _ = tokio::time::timeout(
                std::time::Duration::from_millis(500),
                handle,
            )
            .await;
        }
    }
}

impl<T> Drop for ListenerAbortGuard<T> {
    fn drop(&mut self) {
        if let Some(handle) = self.handle.take() {
            handle.abort();
        }
    }
}

pub(crate) fn safe_url_host(site_base: &str) -> String {
    Url::parse(site_base.trim())
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_ascii_lowercase()))
        .unwrap_or_else(|| "unknown".to_string())
}

pub(crate) fn sanitize_auth_log_error(
    err_str: &str,
    auth_url: &str,
    state: &str,
) -> String {
    let mut sanitized = err_str.to_string();
    if !auth_url.is_empty() {
        sanitized = sanitized.replace(auth_url, "[REDACTED_AUTH_URL]");
    }
    if !state.is_empty() {
        sanitized = sanitized.replace(state, "[REDACTED_STATE]");
    }
    if let Some(q_idx) = sanitized.find('?') {
        let after = &sanitized[q_idx..];
        let end_idx = after
            .find(|c: char| c.is_whitespace() || c == '"' || c == '\'')
            .unwrap_or(after.len());
        let query_part = &after[..end_idx];
        sanitized = sanitized.replace(query_part, "?[REDACTED_QUERY]");
    }
    sanitized
}

#[cfg(any(target_os = "linux", test))]
pub(crate) fn scrub_appimage_env(cmd: &mut std::process::Command) {
    theseus::scrub_appimage_env(cmd);
}

#[cfg(target_os = "linux")]
fn launch_linux_xdg_open(url: &str) -> std::result::Result<(), String> {
    let mut cmd = std::process::Command::new("xdg-open");
    cmd.arg(url);
    scrub_appimage_env(&mut cmd);
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::null());
    // Redirect stderr to /dev/null instead of piping it: a pipe would be
    // inherited by the browser we spawn and nobody reads it (EPIPE/SIGPIPE
    // risk), and we do not need the reason string here.
    cmd.stderr(std::process::Stdio::null());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn xdg-open: {e}"))?;

    let start = std::time::Instant::now();
    // Some window managers (Hyprland, sway) keep xdg-open alive until the
    // browser exits. That is not a failure, so a timeout must not kill it
    // or report an error: the browser may already be open.
    let timeout = std::time::Duration::from_secs(3);

    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if status.success() {
                    return Ok(());
                } else {
                    return Err(format!(
                        "xdg-open exited with status {status}"
                    ));
                }
            }
            Ok(None) => {
                if start.elapsed() >= timeout {
                    // Leave the process running: killing it could take the
                    // browser down with it on some setups. Hand it to a
                    // background thread that reaps it (waitpid), otherwise it
                    // stays a zombie until the launcher exits.
                    std::thread::spawn(move || {
                        let _ = child.wait();
                    });
                    return Ok(());
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(e) => return Err(format!("Failed to wait for xdg-open: {e}")),
        }
    }
}

async fn open_browser_url<R: Runtime>(
    app: &tauri::AppHandle<R>,
    url: &str,
    state: &str,
    safe_host: &str,
) -> bool {
    let app_clone = app.clone();
    let url_for_opener = url.to_string();
    let state_for_log = state.to_string();
    let url_for_log = url.to_string();
    let host_for_log = safe_host.to_string();

    // On Linux the desktop portal can report success even when its browser
    // never starts, so the scrubbed xdg-open is tried first. Only if it
    // fails do we fall back to the portal opener: launching both would open
    // two tabs with the same one-time auth code (issue #169).
    #[cfg(target_os = "linux")]
    {
        let url_for_xdg = url.to_string();
        let host_for_xdg = safe_host.to_string();

        let xdg_join = tauri::async_runtime::spawn_blocking(move || {
            launch_linux_xdg_open(&url_for_xdg)
        })
        .await;

        match xdg_join {
            Ok(Ok(())) => return true,
            Ok(Err(err)) => {
                let safe_err = sanitize_auth_log_error(&err, url, state);
                tracing::warn!(
                    target: "owyx_browser_auth",
                    host = %host_for_xdg,
                    "Scrubbed Linux xdg-open failed, falling back to opener: {safe_err}"
                );
            }
            Err(join_err) => {
                tracing::warn!(
                    target: "owyx_browser_auth",
                    host = %host_for_xdg,
                    "Linux xdg-open spawn_blocking join error: {join_err}"
                );
            }
        }
    }

    // Fallback (and the only path off Linux): the portal opener.
    // spawn_blocking avoids portal/wry main-thread deadlocks on Linux.
    let opener_join = tauri::async_runtime::spawn_blocking(move || {
        app_clone.opener().open_url(&url_for_opener, None::<&str>)
    })
    .await;

    match opener_join {
        Ok(Ok(())) => true,
        Ok(Err(err)) => {
            let safe_err = sanitize_auth_log_error(
                &err.to_string(),
                &url_for_log,
                &state_for_log,
            );
            tracing::warn!(
                target: "owyx_browser_auth",
                host = %host_for_log,
                "Opener failed to open browser URL: {safe_err}"
            );
            false
        }
        Err(_join_err) => {
            tracing::warn!(
                target: "owyx_browser_auth",
                host = %host_for_log,
                "Opener task failed"
            );
            false
        }
    }
}

const OWYX_BROWSER_LOGIN_TIMEOUT: std::time::Duration =
    std::time::Duration::from_secs(300);

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

    let safe_host = safe_url_host(&site_base);

    let (auth_code_recv_socket_tx, auth_code_recv_socket) =
        tokio::sync::oneshot::channel();
    let expected_state = state.clone();
    let auth_code_handle =
        tokio::spawn(super::oauth_utils::auth_code_reply::listen(
            auth_code_recv_socket_tx,
            Some(expected_state),
        ));

    let mut abort_guard = ListenerAbortGuard::new(auth_code_handle);

    let auth_code_recv_socket = match auth_code_recv_socket.await {
        Ok(Ok(addr)) => addr,
        Ok(Err(e)) => {
            abort_guard.abort_and_await().await;
            return Err(TheseusSerializableError::Theseus(e));
        }
        Err(_) => {
            abort_guard.abort_and_await().await;
            return Err(TheseusSerializableError::Theseus(
                theseus::ErrorKind::OtherError(
                    "Auth code listener terminated unexpectedly".into(),
                )
                .into(),
            ));
        }
    };

    let base = site_base.trim_end_matches('/');
    let auth_request_uri = format!(
        "{base}/launcher-auth?port={}&state={}",
        auth_code_recv_socket.port(),
        urlencoding_encode(&state),
    );

    // Emit event opened=false immediately when URL is ready so UI can display/copy/retry
    let _ = app.emit(
        "owyx-site-browser-login-ready",
        OwyxSiteBrowserLoginReadyPayload {
            url: auth_request_uri.clone(),
            opened: false,
        },
    );

    // Attempt to open in browser (via spawn_blocking opener + Linux xdg-open fallback)
    let opened =
        open_browser_url(&app, &auth_request_uri, &state, &safe_host).await;

    // Emit updated ready event with opened=true on success or opened=false on failure
    let _ = app.emit(
        "owyx-site-browser-login-ready",
        OwyxSiteBrowserLoginReadyPayload {
            url: auth_request_uri.clone(),
            opened,
        },
    );

    // Keep listener alive even if opener fails!
    // Bounded wait with 5-minute timeout and cancel listener
    let mut cancel_rx = OWYX_BROWSER_LOGIN_CANCEL.subscribe();
    let join_handle = abort_guard.handle.as_mut().expect("handle present");

    let result = tokio::select! {
        biased;
        _ = cancel_rx.recv() => {
            Err(TheseusSerializableError::Theseus(
                theseus::ErrorKind::OtherError("Login canceled".into()).into(),
            ))
        }
        _ = tokio::time::sleep(OWYX_BROWSER_LOGIN_TIMEOUT) => {
            Err(TheseusSerializableError::Theseus(
                theseus::ErrorKind::OtherError("Login timed out".into()).into(),
            ))
        }
        join_res = join_handle => {
            match join_res {
                Ok(Ok(Some(code))) => Ok(code),
                Ok(Ok(None)) => Err(TheseusSerializableError::Theseus(
                    theseus::ErrorKind::OtherError("Login canceled".into()).into(),
                )),
                Ok(Err(e)) => Err(TheseusSerializableError::Theseus(e)),
                Err(join_err) => {
                    if join_err.is_cancelled() {
                        Err(TheseusSerializableError::Theseus(
                            theseus::ErrorKind::OtherError("Login canceled".into()).into(),
                        ))
                    } else {
                        Err(TheseusSerializableError::Theseus(
                            theseus::ErrorKind::OtherError(format!(
                                "Auth code listener task failed: {join_err}"
                            )).into(),
                        ))
                    }
                }
            }
        }
    };

    match result {
        Ok(code) => {
            abort_guard.disarm();
            if let Some(main_window) = app.get_webview_window("main") {
                let _ = main_window.set_focus();
            }
            Ok(code)
        }
        Err(err) => {
            abort_guard.abort_and_await().await;
            Err(err)
        }
    }
}

#[tauri::command]
pub fn owyx_site_browser_login_cancel() {
    OWYX_BROWSER_LOGIN_CANCEL.send(()).ok();
    super::oauth_utils::auth_code_reply::stop_listeners();
}

/// Retry opening the Owyx launcher-auth URL from the UI ("Open again").
///
/// Goes through the same scrubbed opener as the primary flow so AppImage
/// environment cleanup applies here too (issue #169 / AR-3).
#[tauri::command]
pub async fn owyx_site_browser_login_open<R: Runtime>(
    app: tauri::AppHandle<R>,
    url: String,
) -> Result<bool> {
    if !is_allowed_owyx_launcher_auth_url(&url) {
        return Err(TheseusSerializableError::Theseus(
            theseus::ErrorKind::OtherError(
                "Owyx site login URL is not allowed".into(),
            )
            .into(),
        ));
    }
    let safe_host = safe_url_host(&url);
    Ok(open_browser_url(&app, url.trim(), "", &safe_host).await)
}

/// Matches the exact URL shape Rust itself emits for the launcher auth flow:
/// `https://owyx.site/launcher-auth?port=…&state=…`.
fn is_allowed_owyx_launcher_auth_url(url: &str) -> bool {
    let Ok(parsed) = Url::parse(url.trim()) else {
        return false;
    };
    if parsed.path() != "/launcher-auth" {
        return false;
    }
    is_allowed_owyx_site_base(&format!(
        "{}://{}",
        parsed.scheme(),
        parsed.host_str().unwrap_or_default()
    ))
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
) -> Result<()> {
    let reveal_target = path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // The portal opener can report success without revealing anything on
        // Linux AppImages (the AppImage mount env leaks into the portal
        // daemon); the scrubbed xdg-open is tried first (issue #171/B4).
        #[cfg(target_os = "linux")]
        {
            let dir = reveal_target
                .parent()
                .map(std::path::Path::to_path_buf)
                .unwrap_or_else(|| reveal_target.clone());
            if launch_linux_xdg_open(&dir.to_string_lossy()).is_ok() {
                return Ok(());
            }
        }
        app.opener().reveal_item_in_dir(reveal_target).map_err(|e| {
            tracing::error!("Failed to highlight file in folder: {e}");
            TheseusSerializableError::Theseus(
                theseus::ErrorKind::OtherError(format!(
                    "Failed to open folder: {e}"
                ))
                .into(),
            )
        })
    })
    .await
    .map_err(|e| {
        TheseusSerializableError::Theseus(
            theseus::ErrorKind::OtherError(format!(
                "Failed to highlight file in folder: {e}"
            ))
            .into(),
        )
    })?
}

#[tauri::command]
pub async fn open_path<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: PathBuf,
) -> Result<()> {
    let open_target = path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "linux")]
        {
            if launch_linux_xdg_open(&open_target.to_string_lossy()).is_ok() {
                return Ok(());
            }
        }
        app.opener()
            .open_path(open_target.to_string_lossy(), None::<&str>)
            .map_err(|e| {
                tracing::error!("Failed to open path: {e}");
                TheseusSerializableError::Theseus(
                    theseus::ErrorKind::OtherError(format!(
                        "Failed to open path: {e}"
                    ))
                    .into(),
                )
            })
    })
    .await
    .map_err(|e| {
        TheseusSerializableError::Theseus(
            theseus::ErrorKind::OtherError(format!("Failed to open path: {e}"))
                .into(),
        )
    })?
}

#[tauri::command]
pub async fn show_launcher_logs_folder<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<()> {
    if let Some(d) = DirectoryInfo::global_handle_if_ready() {
        let path = d.launcher_logs_dir().unwrap_or_default();
        // failure to get folder just opens filesystem
        // (ie: if in debug mode only and launcher_logs never created)
        return open_path(app, path).await;
    }
    Ok(())
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
    open_path(app, path).await
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

#[cfg(test)]
mod owyx_browser_auth_tests {
    use super::*;

    static APPIMAGE_ENV_TEST_LOCK: std::sync::Mutex<()> =
        std::sync::Mutex::new(());

    #[test]
    fn test_is_allowed_owyx_site_base() {
        assert!(is_allowed_owyx_site_base("https://owyx.site"));
        assert!(is_allowed_owyx_site_base("https://owyx.site/"));
        assert!(is_allowed_owyx_site_base("https://www.owyx.site"));
        assert!(is_allowed_owyx_site_base("https://www.owyx.site/"));
        assert!(is_allowed_owyx_site_base("  https://owyx.site  "));

        #[cfg(debug_assertions)]
        {
            assert!(is_allowed_owyx_site_base("http://localhost"));
            assert!(is_allowed_owyx_site_base("http://127.0.0.1"));
            assert!(is_allowed_owyx_site_base("https://localhost"));
            assert!(is_allowed_owyx_site_base("https://127.0.0.1"));
        }

        assert!(!is_allowed_owyx_site_base("http://owyx.site"));
        assert!(!is_allowed_owyx_site_base("http://www.owyx.site"));
        assert!(!is_allowed_owyx_site_base("https://api.owyx.site"));
        assert!(!is_allowed_owyx_site_base("https://owyx.site.attacker.com"));
        assert!(!is_allowed_owyx_site_base("https://evilowyx.site"));
        assert!(!is_allowed_owyx_site_base("https://google.com"));
        assert!(!is_allowed_owyx_site_base("https://owyx.site/foo"));
        assert!(!is_allowed_owyx_site_base("https://owyx.site?evil=1"));
        assert!(!is_allowed_owyx_site_base("https://owyx.site#fragment"));
        assert!(!is_allowed_owyx_site_base("javascript:alert(1)"));
        assert!(!is_allowed_owyx_site_base("not a url"));
    }

    #[test]
    fn test_is_safe_owyx_auth_state() {
        assert!(is_safe_owyx_auth_state("0123456789abcdef0123456789abcdef"));
        assert!(is_safe_owyx_auth_state("Valid_State-1234567890"));
        assert!(is_safe_owyx_auth_state(&"a".repeat(16)));
        assert!(is_safe_owyx_auth_state(&"a".repeat(128)));

        assert!(!is_safe_owyx_auth_state(&"a".repeat(15)));
        assert!(!is_safe_owyx_auth_state(&"a".repeat(129)));
        assert!(!is_safe_owyx_auth_state(""));

        assert!(!is_safe_owyx_auth_state("state with spaces 1234567890"));
        assert!(!is_safe_owyx_auth_state("state\nwith\nnewlines01234567890"));
        assert!(!is_safe_owyx_auth_state("state;drop_table;1234567890"));
        assert!(!is_safe_owyx_auth_state("state&evil=123456789012345"));
        assert!(!is_safe_owyx_auth_state("state\"quote\"1234567890123"));
        assert!(!is_safe_owyx_auth_state("state<script>123456789012"));
    }

    #[test]
    fn test_urlencoding_encode() {
        assert_eq!(urlencoding_encode("abcXYZ123-_.~"), "abcXYZ123-_.~");
        assert_eq!(urlencoding_encode("hello world"), "hello%20world");
        assert_eq!(urlencoding_encode("foo&bar=1"), "foo%26bar%3D1");
    }

    #[test]
    fn test_safe_url_host() {
        assert_eq!(safe_url_host("https://owyx.site"), "owyx.site");
        assert_eq!(
            safe_url_host("https://www.owyx.site/path?query=1"),
            "www.owyx.site"
        );
        assert_eq!(safe_url_host("invalid-url"), "unknown");
    }

    #[test]
    fn test_sanitize_auth_log_error() {
        let state = "secret_state_123456789";
        let auth_url = format!(
            "https://owyx.site/launcher-auth?port=8080&state={state}&code=secret"
        );
        let err_msg = format!("Failed to open {auth_url} in browser");
        let sanitized = sanitize_auth_log_error(&err_msg, &auth_url, state);
        assert!(!sanitized.contains(state));
        assert!(!sanitized.contains("code=secret"));
        assert!(!sanitized.contains("port=8080"));
        assert!(sanitized.contains("[REDACTED_AUTH_URL]"));
        assert!(!sanitized.contains("launcher-auth"));

        let standalone = format!("State mismatch: {state}");
        let sanitized_standalone =
            sanitize_auth_log_error(&standalone, "", state);
        assert!(!sanitized_standalone.contains(state));
        assert!(sanitized_standalone.contains("[REDACTED_STATE]"));
    }

    #[test]
    fn test_scrub_appimage_env_restores_clean_loader_environment() {
        const VARS: [&str; 15] = [
            "APPIMAGE",
            "APPDIR",
            "LD_LIBRARY_PATH",
            "LD_PRELOAD",
            "OLD_LD_LIBRARY_PATH",
            "OLD_LD_PRELOAD",
            "GTK_PATH",
            "GTK_EXE_PREFIX",
            "GIO_MODULE_DIR",
            "GIO_EXTRA_MODULES",
            "OLD_GTK_PATH",
            "OLD_GTK_EXE_PREFIX",
            "OLD_GIO_MODULE_DIR",
            "OLD_GIO_EXTRA_MODULES",
            "OLD_APPDIR",
        ];
        let _lock = APPIMAGE_ENV_TEST_LOCK.lock().unwrap();
        let original: Vec<_> = VARS
            .iter()
            .map(|name| (*name, std::env::var_os(name)))
            .collect();
        unsafe {
            std::env::set_var("APPIMAGE", "/tmp/owyx.AppImage");
            std::env::set_var("APPDIR", "/tmp/.mount_owyx");
            std::env::set_var("OLD_APPDIR", "/usr");
            std::env::set_var("OLD_LD_LIBRARY_PATH", "/usr/lib");
            std::env::set_var("OLD_LD_PRELOAD", "/usr/lib/libpreload.so");
            std::env::set_var("LD_LIBRARY_PATH", "/tmp/.mount_owyx/usr/lib");
            std::env::set_var(
                "LD_PRELOAD",
                "/tmp/.mount_owyx/usr/lib/libpreload.so",
            );
            std::env::set_var("OLD_GTK_PATH", "/usr/lib/gtk");
            std::env::set_var("OLD_GIO_MODULE_DIR", "/usr/lib/gio/modules");
            std::env::set_var("GTK_PATH", "/tmp/.mount_owyx/usr/lib/gtk");
            std::env::set_var("GTK_EXE_PREFIX", "/tmp/.mount_owyx/usr");
            std::env::set_var(
                "GIO_MODULE_DIR",
                "/tmp/.mount_owyx/usr/lib/gio/modules",
            );
            std::env::set_var(
                "GIO_EXTRA_MODULES",
                "/tmp/.mount_owyx/usr/lib/gio/extra",
            );
        }
        let mut cmd = std::process::Command::new("xdg-open");
        scrub_appimage_env(&mut cmd);
        let env: std::collections::HashMap<_, _> = cmd.get_envs().collect();
        let get = |name: &str| {
            env.iter()
                .find(|(key, _)| key.to_str() == Some(name))
                .map(|(_, value)| *value)
        };
        assert_eq!(get("LD_LIBRARY_PATH").unwrap().unwrap(), "/usr/lib");
        assert_eq!(
            get("LD_PRELOAD").unwrap().unwrap(),
            "/usr/lib/libpreload.so"
        );
        assert_eq!(get("GTK_PATH").unwrap().unwrap(), "/usr/lib/gtk");
        assert_eq!(
            get("GIO_MODULE_DIR").unwrap().unwrap(),
            "/usr/lib/gio/modules"
        );
        // Vars without an OLD_* counterpart must be dropped from the child
        // environment (Some(None)), not merely left absent from get_envs().
        assert_eq!(get("APPIMAGE"), Some(None));
        assert_eq!(get("APPDIR"), Some(None));
        assert_eq!(get("GTK_EXE_PREFIX"), Some(None));
        assert_eq!(get("GIO_EXTRA_MODULES"), Some(None));
        unsafe {
            for (name, value) in original {
                if let Some(value) = value {
                    std::env::set_var(name, value);
                } else {
                    std::env::remove_var(name);
                }
            }
        }
    }

    #[test]
    fn test_scrub_appimage_env_noop_outside_appimage() {
        const VARS: [&str; 15] = [
            "APPIMAGE",
            "APPDIR",
            "LD_LIBRARY_PATH",
            "LD_PRELOAD",
            "OLD_LD_LIBRARY_PATH",
            "OLD_LD_PRELOAD",
            "GTK_PATH",
            "GTK_EXE_PREFIX",
            "GIO_MODULE_DIR",
            "GIO_EXTRA_MODULES",
            "OLD_GTK_PATH",
            "OLD_GTK_EXE_PREFIX",
            "OLD_GIO_MODULE_DIR",
            "OLD_GIO_EXTRA_MODULES",
            "OLD_APPDIR",
        ];
        let _lock = APPIMAGE_ENV_TEST_LOCK.lock().unwrap();
        let original: Vec<_> = VARS
            .iter()
            .map(|name| (*name, std::env::var_os(name)))
            .collect();
        unsafe {
            for name in VARS {
                std::env::remove_var(name);
            }
            // A plain loader path, but no AppImage marker and no OLD_* vars,
            // must leave the child environment untouched.
            std::env::set_var("LD_LIBRARY_PATH", "/usr/lib");
        }
        let mut cmd = std::process::Command::new("xdg-open");
        scrub_appimage_env(&mut cmd);
        assert_eq!(cmd.get_envs().count(), 0);
        unsafe {
            for (name, value) in original {
                if let Some(value) = value {
                    std::env::set_var(name, value);
                } else {
                    std::env::remove_var(name);
                }
            }
        }
    }

    #[test]
    fn test_ready_payload_serde() {
        let payload = OwyxSiteBrowserLoginReadyPayload {
            url: "https://owyx.site/launcher-auth?port=1234&state=abcdef"
                .to_string(),
            opened: false,
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert_eq!(
            json,
            r#"{"url":"https://owyx.site/launcher-auth?port=1234&state=abcdef","opened":false}"#
        );

        let deserialized: OwyxSiteBrowserLoginReadyPayload =
            serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, payload);

        let opened_payload = OwyxSiteBrowserLoginReadyPayload {
            url: "https://owyx.site/launcher-auth?port=1234&state=abcdef"
                .to_string(),
            opened: true,
        };
        let opened_json = serde_json::to_string(&opened_payload).unwrap();
        assert_eq!(
            opened_json,
            r#"{"url":"https://owyx.site/launcher-auth?port=1234&state=abcdef","opened":true}"#
        );
    }
}
