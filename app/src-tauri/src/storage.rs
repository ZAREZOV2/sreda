use crate::recurrence::Recurrence;
use rusqlite::{params, Connection, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, io::Write, path::Path};
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub description: String,
    pub label: String,
    pub color: String,
    pub priority: String,
    #[serde(default, skip_serializing_if = "is_zero_i64")]
    pub time_spent_ms: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recurrence: Option<Recurrence>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reminder_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub linked_doc_id: Option<String>,
}
fn is_zero_i64(value: &i64) -> bool {
    *value == 0
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ColumnKind {
    Todo,
    Progress,
    Done,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Column {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub kind: Option<ColumnKind>,
    pub tasks: Vec<Task>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Board {
    pub id: String,
    pub name: String,
    pub description: String,
    pub columns: Vec<Column>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Workspace {
    pub schema_version: u32,
    pub boards: Vec<Board>,
    pub selected_board_id: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    pub revision: i64,
    pub workspace: Workspace,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BoardFile {
    pub format: String,
    pub version: u32,
    pub board: Board,
}
fn infer_kind(name: &str, index: usize, total: usize) -> ColumnKind {
    let normalized = name.trim().to_lowercase();
    if normalized == "готово" {
        return ColumnKind::Done;
    }
    if normalized == "в работе" {
        return ColumnKind::Progress;
    }
    if normalized == "нужно сделать" {
        return ColumnKind::Todo;
    }
    if total == 3 {
        return match index {
            1 => ColumnKind::Progress,
            2 => ColumnKind::Done,
            _ => ColumnKind::Todo,
        };
    }
    ColumnKind::Todo
}
fn normalize_board(board: &mut Board) {
    let total = board.columns.len();
    for (index, column) in board.columns.iter_mut().enumerate() {
        if column.kind.is_none() {
            column.kind = Some(infer_kind(&column.name, index, total));
        }
    }
}
fn normalize_workspace(workspace: &mut Workspace) {
    for board in &mut workspace.boards {
        normalize_board(board);
    }
}
fn text(value: &str, max: usize, required: bool) -> Result<(), String> {
    if value.chars().count() > max || (required && value.trim().is_empty()) || value.contains('\0')
    {
        return Err(format!("Недопустимая строка (максимум {max} символов)"));
    }
    Ok(())
}
fn id(value: &str, ids: &mut HashSet<String>) -> Result<(), String> {
    text(value, 100, true)?;
    if !value
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        || !ids.insert(value.into())
    {
        return Err("Некорректный или повторяющийся идентификатор".into());
    }
    Ok(())
}
fn validate_board(
    board: &Board,
    ids: &mut HashSet<String>,
    count: &mut usize,
) -> Result<(), String> {
    id(&board.id, ids)?;
    text(&board.name, 120, true)?;
    text(&board.description, 2000, false)?;
    if board.columns.is_empty() || board.columns.len() > 50 {
        return Err("На доске должно быть от 1 до 50 колонок".into());
    }
    for column in &board.columns {
        id(&column.id, ids)?;
        text(&column.name, 80, true)?;
        if column.kind.is_none() {
            return Err("Некорректный тип колонки".into());
        }
        for task in &column.tasks {
            *count += 1;
            if *count > 10000 {
                return Err("Превышен предел 10 000 карточек".into());
            }
            id(&task.id, ids)?;
            text(&task.title, 300, true)?;
            text(&task.description, 20000, false)?;
            text(&task.label, 40, false)?;
            if !["sage", "blue", "amber", "rose", "violet", "gray"].contains(&task.color.as_str())
                || !["high", "medium", "low"].contains(&task.priority.as_str())
            {
                return Err("Некорректная метка или приоритет".into());
            }
            if task.time_spent_ms < 0 || task.time_spent_ms > 10 * 365 * 24 * 60 * 60 * 1000 {
                return Err("Некорректный учёт времени".into());
            }
            if let Some(recurrence) = &task.recurrence {
                if !crate::recurrence::valid(recurrence) {
                    return Err("Некорректное повторение задачи".into());
                }
            }
            if let Some(doc_id) = &task.linked_doc_id {
                text(doc_id, 100, true)?;
                if !doc_id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
                {
                    return Err("Некорректная связь с документом".into());
                }
            }
        }
    }
    Ok(())
}
pub fn validate(workspace: &Workspace) -> Result<(), String> {
    if workspace.schema_version != 1 {
        return Err("Неподдерживаемая версия данных".into());
    }
    if workspace.boards.len() > 100 {
        return Err("Превышен предел 100 досок".into());
    }
    let mut ids = HashSet::new();
    let mut count = 0;
    for board in &workspace.boards {
        validate_board(board, &mut ids, &mut count)?;
    }
    if workspace
        .selected_board_id
        .as_ref()
        .is_some_and(|selected| !workspace.boards.iter().any(|b| &b.id == selected))
    {
        return Err("Выбранная доска отсутствует".into());
    }
    Ok(())
}
pub fn validate_file(file: &mut BoardFile) -> Result<(), String> {
    if file.format != "sreda-board" || file.version != 1 {
        return Err("Это не файл доски Среда версии 1".into());
    }
    normalize_board(&mut file.board);
    validate_board(&file.board, &mut HashSet::new(), &mut 0)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupFile {
    pub format: String,
    pub version: u32,
    pub workspace: Workspace,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub documents: Vec<crate::documents::BackupDocument>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub folders: Vec<crate::documents::BackupFolder>,
}

pub fn validate_backup(file: &mut BackupFile) -> Result<(), String> {
    if file.format != "sreda-backup" || (file.version != 1 && file.version != 2) {
        return Err("Это не файл резервной копии Среда версии 1 или 2".into());
    }
    normalize_workspace(&mut file.workspace);
    validate(&file.workspace)?;
    if file.documents.len() > 5000 || file.folders.len() > 1000 {
        return Err("В копии слишком много документов".into());
    }
    for document in &file.documents {
        crate::documents::validate_backup_document(document)?;
    }
    for folder in &file.folders {
        crate::documents::validate_backup_folder(folder)?;
    }
    Ok(())
}

pub fn read_backup_or_board(path: &Path) -> Result<serde_json::Value, String> {
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    std::io::Read::read_to_end(
        &mut std::io::Read::take(&mut file, 20 * 1024 * 1024 + 1),
        &mut bytes,
    )
    .map_err(|e| e.to_string())?;
    if bytes.len() > 20 * 1024 * 1024 {
        return Err("Файл больше 20 МБ".into());
    }
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|e| format!("Некорректный JSON: {e}"))?;
    let format = value.get("format").and_then(|v| v.as_str()).unwrap_or("");
    if format == "sreda-backup" {
        let mut parsed: BackupFile = serde_json::from_value(value)
            .map_err(|e| format!("Некорректный файл резервной копии: {e}"))?;
        validate_backup(&mut parsed)?;
        return serde_json::to_value(&parsed).map_err(|e| e.to_string());
    }
    if format == "sreda-board" {
        let mut parsed: BoardFile = serde_json::from_value(value)
            .map_err(|e| format!("Некорректный JSON доски: {e}"))?;
        validate_file(&mut parsed)?;
        return serde_json::to_value(&parsed).map_err(|e| e.to_string());
    }
    Err("Ожидался файл доски или резервной копии Среда версии 1 или 2".into())
}
pub(crate) fn open(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|e| format!("Не удалось открыть SQLite: {e}"))?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, data TEXT NOT NULL);").map_err(|e| e.to_string())?;
    let empty = Workspace {
        schema_version: 1,
        boards: vec![],
        selected_board_id: None,
    };
    conn.execute(
        "INSERT OR IGNORE INTO workspace(id, revision, data) VALUES(1, 0, ?1)",
        [serde_json::to_string(&empty).map_err(|e| e.to_string())?],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}
pub fn load(path: &Path) -> Result<Snapshot, String> {
    let conn = open(path)?;
    let (revision, json): (i64, String) = conn
        .query_row(
            "SELECT revision, data FROM workspace WHERE id=1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    let mut workspace: Workspace = serde_json::from_str(&json).map_err(|e| {
        format!("Повреждены данные SQLite. Исходный файл сохранён без изменений: {e}")
    })?;
    normalize_workspace(&mut workspace);
    validate(&workspace)?;
    Ok(Snapshot {
        revision,
        workspace,
    })
}
pub fn save(path: &Path, workspace: &Workspace, expected_revision: i64) -> Result<i64, String> {
    let mut workspace = workspace.clone();
    normalize_workspace(&mut workspace);
    validate(&workspace)?;
    let json = serde_json::to_string(&workspace).map_err(|e| e.to_string())?;
    if json.len() > 20 * 1024 * 1024 {
        return Err("Данные превышают 20 МБ".into());
    }
    {
        let conn = open(path)?;
        crate::search::ensure(&conn).map_err(|e| format!("Не удалось подготовить поиск: {e}"))?;
    }
    let mut conn = open(path)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| format!("Не удалось начать запись: {e}"))?;
    let actual: i64 = tx
        .query_row("SELECT revision FROM workspace WHERE id=1", [], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    if actual != expected_revision {
        return Err(
            "Данные изменились в другом окне. Обновите данные и повторите действие.".into(),
        );
    }
    let next = actual.checked_add(1).ok_or("Переполнение версии данных")?;
    tx.execute(
        "UPDATE workspace SET revision=?1, data=?2 WHERE id=1",
        params![next, json],
    )
    .map_err(|e| format!("Не удалось записать данные: {e}"))?;
    crate::search::reindex_cards(&tx, &workspace)
        .map_err(|e| format!("Не удалось обновить поиск карточек: {e}"))?;
    tx.commit()
        .map_err(|e| format!("SQLite не подтвердила сохранение: {e}"))?;
    Ok(next)
}

/// Повторно читает снимок и записывает его, если ревизию успели сдвинуть.
pub fn update<F>(path: &Path, mut mutate: F) -> Result<i64, String>
where
    F: FnMut(&mut Workspace) -> Result<(), String>,
{
    for _ in 0..5 {
        let snapshot = load(path)?;
        let mut workspace = snapshot.workspace;
        mutate(&mut workspace)?;
        match save(path, &workspace, snapshot.revision) {
            Ok(revision) => return Ok(revision),
            Err(error) if error.contains("другом окне") => continue,
            Err(error) => return Err(error),
        }
    }
    Err("Не удалось записать: данные изменились несколько раз подряд".into())
}
pub fn read_import(path: &Path) -> Result<BoardFile, String> {
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    std::io::Read::read_to_end(
        &mut std::io::Read::take(&mut file, 20 * 1024 * 1024 + 1),
        &mut bytes,
    )
    .map_err(|e| e.to_string())?;
    if bytes.len() > 20 * 1024 * 1024 {
        return Err("Файл больше 20 МБ".into());
    }
    let mut parsed: BoardFile =
        serde_json::from_slice(&bytes).map_err(|e| format!("Некорректный JSON доски: {e}"))?;
    validate_file(&mut parsed)?;
    Ok(parsed)
}
pub fn write_export(path: &Path, bytes: &[u8]) -> Result<(), String> {
    static SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let mut temp = path.as_os_str().to_os_string();
    temp.push(format!(
        ".{}.{}.tmp",
        std::process::id(),
        SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    let temp = std::path::PathBuf::from(temp);
    let mut owned = false;
    let result = (|| {
        let mut output = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| e.to_string())?;
        owned = true;
        output.write_all(bytes).map_err(|e| e.to_string())?;
        output.sync_all().map_err(|e| e.to_string())?;
        drop(output);
        std::fs::rename(&temp, path).map_err(|e| format!("Не удалось завершить экспорт: {e}"))?;
        Ok(())
    })();
    if result.is_err() && owned {
        let _ = std::fs::remove_file(&temp);
    }
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    fn workspace() -> Workspace {
        let mut data:Workspace=serde_json::from_value(serde_json::json!({"schemaVersion":1,"selectedBoardId":"b1","boards":[{"id":"b1","name":"Работа","description":"","columns":[{"id":"c1","name":"Нужно сделать","tasks":[{"id":"t1","title":"Задача","description":"Текст","label":"UI","color":"sage","priority":"high"}]},{"id":"c2","name":"Готово","tasks":[]}]}]})).unwrap();
        normalize_workspace(&mut data);
        data
    }
    fn dir() -> std::path::PathBuf {
        static ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "sreda-test-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&path).unwrap();
        path
    }
    #[test]
    fn sqlite_roundtrip_order_and_conflict() {
        let dir = dir();
        let path = dir.join("test.sqlite3");
        assert_eq!(load(&path).unwrap().revision, 0);
        let mut data = workspace();
        assert_eq!(save(&path, &data, 0).unwrap(), 1);
        assert_eq!(load(&path).unwrap().workspace, data);
        let task = data.boards[0].columns[0].tasks.remove(0);
        data.boards[0].columns[1].tasks.push(task);
        data.boards[0].columns.swap(0, 1);
        assert_eq!(save(&path, &data, 1).unwrap(), 2);
        assert_eq!(load(&path).unwrap().workspace, data);
        assert!(save(&path, &workspace(), 1)
            .unwrap_err()
            .contains("другом окне"));
        assert_eq!(load(&path).unwrap().workspace, data);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn invalid_data_cannot_replace_saved_state() {
        let dir = dir();
        let path = dir.join("test.sqlite3");
        let data = workspace();
        save(&path, &data, 0).unwrap();
        let mut invalid = data.clone();
        invalid.boards[0].columns[0].tasks[0].title = "  ".into();
        assert!(save(&path, &invalid, 1).is_err());
        invalid = data.clone();
        invalid.boards[0].columns[1].id = "c1".into();
        assert!(save(&path, &invalid, 1).is_err());
        assert_eq!(load(&path).unwrap().workspace, data);
        assert!(save(&dir.join("missing/db"), &data, 0).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn file_roundtrip_and_validation() {
        let dir = dir();
        let path = dir.join("board.json");
        let file = BoardFile {
            format: "sreda-board".into(),
            version: 1,
            board: workspace().boards.remove(0),
        };
        write_export(&path, &serde_json::to_vec(&file).unwrap()).unwrap();
        assert_eq!(read_import(&path).unwrap().board, file.board);
        let mut modified = file;
        modified.board.name = "Обновлённая".into();
        write_export(&path, &serde_json::to_vec(&modified).unwrap()).unwrap();
        assert_eq!(read_import(&path).unwrap().board.name, "Обновлённая");
        std::fs::write(&path, b"{broken").unwrap();
        assert!(read_import(&path).is_err());
        modified.version = 2;
        std::fs::write(&path, serde_json::to_vec(&modified).unwrap()).unwrap();
        assert!(read_import(&path).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn frontend_contract_survives_process_restart() {
        let dir = dir();
        let path = dir.join("restart.sqlite3");
        let mut state: Workspace =
            serde_json::from_str(include_str!("../../tests/fixtures/workspace.json")).unwrap();
        normalize_workspace(&mut state);
        validate(&state).unwrap();
        save(&path, &state, 0).unwrap();
        let child = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "storage::tests::restart_reader", "--ignored"])
            .env("SREDA_TEST_DB", &path)
            .output()
            .unwrap();
        assert!(
            child.status.success(),
            "{} {}",
            String::from_utf8_lossy(&child.stdout),
            String::from_utf8_lossy(&child.stderr)
        );
        let export = dir.join("export.json");
        let file = BoardFile {
            format: "sreda-board".into(),
            version: 1,
            board: state.boards[0].clone(),
        };
        write_export(&export, &serde_json::to_vec(&file).unwrap()).unwrap();
        assert_eq!(read_import(&export).unwrap().board, state.boards[0]);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    #[ignore]
    fn restart_reader() {
        let mut state: Workspace =
            serde_json::from_str(include_str!("../../tests/fixtures/workspace.json")).unwrap();
        normalize_workspace(&mut state);
        let snapshot = load(Path::new(&std::env::var("SREDA_TEST_DB").unwrap())).unwrap();
        assert_eq!(snapshot.revision, 1);
        assert_eq!(snapshot.workspace, state);
    }
    #[test]
    fn corrupted_data_is_reported_and_preserved() {
        let dir = dir();
        let path = dir.join("corrupt.sqlite3");
        save(&path, &workspace(), 0).unwrap();
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute("UPDATE workspace SET data='broken' WHERE id=1", [])
                .unwrap();
        }
        assert!(load(&path).unwrap_err().contains("Повреждены"));
        let conn = Connection::open(&path).unwrap();
        let raw: String = conn
            .query_row("SELECT data FROM workspace WHERE id=1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(raw, "broken");
        drop(conn);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn failed_export_preserves_existing_file() {
        let dir = dir();
        let path = dir.join("existing.json");
        std::fs::write(&path, b"original").unwrap();
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            let guard = std::fs::OpenOptions::new()
                .read(true)
                .share_mode(0)
                .open(&path)
                .unwrap();
            assert!(write_export(&path, b"replacement").is_err());
            drop(guard);
            assert_eq!(std::fs::read(&path).unwrap(), b"original");
            assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        }
        #[cfg(unix)]
        {
            write_export(&path, b"replacement").unwrap();
            assert_eq!(std::fs::read(&path).unwrap(), b"replacement");
            assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
            let blocked = dir.join("blocked.json");
            std::fs::create_dir(&blocked).unwrap();
            std::fs::write(blocked.join("keep"), b"stay").unwrap();
            assert!(write_export(&blocked, b"replacement").is_err());
            assert!(blocked.is_dir());
            assert_eq!(std::fs::read(blocked.join("keep")).unwrap(), b"stay");
            let leftovers: Vec<_> = std::fs::read_dir(&dir)
                .unwrap()
                .map(|e| e.unwrap().file_name())
                .filter(|n| n != "existing.json" && n != "blocked.json")
                .collect();
            assert!(leftovers.is_empty(), "leftover temp files: {leftovers:?}");
        }
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn missing_column_kind_is_inferred_from_name_and_position() {
        let dir = dir();
        let path = dir.join("legacy.sqlite3");
        let legacy = r#"{"schemaVersion":1,"selectedBoardId":"b1","boards":[{"id":"b1","name":"Работа","description":"","columns":[{"id":"c1","name":"Нужно сделать","tasks":[]},{"id":"c2","name":"В работе","tasks":[]},{"id":"c3","name":"Готово","tasks":[]},{"id":"c4","name":"ГОТОВО","tasks":[]},{"id":"c5","name":"Прочее","tasks":[]}]}]}"#;
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE workspace (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, data TEXT NOT NULL);").unwrap();
        conn.execute(
            "INSERT INTO workspace(id, revision, data) VALUES(1, 3, ?1)",
            [legacy],
        )
        .unwrap();
        drop(conn);
        let snapshot = load(&path).unwrap();
        let kinds: Vec<_> = snapshot.workspace.boards[0]
            .columns
            .iter()
            .map(|c| c.kind)
            .collect();
        assert_eq!(
            kinds,
            vec![
                Some(ColumnKind::Todo),
                Some(ColumnKind::Progress),
                Some(ColumnKind::Done),
                Some(ColumnKind::Done),
                Some(ColumnKind::Todo)
            ]
        );
        let custom = r#"{"schemaVersion":1,"selectedBoardId":null,"boards":[{"id":"b1","name":"A","description":"","columns":[{"id":"c1","name":"Архив","tasks":[]},{"id":"c2","name":"Текущее","tasks":[]},{"id":"c3","name":"Потом","tasks":[]}]}]}"#;
        let mut parsed: Workspace = serde_json::from_str(custom).unwrap();
        normalize_workspace(&mut parsed);
        let kinds: Vec<_> = parsed.boards[0].columns.iter().map(|c| c.kind).collect();
        assert_eq!(
            kinds,
            vec![
                Some(ColumnKind::Todo),
                Some(ColumnKind::Progress),
                Some(ColumnKind::Done)
            ]
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn backup_roundtrip_and_rejects_invalid() {
        let dir = dir();
        let path = dir.join("backup.json");
        let file = BackupFile {
            format: "sreda-backup".into(),
            version: 1,
            workspace: workspace(),
            documents: vec![],
            folders: vec![],
        };
        write_export(&path, &serde_json::to_vec(&file).unwrap()).unwrap();
        let loaded = read_backup_or_board(&path).unwrap();
        assert_eq!(loaded["format"], "sreda-backup");
        assert_eq!(loaded["workspace"]["boards"][0]["name"], "Работа");
        let board = BoardFile {
            format: "sreda-board".into(),
            version: 1,
            board: workspace().boards[0].clone(),
        };
        let board_path = dir.join("board.json");
        write_export(&board_path, &serde_json::to_vec(&board).unwrap()).unwrap();
        let as_board = read_backup_or_board(&board_path).unwrap();
        assert_eq!(as_board["format"], "sreda-board");
        let mut bad = file;
        bad.version = 3;
        std::fs::write(&path, serde_json::to_vec(&bad).unwrap()).unwrap();
        assert!(read_backup_or_board(&path).is_err());
        let mut with_docs = BackupFile {
            format: "sreda-backup".into(),
            version: 2,
            workspace: workspace(),
            documents: vec![crate::documents::BackupDocument {
                id: "doc-1".into(),
                title: "Заметка".into(),
                markdown: "# Текст".into(),
                revision: 1,
                folder_id: None,
                linked_card_id: None,
            }],
            folders: vec![],
        };
        validate_backup(&mut with_docs).unwrap();
        let v2 = dir.join("v2.json");
        write_export(&v2, &serde_json::to_vec(&with_docs).unwrap()).unwrap();
        let loaded = read_backup_or_board(&v2).unwrap();
        assert_eq!(loaded["version"], 2);
        assert_eq!(loaded["documents"][0]["title"], "Заметка");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
