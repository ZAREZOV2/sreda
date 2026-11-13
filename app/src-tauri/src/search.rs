use crate::storage::{Workspace, open};
use rusqlite::{Connection, params};
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub kind: String,
    pub id: String,
    pub title: String,
    pub snippet: String,
    pub board_id: Option<String>,
}

pub fn ensure(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(doc_id UNINDEXED, title, body, tokenize='unicode61');
         CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(card_id UNINDEXED, board_id UNINDEXED, title, body, tokenize='unicode61');
         CREATE TABLE IF NOT EXISTS doc_epoch (id INTEGER PRIMARY KEY CHECK(id=1), n INTEGER NOT NULL);
         INSERT OR IGNORE INTO doc_epoch(id, n) VALUES(1, 0);",
    )
    .map_err(|e| e.to_string())
}

pub fn bump_doc_epoch(conn: &Connection) -> Result<(), String> {
    ensure(conn)?;
    conn.execute("UPDATE doc_epoch SET n = n + 1 WHERE id=1", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn doc_epoch(path: &Path) -> Result<i64, String> {
    let conn = open(path)?;
    ensure(&conn)?;
    conn.query_row("SELECT n FROM doc_epoch WHERE id=1", [], |row| row.get(0))
        .map_err(|e| e.to_string())
}

pub fn fts_query(raw: &str) -> Option<String> {
    let mut parts = Vec::new();
    for token in raw.split_whitespace().take(8) {
        let clean: String = token
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
            .take(40)
            .collect();
        if clean.chars().count() < 2 || matches!(clean.to_ascii_uppercase().as_str(), "AND" | "OR" | "NOT" | "NEAR") {
            continue;
        }
        parts.push(format!("\"{clean}\""));
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" AND "))
    }
}

pub fn upsert_doc(conn: &Connection, id: &str, title: &str, body: &str) -> Result<(), String> {
    ensure(conn)?;
    conn.execute("DELETE FROM docs_fts WHERE doc_id=?1", [id])
        .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO docs_fts(doc_id, title, body) VALUES(?1, ?2, ?3)",
        params![id, title, body],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn remove_doc(conn: &Connection, id: &str) -> Result<(), String> {
    ensure(conn)?;
    conn.execute("DELETE FROM docs_fts WHERE doc_id=?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn reindex_cards(conn: &Connection, workspace: &Workspace) -> Result<(), String> {
    ensure(conn)?;
    conn.execute("DELETE FROM cards_fts", [])
        .map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("INSERT INTO cards_fts(card_id, board_id, title, body) VALUES(?1, ?2, ?3, ?4)")
        .map_err(|e| e.to_string())?;
    for board in &workspace.boards {
        for column in &board.columns {
            for task in &column.tasks {
                stmt.execute(params![task.id, board.id, task.title, task.description])
                    .map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

pub fn query(path: &Path, raw: &str, limit: usize) -> Result<Vec<Hit>, String> {
    let Some(match_query) = fts_query(raw) else {
        return Ok(Vec::new());
    };
    let limit = limit.clamp(1, 50) as i64;
    let conn = open(path)?;
    ensure(&conn)?;
    let mut hits = Vec::new();
    let mut docs = conn
        .prepare("SELECT doc_id, title, snippet(docs_fts, 2, '«', '»', '…', 12) FROM docs_fts WHERE docs_fts MATCH ?1 LIMIT ?2")
        .map_err(|e| e.to_string())?;
    let rows = docs
        .query_map(params![match_query, limit], |row| {
            Ok(Hit {
                kind: "doc".into(),
                id: row.get(0)?,
                title: row.get(1)?,
                snippet: row.get(2)?,
                board_id: None,
            })
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        hits.push(row.map_err(|e| e.to_string())?);
    }
    let mut cards = conn
        .prepare("SELECT card_id, title, snippet(cards_fts, 2, '«', '»', '…', 12), board_id FROM cards_fts WHERE cards_fts MATCH ?1 LIMIT ?2")
        .map_err(|e| e.to_string())?;
    let rows = cards
        .query_map(params![match_query, limit], |row| {
            Ok(Hit {
                kind: "card".into(),
                id: row.get(0)?,
                title: row.get(1)?,
                snippet: row.get(2)?,
                board_id: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        hits.push(row.map_err(|e| e.to_string())?);
    }
    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{self, Board, Column, ColumnKind, Task};

    fn task(id: &str, title: &str, description: &str) -> Task {
        Task {
            id: id.into(),
            title: title.into(),
            description: description.into(),
            label: String::new(),
            color: "gray".into(),
            priority: "low".into(),
            time_spent_ms: 0,
            recurrence: None,
            reminder_at: None,
            linked_doc_id: None,
        }
    }

    #[test]
    fn fts_finds_cyrillic_docs_and_cards() {
        let path = std::env::temp_dir().join(format!("sreda-fts-{}.sqlite", uuid::Uuid::new_v4()));
        let mut workspace = storage::load(&path).unwrap().workspace;
        workspace.boards.push(Board {
            id: "b1".into(),
            name: "Поиск".into(),
            description: String::new(),
            columns: vec![Column {
                id: "c1".into(),
                name: "Нужно сделать".into(),
                kind: Some(ColumnKind::Todo),
                tasks: vec![task("t1", "Макет экрана", "нужен поиск по карточкам")],
            }],
        });
        workspace.selected_board_id = Some("b1".into());
        storage::save(&path, &workspace, 0).unwrap();
        let conn = open(&path).unwrap();
        upsert_doc(&conn, "d1", "Заметка", "Полнотекстовый поиск документов").unwrap();
        let docs = query(&path, "поиск", 10).unwrap();
        assert!(docs.iter().any(|hit| hit.kind == "doc" && hit.id == "d1"));
        assert!(docs.iter().any(|hit| hit.kind == "card" && hit.id == "t1"));
        assert!(query(&path, "\" OR 1", 10).unwrap().is_empty());
        let _ = std::fs::remove_file(path);
    }
}
