use crate::collab::ingress::IngressSettings;
use crate::collab::session::{CollabSettings, HostEvent, Identity};
use crate::collab::{self, HostHandle};
use crate::storage::{self, BackupFile, BoardFile, Snapshot, Workspace};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;

pub struct AppPaths {
    pub data_dir: PathBuf,
    pub database: PathBuf,
    pub identity: PathBuf,
    pub settings: PathBuf,
    pub guests: PathBuf,
    pub themes_dir: PathBuf,
    pub ui_prefs: PathBuf,
}

impl AppPaths {
    fn from_app(app: &AppHandle) -> Result<Self, String> {
        let data_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&data_dir)
            .map_err(|e| format!("Не удалось создать каталог данных: {e}"))?;
        let themes_dir = data_dir.join("themes");
        std::fs::create_dir_all(&themes_dir)
            .map_err(|e| format!("Не удалось создать каталог тем: {e}"))?;
        Ok(Self {
            database: data_dir.join("sreda.sqlite3"),
            identity: data_dir.join("collab-identity.json"),
            settings: data_dir.join("collab-settings.json"),
            guests: data_dir.join("guest-sessions.json"),
            ui_prefs: data_dir.join("ui-prefs.json"),
            themes_dir,
            data_dir,
        })
    }
}

pub struct CollabCell {
    pub host: Mutex<Option<HostHandle>>,
}

impl CollabCell {
    fn new() -> Self {
        Self {
            host: Mutex::new(None),
        }
    }
}

fn database(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(AppPaths::from_app(app)?.database)
}

#[tauri::command]
async fn load_workspace(app: AppHandle) -> Result<Snapshot, String> {
    let path = database(&app)?;
    tauri::async_runtime::spawn_blocking(move || storage::load(&path))
        .await
        .map_err(|e| format!("Не удалось прочитать данные: {e}"))?
}

#[tauri::command]
async fn save_workspace(
    app: AppHandle,
    workspace: Workspace,
    expected_revision: i64,
) -> Result<i64, String> {
    let path = database(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        storage::save(&path, &workspace, expected_revision)
    })
    .await
    .map_err(|e| format!("Не удалось завершить запись: {e}"))?
}

#[tauri::command]
fn data_location(app: AppHandle) -> Result<String, String> {
    Ok(database(&app)?.to_string_lossy().into_owned())
}

#[tauri::command]
fn data_dir_path(app: AppHandle) -> Result<String, String> {
    Ok(AppPaths::from_app(&app)?.data_dir.to_string_lossy().into_owned())
}

fn default_os_display_name() -> String {
    std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .ok()
        .map(|s| s.trim().chars().take(40).collect::<String>())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Вы".into())
}

#[tauri::command]
fn default_display_name() -> String {
    default_os_display_name()
}

fn open_with_system(target: &std::path::Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(target)
            .spawn()
            .map_err(|e| format!("Не удалось открыть папку: {e}"))?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(target)
            .spawn()
            .map_err(|e| format!("Не удалось открыть папку: {e}"))?;
        return Ok(());
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|e| format!("Не удалось открыть папку: {e}"))?;
        Ok(())
    }
}

fn open_url_with_system(url: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", url])
            .spawn()
            .map_err(|e| format!("Не удалось открыть ссылку: {e}"))?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("Не удалось открыть ссылку: {e}"))?;
        return Ok(());
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("Не удалось открыть ссылку: {e}"))?;
        Ok(())
    }
}

#[tauri::command]
fn open_data_dir(app: AppHandle) -> Result<(), String> {
    let dir = AppPaths::from_app(&app)?.data_dir;
    open_with_system(&dir)
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let allowed = url == "https://dashboard.ngrok.com"
        || url.starts_with("https://dashboard.ngrok.com/");
    let safe = url
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || "-._~/:?=#".contains(c));
    if !allowed || !safe {
        return Err("Разрешены только ссылки на dashboard.ngrok.com".into());
    }
    open_url_with_system(&url)
}

