use crate::mcp::{config, ops};
use rmcp::{
    ErrorData as McpError, RoleServer, ServerHandler, ServiceExt,
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::*,
    service::RequestContext,
    tool, tool_handler, tool_router,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

#[derive(Clone)]
pub struct SredaMcp {
    db: std::sync::Arc<PathBuf>,
    tool_router: ToolRouter<Self>,
}

fn gate() -> &'static Mutex<ops::Gate> {
    static GATE: OnceLock<Mutex<ops::Gate>> = OnceLock::new();
    GATE.get_or_init(|| Mutex::new(ops::Gate::new()))
}

fn tool_error(message: String) -> McpError {
    McpError::invalid_params(message, None)
}

impl SredaMcp {
    pub fn new(db: PathBuf) -> Self {
        Self {
            db: std::sync::Arc::new(db),
            tool_router: Self::tool_router(),
        }
    }

    fn invoke(&self, name: &str, args: Value) -> Result<CallToolResult, McpError> {
        let settings = config::load(&self.db);
        if !settings.enabled {
            return Err(tool_error("MCP выключен в настройках «Среды»".into()));
        }
        let now = crate::recurrence::now_ms() / 1000;
        let allowed = gate().lock().map(|mut gate| gate.allow(now as u64, 30)).unwrap_or(false);
        if !allowed {
            return Err(tool_error("Слишком много запросов MCP. Подождите секунду.".into()));
        }
        let _ = ops::touch_client(&self.db, "mcp", "mcp", name);
        let policy = ops::Policy::from_config(&settings);
        let outcome = ops::call(&self.db, &policy, name, &args, false).map_err(tool_error)?;
        let text = serde_json::to_string(&outcome).unwrap_or_else(|_| "{}".into());
        Ok(CallToolResult::success(vec![Content::text(text)]))
    }
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct BoardArgs {
    board_id: String,
}
#[derive(Debug, Deserialize, Serialize, JsonSchema)]
struct NameArgs {
    name: String,
}
#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct ListCardArgs {
    #[serde(default)]
    board_id: Option<String>,
    #[serde(default)]
    column_id: Option<String>,
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    label: Option<String>,
    #[serde(default)]
    priority: Option<String>,
    #[serde(default)]
    text: Option<String>,
}
#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct CardIdArgs {
    card_id: String,
}
#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct CardWriteArgs {
    #[serde(default)]
    board_id: Option<String>,
    #[serde(default)]
    column_id: Option<String>,
    #[serde(default)]
    card_id: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    label: Option<String>,
    #[serde(default)]
    color: Option<String>,
    #[serde(default)]
    priority: Option<String>,
    #[serde(default)]
    time_spent_ms: Option<i64>,
    #[serde(default)]
    reminder_at: Option<i64>,
}
#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct ColumnArgs {
    board_id: String,
    #[serde(default)]
    column_id: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    kind: Option<String>,
}
#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct DocArgs {
    #[serde(default)]
    doc_id: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    markdown: Option<String>,
    #[serde(default)]
    folder_id: Option<String>,
}
#[derive(Debug, Deserialize, Serialize, JsonSchema)]
struct SearchArgs {
    query: String,
}
#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct LinkArgs {
    doc_id: String,
    card_id: String,
}
#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct ChecklistArgs {
    doc_id: String,
    board_id: String,
    column_id: String,
}

