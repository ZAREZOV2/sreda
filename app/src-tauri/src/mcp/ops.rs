use crate::documents::{self, Document};
use crate::recurrence::{self, Recurrence};
use crate::search;
use crate::storage::{self, Board, Column, ColumnKind, Task, Workspace};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccessMode {
    Read,
    Write,
    Confirm,
}

#[derive(Debug, Clone)]
pub struct Policy {
    pub mode: AccessMode,
    pub boards: Option<HashSet<String>>,
    pub folders: Option<HashSet<String>>,
}

impl Policy {
    pub fn from_config(config: &crate::mcp::config::McpConfig) -> Self {
        let mode = match config.mode.as_str() {
            "read-write" => AccessMode::Write,
            "confirm" => AccessMode::Confirm,
            _ => AccessMode::Read,
        };
        let boards = if config.board_ids.is_empty() {
            None
        } else {
            Some(config.board_ids.iter().cloned().collect())
        };
        let folders = if config.folder_ids.is_empty() {
            None
        } else {
            Some(config.folder_ids.iter().cloned().collect())
        };
        Self { mode, boards, folders }
    }

    fn allows_board(&self, id: &str) -> bool {
        self.boards.as_ref().is_none_or(|ids| ids.contains(id))
    }

    fn allows_folder(&self, id: Option<&str>) -> bool {
        let Some(folders) = &self.folders else {
            return true;
        };
        id.is_some_and(|folder| folders.contains(folder))
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub result: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pending {
    pub id: String,
    pub tool: String,
    pub summary: String,
    pub payload: Value,
    pub created_at: i64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Audit {
    pub id: String,
    pub tool: String,
    pub summary: String,
    pub created_at: i64,
    pub undone: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientSeen {
    pub id: String,
    pub transport: String,
    pub label: String,
    pub seen_at: i64,
}

pub struct Gate {
    second: u64,
    count: u32,
}

impl Gate {
    pub fn new() -> Self {
        Self { second: 0, count: 0 }
    }

    pub fn allow(&mut self, now_sec: u64, limit: u32) -> bool {
        if self.second != now_sec {
            self.second = now_sec;
            self.count = 0;
        }
        if self.count >= limit {
            return false;
        }
        self.count += 1;
        true
    }
}

fn ensure(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS mcp_pending (
            id TEXT PRIMARY KEY,
            tool TEXT NOT NULL,
            summary TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            status TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS mcp_audit (
            id TEXT PRIMARY KEY,
            tool TEXT NOT NULL,
            summary TEXT NOT NULL,
            before_json TEXT NOT NULL,
            target_kind TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            undone INTEGER NOT NULL DEFAULT 0
         );
         CREATE TABLE IF NOT EXISTS mcp_clients (
            id TEXT PRIMARY KEY,
            transport TEXT NOT NULL,
            label TEXT NOT NULL,
            seen_at INTEGER NOT NULL
         );",
    )
    .map_err(|e| e.to_string())
}

fn with_conn<T>(path: &Path, body: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
    let conn = storage::open(path)?;
    ensure(&conn)?;
    body(&conn)
}

pub fn call(path: &Path, policy: &Policy, tool: &str, args: &Value, confirmed: bool) -> Result<Outcome, String> {
    if tool == "delete_card" && !confirmed {
        return enqueue(path, tool, "Удаление карточки ждёт подтверждения", args);
    }
    if is_write(tool) && policy.mode == AccessMode::Read {
        return Err("MCP-сервер открыт только для чтения".into());
    }
    if is_write(tool) && policy.mode == AccessMode::Confirm && !confirmed {
        return enqueue(path, tool, &format!("Действие «{tool}» ждёт подтверждения"), args);
    }
    let result = match tool {
        "list_boards" => list_boards(path, policy)?,
        "get_board" => get_board(path, policy, arg_str(args, "boardId")?)?,
        "create_board" => create_board(path, policy, arg_str(args, "name")?)?,
        "list_cards" => list_cards(path, policy, args)?,
        "get_card" => get_card(path, policy, arg_str(args, "cardId")?)?,
        "create_card" => create_card(path, policy, args)?,
        "update_card" => update_card(path, policy, args)?,
        "move_card" => move_card(path, policy, args)?,
        "delete_card" => delete_card(path, policy, args)?,
        "create_column" => create_column(path, policy, args)?,
        "update_column" => update_column(path, policy, args)?,
        "list_docs" => list_docs(path, policy)?,
        "read_doc" => read_doc(path, policy, arg_str(args, "docId")?)?,
        "create_doc" => create_doc(path, policy, args)?,
        "update_doc" => update_doc(path, policy, args)?,
        "search" => search(path, policy, args.get("query").and_then(|v| v.as_str()).unwrap_or(""))?,
        "link_doc_to_card" => link_doc_to_card(path, policy, args)?,
        "checklist_to_cards" => checklist_to_cards(path, policy, args)?,
        _ => return Err(format!("Неизвестный инструмент {tool}")),
    };
    Ok(Outcome {
        status: "ok".into(),
        id: None,
        result,
    })
}

fn is_write(tool: &str) -> bool {
    !matches!(tool, "list_boards" | "get_board" | "list_cards" | "get_card" | "list_docs" | "read_doc" | "search")
}

fn arg_str<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    args.get(key)
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("Нужно поле {key}"))
}

fn enqueue(path: &Path, tool: &str, summary: &str, payload: &Value) -> Result<Outcome, String> {
    let id = format!("pending-{}", uuid::Uuid::new_v4().simple());
    let created_at = recurrence::now_ms();
    with_conn(path, |conn| {
        conn.execute(
            "INSERT INTO mcp_pending(id, tool, summary, payload, created_at, status) VALUES(?1,?2,?3,?4,?5,'pending')",
            params![id, tool, summary, payload.to_string(), created_at],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;
    Ok(Outcome {
        status: "pending".into(),
        id: Some(id),
        result: json!({ "summary": summary }),
    })
}

pub fn list_pending(path: &Path) -> Result<Vec<Pending>, String> {
    with_conn(path, |conn| {
        let mut stmt = conn
            .prepare("SELECT id, tool, summary, payload, created_at, status FROM mcp_pending WHERE status='pending' ORDER BY created_at")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, String>(5)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut items = Vec::new();
        for row in rows {
            let (id, tool, summary, payload, created_at, status) = row.map_err(|e| e.to_string())?;
            items.push(Pending {
                id,
                tool,
                summary,
                payload: serde_json::from_str(&payload).unwrap_or(Value::Null),
                created_at,
                status,
            });
        }
        Ok(items)
    })
}

pub fn resolve_pending(path: &Path, id: &str, accept: bool) -> Result<Outcome, String> {
    let pending = list_pending(path)?
        .into_iter()
        .find(|item| item.id == id)
        .ok_or("Запрос уже обработан")?;
    if !accept {
        with_conn(path, |conn| {
            conn.execute("UPDATE mcp_pending SET status='rejected' WHERE id=?1", [id])
                .map_err(|e| e.to_string())?;
            Ok(())
        })?;
        return Ok(Outcome {
            status: "rejected".into(),
            id: Some(id.into()),
            result: json!({ "summary": pending.summary }),
        });
    }
    let mut policy = Policy::from_config(&crate::mcp::config::load(path));
    policy.mode = AccessMode::Write;
    let outcome = call(path, &policy, &pending.tool, &pending.payload, true)?;
    with_conn(path, |conn| {
        conn.execute("UPDATE mcp_pending SET status='applied' WHERE id=?1", [id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })?;
    Ok(outcome)
}

pub fn list_audit(path: &Path) -> Result<Vec<Audit>, String> {
    with_conn(path, |conn| {
        let mut stmt = conn
            .prepare("SELECT id, tool, summary, created_at, undone FROM mcp_audit ORDER BY created_at DESC LIMIT 100")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(Audit {
                    id: row.get(0)?,
                    tool: row.get(1)?,
                    summary: row.get(2)?,
                    created_at: row.get(3)?,
                    undone: row.get::<_, i64>(4)? != 0,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    })
}

pub fn undo(path: &Path, id: &str) -> Result<(), String> {
    let (before, kind, undone): (String, String, i64) = with_conn(path, |conn| {
        conn.query_row(
            "SELECT before_json, target_kind, undone FROM mcp_audit WHERE id=?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|_| "Запись журнала не найдена".to_string())
    })?;
    if undone != 0 {
        return Err("Это действие уже отменено".into());
    }
    if kind == "workspace" {
        let workspace: Workspace = serde_json::from_str(&before).map_err(|e| e.to_string())?;
        let current = storage::load(path)?;
        storage::save(path, &workspace, current.revision)?;
    } else if kind == "document" {
        let document: Document = serde_json::from_str(&before).map_err(|e| e.to_string())?;
        let mut current = documents::list(path)?
            .into_iter()
            .find(|doc| doc.id == document.id)
            .ok_or("Документ уже удалён")?;
        current.title = document.title;
        current.markdown = document.markdown;
        current.folder_id = document.folder_id;
        current.linked_card_id = document.linked_card_id;
        documents::save(path, &current)?;
    } else {
        return Err("Неизвестный тип отмены".into());
    }
    with_conn(path, |conn| {
        conn.execute("UPDATE mcp_audit SET undone=1 WHERE id=?1", [id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

pub fn touch_client(path: &Path, id: &str, transport: &str, label: &str) -> Result<(), String> {
    let seen_at = recurrence::now_ms();
    with_conn(path, |conn| {
        conn.execute(
            "INSERT INTO mcp_clients(id, transport, label, seen_at) VALUES(?1,?2,?3,?4)
             ON CONFLICT(id) DO UPDATE SET transport=?2, label=?3, seen_at=?4",
            params![id, transport, label.chars().take(120).collect::<String>(), seen_at],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

pub fn list_clients(path: &Path) -> Result<Vec<ClientSeen>, String> {
    with_conn(path, |conn| {
        let mut stmt = conn
            .prepare("SELECT id, transport, label, seen_at FROM mcp_clients ORDER BY seen_at DESC LIMIT 20")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(ClientSeen {
                    id: row.get(0)?,
                    transport: row.get(1)?,
                    label: row.get(2)?,
                    seen_at: row.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    })
}

fn record_workspace(path: &Path, tool: &str, summary: &str, before: &Workspace) -> Result<(), String> {
    let id = format!("audit-{}", uuid::Uuid::new_v4().simple());
    let before_json = serde_json::to_string(before).map_err(|e| e.to_string())?;
    with_conn(path, |conn| {
        conn.execute(
            "INSERT INTO mcp_audit(id, tool, summary, before_json, target_kind, created_at, undone) VALUES(?1,?2,?3,?4,'workspace',?5,0)",
            params![id, tool, summary, before_json, recurrence::now_ms()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

fn record_document(path: &Path, tool: &str, summary: &str, before: &Document) -> Result<(), String> {
    let id = format!("audit-{}", uuid::Uuid::new_v4().simple());
    let before_json = serde_json::to_string(before).map_err(|e| e.to_string())?;
    with_conn(path, |conn| {
        conn.execute(
            "INSERT INTO mcp_audit(id, tool, summary, before_json, target_kind, created_at, undone) VALUES(?1,?2,?3,?4,'document',?5,0)",
            params![id, tool, summary, before_json, recurrence::now_ms()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

fn require_board<'a>(workspace: &'a Workspace, policy: &Policy, id: &str) -> Result<&'a Board, String> {
    let board = workspace
        .boards
        .iter()
        .find(|board| board.id == id)
        .ok_or("Доска не найдена")?;
    if !policy.allows_board(&board.id) {
        return Err("Доска вне области доступа MCP".into());
    }
    Ok(board)
}

fn list_boards(path: &Path, policy: &Policy) -> Result<Value, String> {
    let snapshot = storage::load(path)?;
    let boards: Vec<_> = snapshot
        .workspace
        .boards
        .iter()
        .filter(|board| policy.allows_board(&board.id))
        .map(|board| {
            json!({
                "id": board.id,
                "name": board.name,
                "description": board.description,
                "columns": board.columns.len(),
            })
        })
        .collect();
    Ok(json!(boards))
}

fn get_board(path: &Path, policy: &Policy, id: &str) -> Result<Value, String> {
    let snapshot = storage::load(path)?;
    let board = require_board(&snapshot.workspace, policy, id)?;
    serde_json::to_value(board).map_err(|e| e.to_string())
}

fn create_board(path: &Path, policy: &Policy, name: &str) -> Result<Value, String> {
    if name.chars().count() > 120 || name.trim().is_empty() {
        return Err("Название доски — до 120 символов".into());
    }
    if policy.boards.is_some() {
        return Err("Создание доски доступно, когда область MCP — все доски".into());
    }
    let before = storage::load(path)?.workspace;
    let board = fresh_board(name.trim());
    let id = board.id.clone();
    storage::update(path, |workspace| {
        workspace.boards.push(board.clone());
        workspace.selected_board_id = Some(id.clone());
        Ok(())
    })?;
    record_workspace(path, "create_board", &format!("Создана доска «{name}»"), &before)?;
    get_board(path, &open_policy(), &id)
}

fn open_policy() -> Policy {
    Policy { mode: AccessMode::Write, boards: None, folders: None }
}

fn fresh_board(name: &str) -> Board {
    let ident = || format!("id-{}", uuid::Uuid::new_v4().simple());
    Board {
        id: ident(),
        name: name.into(),
        description: String::new(),
        columns: vec![
            Column { id: ident(), name: "Нужно сделать".into(), kind: Some(ColumnKind::Todo), tasks: vec![] },
            Column { id: ident(), name: "В работе".into(), kind: Some(ColumnKind::Progress), tasks: vec![] },
            Column { id: ident(), name: "Готово".into(), kind: Some(ColumnKind::Done), tasks: vec![] },
        ],
    }
}

fn list_cards(path: &Path, policy: &Policy, args: &Value) -> Result<Value, String> {
    let snapshot = storage::load(path)?;
    let text = args.get("text").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
    let label = args.get("label").and_then(|v| v.as_str());
    let priority = args.get("priority").and_then(|v| v.as_str());
    let column_id = args.get("columnId").and_then(|v| v.as_str());
    let kind = args.get("kind").and_then(|v| v.as_str());
    let board_id = args.get("boardId").and_then(|v| v.as_str());
    let mut cards = Vec::new();
    for board in &snapshot.workspace.boards {
        if let Some(expected) = board_id {
            if board.id != expected {
                continue;
            }
        }
        if !policy.allows_board(&board.id) {
            continue;
        }
        for column in &board.columns {
            if column_id.is_some_and(|id| column.id != id) {
                continue;
            }
            if kind.is_some_and(|expected| column.kind.map(|k| kind_name(k) != expected).unwrap_or(true)) {
                continue;
            }
            for task in &column.tasks {
                if label.is_some_and(|value| task.label != value) || priority.is_some_and(|value| task.priority != value) {
                    continue;
                }
                if !text.is_empty()
                    && !task.title.to_lowercase().contains(&text)
                    && !task.description.to_lowercase().contains(&text)
                {
                    continue;
                }
                cards.push(json!({
                    "id": task.id,
                    "title": task.title,
                    "boardId": board.id,
                    "columnId": column.id,
                    "kind": column.kind.map(kind_name),
                    "label": task.label,
                    "priority": task.priority,
                }));
            }
        }
    }
    Ok(json!(cards))
}

fn kind_name(kind: ColumnKind) -> &'static str {
    match kind {
        ColumnKind::Todo => "todo",
        ColumnKind::Progress => "progress",
        ColumnKind::Done => "done",
    }
}

fn parse_kind(value: &str) -> Result<ColumnKind, String> {
    match value {
        "todo" => Ok(ColumnKind::Todo),
        "progress" => Ok(ColumnKind::Progress),
        "done" => Ok(ColumnKind::Done),
        _ => Err("Тип колонки: todo, progress или done".into()),
    }
}

fn find_card(workspace: &Workspace, card_id: &str) -> Result<(String, String), String> {
    for board in &workspace.boards {
        for column in &board.columns {
            if column.tasks.iter().any(|task| task.id == card_id) {
                return Ok((board.id.clone(), column.id.clone()));
            }
        }
    }
    Err("Карточка не найдена".into())
}

fn get_card(path: &Path, policy: &Policy, card_id: &str) -> Result<Value, String> {
    let snapshot = storage::load(path)?;
    let (board_id, column_id) = find_card(&snapshot.workspace, card_id)?;
    let board = require_board(&snapshot.workspace, policy, &board_id)?;
    let column = board.columns.iter().find(|column| column.id == column_id).unwrap();
    let task = column.tasks.iter().find(|task| task.id == card_id).unwrap();
    Ok(json!({ "boardId": board.id, "columnId": column.id, "task": task }))
}

fn task_from_args(args: &Value, id: String) -> Result<Task, String> {
    let title = arg_str(args, "title")?;
    if title.chars().count() > 300 {
        return Err("Название карточки слишком длинное".into());
    }
    let color = args.get("color").and_then(|v| v.as_str()).unwrap_or("gray");
    let priority = args.get("priority").and_then(|v| v.as_str()).unwrap_or("medium");
    let description = args.get("description").and_then(|v| v.as_str()).unwrap_or("");
    let label = args.get("label").and_then(|v| v.as_str()).unwrap_or("");
    Ok(Task {
        id,
        title: title.into(),
        description: description.into(),
        label: label.into(),
        color: color.into(),
        priority: priority.into(),
        time_spent_ms: args.get("timeSpentMs").and_then(|v| v.as_i64()).unwrap_or(0),
        recurrence: args.get("recurrence").and_then(|v| serde_json::from_value::<Recurrence>(v.clone()).ok()),
        reminder_at: args.get("reminderAt").and_then(|v| v.as_i64()),
        linked_doc_id: args.get("linkedDocId").and_then(|v| v.as_str()).map(str::to_string),
    })
}

fn create_card(path: &Path, policy: &Policy, args: &Value) -> Result<Value, String> {
    let board_id = arg_str(args, "boardId")?.to_string();
    let column_id = arg_str(args, "columnId")?.to_string();
    let task = task_from_args(args, format!("task-{}", uuid::Uuid::new_v4().simple()))?;
    let before = storage::load(path)?.workspace;
    require_board(&before, policy, &board_id)?;
    let card_id = task.id.clone();
    storage::update(path, |workspace| {
        let board = workspace.boards.iter_mut().find(|board| board.id == board_id).ok_or("Доска не найдена")?;
        let column = board.columns.iter_mut().find(|column| column.id == column_id).ok_or("Колонка не найдена")?;
        column.tasks.push(task.clone());
        Ok(())
    })?;
    record_workspace(path, "create_card", &format!("Создана карточка «{}»", task.title), &before)?;
    get_card(path, &open_policy(), &card_id)
}

fn update_card(path: &Path, policy: &Policy, args: &Value) -> Result<Value, String> {
    let card_id = arg_str(args, "cardId")?.to_string();
    let before = storage::load(path)?.workspace;
    let (board_id, _) = find_card(&before, &card_id)?;
    require_board(&before, policy, &board_id)?;
    storage::update(path, |workspace| {
        let (board_id, column_id) = find_card(workspace, &card_id)?;
        let board = workspace.boards.iter_mut().find(|board| board.id == board_id).unwrap();
        let column = board.columns.iter_mut().find(|column| column.id == column_id).unwrap();
        let task = column.tasks.iter_mut().find(|task| task.id == card_id).unwrap();
        if let Some(title) = args.get("title").and_then(|v| v.as_str()) {
            task.title = title.trim().to_string();
        }
        if let Some(description) = args.get("description").and_then(|v| v.as_str()) {
            task.description = description.to_string();
        }
        if let Some(label) = args.get("label").and_then(|v| v.as_str()) {
            task.label = label.to_string();
        }
        if let Some(color) = args.get("color").and_then(|v| v.as_str()) {
            task.color = color.to_string();
        }
        if let Some(priority) = args.get("priority").and_then(|v| v.as_str()) {
            task.priority = priority.to_string();
        }
        if let Some(spent) = args.get("timeSpentMs").and_then(|v| v.as_i64()) {
            task.time_spent_ms = spent;
        }
        if args.get("recurrence").is_some() {
            task.recurrence = args.get("recurrence").and_then(|v| if v.is_null() { None } else { serde_json::from_value(v.clone()).ok() });
        }
        if args.get("reminderAt").is_some() {
            task.reminder_at = args.get("reminderAt").and_then(|v| v.as_i64());
        }
        Ok(())
    })?;
    record_workspace(path, "update_card", "Карточка обновлена", &before)?;
    get_card(path, &open_policy(), &card_id)
}

fn move_card(path: &Path, policy: &Policy, args: &Value) -> Result<Value, String> {
    let card_id = arg_str(args, "cardId")?.to_string();
    let column_id = arg_str(args, "columnId")?.to_string();
    let before = storage::load(path)?.workspace;
    let (board_id, from_column) = find_card(&before, &card_id)?;
    let board = require_board(&before, policy, &board_id)?;
    let from_done = board.columns.iter().find(|column| column.id == from_column).and_then(|column| column.kind) == Some(ColumnKind::Done);
    let to_done = board.columns.iter().find(|column| column.id == column_id).and_then(|column| column.kind) == Some(ColumnKind::Done);
    storage::update(path, |workspace| {
        let board = workspace.boards.iter_mut().find(|board| board.id == board_id).ok_or("Доска не найдена")?;
        let mut task = None;
        for column in &mut board.columns {
            if let Some(index) = column.tasks.iter().position(|task| task.id == card_id) {
                task = Some(column.tasks.remove(index));
                break;
            }
        }
        let task = task.ok_or("Карточка не найдена")?;
        let column = board.columns.iter_mut().find(|column| column.id == column_id).ok_or("Колонка не найдена")?;
        column.tasks.push(task);
        recurrence::spawn_if_completed(board, &card_id, !from_done && to_done);
        Ok(())
    })?;
    if to_done {
        let _ = documents::sync_card_check(path, &card_id, true);
    } else if from_done {
        let _ = documents::sync_card_check(path, &card_id, false);
    }
    record_workspace(path, "move_card", "Карточка перенесена", &before)?;
    get_card(path, &open_policy(), &card_id).or_else(|_| Ok(json!({ "spawned": true })))
}

fn delete_card(path: &Path, policy: &Policy, args: &Value) -> Result<Value, String> {
    let card_id = arg_str(args, "cardId")?.to_string();
    let before = storage::load(path)?.workspace;
    let (board_id, _) = find_card(&before, &card_id)?;
    require_board(&before, policy, &board_id)?;
    storage::update(path, |workspace| {
        for board in &mut workspace.boards {
            for column in &mut board.columns {
                column.tasks.retain(|task| task.id != card_id);
            }
        }
        Ok(())
    })?;
    record_workspace(path, "delete_card", "Карточка удалена", &before)?;
    Ok(json!({ "deleted": card_id }))
}

fn create_column(path: &Path, policy: &Policy, args: &Value) -> Result<Value, String> {
    let board_id = arg_str(args, "boardId")?.to_string();
    let name = arg_str(args, "name")?.to_string();
    let kind = parse_kind(args.get("kind").and_then(|v| v.as_str()).unwrap_or("todo"))?;
    let before = storage::load(path)?.workspace;
    require_board(&before, policy, &board_id)?;
    let column_id = format!("col-{}", uuid::Uuid::new_v4().simple());
    storage::update(path, |workspace| {
        let board = workspace.boards.iter_mut().find(|board| board.id == board_id).ok_or("Доска не найдена")?;
        board.columns.push(Column {
            id: column_id.clone(),
            name: name.clone(),
            kind: Some(kind),
            tasks: vec![],
        });
        Ok(())
    })?;
    record_workspace(path, "create_column", &format!("Создана колонка «{name}»"), &before)?;
    Ok(json!({ "id": column_id }))
}

fn update_column(path: &Path, policy: &Policy, args: &Value) -> Result<Value, String> {
    let board_id = arg_str(args, "boardId")?.to_string();
    let column_id = arg_str(args, "columnId")?.to_string();
    let before = storage::load(path)?.workspace;
    require_board(&before, policy, &board_id)?;
    storage::update(path, |workspace| {
        let board = workspace.boards.iter_mut().find(|board| board.id == board_id).ok_or("Доска не найдена")?;
        let column = board.columns.iter_mut().find(|column| column.id == column_id).ok_or("Колонка не найдена")?;
        if let Some(name) = args.get("name").and_then(|v| v.as_str()) {
            column.name = name.trim().to_string();
        }
        if let Some(kind) = args.get("kind").and_then(|v| v.as_str()) {
            column.kind = Some(parse_kind(kind)?);
        }
        Ok(())
    })?;
    record_workspace(path, "update_column", "Колонка обновлена", &before)?;
    Ok(json!({ "id": column_id }))
}

fn list_docs(path: &Path, policy: &Policy) -> Result<Value, String> {
    let docs: Vec<_> = documents::list(path)?
        .into_iter()
        .filter(|doc| policy.allows_folder(doc.folder_id.as_deref()))
        .map(|doc| json!({ "id": doc.id, "title": doc.title, "folderId": doc.folder_id, "revision": doc.revision, "linkedCardId": doc.linked_card_id }))
        .collect();
    Ok(json!(docs))
}

fn read_doc(path: &Path, policy: &Policy, id: &str) -> Result<Value, String> {
    let doc = documents::list(path)?.into_iter().find(|doc| doc.id == id).ok_or("Документ не найден")?;
    if !policy.allows_folder(doc.folder_id.as_deref()) {
        return Err("Документ вне области доступа MCP".into());
    }
    serde_json::to_value(doc).map_err(|e| e.to_string())
}

fn create_doc(path: &Path, policy: &Policy, args: &Value) -> Result<Value, String> {
    let title = arg_str(args, "title")?;
    let folder_id = args.get("folderId").and_then(|v| v.as_str()).map(str::to_string);
    if !policy.allows_folder(folder_id.as_deref()) {
        return Err("Папка вне области доступа MCP".into());
    }
    let doc = Document {
        id: format!("doc-{}", uuid::Uuid::new_v4().simple()),
        title: title.into(),
        markdown: args.get("markdown").and_then(|v| v.as_str()).unwrap_or("").into(),
        revision: 0,
        folder_id,
        linked_card_id: None,
        updated_at: 0,
    };
    let id = doc.id.clone();
    documents::save(path, &doc)?;
    read_doc(path, &open_policy(), &id)
}

fn update_doc(path: &Path, policy: &Policy, args: &Value) -> Result<Value, String> {
    let id = arg_str(args, "docId")?.to_string();
    let mut doc = documents::list(path)?.into_iter().find(|doc| doc.id == id).ok_or("Документ не найден")?;
    if !policy.allows_folder(doc.folder_id.as_deref()) {
        return Err("Документ вне области доступа MCP".into());
    }
    let before = doc.clone();
    if let Some(title) = args.get("title").and_then(|v| v.as_str()) {
        doc.title = title.to_string();
    }
    if let Some(markdown) = args.get("markdown").and_then(|v| v.as_str()) {
        doc.markdown = markdown.to_string();
    }
    documents::save(path, &doc)?;
    record_document(path, "update_doc", &format!("Документ «{}» обновлён", before.title), &before)?;
    read_doc(path, &open_policy(), &id)
}

fn search(path: &Path, policy: &Policy, query: &str) -> Result<Value, String> {
    let hits = search::query(path, query, 30)?;
    let snapshot = storage::load(path)?;
    let docs = documents::list(path)?;
    let filtered: Vec<_> = hits
        .into_iter()
        .filter(|hit| match hit.kind.as_str() {
            "card" => hit.board_id.as_deref().is_some_and(|id| policy.allows_board(id)),
            "doc" => docs.iter().find(|doc| doc.id == hit.id).is_some_and(|doc| policy.allows_folder(doc.folder_id.as_deref())),
            _ => false,
        })
        .collect();
    let _ = snapshot;
    serde_json::to_value(filtered).map_err(|e| e.to_string())
}

fn link_doc_to_card(path: &Path, policy: &Policy, args: &Value) -> Result<Value, String> {
    let doc_id = arg_str(args, "docId")?.to_string();
    let card_id = arg_str(args, "cardId")?.to_string();
    let mut doc = documents::list(path)?.into_iter().find(|doc| doc.id == doc_id).ok_or("Документ не найден")?;
    if !policy.allows_folder(doc.folder_id.as_deref()) {
        return Err("Документ вне области доступа MCP".into());
    }
    let before_doc = doc.clone();
    let before = storage::load(path)?.workspace;
    let (board_id, _) = find_card(&before, &card_id)?;
    require_board(&before, policy, &board_id)?;
    doc.linked_card_id = Some(card_id.clone());
    documents::save(path, &doc)?;
    let saved = storage::update(path, |workspace| {
        for board in &mut workspace.boards {
            for column in &mut board.columns {
                if let Some(task) = column.tasks.iter_mut().find(|task| task.id == card_id) {
                    task.linked_doc_id = Some(doc_id.clone());
                }
            }
        }
        Ok(())
    });
    if let Err(error) = saved {
        let _ = documents::save(path, &before_doc);
        return Err(error);
    }
    record_workspace(path, "link_doc_to_card", "Документ связан с карточкой", &before)?;
    record_document(path, "link_doc_to_card", "Документ связан с карточкой", &before_doc)?;
    Ok(json!({ "docId": doc_id, "cardId": card_id }))
}

fn checklist_to_cards(path: &Path, policy: &Policy, args: &Value) -> Result<Value, String> {
    let doc_id = arg_str(args, "docId")?.to_string();
    let board_id = arg_str(args, "boardId")?.to_string();
    let column_id = arg_str(args, "columnId")?.to_string();
    let mut doc = documents::list(path)?.into_iter().find(|doc| doc.id == doc_id).ok_or("Документ не найден")?;
    if !policy.allows_folder(doc.folder_id.as_deref()) {
        return Err("Документ вне области доступа MCP".into());
    }
    let before = storage::load(path)?.workspace;
    require_board(&before, policy, &board_id)?;
    let before_doc = doc.clone();
    let mut created = Vec::new();
    let mut markdown = doc.markdown.clone();
    for mut item in crate::checklist::parse(&doc.markdown) {
        if item.checked || item.card_id.is_some() || item.text.trim().is_empty() {
            continue;
        }
        let id = format!("task-{}", uuid::Uuid::new_v4().simple());
        item.card_id = Some(id.clone());
        markdown = crate::checklist::replace_line(&markdown, &item);
        created.push((id, item.text));
    }
    if created.is_empty() {
        return Ok(json!({ "created": [] }));
    }
    doc.markdown = markdown;
    let revision = storage::update(path, |workspace| {
        let board = workspace.boards.iter_mut().find(|board| board.id == board_id).ok_or("Доска не найдена")?;
        let column = board.columns.iter_mut().find(|column| column.id == column_id).ok_or("Колонка не найдена")?;
        for (id, title) in &created {
            column.tasks.push(recurrence::blank_task(id, title));
        }
        Ok(())
    })?;
    if let Err(error) = documents::save(path, &doc) {
        let current = storage::load(path)?;
        let _ = storage::save(path, &before, current.revision);
        return Err(error);
    }
    record_workspace(path, "checklist_to_cards", "Чек-лист стал карточками", &before)?;
    record_document(path, "checklist_to_cards", "Чек-лист связан с карточками", &before_doc)?;
    let _ = revision;
    Ok(json!({ "created": created.into_iter().map(|(id, title)| json!({ "id": id, "title": title })).collect::<Vec<_>>() }))
}

pub fn resource(path: &Path, uri: &str) -> Result<(String, String), String> {
    let policy = Policy::from_config(&crate::mcp::config::load(path));
    if let Some(id) = uri.strip_prefix("sreda://board/") {
        let value = get_board(path, &policy, id)?;
        return Ok(("application/json".into(), value.to_string()));
    }
    if let Some(id) = uri.strip_prefix("sreda://doc/") {
        let value = read_doc(path, &policy, id)?;
        let markdown = value.get("markdown").and_then(|v| v.as_str()).unwrap_or("");
        return Ok(("text/markdown".into(), markdown.into()));
    }
    Err("Неизвестный ресурс".into())
}

pub fn prompt(path: &Path, name: &str, board_id: Option<&str>) -> Result<String, String> {
    let policy = Policy::from_config(&crate::mcp::config::load(path));
    let board = if let Some(id) = board_id {
        serde_json::to_string_pretty(&get_board(path, &policy, id)?).unwrap_or_default()
    } else {
        serde_json::to_string_pretty(&list_boards(path, &policy)?).unwrap_or_default()
    };
    let text = match name {
        "split_spec" => format!("Разбей техническое задание на карточки канбана «Среды». Сначала прочитай документ, затем создай карточки в колонке «Нужно сделать». Не удаляй существующие карточки.\n\nКонтекст досок:\n{board}"),
        "retro" => format!("Сделай ретроспективу по доске: что готово, что застряло, какие следующие три шага. Не меняй доску, пока человек не попросит.\n\n{board}"),
        "week_summary" => format!("Собери короткую сводку за неделю по карточкам и документам: сделано, в работе, риски.\n\n{board}"),
        _ => return Err("Неизвестный шаблон".into()),
    };
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("sreda-mcp-{}.sqlite", uuid::Uuid::new_v4()));
        let _ = storage::load(&path).unwrap();
        path
    }

    #[test]
    fn read_only_blocks_writes_and_delete_waits() {
        let path = db();
        let policy = Policy { mode: AccessMode::Read, boards: None, folders: None };
        assert!(call(&path, &policy, "create_board", &json!({"name": "Секрет"}), false).is_err());
        let write = Policy { mode: AccessMode::Write, boards: None, folders: None };
        let created = call(&path, &write, "create_board", &json!({"name": "План"}), false).unwrap();
        let board_id = created.result["id"].as_str().unwrap().to_string();
        let column_id = created.result["columns"][0]["id"].as_str().unwrap().to_string();
        let card = call(&path, &write, "create_card", &json!({"boardId": board_id, "columnId": column_id, "title": "Черновик"}), false).unwrap();
        let card_id = card.result["task"]["id"].as_str().unwrap();
        let pending = call(&path, &write, "delete_card", &json!({"cardId": card_id}), false).unwrap();
        assert_eq!(pending.status, "pending");
        assert!(get_card(&path, &write, card_id).is_ok());
        resolve_pending(&path, pending.id.as_deref().unwrap(), true).unwrap();
        assert!(get_card(&path, &write, card_id).is_err());
        let audit = list_audit(&path).unwrap();
        let entry = audit.iter().find(|item| item.tool == "delete_card").unwrap();
        undo(&path, &entry.id).unwrap();
        assert!(get_card(&path, &write, card_id).is_ok());
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn search_and_checklist_tools() {
        let path = db();
        let write = Policy { mode: AccessMode::Write, boards: None, folders: None };
        let doc = call(&path, &write, "create_doc", &json!({"title": "ТЗ", "markdown": "- [ ] Сверстать\n- [x] Уже есть"}), false).unwrap();
        let doc_id = doc.result["id"].as_str().unwrap();
        let board = call(&path, &write, "create_board", &json!({"name": "Сборка"}), false).unwrap();
        let board_id = board.result["id"].as_str().unwrap();
        let column_id = board.result["columns"][0]["id"].as_str().unwrap();
        let made = call(&path, &write, "checklist_to_cards", &json!({"docId": doc_id, "boardId": board_id, "columnId": column_id}), false).unwrap();
        assert_eq!(made.result["created"].as_array().unwrap().len(), 1);
        let hits = call(&path, &write, "search", &json!({"query": "Сверстать"}), false).unwrap();
        assert!(hits.result.as_array().unwrap().iter().any(|hit| hit["kind"] == "card" || hit["title"] == "ТЗ"));
        let mut gate = Gate::new();
        assert!(gate.allow(1, 2));
        assert!(gate.allow(1, 2));
        assert!(!gate.allow(1, 2));
        assert!(gate.allow(2, 2));
        let _ = std::fs::remove_file(path);
    }
}
