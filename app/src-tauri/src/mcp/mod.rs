pub mod config;
pub mod ops;
pub mod server;

pub fn run_stdio() -> i32 {
    let database = config::database_path();
    let settings = config::load(&database);
    if !settings.enabled {
        eprintln!("MCP-сервер «Среды» выключен. Включите его в Настройки → ИИ / MCP.");
        return 2;
    }
    if settings.transport == "http" {
        eprintln!("В настройках выбран только HTTP. Для stdio укажите транспорт «stdio» или «оба».");
        return 2;
    }
    let runtime = match tokio::runtime::Runtime::new() {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("Не удалось запустить MCP: {error}");
            return 1;
        }
    };
    if let Err(error) = runtime.block_on(server::serve_stdio(database)) {
        eprintln!("MCP остановлен: {error}");
        return 1;
    }
    0
}
