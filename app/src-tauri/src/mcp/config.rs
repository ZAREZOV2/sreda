use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_transport")]
    pub transport: String,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_mode")]
    pub mode: String,
    #[serde(default)]
    pub board_ids: Vec<String>,
    #[serde(default)]
    pub folder_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_hash: Option<String>,
}

fn default_transport() -> String {
    "stdio".into()
}
fn default_port() -> u16 {
    47_321
}
fn default_mode() -> String {
    "read".into()
}

impl Default for McpConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            transport: default_transport(),
            port: default_port(),
            mode: default_mode(),
            board_ids: Vec::new(),
            folder_ids: Vec::new(),
            token_hash: None,
        }
    }
}

pub fn config_path(database: &Path) -> PathBuf {
    database
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("mcp.json")
}

pub fn load(database: &Path) -> McpConfig {
    let path = config_path(database);
    let Ok(bytes) = std::fs::read(&path) else {
        return McpConfig::default();
    };
    let mut config: McpConfig = serde_json::from_slice(&bytes).unwrap_or_default();
    if normalize(&mut config).is_err() {
        return McpConfig::default();
    }
    config
}

pub fn save(database: &Path, config: &McpConfig) -> Result<(), String> {
    let mut config = config.clone();
    normalize(&mut config)?;
    if let Some(parent) = config_path(database).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(
        config_path(database),
        serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

fn normalize(config: &mut McpConfig) -> Result<(), String> {
    if !matches!(config.transport.as_str(), "stdio" | "http" | "both") {
        return Err("Транспорт MCP: stdio, http или both".into());
    }
    if !matches!(config.mode.as_str(), "read" | "read-write" | "confirm") {
        return Err("Режим MCP: read, read-write или confirm".into());
    }
    if config.port < 1024 {
        return Err("Порт MCP должен быть не меньше 1024".into());
    }
    config.board_ids.retain(|id| !id.is_empty());
    config.folder_ids.retain(|id| !id.is_empty());
    Ok(())
}

pub fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn generate_token() -> (String, String) {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let token = base64::Engine::encode(
        &base64::engine::general_purpose::URL_SAFE_NO_PAD,
        bytes,
    );
    let hash = hash_token(&token);
    (token, hash)
}

pub fn token_matches(hash: &str, token: &str) -> bool {
    let actual = hash_token(token);
    if hash.len() != actual.len() {
        return false;
    }
    subtle::ConstantTimeEq::ct_eq(hash.as_bytes(), actual.as_bytes()).into()
}

pub fn database_path() -> PathBuf {
    if let Ok(path) = std::env::var("SREDA_DB") {
        return PathBuf::from(path);
    }
    #[cfg(windows)]
    {
        let base = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".into());
        return PathBuf::from(base)
            .join("local.sreda.kanban")
            .join("sreda.sqlite3");
    }
    #[cfg(not(windows))]
    {
        let base = std::env::var("XDG_DATA_HOME").unwrap_or_else(|_| {
            let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
            format!("{home}/.local/share")
        });
        PathBuf::from(base)
            .join("local.sreda.kanban")
            .join("sreda.sqlite3")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_off_and_read_only() {
        let config = McpConfig::default();
        assert!(!config.enabled);
        assert_eq!(config.mode, "read");
        assert_eq!(config.transport, "stdio");
        let (token, hash) = generate_token();
        assert!(token_matches(&hash, &token));
        assert!(!token_matches(&hash, "other-token-value"));
    }
}
