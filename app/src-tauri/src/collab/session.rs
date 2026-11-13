use crate::collab::protocol::{Participant, ServerMessage};
use crate::collab::token::InviteToken;
use crate::storage::{self, Snapshot, Workspace};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::sync::{broadcast, mpsc, Mutex};
use uuid::Uuid;

pub const TOKEN_TTL: Duration = Duration::from_secs(60 * 60 * 24 * 7);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub host_id: String,
    pub workspace_id: String,
}

impl Identity {
    pub fn generate() -> Self {
        Self {
            host_id: format!("host_{}", Uuid::new_v4().as_simple()),
            workspace_id: format!("ws_{}", Uuid::new_v4().as_simple()),
        }
    }

    pub fn load_or_create(path: &Path) -> Result<Self, String> {
        if path.exists() {
            let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
            return serde_json::from_slice(&bytes)
                .map_err(|e| format!("Повреждена идентичность: {e}"));
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let identity = Self::generate();
        std::fs::write(
            path,
            serde_json::to_vec_pretty(&identity).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        Ok(identity)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CollabSettings {
    pub ngrok_authtoken: String,
    pub static_domain: String,
}

impl CollabSettings {
    pub fn load(path: &Path) -> Self {
        std::fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(
            path,
            serde_json::to_vec_pretty(self).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())
    }
}

#[derive(Clone)]
pub struct Peer {
    pub id: String,
    pub name: String,
    pub color: String,
    pub token: String,
    pub selected_board_id: Option<String>,
    pub role: String,
    pub tx: mpsc::Sender<ServerMessage>,
}

pub struct SessionInner {
    pub identity: Identity,
    pub host_name: String,
    pub host_color: String,
    pub db_path: PathBuf,
    pub snapshot: Snapshot,
    pub tokens: Vec<InviteToken>,
    pub peers: HashMap<String, Peer>,
    pub public_url: String,
    pub static_domain: bool,
    pub current_invite: Option<String>,
}

impl SessionInner {
    pub fn participants(&self) -> Vec<Participant> {
        let mut list = vec![Participant {
            id: self.identity.host_id.clone(),
            name: self.host_name.clone(),
            selected_board_id: self.snapshot.workspace.selected_board_id.clone(),
            role: "host".into(),
            color: Some(self.host_color.clone()),
        }];
        list.extend(self.peers.values().map(|peer| Participant {
            id: peer.id.clone(),
            name: peer.name.clone(),
            selected_board_id: peer.selected_board_id.clone(),
            role: peer.role.clone(),
            color: Some(peer.color.clone()),
        }));
        list
    }

    pub fn apply_push(
        &mut self,
        expected_revision: i64,
        workspace: Workspace,
        origin_id: &str,
    ) -> Result<(i64, Workspace), (String, Snapshot)> {
        match storage::save(&self.db_path, &workspace, expected_revision) {
            Ok(revision) => {
                let snapshot =
                    storage::load(&self.db_path).map_err(|e| (e, self.snapshot.clone()))?;
                // Prefer the just-saved workspace if load succeeds; keep server canonical.
                self.snapshot = snapshot;
                let _ = origin_id;
                Ok((revision, self.snapshot.workspace.clone()))
            }
            Err(message) => {
                let snapshot =
                    storage::load(&self.db_path).unwrap_or_else(|_| self.snapshot.clone());
                self.snapshot = snapshot.clone();
                Err((message, snapshot))
            }
        }
    }
}

#[derive(Clone)]
pub struct Session {
    pub inner: std::sync::Arc<Mutex<SessionInner>>,
    pub events: broadcast::Sender<HostEvent>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum HostEvent {
    #[serde(rename_all = "camelCase")]
    State {
        snapshot: Snapshot,
        origin_id: String,
    },
    Presence {
        participants: Vec<Participant>,
    },
    #[serde(rename_all = "camelCase")]
    Theme {
        theme: String,
        origin_id: String,
    },
    Stopped,
}

impl Session {
    pub fn new(
        identity: Identity,
        db_path: PathBuf,
        snapshot: Snapshot,
        public_url: String,
        static_domain: bool,
    ) -> Self {
        let (events, _) = broadcast::channel(32);
        let inner = SessionInner {
            identity,
            host_name: "Хозяин".into(),
            host_color: "sage".into(),
            db_path,
            snapshot,
            tokens: Vec::new(),
            peers: HashMap::new(),
            public_url,
            static_domain,
            current_invite: None,
        };
        Self {
            inner: std::sync::Arc::new(Mutex::new(inner)),
            events,
        }
    }

    pub async fn issue_invite(&self) -> Result<String, String> {
        let mut inner = self.inner.lock().await;
        for token in &mut inner.tokens {
            token.revoked = true;
        }
        let kicked: Vec<mpsc::Sender<ServerMessage>> =
            inner.peers.values().map(|peer| peer.tx.clone()).collect();
        let (encoded, token) = InviteToken::issue(TOKEN_TTL);
        inner.tokens.push(token);
        inner.current_invite = Some(encoded.clone());
        drop(inner);
        for tx in kicked {
            let _ = tx
                .send(ServerMessage::Shutdown {
                    reason: "revoked".into(),
                })
                .await;
        }
        self.kick_all().await;
        Ok(encoded)
    }

    pub async fn revoke_current(&self) -> Result<String, String> {
        self.issue_invite().await
    }

    pub async fn encode_invite_link(&self, token: &str) -> String {
        let inner = self.inner.lock().await;
        encode_invite_link(
            &inner.public_url,
            &inner.identity.workspace_id,
            &inner.identity.host_id,
            inner.static_domain,
            token,
        )
    }

    pub async fn kick_all(&self) {
        let mut inner = self.inner.lock().await;
        inner.peers.clear();
    }

    pub async fn broadcast(&self, message: ServerMessage, except: Option<&str>) {
        let peers: Vec<mpsc::Sender<ServerMessage>> = {
            let inner = self.inner.lock().await;
            inner
                .peers
                .values()
                .filter(|peer| except.is_none_or(|id| peer.id != id))
                .map(|peer| peer.tx.clone())
                .collect()
        };
        for tx in peers {
            let _ = tx.send(message.clone()).await;
        }
    }

    pub async fn emit_presence(&self) {
        let participants = self.inner.lock().await.participants();
        let _ = self.events.send(HostEvent::Presence {
            participants: participants.clone(),
        });
        self.broadcast(ServerMessage::Presence { participants }, None)
            .await;
    }

    pub async fn set_host_profile(&self, name: String, color: String) {
        {
            let mut inner = self.inner.lock().await;
            inner.host_name = name;
            inner.host_color = color;
        }
        self.emit_presence().await;
    }
}

pub fn encode_invite_link(
    public_url: &str,
    workspace_id: &str,
    host_id: &str,
    static_domain: bool,
    token: &str,
) -> String {
    let payload = serde_json::json!({
        "format": "sreda-invite",
        "version": 1,
        "workspaceId": workspace_id,
        "hostId": host_id,
        "url": public_url.trim_end_matches('/'),
        "staticDomain": static_domain,
        "token": token,
    });
    let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .encode(serde_json::to_vec(&payload).unwrap_or_default());
    format!(
        "{}#sreda-invite={}",
        public_url.trim_end_matches('/'),
        encoded
    )
}

pub fn parse_invite_token(link_or_token: &str) -> Result<String, String> {
    let text = link_or_token.trim();
    if let Some(index) = text.find("sreda-invite=") {
        let encoded = &text[index + "sreda-invite=".len()..];
        let encoded = encoded.split('&').next().unwrap_or(encoded);
        let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(encoded)
            .map_err(|_| "Некорректная ссылка-приглашение".to_string())?;
        let value: serde_json::Value = serde_json::from_slice(&bytes)
            .map_err(|_| "Некорректная ссылка-приглашение".to_string())?;
        value
            .get("token")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| "В ссылке нет токена".into())
    } else {
        Ok(text.to_string())
    }
}
