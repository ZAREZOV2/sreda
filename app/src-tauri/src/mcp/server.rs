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
        Ok(CallToolResult::success(vec![ContentBlock::text(text)]))
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

#[tool_handler(router = self.tool_router)]
impl ServerHandler for SredaMcp {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(
            ServerCapabilities::builder()
                .enable_tools()
                .enable_resources()
                .enable_prompts()
                .build(),
        )
        .with_instructions(
            "Локальная «Среда»: доски, карточки и Markdown-документы. Удаление всегда ждёт подтверждения в приложении. Запись зависит от режима в настройках."
                .to_string(),
        )
    }

    async fn list_resources(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListResourcesResult, McpError> {
        let mut resources = Vec::new();
        if let Ok(boards) = ops::call(self.db.as_path(), &ops::Policy::from_config(&config::load(&self.db)), "list_boards", &json!({}), false) {
            if let Some(items) = boards.result.as_array() {
                for item in items {
                    if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                        resources.push(Resource::new(format!("sreda://board/{id}"), item.get("name").and_then(|v| v.as_str()).unwrap_or(id).to_string()));
                    }
                }
            }
        }
        if let Ok(docs) = ops::call(self.db.as_path(), &ops::Policy::from_config(&config::load(&self.db)), "list_docs", &json!({}), false) {
            if let Some(items) = docs.result.as_array() {
                for item in items {
                    if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                        resources.push(Resource::new(format!("sreda://doc/{id}"), item.get("title").and_then(|v| v.as_str()).unwrap_or(id).to_string()));
                    }
                }
            }
        }
        Ok(ListResourcesResult::with_all_items(resources))
    }

    async fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<ReadResourceResponse, McpError> {
        let (mime, text) = ops::resource(self.db.as_path(), &request.uri).map_err(tool_error)?;
        Ok(ReadResourceResult::new(vec![
            ResourceContents::text(text, request.uri).with_mime_type(mime),
        ])
        .into())
    }

    async fn list_prompts(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListPromptsResult, McpError> {
        Ok(ListPromptsResult::with_all_items(vec![
            Prompt::new("split_spec", Some("Разбей ТЗ на карточки"), Some(vec![board_argument()])),
            Prompt::new("retro", Some("Сделай ретро по доске"), Some(vec![board_argument()])),
            Prompt::new("week_summary", Some("Сводка за неделю"), Some(vec![board_argument()])),
        ]))
    }

    async fn get_prompt(
        &self,
        request: GetPromptRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<GetPromptResponse, McpError> {
        let board_id = request
            .arguments
            .as_ref()
            .and_then(|map| map.get("boardId"))
            .and_then(|value| value.as_str())
            .filter(|value| !value.is_empty());
        let text = ops::prompt(self.db.as_path(), &request.name, board_id).map_err(tool_error)?;
        Ok(GetPromptResult::new(vec![PromptMessage::new_text(Role::User, text)])
            .with_description(request.name)
            .into())
    }
}

fn board_argument() -> PromptArgument {
    PromptArgument::new("boardId")
        .with_description("Идентификатор доски")
        .with_required(false)
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
    shutdown: tokio::sync::watch::Receiver<bool>,
) -> Result<(), String> {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|error| format!("Не удалось открыть порт MCP: {error}"))?;
    serve_listener(db, listener, shutdown).await
}

