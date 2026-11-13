use crate::search;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Document {
    pub id: String,
    pub title: String,
    pub markdown: String,
    pub revision: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub linked_card_id: Option<String>,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub updated_at: i64,
}

fn is_zero(value: &i64) -> bool {
    *value == 0
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Folder {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupDocument {
    pub id: String,
    pub title: String,
    pub markdown: String,
    pub revision: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub linked_card_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupFolder {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Revision {
    pub id: i64,
    pub title: String,
    pub markdown: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentMeta {
    pub id: String,
    pub doc_id: String,
    pub mime: String,
    pub name: String,
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

pub fn validate_backup_document(doc: &BackupDocument) -> Result<(), String> {
    if !valid_id(&doc.id)
        || doc.title.trim().is_empty()
        || doc.title.chars().count() > 200
        || doc.markdown.len() > 2 * 1024 * 1024
        || doc.title.contains('\0')
        || doc.markdown.contains('\0')
        || doc.revision < 0
    {
        return Err("Некорректный документ в резервной копии".into());
    }
    if doc.folder_id.as_ref().is_some_and(|id| !valid_id(id))
        || doc.linked_card_id.as_ref().is_some_and(|id| !valid_id(id))
    {
        return Err("Некорректная связь документа".into());
    }
    Ok(())
}

pub fn validate_backup_folder(folder: &BackupFolder) -> Result<(), String> {
    if !valid_id(&folder.id)
        || folder.name.trim().is_empty()
        || folder.name.chars().count() > 80
        || folder.name.contains('\0')
        || folder.revision < 0
        || folder.parent_id.as_ref().is_some_and(|id| !valid_id(id))
    {
        return Err("Некорректная папка в резервной копии".into());
    }
    Ok(())
}

fn validate_document(doc: &Document) -> Result<(), String> {
    validate_backup_document(&BackupDocument {
        id: doc.id.clone(),
        title: doc.title.clone(),
        markdown: doc.markdown.clone(),
        revision: doc.revision,
        folder_id: doc.folder_id.clone(),
        linked_card_id: doc.linked_card_id.clone(),
    })
}

pub(crate) fn open(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
         CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            markdown TEXT NOT NULL,
            revision INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS folders (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            parent_id TEXT,
            revision INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS document_revisions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            doc_id TEXT NOT NULL,
            title TEXT NOT NULL,
            markdown TEXT NOT NULL,
            created_at INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS attachments (
            id TEXT PRIMARY KEY,
            doc_id TEXT NOT NULL,
            mime TEXT NOT NULL,
            name TEXT NOT NULL,
            bytes BLOB NOT NULL,
            created_at INTEGER NOT NULL
         );",
    )
    .map_err(|e| e.to_string())?;
    ensure_column(&conn, "documents", "folder_id", "ALTER TABLE documents ADD COLUMN folder_id TEXT")?;
    ensure_column(&conn, "documents", "linked_card_id", "ALTER TABLE documents ADD COLUMN linked_card_id TEXT")?;
    ensure_column(
        &conn,
        "documents",
        "updated_at",
        "ALTER TABLE documents ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0",
    )?;
    search::ensure(&conn)?;
    Ok(conn)
}

fn ensure_column(conn: &Connection, table: &str, column: &str, alter: &str) -> Result<(), String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|e| e.to_string())?;
    let names = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?;
    for name in names {
        if name.map_err(|e| e.to_string())? == column {
            return Ok(());
        }
    }
    conn.execute(alter, []).map_err(|e| e.to_string())?;
    Ok(())
}

fn now_ms() -> i64 {
    crate::recurrence::now_ms()
}

pub fn list(path: &Path) -> Result<Vec<Document>, String> {
    let conn = open(path)?;
    let mut stmt = conn
        .prepare("SELECT id, title, markdown, revision, folder_id, linked_card_id, updated_at FROM documents ORDER BY title COLLATE NOCASE, id")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Document {
                id: row.get(0)?,
                title: row.get(1)?,
                markdown: row.get(2)?,
                revision: row.get(3)?,
                folder_id: row.get(4)?,
                linked_card_id: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn list_folders(path: &Path) -> Result<Vec<Folder>, String> {
    let conn = open(path)?;
    let mut stmt = conn
        .prepare("SELECT id, name, parent_id, revision FROM folders ORDER BY name COLLATE NOCASE, id")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Folder {
                id: row.get(0)?,
                name: row.get(1)?,
                parent_id: row.get(2)?,
                revision: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn save(path: &Path, doc: &Document) -> Result<i64, String> {
    validate_document(doc)?;
    if doc.revision == i64::MAX {
        return Err("Некорректный документ: название до 200 символов, текст до 2 МБ".into());
    }
    let conn = open(path)?;
    if let Some(folder) = &doc.folder_id {
        let exists: i64 = conn
            .query_row("SELECT COUNT(*) FROM folders WHERE id=?1", [folder], |row| row.get(0))
            .unwrap_or(0);
        if exists != 1 {
            return Err("Папка документа не найдена".into());
        }
    }
    let updated_at = now_ms();
    let changed = if doc.revision == 0 {
        conn.execute(
            "INSERT OR IGNORE INTO documents(id, title, markdown, revision, folder_id, linked_card_id, updated_at) VALUES(?1,?2,?3,1,?4,?5,?6)",
            params![doc.id, doc.title, doc.markdown, doc.folder_id, doc.linked_card_id, updated_at],
        )
    } else {
        conn.execute(
            "UPDATE documents SET title=?2, markdown=?3, revision=revision+1, folder_id=?4, linked_card_id=?5, updated_at=?6 WHERE id=?1 AND revision=?7",
            params![doc.id, doc.title, doc.markdown, doc.folder_id, doc.linked_card_id, updated_at, doc.revision],
        )
    }
    .map_err(|e| e.to_string())?;
    if changed != 1 {
        return Err("Документ изменён в другом окне. Экспортируйте черновик и перечитайте документы.".into());
    }
    conn.execute(
        "INSERT INTO document_revisions(doc_id, title, markdown, created_at) VALUES(?1,?2,?3,?4)",
        params![doc.id, doc.title, doc.markdown, updated_at],
    )
    .map_err(|e| e.to_string())?;
    prune_history(&conn, &doc.id)?;
    search::upsert_doc(&conn, &doc.id, &doc.title, &doc.markdown)?;
    search::bump_doc_epoch(&conn)?;
    Ok(doc.revision + 1)
}

pub fn keep_revisions(stamps: &[i64]) -> Vec<bool> {
    let count = stamps.len();
    if count <= 25 {
        return vec![true; count];
    }
    let mut keep = vec![false; count];
    let mut last: Option<i64> = None;
    for index in 0..(count - 25) {
        let stamp = stamps[index];
        if last.is_none_or(|previous| stamp.saturating_sub(previous) >= 3_600_000) {
            keep[index] = true;
            last = Some(stamp);
        }
    }
    for flag in keep.iter_mut().skip(count - 25) {
        *flag = true;
    }
    keep
}

fn prune_history(conn: &Connection, doc_id: &str) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT id, created_at FROM document_revisions WHERE doc_id=?1 ORDER BY created_at ASC, id ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([doc_id], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))
        .map_err(|e| e.to_string())?;
    let stored = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    let flags = keep_revisions(&stored.iter().map(|(_, stamp)| *stamp).collect::<Vec<_>>());
    for (flag, (id, _)) in flags.into_iter().zip(stored) {
        if !flag {
            conn.execute("DELETE FROM document_revisions WHERE id=?1", [id])
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub fn history(path: &Path, doc_id: &str) -> Result<Vec<Revision>, String> {
    if !valid_id(doc_id) {
        return Err("Некорректный документ".into());
    }
    let conn = open(path)?;
    let mut stmt = conn
        .prepare("SELECT id, title, markdown, created_at FROM document_revisions WHERE doc_id=?1 ORDER BY id DESC LIMIT 40")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([doc_id], |row| {
            Ok(Revision {
                id: row.get(0)?,
                title: row.get(1)?,
                markdown: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn save_folder(path: &Path, folder: &Folder) -> Result<i64, String> {
    validate_backup_folder(&BackupFolder {
        id: folder.id.clone(),
        name: folder.name.clone(),
        parent_id: folder.parent_id.clone(),
        revision: folder.revision,
    })?;
    if folder.parent_id.as_deref() == Some(folder.id.as_str()) {
        return Err("Папка не может быть внутри самой себя".into());
    }
    let conn = open(path)?;
    if let Some(parent) = &folder.parent_id {
        let exists: i64 = conn
            .query_row("SELECT COUNT(*) FROM folders WHERE id=?1", [parent], |row| row.get(0))
            .unwrap_or(0);
        if exists != 1 {
            return Err("Родительская папка не найдена".into());
        }
    }
    let changed = if folder.revision == 0 {
        conn.execute(
            "INSERT OR IGNORE INTO folders(id, name, parent_id, revision) VALUES(?1,?2,?3,1)",
            params![folder.id, folder.name.trim(), folder.parent_id],
        )
    } else {
        conn.execute(
            "UPDATE folders SET name=?2, parent_id=?3, revision=revision+1 WHERE id=?1 AND revision=?4",
            params![folder.id, folder.name.trim(), folder.parent_id, folder.revision],
        )
    }
    .map_err(|e| e.to_string())?;
    if changed != 1 {
        return Err("Папка изменена в другом окне".into());
    }
    search::bump_doc_epoch(&conn)?;
    Ok(folder.revision + 1)
}

pub fn delete_folder(path: &Path, id: &str) -> Result<(), String> {
    if !valid_id(id) {
        return Err("Некорректная папка".into());
    }
    let conn = open(path)?;
    conn.execute("UPDATE documents SET folder_id=NULL WHERE folder_id=?1", [id])
        .map_err(|e| e.to_string())?;
    conn.execute("UPDATE folders SET parent_id=NULL WHERE parent_id=?1", [id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM folders WHERE id=?1", [id])
        .map_err(|e| e.to_string())?;
    search::bump_doc_epoch(&conn)?;
    Ok(())
}

pub fn put_attachment(path: &Path, doc_id: &str, mime: &str, name: &str, bytes: &[u8]) -> Result<String, String> {
    if !valid_id(doc_id) {
        return Err("Некорректный документ".into());
    }
    if !matches!(mime, "image/png" | "image/jpeg" | "image/gif" | "image/webp") {
        return Err("Можно вставлять только изображения PNG, JPEG, GIF и WebP".into());
    }
    if bytes.len() > 4 * 1024 * 1024 || bytes.is_empty() {
        return Err("Изображение должно быть не пустым и не больше 4 МБ".into());
    }
    let safe_name: String = name.chars().filter(|c| !c.is_control()).take(80).collect();
    let id = format!("att-{}", uuid::Uuid::new_v4().simple());
    let conn = open(path)?;
    let exists: i64 = conn
        .query_row("SELECT COUNT(*) FROM documents WHERE id=?1", [doc_id], |row| row.get(0))
        .unwrap_or(0);
    if exists != 1 {
        return Err("Сначала сохраните документ".into());
    }
    conn.execute(
        "INSERT INTO attachments(id, doc_id, mime, name, bytes, created_at) VALUES(?1,?2,?3,?4,?5,?6)",
        params![id, doc_id, mime, safe_name, bytes, now_ms()],
    )
    .map_err(|e| e.to_string())?;
    Ok(id)
}

pub fn get_attachment(path: &Path, id: &str) -> Result<(String, Vec<u8>), String> {
    if !valid_id(id) {
        return Err("Некорректное вложение".into());
    }
    let conn = open(path)?;
    conn.query_row(
        "SELECT mime, bytes FROM attachments WHERE id=?1",
        [id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?)),
    )
    .map_err(|_| "Вложение не найдено".to_string())
}

pub fn sync_card_check(path: &Path, card_id: &str, checked: bool) -> Result<u32, String> {
    if !valid_id(card_id) {
        return Err("Некорректная карточка".into());
    }
    let mut changed = 0;
    for doc in list(path)? {
        let markdown = crate::checklist::set_checked(&doc.markdown, card_id, checked);
        if markdown == doc.markdown {
            continue;
        }
        let mut next = doc;
        next.markdown = markdown;
        save(path, &next)?;
        changed += 1;
    }
    Ok(changed)
}

pub fn backup_documents(path: &Path) -> Result<(Vec<BackupDocument>, Vec<BackupFolder>), String> {
    let documents = list(path)?
        .into_iter()
        .map(|doc| BackupDocument {
            id: doc.id,
            title: doc.title,
            markdown: doc.markdown,
            revision: doc.revision,
            folder_id: doc.folder_id,
            linked_card_id: doc.linked_card_id,
        })
        .collect();
    let folders = list_folders(path)?
        .into_iter()
        .map(|folder| BackupFolder {
            id: folder.id,
            name: folder.name,
            parent_id: folder.parent_id,
            revision: folder.revision,
        })
        .collect();
    Ok((documents, folders))
}

pub fn import_copies(
    path: &Path,
    documents: &[BackupDocument],
    folders: &[BackupFolder],
) -> Result<u32, String> {
    for folder in folders {
        validate_backup_folder(folder)?;
    }
    for document in documents {
        validate_backup_document(document)?;
    }
    let mut folder_ids = std::collections::HashMap::<String, String>::new();
    for folder in folders {
        let id = format!("folder-{}", uuid::Uuid::new_v4().simple());
        folder_ids.insert(folder.id.clone(), id.clone());
        save_folder(
            path,
            &Folder {
                id,
                name: folder.name.clone(),
                parent_id: None,
                revision: 0,
            },
        )?;
    }
    for folder in folders {
        let Some(parent) = &folder.parent_id else { continue };
        let Some(id) = folder_ids.get(&folder.id) else { continue };
        let Some(parent_id) = folder_ids.get(parent) else { continue };
        let current = list_folders(path)?
            .into_iter()
            .find(|item| &item.id == id);
        if let Some(mut current) = current {
            current.parent_id = Some(parent_id.clone());
            save_folder(path, &current)?;
        }
    }
    let mut count = 0;
    for document in documents {
        save(
            path,
            &Document {
                id: format!("doc-{}", uuid::Uuid::new_v4().simple()),
                title: document.title.clone(),
                markdown: document.markdown.clone(),
                revision: 0,
                folder_id: document.folder_id.as_ref().and_then(|id| folder_ids.get(id).cloned()),
                linked_card_id: None,
                updated_at: 0,
            },
        )?;
        count += 1;
    }
    Ok(count)
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VaultReport {
    pub exported: u32,
    pub imported: u32,
}

pub fn sync_vault(path: &Path, folder: &Path) -> Result<VaultReport, String> {
    if !folder.is_dir() {
        return Err("Нужна папка на диске".into());
    }
    let root = folder.canonicalize().map_err(|e| e.to_string())?;
    let mut exported = 0;
    let mut imported = 0;
    let mut files = 0u32;
    for entry in std::fs::read_dir(&root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.ends_with(".md") {
            files += 1;
        }
    }
    if files > 200 {
        return Err("В папке больше 200 markdown-файлов".into());
    }
    for doc in list(path)? {
        let filename = format!("{}.md", doc.id);
        let target = safe_md(&root, &filename)?;
        let file_newer = target
            .metadata()
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|time| time.as_millis() as i64 > doc.updated_at.saturating_add(1500))
            .unwrap_or(false);
        if file_newer {
            let bytes = std::fs::read(&target).map_err(|e| e.to_string())?;
            if bytes.len() > 2 * 1024 * 1024 {
                return Err("Файл в папке больше 2 МБ".into());
            }
            let markdown = String::from_utf8(bytes).map_err(|_| "Ожидался Markdown в UTF-8".to_string())?;
            let mut next = doc;
            next.markdown = markdown.trim_start_matches('\u{feff}').to_string();
            save(path, &next)?;
            imported += 1;
        } else {
            crate::storage::write_export(&target, doc.markdown.as_bytes())?;
            exported += 1;
        }
    }
    let known: std::collections::HashSet<String> = list(path)?.into_iter().map(|doc| doc.id).collect();
    for entry in std::fs::read_dir(&root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(id) = name.strip_suffix(".md") else { continue };
        if !valid_id(id) || known.contains(id) {
            continue;
        }
        let bytes = std::fs::read(entry.path()).map_err(|e| e.to_string())?;
        if bytes.len() > 2 * 1024 * 1024 {
            return Err("Файл в папке больше 2 МБ".into());
        }
        let markdown = String::from_utf8(bytes).map_err(|_| "Ожидался Markdown в UTF-8".to_string())?;
        save(path, &Document {
            id: id.to_string(),
            title: id.chars().take(200).collect(),
            markdown: markdown.trim_start_matches('\u{feff}').to_string(),
            revision: 0,
            folder_id: None,
            linked_card_id: None,
            updated_at: 0,
        })?;
        imported += 1;
    }
    Ok(VaultReport { exported, imported })
}

fn safe_md(root: &Path, name: &str) -> Result<std::path::PathBuf, String> {
    if !name.ends_with(".md") || name.len() > 120 || name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("Некорректное имя файла".into());
    }
    let path = root.join(name);
    if let Some(parent) = path.parent() {
        let parent = if parent.exists() { parent.canonicalize().map_err(|e| e.to_string())? } else { parent.to_path_buf() };
        if parent != root {
            return Err("Файл выходит за пределы папки".into());
        }
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persists_unicode_and_rejects_stale_writes() {
        let path = std::env::temp_dir().join(format!("sreda-docs-{}.sqlite", uuid::Uuid::new_v4()));
        let mut doc = Document {
            id: "doc-test".into(),
            title: "Заметка".into(),
            markdown: "# Привет\n- [ ] задача".into(),
            revision: 0,
            folder_id: None,
            linked_card_id: None,
            updated_at: 0,
        };
        assert!(list(&path).unwrap().is_empty());
        let workspace = crate::storage::load(&path).unwrap();
        assert_eq!(save(&path, &doc).unwrap(), 1);
        assert!(save(&path, &doc).is_err());
        doc.revision = 1;
        doc.markdown.push_str("\nИзменение");
        assert_eq!(save(&path, &doc).unwrap(), 2);
        assert!(save(&path, &doc).is_err());
        assert_eq!(list(&path).unwrap()[0].markdown, doc.markdown);
        assert_eq!(crate::storage::load(&path).unwrap().workspace, workspace.workspace);
        doc.title.clear();
        assert!(save(&path, &doc).is_err());
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn history_search_and_folder_roundtrip() {
        let path = std::env::temp_dir().join(format!("sreda-docs-more-{}.sqlite", uuid::Uuid::new_v4()));
        let folder = Folder {
            id: "folder-1".into(),
            name: "Заметки".into(),
            parent_id: None,
            revision: 0,
        };
        assert_eq!(save_folder(&path, &folder).unwrap(), 1);
        let doc = Document {
            id: "doc-1".into(),
            title: "Поиск".into(),
            markdown: "Уникальное слово квазимодо".into(),
            revision: 0,
            folder_id: Some("folder-1".into()),
            linked_card_id: None,
            updated_at: 0,
        };
        save(&path, &doc).unwrap();
        let hits = crate::search::query(&path, "квазимодо", 5).unwrap();
        assert!(hits.iter().any(|hit| hit.id == "doc-1"));
        assert_eq!(history(&path, "doc-1").unwrap().len(), 1);
        assert!(keep_revisions(&[0, 10, 3_600_000, 3_600_010]).iter().filter(|flag| **flag).count() >= 3);
        let _ = std::fs::remove_file(path);
    }
}
