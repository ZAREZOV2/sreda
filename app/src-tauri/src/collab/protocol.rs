use crate::storage::{Snapshot, Workspace};
use serde::{Deserialize, Serialize};

pub const MAX_MESSAGE_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_CONNECTIONS: usize = 16;
pub const HELLO_TIMEOUT_SECS: u64 = 8;
pub const HEARTBEAT_INTERVAL_SECS: u64 = 15;
pub const HEARTBEAT_TIMEOUT_SECS: u64 = 45;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Participant {
    pub id: String,
    pub name: String,
    pub selected_board_id: Option<String>,
    pub role: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ClientMessage {
    #[serde(rename_all = "camelCase")]
    Hello {
        token: String,
        guest_id: String,
        name: String,
        #[serde(default)]
        color: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Push {
        expected_revision: i64,
        workspace: Workspace,
    },
    #[serde(rename_all = "camelCase")]
    Presence {
        name: String,
        selected_board_id: Option<String>,
        #[serde(default)]
        color: Option<String>,
    },
    Heartbeat,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ServerMessage {
    #[serde(rename_all = "camelCase")]
    Welcome {
        workspace_id: String,
        host_id: String,
        snapshot: Snapshot,
        self_id: String,
        static_domain: bool,
        participants: Vec<Participant>,
    },
    #[serde(rename_all = "camelCase")]
    State {
        revision: i64,
        workspace: Workspace,
        origin_id: String,
    },
    #[serde(rename_all = "camelCase")]
    Rejected {
        expected_revision: i64,
        message: String,
        snapshot: Snapshot,
    },
    #[serde(rename_all = "camelCase")]
    Presence {
        participants: Vec<Participant>,
    },
    Heartbeat,
    #[serde(rename_all = "camelCase")]
    Shutdown {
        reason: String,
    },
    #[serde(rename_all = "camelCase")]
    Error {
        message: String,
    },
}

impl ServerMessage {
    pub fn to_bytes(&self) -> Result<Vec<u8>, String> {
        let bytes = serde_json::to_vec(self).map_err(|e| e.to_string())?;
        if bytes.len() > MAX_MESSAGE_BYTES {
            return Err("Сообщение превышает допустимый размер".into());
        }
        Ok(bytes)
    }
}

impl ClientMessage {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() > MAX_MESSAGE_BYTES {
            return Err("Сообщение превышает допустимый размер".into());
        }
        serde_json::from_slice(bytes).map_err(|e| format!("Некорректное сообщение: {e}"))
    }
}