async fn serve_listener(
    db: PathBuf,
    listener: tokio::net::TcpListener,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) -> Result<(), String> {
    use rmcp::transport::streamable_http_server::{
        StreamableHttpService, session::local::LocalSessionManager,
    };
    let address = listener.local_addr().map_err(|error| error.to_string())?;
    if !address.ip().is_loopback() {
        return Err("MCP HTTP слушает только 127.0.0.1".into());
    }
    let factory_db = db.clone();
    let service = StreamableHttpService::new(
        move || Ok(SredaMcp::new(factory_db.clone())),
        LocalSessionManager::default().into(),
        Default::default(),
    );
    let router = axum::Router::new()
        .nest_service("/mcp", service)
        .layer(axum::middleware::from_fn_with_state(db, authorize));
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::config::{self, McpConfig};
    use crate::storage;
    use rmcp::model::{CallToolRequestParams, ContentBlock, GetPromptRequestParams, ReadResourceRequestParams};
    use rmcp::ServiceExt;
    use std::time::Duration;

    const TOOLS: &[&str] = &[
        "list_boards",
        "get_board",
        "create_board",
        "list_cards",
        "get_card",
        "create_card",
        "update_card",
        "move_card",
        "delete_card",
        "create_column",
        "update_column",
        "list_docs",
        "read_doc",
        "create_doc",
        "update_doc",
        "search",
        "link_doc_to_card",
        "checklist_to_cards",
    ];

    fn temp_db() -> PathBuf {
        let path = std::env::temp_dir().join(format!("sreda-mcp-server-{}.sqlite", uuid::Uuid::new_v4()));
        storage::load(&path).unwrap();
        path
    }

    fn save_config(path: &std::path::Path, enabled: bool, mode: &str, token_hash: Option<String>) {
        config::save(
            path,
            &McpConfig {
                enabled,
                transport: "both".into(),
                port: 47321,
                mode: mode.into(),
                board_ids: Vec::new(),
                folder_ids: Vec::new(),
                token_hash,
            },
        )
        .unwrap();
    }

    fn tool_text(result: &rmcp::model::CallToolResult) -> String {
        result
            .content
            .iter()
            .find_map(|block| match block {
                ContentBlock::Text(text) => Some(text.text.clone()),
                _ => None,
            })
            .unwrap_or_default()
    }

    #[test]
    fn tool_catalog_keeps_names_and_camel_case_arguments() {
        let router = SredaMcp::tool_router();
        let tools = router.list_all();
        assert_eq!(tools.len(), TOOLS.len());
        for name in TOOLS {
            assert!(router.has_route(name), "{name}");
            let tool = tools.iter().find(|tool| tool.name == *name).unwrap();
            assert!(tool.description.as_ref().is_some_and(|text| !text.is_empty()));
        }
        let board = tools.iter().find(|tool| tool.name == "get_board").unwrap();
        let schema = serde_json::to_string(&*board.input_schema).unwrap();
        assert!(schema.contains("boardId"), "{schema}");
        assert!(!schema.contains("board_id"), "{schema}");
        let cards = tools.iter().find(|tool| tool.name == "list_cards").unwrap();
        let schema = serde_json::to_string(&*cards.input_schema).unwrap();
        assert!(schema.contains("columnId"), "{schema}");
        assert_eq!(
            tools.iter().find(|tool| tool.name == "list_boards").unwrap().description.as_deref(),
            Some("Список досок")
        );
    }

    #[tokio::test]
    async fn stdio_session_keeps_tools_resources_and_the_switch() {
        let path = temp_db();
        let (client_io, server_io) = tokio::io::duplex(64 * 1024);
        let server_db = path.clone();
        let server = tokio::spawn(async move {
            let running = SredaMcp::new(server_db).serve(server_io).await.expect("сервер");
            running.waiting().await.expect("ожидание");
        });
        let client = ().serve(client_io).await.expect("клиент");
        let tools = tokio::time::timeout(Duration::from_secs(5), client.list_all_tools())
            .await
            .expect("таймаут списка инструментов")
            .expect("список инструментов");
        assert_eq!(tools.len(), TOOLS.len());

        let disabled = client
            .call_tool(CallToolRequestParams::new("list_boards"))
            .await
            .expect_err("выключенный MCP должен отказать");
        assert!(disabled.to_string().contains("выключен"), "{disabled}");

        let (_token, hash) = config::generate_token();
        save_config(&path, true, "read-write", Some(hash));
        let created = tool_text(
            &client
                .call_tool(CallToolRequestParams::new("create_board").with_arguments(rmcp::object!({ "name": "План" })))
                .await
                .expect("создание доски"),
        );
        let created: serde_json::Value = serde_json::from_str(&created).unwrap();
        assert_eq!(created["result"]["name"], "План");
        let board_id = created["result"]["id"].as_str().unwrap().to_string();
        let column_id = created["result"]["columns"][0]["id"].as_str().unwrap().to_string();

        let boards = tool_text(
            &client
                .call_tool(CallToolRequestParams::new("list_boards"))
                .await
                .unwrap(),
        );
        assert!(boards.contains("План"), "{boards}");

        let resources = client.list_all_resources().await.unwrap();
        let uri = format!("sreda://board/{board_id}");
        assert!(resources.iter().any(|resource| resource.uri == uri));
        let document = client
            .read_resource(ReadResourceRequestParams::new(uri))
            .await
            .unwrap();
        let body = serde_json::to_string(&document).unwrap();
        assert!(body.contains("План"), "{body}");

        let prompts = client.list_all_prompts().await.unwrap();
        assert!(prompts.iter().any(|prompt| prompt.name == "split_spec"));
        assert!(prompts.iter().any(|prompt| prompt.name == "retro"));
        assert!(prompts.iter().any(|prompt| prompt.name == "week_summary"));
        let prompt = client
            .get_prompt(GetPromptRequestParams::new("week_summary").with_arguments(rmcp::object!({ "boardId": board_id })))
            .await
            .unwrap();
        let prompt_text = serde_json::to_string(&prompt).unwrap();
        assert!(prompt_text.contains("сводку"), "{prompt_text}");

        save_config(&path, true, "read", None);
        let denied = client
            .call_tool(CallToolRequestParams::new("create_board").with_arguments(rmcp::object!({ "name": "Секрет" })))
            .await
            .expect_err("чтение не создаёт доску");
        assert!(denied.to_string().contains("только для чтения"), "{denied}");

        save_config(&path, true, "read-write", None);
        let card = tool_text(
            &client
                .call_tool(
                    CallToolRequestParams::new("create_card").with_arguments(
                        rmcp::object!({ "boardId": board_id, "columnId": column_id, "title": "Черновик" }),
                    ),
                )
                .await
                .unwrap(),
        );
        let card: serde_json::Value = serde_json::from_str(&card).unwrap();
        let card_id = card["result"]["task"]["id"].as_str().unwrap();
        let pending = tool_text(
            &client
                .call_tool(CallToolRequestParams::new("delete_card").with_arguments(rmcp::object!({ "cardId": card_id })))
                .await
                .unwrap(),
        );
        assert!(pending.contains("pending"), "{pending}");

        client.cancel().await.unwrap();
        tokio::time::timeout(Duration::from_secs(5), server).await.expect("сервер завис").unwrap();
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(config::config_path(&path));
    }

    #[tokio::test]
    async fn http_stays_on_loopback_and_requires_bearer() {
        let path = temp_db();
        let (token, hash) = config::generate_token();
        save_config(&path, true, "read", Some(hash));
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        assert!(address.ip().is_loopback());
        let (tx, rx) = tokio::sync::watch::channel(false);
        let server_db = path.clone();
        let server = tokio::spawn(async move { serve_listener(server_db, listener, rx).await.unwrap() });

        assert_eq!(http_status(address, None).await, 401);
        assert_eq!(http_status(address, Some("не-тот-токен")).await, 401);
        let allowed = http_status(address, Some(&token)).await;
        assert_ne!(allowed, 401, "верный токен не должен получать 401, статус {allowed}");

        let _ = tx.send(true);
        tokio::time::timeout(Duration::from_secs(5), server).await.expect("HTTP завис").unwrap();
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(config::config_path(&path));
    }

    async fn http_status(address: std::net::SocketAddr, token: Option<&str>) -> u16 {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut stream = tokio::net::TcpStream::connect(address).await.unwrap();
        let body = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"sreda-test","version":"0"}}}"#;
        let auth = token
            .map(|token| format!("Authorization: Bearer {token}\r\n"))
            .unwrap_or_default();
        let request = format!(
            "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\n{auth}Content-Type: application/json\r\nAccept: application/json, text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(request.as_bytes()).await.unwrap();
        let mut buf = [0u8; 512];
        let read = tokio::time::timeout(Duration::from_secs(3), stream.read(&mut buf))
            .await
            .expect("таймаут HTTP")
            .unwrap();
        let text = String::from_utf8_lossy(&buf[..read]);
        text.split_whitespace().nth(1).unwrap_or("0").parse().unwrap_or(0)
    }
}
