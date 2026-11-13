use crate::storage::{self, Board, Column, ColumnKind, Task};
use std::path::Path;

// No window, network listener or user database is opened by this check.
pub fn verify(context: &tauri::Context<tauri::Wry>, report: &Path) -> Result<(), String> {
    if !cfg!(feature = "custom-protocol") { return Err("The executable was built without embedded frontend support".into()); }
    let assets=context.assets();
    let index=assets.get(&"index.html".into()).ok_or("Embedded index.html is missing")?;
    let html=std::str::from_utf8(&index).map_err(|e|e.to_string())?;
    let mut bundled=Vec::new();
    for marker in ["src=\"", "href=\""] {
        for fragment in html.split(marker).skip(1) {
            let value=fragment.split('"').next().unwrap_or("");
            if value.starts_with("http:") || value.starts_with("https:") {return Err(format!("Remote bootstrap asset: {value}"));}
            if !value.is_empty() && !value.starts_with('#') && !value.starts_with("data:") {
                let key=value.trim_start_matches('.').trim_start_matches('/');
                let content=assets.get(&key.into()).ok_or_else(||format!("Missing embedded asset {key}"))?;
                if content.is_empty(){return Err(format!("Empty embedded asset {key}"))}
                bundled.push(serde_json::json!({"path":key,"bytes":content.len()}));
            }
        }
    }
    if !bundled.iter().any(|a|a["path"].as_str().unwrap_or("").starts_with("assets/") && a["path"].as_str().unwrap_or("").ends_with(".js")) || !bundled.iter().any(|a|a["path"].as_str().unwrap_or("").starts_with("assets/") && a["path"].as_str().unwrap_or("").ends_with(".css")) {return Err("Frontend JS/CSS bootstrap not found".into())}
    for font in ["fonts/GolosText-Variable.woff2", "fonts/JetBrainsMono-Variable.woff2"] {
        if assets.get(&font.into()).is_none(){return Err(format!("Missing embedded font {font}"))}
    }
    let directory=report.parent().ok_or("Report directory is required")?;
    std::fs::create_dir_all(directory).map_err(|e|e.to_string())?;
    let db=directory.join(format!("self-check-{}.sqlite3",std::process::id()));
    if db.exists(){return Err("Diagnostic database already exists".into())}
    let result: Result<serde_json::Value, String>=(||{
        let mut snapshot=storage::load(&db)?;
        let board=Board{id:"check-board".into(),name:"Проверка автономного запуска".into(),description:"".into(),columns:vec![Column{id:"check-column".into(),name:"Нужно сделать".into(),kind:Some(ColumnKind::Todo),tasks:vec![Task{id:"check-task".into(),title:"SQLite внутри exe".into(),description:"Тестовая запись".into(),label:"".into(),color:"sage".into(),priority:"medium".into()}]}]};
        snapshot.workspace.selected_board_id=Some(board.id.clone());snapshot.workspace.boards.push(board);
        let revision=storage::save(&db,&snapshot.workspace,snapshot.revision)?;
        let reopened=storage::load(&db)?;
        if reopened.revision!=revision || reopened.workspace!=snapshot.workspace{return Err("SQLite roundtrip mismatch".into())}
        Ok(serde_json::json!({"ok":true,"version":context.config().version,"customProtocol":true,"embeddedIndex":true,"assets":bundled,"sqliteRoundtrip":true,"separateBackendRequired":false}))
    })();
    let _=std::fs::remove_file(&db);
    let value=result?;
    std::fs::write(report,serde_json::to_vec_pretty(&value).map_err(|e|e.to_string())?).map_err(|e|e.to_string())
}
