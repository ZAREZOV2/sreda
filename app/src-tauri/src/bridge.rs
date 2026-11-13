use crate::documents::{self, BackupDocument, BackupFolder, Folder};
use crate::mcp::{config::McpConfig, ops};
use crate::search;
use base64::Engine;

struct HttpCell {
    shutdown: std::sync::Mutex<Option<tokio::sync::watch::Sender<bool>>>,
}

fn http_cell() -> HttpCell {
    HttpCell {
        shutdown: std::sync::Mutex::new(None),
    }
}

#[tauri::command]
fn documents_folders(app: AppHandle) -> Result<Vec<Folder>, String> {
    documents::list_folders(&database(&app)?)
}

#[tauri::command]
fn documents_folder_save(app: AppHandle, folder: Folder) -> Result<i64, String> {
    documents::save_folder(&database(&app)?, &folder)
}

#[tauri::command]
fn documents_folder_delete(app: AppHandle, id: String) -> Result<(), String> {
    documents::delete_folder(&database(&app)?, &id)
}

#[tauri::command]
fn documents_history(app: AppHandle, id: String) -> Result<Vec<documents::Revision>, String> {
    documents::history(&database(&app)?, &id)
}

#[derive(Serialize)]
struct BackupBundle {
    documents: Vec<BackupDocument>,
    folders: Vec<BackupFolder>,
}

#[tauri::command]
fn documents_backup(app: AppHandle) -> Result<BackupBundle, String> {
    let (documents, folders) = documents::backup_documents(&database(&app)?)?;
    Ok(BackupBundle { documents, folders })
}

#[tauri::command]
fn documents_import_copies(app: AppHandle, documents: Vec<BackupDocument>, folders: Vec<BackupFolder>) -> Result<u32, String> {
    documents::import_copies(&database(&app)?, &documents, &folders)
}

#[tauri::command]
fn documents_attachment_put(app: AppHandle, doc_id: String, mime: String, name: String, bytes_base64: String) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(bytes_base64.trim())
        .map_err(|_| "Вложение не в base64".to_string())?;
    documents::put_attachment(&database(&app)?, &doc_id, &mime, &name, &bytes)
}

#[derive(Serialize)]
struct AttachmentOut {
    mime: String,
    base64: String,
}