#[tauri::command]
async fn export_board(file: BoardFile) -> Result<bool, String> {
    let mut file = file;
    storage::validate_file(&mut file)?;
    let selected = rfd::AsyncFileDialog::new()
        .set_title("Экспорт доски Среда")
        .set_file_name("sreda-board.json")
        .add_filter("Доска Среда", &["json"])
        .save_file()
        .await;
    if let Some(handle) = selected {
        storage::write_export(
            handle.path(),
            &serde_json::to_vec_pretty(&file).map_err(|e| e.to_string())?,
        )?;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
async fn import_board() -> Result<Option<BoardFile>, String> {
    let selected = rfd::AsyncFileDialog::new()
        .set_title("Импорт доски Среда")
        .add_filter("Доска Среда", &["json"])
        .pick_file()
        .await;
    if let Some(handle) = selected {
        storage::read_import(handle.path()).map(Some)
    } else {
        Ok(None)
    }
}

#[tauri::command]
async fn export_workspace_backup(file: BackupFile) -> Result<bool, String> {
    let mut file = file;
    storage::validate_backup(&mut file)?;
    let selected = rfd::AsyncFileDialog::new()
        .set_title("Экспорт резервной копии Среда")
        .set_file_name("sreda-backup.json")
        .add_filter("Резервная копия Среда", &["json"])
        .save_file()
        .await;
    if let Some(handle) = selected {
        storage::write_export(
            handle.path(),
            &serde_json::to_vec_pretty(&file).map_err(|e| e.to_string())?,
        )?;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
async fn import_workspace_backup() -> Result<Option<serde_json::Value>, String> {
    let selected = rfd::AsyncFileDialog::new()
        .set_title("Импорт резервной копии Среда")
        .add_filter("Резервная копия или доска Среда", &["json"])
        .pick_file()
        .await;
    if let Some(handle) = selected {
        storage::read_backup_or_board(handle.path()).map(Some)
    } else {
        Ok(None)
    }
}

#[tauri::command]
fn collab_settings_get(app: AppHandle) -> Result<CollabSettings, String> {
    Ok(CollabSettings::load(&AppPaths::from_app(&app)?.settings))
}

#[tauri::command]
fn collab_settings_set(app: AppHandle, settings: CollabSettings) -> Result<(), String> {
    settings.save(&AppPaths::from_app(&app)?.settings)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IdleStatus {
    running: bool,
    public_url: Option<String>,
    invite_link: Option<String>,
    static_domain: bool,
    workspace_id: Option<String>,
    host_id: Option<String>,
    participants: Vec<collab::Participant>,
}

#[tauri::command]
async fn collab_host_status(
    app: AppHandle,
    cell: State<'_, Arc<CollabCell>>,
) -> Result<serde_json::Value, String> {
    let guard = cell.host.lock().await;
    if let Some(host) = guard.as_ref() {
        serde_json::to_value(host.status().await).map_err(|e| e.to_string())
    } else {
        let identity = Identity::load_or_create(&AppPaths::from_app(&app)?.identity)?;
        serde_json::to_value(IdleStatus {
            running: false,
            public_url: None,
            invite_link: None,
            static_domain: false,
            workspace_id: Some(identity.workspace_id),
            host_id: Some(identity.host_id),
            participants: Vec::new(),
        })
        .map_err(|e| e.to_string())
    }
}


fn load_host_profile(paths: &AppPaths) -> (String, String) {
    let prefs = std::fs::read(&paths.ui_prefs)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    let profile = prefs.get("profile");
    let name = profile
        .and_then(|p| p.get("displayName").or_else(|| p.get("display_name")))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.chars().take(40).collect::<String>())
        .unwrap_or_else(default_os_display_name);
    let color = profile
        .and_then(|p| p.get("color"))
        .and_then(|v| v.as_str())
        .filter(|c| matches!(*c, "sage" | "blue" | "amber" | "rose" | "violet" | "gray"))
        .unwrap_or("sage")
        .to_string();
    (name, color)
}

#[tauri::command]
async fn collab_host_start(
    app: AppHandle,
    cell: State<'_, Arc<CollabCell>>,
) -> Result<collab::HostStatus, String> {
    let mut guard = cell.host.lock().await;
    if guard.is_some() {
        return guard.as_ref().unwrap().status().await.pipe_ok();
    }
    let paths = AppPaths::from_app(&app)?;
    let identity = Identity::load_or_create(&paths.identity)?;
    let settings = CollabSettings::load(&paths.settings);
    let ingress = IngressSettings {
        authtoken: Some(settings.ngrok_authtoken.clone()).filter(|s| !s.trim().is_empty()),
        static_domain: Some(settings.static_domain.clone()).filter(|s| !s.trim().is_empty()),
    };
    let (host_name, host_color) = load_host_profile(&paths);
    let handle = collab::start(paths.database.clone(), identity, ingress).await?;
    handle.set_profile(host_name, host_color).await;
    let mut events = handle.subscribe().await;
    let emitter = app.clone();
    tokio::spawn(async move {
        while let Ok(event) = events.recv().await {
            match event {
                HostEvent::State {
                    snapshot,
                    origin_id,
                } => {
                    let _ = emitter.emit(
                        "collab://state",
                        serde_json::json!({ "snapshot": snapshot, "originId": origin_id }),
                    );
                }
                HostEvent::Presence { participants } => {
                    let _ = emitter.emit("collab://presence", participants);
                }
                HostEvent::Stopped => {
                    let _ = emitter.emit("collab://stopped", ());
                    break;
                }
            }
        }
    });
    let status = handle.status().await;
    *guard = Some(handle);
    Ok(status)
}

trait PipeOk<T> {
    fn pipe_ok(self) -> Result<T, String>;
}
impl<T> PipeOk<T> for T {
    fn pipe_ok(self) -> Result<T, String> {
        Ok(self)
    }
}

#[tauri::command]
async fn collab_host_stop(cell: State<'_, Arc<CollabCell>>) -> Result<(), String> {
    let handle = cell.host.lock().await.take();
    if let Some(handle) = handle {
        handle.stop().await;
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostProfile {
    name: String,
    color: String,
}

#[tauri::command]
async fn collab_host_set_profile(
    cell: State<'_, Arc<CollabCell>>,
    profile: HostProfile,
) -> Result<(), String> {
    let guard = cell.host.lock().await;
    if let Some(host) = guard.as_ref() {
        let name = profile.name.trim().chars().take(40).collect::<String>();
        let name = if name.is_empty() {
            default_os_display_name()
        } else {
            name
        };
        let color = match profile.color.as_str() {
            "blue" | "amber" | "rose" | "violet" | "gray" | "sage" => profile.color,
            _ => "sage".into(),
        };
        host.set_profile(name, color).await;
    }
    Ok(())
}

#[tauri::command]
async fn collab_invite_issue(cell: State<'_, Arc<CollabCell>>) -> Result<String, String> {
    let guard = cell.host.lock().await;
    let host = guard.as_ref().ok_or("Сначала откройте доступ")?;
    host.issue_invite().await
}

#[tauri::command]
async fn collab_invite_revoke(cell: State<'_, Arc<CollabCell>>) -> Result<String, String> {
    let guard = cell.host.lock().await;
    let host = guard.as_ref().ok_or("Сначала откройте доступ")?;
    host.revoke().await
}

#[tauri::command]
async fn collab_host_push(
    cell: State<'_, Arc<CollabCell>>,
    workspace: Workspace,
    expected_revision: i64,
) -> Result<i64, String> {
    let guard = cell.host.lock().await;
    let host = guard.as_ref().ok_or("Доступ не открыт")?;
    host.push_local(workspace, expected_revision).await
}

#[tauri::command]
fn guest_sessions_load(app: AppHandle) -> Result<serde_json::Value, String> {
    let path = AppPaths::from_app(&app)?.guests;
    if !path.exists() {
        return Ok(serde_json::json!([]));
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}

#[tauri::command]
fn guest_sessions_save(app: AppHandle, sessions: serde_json::Value) -> Result<(), String> {
    let path = AppPaths::from_app(&app)?.guests;
    std::fs::write(
        &path,
        serde_json::to_vec_pretty(&sessions).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}


fn is_safe_theme_filename(name: &str) -> bool {
    const SUFFIX: &str = ".sreda-theme.json";
    if !name.ends_with(SUFFIX) {
        return false;
    }
    let stem = &name[..name.len() - SUFFIX.len()];
    !stem.is_empty()
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains("..")
        && stem
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
}

#[derive(Serialize, Deserialize)]
struct UserThemeFile {
    filename: String,
    contents: String,
}

#[tauri::command]
fn themes_dir_path(app: AppHandle) -> Result<String, String> {
    Ok(AppPaths::from_app(&app)?.themes_dir.to_string_lossy().into_owned())
}

#[tauri::command]
fn themes_list_user(app: AppHandle) -> Result<Vec<UserThemeFile>, String> {
    let dir = AppPaths::from_app(&app)?.themes_dir;
    let mut files = Vec::new();
    let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !is_safe_theme_filename(&name) {
            continue;
        }
        let contents = std::fs::read_to_string(entry.path()).map_err(|e| e.to_string())?;
        files.push(UserThemeFile {
            filename: name,
            contents,
        });
    }
    files.sort_by(|a, b| a.filename.cmp(&b.filename));
    Ok(files)
}

#[tauri::command]
fn themes_write_user(app: AppHandle, filename: String, contents: String) -> Result<(), String> {
    if !is_safe_theme_filename(&filename) {
        return Err("Некорректное имя файла темы".into());
    }
    if contents.len() > 200_000 {
        return Err("Файл темы слишком большой".into());
    }
    // Reject obviously dangerous payloads before touching the disk.
    let lowered = contents.to_ascii_lowercase();
    if lowered.contains("@import")
        || lowered.contains("javascript:")
        || lowered.contains("expression(")
        || lowered.contains("<script")
    {
        return Err("В файле темы есть запрещённые конструкции".into());
    }
    let path = AppPaths::from_app(&app)?.themes_dir.join(&filename);
    std::fs::write(path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn themes_remove_user(app: AppHandle, filename: String) -> Result<(), String> {
    if !is_safe_theme_filename(&filename) {
        return Err("Некорректное имя файла темы".into());
    }
    let path = AppPaths::from_app(&app)?.themes_dir.join(&filename);
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn themes_pick_import() -> Result<Option<String>, String> {
    let selected = rfd::AsyncFileDialog::new()
        .set_title("Импорт темы Среда")
        .add_filter("Тема Среда", &["sreda-theme.json", "json"])
        .pick_file()
        .await;
    if let Some(handle) = selected {
        let bytes = std::fs::read(handle.path()).map_err(|e| e.to_string())?;
        if bytes.len() > 200_000 {
            return Err("Файл темы слишком большой".into());
        }
        String::from_utf8(bytes).map(Some).map_err(|e| e.to_string())
    } else {
        Ok(None)
    }
}

#[tauri::command]
async fn themes_pick_export(filename: String, contents: String) -> Result<bool, String> {
    if !is_safe_theme_filename(&filename) {
        return Err("Некорректное имя файла темы".into());
    }
    let selected = rfd::AsyncFileDialog::new()
        .set_title("Экспорт темы Среда")
        .set_file_name(&filename)
        .add_filter("Тема Среда", &["sreda-theme.json", "json"])
        .save_file()
        .await;
    if let Some(handle) = selected {
        std::fs::write(handle.path(), contents).map_err(|e| e.to_string())?;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
fn ui_prefs_get(app: AppHandle) -> Result<serde_json::Value, String> {
    let path = AppPaths::from_app(&app)?.ui_prefs;
    if !path.exists() {
        return Ok(serde_json::json!({ "themeId": "graphite" }));
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}

#[tauri::command]
fn ui_prefs_set(app: AppHandle, prefs: serde_json::Value) -> Result<(), String> {
    let path = AppPaths::from_app(&app)?.ui_prefs;
    std::fs::write(
        path,
        serde_json::to_vec_pretty(&prefs).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(CollabCell::new()))
        .invoke_handler(tauri::generate_handler![
            load_workspace,
            save_workspace,
            data_location,
            data_dir_path,
            default_display_name,
            open_data_dir,
            open_external_url,
            export_board,
            import_board,
            export_workspace_backup,
            import_workspace_backup,
            collab_settings_get,
            collab_settings_set,
            collab_host_status,
            collab_host_start,
            collab_host_stop,
            collab_host_set_profile,
            collab_invite_issue,
            collab_invite_revoke,
            collab_host_push,
            guest_sessions_load,
            guest_sessions_save,
            themes_dir_path,
            themes_list_user,
            themes_write_user,
            themes_remove_user,
            themes_pick_import,
            themes_pick_export,
            ui_prefs_get,
            ui_prefs_set,
        ])
        .run(tauri::generate_context!())
        .expect("Unable to start Sreda");
}