#[tool_router]
impl SredaMcp {
    #[tool(description = "Список досок")]
    fn list_boards(&self) -> Result<CallToolResult, McpError> {
        self.invoke("list_boards", json!({}))
    }
    #[tool(description = "Доска целиком")]
    fn get_board(&self, Parameters(args): Parameters<BoardArgs>) -> Result<CallToolResult, McpError> {
        self.invoke("get_board", serde_json::to_value(args).unwrap_or(json!({})))
    }
    #[tool(description = "Создать доску")]
    fn create_board(&self, Parameters(args): Parameters<NameArgs>) -> Result<CallToolResult, McpError> {
        self.invoke("create_board", json!({ "name": args.name }))
    }
    #[tool(description = "Список карточек с фильтрами")]
    fn list_cards(&self, Parameters(args): Parameters<ListCardArgs>) -> Result<CallToolResult, McpError> {
        self.invoke("list_cards", serde_json::to_value(args).unwrap_or(json!({})))
    }
    #[tool(description = "Одна карточка")]
    fn get_card(&self, Parameters(args): Parameters<CardIdArgs>) -> Result<CallToolResult, McpError> {
        self.invoke("get_card", json!({ "cardId": args.card_id }))
    }
    #[tool(description = "Создать карточку")]
    fn create_card(&self, Parameters(args): Parameters<CardWriteArgs>) -> Result<CallToolResult, McpError> {
        self.invoke("create_card", serde_json::to_value(args).unwrap_or(json!({})))
    }
    #[tool(description = "Обновить карточку")]
    fn update_card(&self, Parameters(args): Parameters<CardWriteArgs>) -> Result<CallToolResult, McpError> {
        self.invoke("update_card", serde_json::to_value(args).unwrap_or(json!({})))
    }
    #[tool(description = "Перенести карточку в колонку")]
    fn move_card(&self, Parameters(args): Parameters<CardWriteArgs>) -> Result<CallToolResult, McpError> {
        self.invoke("move_card", serde_json::to_value(args).unwrap_or(json!({})))
    }
    #[tool(description = "Удалить карточку. Всегда ждёт подтверждения в интерфейсе.")]
    fn delete_card(&self, Parameters(args): Parameters<CardIdArgs>) -> Result<CallToolResult, McpError> {
        self.invoke("delete_card", json!({ "cardId": args.card_id }))
    }
    #[tool(description = "Создать колонку")]
    fn create_column(&self, Parameters(args): Parameters<ColumnArgs>) -> Result<CallToolResult, McpError> {
        self.invoke("create_column", serde_json::to_value(args).unwrap_or(json!({})))
    }
    #[tool(description = "Обновить колонку, включая тип todo/progress/done")]
    fn update_column(&self, Parameters(args): Parameters<ColumnArgs>) -> Result<CallToolResult, McpError> {
        self.invoke("update_column", serde_json::to_value(args).unwrap_or(json!({})))
    }
    #[tool(description = "Список документов")]
    fn list_docs(&self) -> Result<CallToolResult, McpError> {
        self.invoke("list_docs", json!({}))
    }
    #[tool(description = "Прочитать документ")]
    fn read_doc(&self, Parameters(args): Parameters<DocArgs>) -> Result<CallToolResult, McpError> {
        self.invoke("read_doc", serde_json::to_value(args).unwrap_or(json!({})))
    }
    #[tool(description = "Создать документ")]
    fn create_doc(&self, Parameters(args): Parameters<DocArgs>) -> Result<CallToolResult, McpError> {
        self.invoke("create_doc", serde_json::to_value(args).unwrap_or(json!({})))
    }
    #[tool(description = "Обновить Markdown документа")]
    fn update_doc(&self, Parameters(args): Parameters<DocArgs>) -> Result<CallToolResult, McpError> {
        self.invoke("update_doc", serde_json::to_value(args).unwrap_or(json!({})))
    }
    #[tool(description = "Полнотекстовый поиск по документам и карточкам")]
    fn search(&self, Parameters(args): Parameters<SearchArgs>) -> Result<CallToolResult, McpError> {
        self.invoke("search", json!({ "query": args.query }))
    }
    #[tool(description = "Связать документ с карточкой")]
    fn link_doc_to_card(&self, Parameters(args): Parameters<LinkArgs>) -> Result<CallToolResult, McpError> {
        self.invoke("link_doc_to_card", json!({ "docId": args.doc_id, "cardId": args.card_id }))
    }
    #[tool(description = "Сделать карточки из неотмеченных пунктов чек-листа")]
    fn checklist_to_cards(&self, Parameters(args): Parameters<ChecklistArgs>) -> Result<CallToolResult, McpError> {
        self.invoke(
            "checklist_to_cards",
            json!({ "docId": args.doc_id, "boardId": args.board_id, "columnId": args.column_id }),
        )
    }
}