#[tauri::command]
fn documents_attachment_get(app: AppHandle, id: String) -> Result<AttachmentOut, String> {
    let (mime, bytes) = documents::get_attachment(&database(&app)?, &id)?;
    Ok(AttachmentOut {
        mime,
        base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

#[tauri::command]
fn documents_render_html(title: String, markdown: String) -> Result<String, String> {
    crate::markdown_html::render_document(&title, &markdown)
}

#[tauri::command]
async fn documents_sync_vault(app: AppHandle) -> Result<documents::VaultReport, String> {
    let selected = rfd::AsyncFileDialog::new().set_title("Папка документов").pick_folder().await;
    let Some(handle) = selected else {
        return Err("Папка не выбрана".into());
    };
    let path = database(&app)?;
    let folder = handle.path().to_path_buf();
    tauri::async_runtime::spawn_blocking(move || documents::sync_vault(&path, &folder))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn search_text(app: AppHandle, query: String) -> Result<Vec<search::Hit>, String> {
    if query.len() > 200 {
        return Err("Слишком длинный запрос".into());
    }
    search::query(&database(&app)?, &query, 30)
}

#[tauri::command]
fn documents_epoch(app: AppHandle) -> Result<i64, String> {
    search::doc_epoch(&database(&app)?)
}

#[tauri::command]
fn workspace_revision(app: AppHandle) -> Result<i64, String> {
    Ok(crate::storage::load(&database(&app)?)?.revision)
}

#[tauri::command]
fn mcp_config_get(app: AppHandle) -> Result<McpConfig, String> {
    Ok(crate::mcp::config::load(&database(&app)?))
}

#[tauri::command]
fn mcp_config_set(app: AppHandle, config: McpConfig) -> Result<(), String> {
    if config.port < 1024 {
        return Err("Порт MCP должен быть не меньше 1024".into());
    }
    crate::mcp::config::save(&database(&app)?, &config)
}

#[derive(Serialize)]
struct MintedToken {
    token: String,
}

#[tauri::command]
fn mcp_token_generate(app: AppHandle) -> Result<MintedToken, String> {
    let path = database(&app)?;
    let mut config = crate::mcp::config::load(&path);
    let (token, hash) = crate::mcp::config::generate_token();
    config.token_hash = Some(hash);
    crate::mcp::config::save(&path, &config)?;
    Ok(MintedToken { token })
}

#[tauri::command]
fn mcp_token_revoke(app: AppHandle) -> Result<(), String> {
    let path = database(&app)?;
    let mut config = crate::mcp::config::load(&path);
    config.token_hash = None;
    crate::mcp::config::save(&path, &config)
}

#[tauri::command]
fn mcp_pending_list(app: AppHandle) -> Result<Vec<ops::Pending>, String> {
    ops::list_pending(&database(&app)?)
}

#[tauri::command]
fn mcp_pending_resolve(app: AppHandle, id: String, accept: bool) -> Result<ops::Outcome, String> {
    let outcome = ops::resolve_pending(&database(&app)?, &id, accept)?;
    let _ = app.emit("sreda://changed", ());
    Ok(outcome)
}

#[tauri::command]
fn mcp_audit_list(app: AppHandle) -> Result<Vec<ops::Audit>, String> {
    ops::list_audit(&database(&app)?)
}

#[tauri::command]
fn mcp_audit_undo(app: AppHandle, id: String) -> Result<(), String> {
    ops::undo(&database(&app)?, &id)?;
    let _ = app.emit("sreda://changed", ());
    Ok(())
}

#[tauri::command]
fn mcp_clients(app: AppHandle) -> Result<Vec<ops::ClientSeen>, String> {
    ops::list_clients(&database(&app)?)
}

#[tauri::command]
fn mcp_binary_path() -> String {
    let exe = std::env::current_exe().unwrap_or_default();
    let name = if cfg!(windows) { "sreda-mcp.exe" } else { "sreda-mcp" };
    exe.parent().unwrap_or(std::path::Path::new(".")).join(name).to_string_lossy().into_owned()
}

#[tauri::command]
async fn mcp_http_apply(app: AppHandle, cell: State<'_, std::sync::Arc<HttpCell>>) -> Result<(), String> {
    let path = database(&app)?;
    let config = crate::mcp::config::load(&path);
    let mut guard = cell.shutdown.lock().map_err(|_| "MCP занят".to_string())?;
    if let Some(sender) = guard.take() {
        let _ = sender.send(true);
    }
    let http = config.enabled && matches!(config.transport.as_str(), "http" | "both");
    if !http {
        return Ok(());
    }
    if config.token_hash.is_none() {
        return Err("Для HTTP сначала создайте токен".into());
    }
    let (tx, rx) = tokio::sync::watch::channel(false);
    let port = config.port;
    tokio::spawn(async move {
        if let Err(error) = crate::mcp::server::serve_http(path, port, rx).await {
            eprintln!("MCP HTTP: {error}");
        }
    });
    *guard = Some(tx);
    Ok(())
}

#[tauri::command]
fn notify_user(title: String, body: String) -> Result<(), String> {
    if title.chars().count() > 80 || body.chars().count() > 240 || title.trim().is_empty() {
        return Err("Слишком длинное уведомление".into());
    }
    #[cfg(windows)]
    {
        notify_rust::Notification::new()
            .app_id("local.sreda.kanban")
            .summary(&title)
            .body(&body)
            .show()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        notify_rust::Notification::new()
            .summary(&title)
            .body(&body)
            .show()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[tauri::command]
fn themes_read_dropped(path: String) -> Result<String, String> {
    let file = std::path::Path::new(&path);
    let name = file.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if !name.ends_with(".sreda-theme.json") || name.contains("..") {
        return Err("Нужен файл *.sreda-theme.json".into());
    }
    let bytes = std::fs::read(file).map_err(|e| e.to_string())?;
    if bytes.len() > 200_000 {
        return Err("Файл темы слишком большой".into());
    }
    let text = String::from_utf8(bytes).map_err(|e| e.to_string())?;
    let lowered = text.to_ascii_lowercase();
    if lowered.contains("@import") || lowered.contains("javascript:") || lowered.contains("expression(") || lowered.contains("<script") || lowered.contains("url(") {
        return Err("В файле темы есть запрещённые конструкции".into());
    }
    Ok(text)
}

#[tauri::command]
async fn collab_share_theme(cell: State<'_, std::sync::Arc<CollabCell>>, theme: String) -> Result<(), String> {
    if theme.len() > 100_000 {
        return Err("Тема слишком большая".into());
    }
    let lowered = theme.to_ascii_lowercase();
    if lowered.contains("@import") || lowered.contains("javascript:") || lowered.contains("expression(") || lowered.contains("url(") || lowered.contains("<script") {
        return Err("Тема не прошла проверку".into());
    }
    let guard = cell.host.lock().await;
    let host = guard.as_ref().ok_or("Сначала откройте доступ")?;
    host.share_theme(theme).await;
    Ok(())
}
