use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Document {
    pub id: String,
    pub title: String,
    pub markdown: String,
    pub revision: i64,
}

fn open(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.busy_timeout(std::time::Duration::from_secs(5)).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, title TEXT NOT NULL, markdown TEXT NOT NULL, revision INTEGER NOT NULL);").map_err(|e| e.to_string())?;
    Ok(conn)
}

pub fn list(path: &Path) -> Result<Vec<Document>, String> {
    let conn = open(path)?;
    let mut stmt = conn.prepare("SELECT id,title,markdown,revision FROM documents ORDER BY title COLLATE NOCASE,id").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| Ok(Document { id: row.get(0)?, title: row.get(1)?, markdown: row.get(2)?, revision: row.get(3)? })).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn save(path: &Path, doc: &Document) -> Result<i64, String> {
    if doc.id.is_empty() || doc.id.len() > 100 || !doc.id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') || doc.title.trim().is_empty() || doc.title.chars().count() > 200 || doc.markdown.len() > 2 * 1024 * 1024 || doc.title.contains('\0') || doc.markdown.contains('\0') || doc.revision < 0 || doc.revision == i64::MAX {
        return Err("Некорректный документ: название до 200 символов, текст до 2 МБ".into());
    }
    let conn = open(path)?;
    let changed = if doc.revision == 0 {
        conn.execute("INSERT OR IGNORE INTO documents(id,title,markdown,revision) VALUES(?1,?2,?3,1)", params![doc.id, doc.title, doc.markdown])
    } else {
        conn.execute("UPDATE documents SET title=?2, markdown=?3, revision=revision+1 WHERE id=?1 AND revision=?4", params![doc.id, doc.title, doc.markdown, doc.revision])
    }.map_err(|e| e.to_string())?;
    if changed != 1 { return Err("Документ изменён в другом окне. Экспортируйте черновик и перечитайте документы.".into()); }
    Ok(doc.revision + 1)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn persists_unicode_and_rejects_stale_writes() {
        let path = std::env::temp_dir().join(format!("sreda-docs-{}.sqlite", uuid::Uuid::new_v4()));
        let mut doc = Document { id: "doc-test".into(), title: "Заметка".into(), markdown: "# Привет\n- [ ] задача".into(), revision: 0 };
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
        drop(std::fs::remove_file(path));
    }
}