#[tool_handler]
impl ServerHandler for SredaMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            instructions: Some(
                "Локальная «Среда»: доски, карточки и Markdown-документы. Удаление всегда ждёт подтверждения в приложении. Запись зависит от режима в настройках."
                    .into(),
            ),
            capabilities: ServerCapabilities::builder()
                .enable_tools()
                .enable_resources()
                .enable_prompts()
                .build(),
            ..Default::default()
        }
    }

    async fn list_resources(
        &self,
        _request: Option<PaginatedRequestParam>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListResourcesResult, McpError> {
        let mut resources = Vec::new();
        if let Ok(boards) = ops::call(self.db.as_path(), &ops::Policy::from_config(&config::load(&self.db)), "list_boards", &json!({}), false) {
            if let Some(items) = boards.result.as_array() {
                for item in items {
                    if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                        resources.push(RawResource::new(format!("sreda://board/{id}"), item.get("name").and_then(|v| v.as_str()).unwrap_or(id).to_string()).no_annotation());
                    }
                }
            }
        }
        if let Ok(docs) = ops::call(self.db.as_path(), &ops::Policy::from_config(&config::load(&self.db)), "list_docs", &json!({}), false) {
            if let Some(items) = docs.result.as_array() {
                for item in items {
                    if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                        resources.push(RawResource::new(format!("sreda://doc/{id}"), item.get("title").and_then(|v| v.as_str()).unwrap_or(id).to_string()).no_annotation());
                    }
                }
            }
        }
        Ok(ListResourcesResult { resources, next_cursor: None })
    }

    async fn read_resource(
        &self,
        request: ReadResourceRequestParam,
        _context: RequestContext<RoleServer>,
    ) -> Result<ReadResourceResult, McpError> {
        let (mime, text) = ops::resource(self.db.as_path(), &request.uri).map_err(tool_error)?;
        Ok(ReadResourceResult {
            contents: vec![ResourceContents::TextResourceContents {
                uri: request.uri,
                mime_type: Some(mime),
                text,
                meta: None,
            }],
        })
    }

    async fn list_prompts(
        &self,
        _request: Option<PaginatedRequestParam>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListPromptsResult, McpError> {
        Ok(ListPromptsResult {
            prompts: vec![
                Prompt::new("split_spec", Some("Разбей ТЗ на карточки"), Some(vec![board_argument()])),
                Prompt::new("retro", Some("Сделай ретро по доске"), Some(vec![board_argument()])),
                Prompt::new("week_summary", Some("Сводка за неделю"), Some(vec![board_argument()])),
            ],
            next_cursor: None,
        })
    }

    async fn get_prompt(
        &self,
        request: GetPromptRequestParam,
        _context: RequestContext<RoleServer>,
    ) -> Result<GetPromptResult, McpError> {
        let board_id = request
            .arguments
            .as_ref()
            .and_then(|map| map.get("boardId"))
            .and_then(|value| value.as_str())
            .filter(|value| !value.is_empty());
        let text = ops::prompt(self.db.as_path(), &request.name, board_id).map_err(tool_error)?;
        Ok(GetPromptResult {
            description: Some(request.name.clone()),
            messages: vec![PromptMessage {
                role: PromptMessageRole::User,
                content: PromptMessageContent::Text { text },
            }],
        })
    }
}

fn board_argument() -> PromptArgument {
    PromptArgument {
        name: "boardId".into(),
        title: None,
        description: Some("Идентификатор доски".into()),
        required: Some(false),
    }
}

pub async fn serve_stdio(db: PathBuf) -> Result<(), String> {
    let service = SredaMcp::new(db)
        .serve(rmcp::transport::stdio())
        .await
        .map_err(|error| error.to_string())?;
    service.waiting().await.map_err(|error| error.to_string())?;
    Ok(())
}

use axum::middleware::Next;
use axum::response::IntoResponse;

pub async fn serve_http(
    db: PathBuf,
    port: u16,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) -> Result<(), String> {
    use rmcp::transport::streamable_http_server::{
        StreamableHttpService, session::local::LocalSessionManager,
    };
    let factory_db = db.clone();
    let service = StreamableHttpService::new(
        move || Ok(SredaMcp::new(factory_db.clone())),
        LocalSessionManager::default().into(),
        Default::default(),
    );
    let router = axum::Router::new()
        .nest_service("/mcp", service)
        .layer(axum::middleware::from_fn_with_state(db, authorize));
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|error| format!("Не удалось открыть порт MCP: {error}"))?;
    let address = listener.local_addr().map_err(|error| error.to_string())?;
    if !address.ip().is_loopback() {
        return Err("MCP HTTP слушает только 127.0.0.1".into());
    }
    axum::serve(listener, router)
        .with_graceful_shutdown(async move {
            let _ = shutdown.changed().await;
        })
        .await
        .map_err(|error| error.to_string())
}

async fn authorize(
    axum::extract::State(db): axum::extract::State<PathBuf>,
    request: axum::extract::Request,
    next: Next,
) -> axum::response::Response {
    let settings = config::load(&db);
    let Some(hash) = settings.token_hash.as_deref() else {
        return (
            axum::http::StatusCode::UNAUTHORIZED,
            "Создайте токен в настройках «ИИ / MCP»",
        )
            .into_response();
    };
    let header = request
        .headers()
        .get(http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let Some(token) = header.strip_prefix("Bearer ") else {
        return (axum::http::StatusCode::UNAUTHORIZED, "Нужен Bearer-токен").into_response();
    };
    if !config::token_matches(hash, token) {
        return (axum::http::StatusCode::UNAUTHORIZED, "Токен MCP не подошёл").into_response();
    }
    next.run(request).await
}
