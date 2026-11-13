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
    pub board_id: String,
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
    /// Never send a guest a snapshot containing boards outside their invitation.
    pub fn scoped_snapshot(&self, board_id: &str) -> Option<Snapshot> {
        let board = self.snapshot.workspace.boards.iter()
            .find(|board| board.id == board_id)?.clone();
        Some(Snapshot {
            revision: self.snapshot.revision,
            workspace: Workspace {
                schema_version: self.snapshot.workspace.schema_version,
                boards: vec![board],
                selected_board_id: Some(board_id.to_string()),
            },
        })
    }

    pub fn scoped_participants(&self, board_id: &str) -> Vec<Participant> {
        let mut participants = vec![Participant {
            id: self.identity.host_id.clone(),
            name: self.host_name.clone(),
            selected_board_id: Some(board_id.to_string()),
            role: "host".into(),
            color: Some(self.host_color.clone()),
        }];
        participants.extend(self.peers.values()
            .filter(|peer| peer.board_id == board_id)
            .map(|peer| Participant {
                id: peer.id.clone(),
                name: peer.name.clone(),
                selected_board_id: Some(board_id.to_string()),
                role: peer.role.clone(),
                color: Some(peer.color.clone()),
            }));
        participants
    }

    /// A guest may replace only the board named by their active, editable invitation.
    /// All other host data is kept from the current authoritative snapshot.
    pub fn apply_guest_push(
        &mut self,
        guest_id: &str,
        expected_revision: i64,
        workspace: Workspace,
    ) -> Result<(i64, Workspace), (String, Snapshot)> {
        let fail = |message: &str, snapshot: &Snapshot| (message.to_string(), snapshot.clone());
        let peer = self.peers.get(guest_id)
            .ok_or_else(|| fail("Участник не найден", &self.snapshot))?;
        if peer.role != "edit" {
            return Err(fail("Это приглашение разрешает только просмотр", &self.snapshot));
        }
        let board_id = peer.board_id.clone();
        if workspace.boards.len() != 1
            || workspace.boards[0].id != board_id
            || workspace.selected_board_id.as_deref() != Some(board_id.as_str())
        {
            return Err(fail("Разрешено изменять только приглашённую доску", &self.snapshot));
        }
        storage::validate(&workspace)
            .map_err(|message| (message, self.snapshot.clone()))?;
        let mut merged = self.snapshot.workspace.clone();
        let host_board = merged.boards.iter_mut().find(|board| board.id == board_id)
            .ok_or_else(|| fail("Доска больше недоступна", &self.snapshot))?;
        *host_board = workspace.boards[0].clone();
        storage::validate(&merged)
            .map_err(|message| (message, self.snapshot.clone()))?;
        self.apply_push(expected_revision, merged, guest_id)
    }

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

    pub async fn issue_invite(&self, board_id: &str, role: &str) -> Result<String, String> {
        let mut inner = self.inner.lock().await;
        if role != "view" && role != "edit" {
            return Err("Недопустимая роль приглашения".into());
        }
        if !inner.snapshot.workspace.boards.iter().any(|board| board.id == board_id) {
            return Err("Выберите существующую доску".into());
        }
        for token in &mut inner.tokens {
            token.revoked = true;
        }
        let kicked: Vec<mpsc::Sender<ServerMessage>> =
            inner.peers.values().map(|peer| peer.tx.clone()).collect();
        let (encoded, token) = InviteToken::issue(TOKEN_TTL, board_id.into(), role.into());
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
        let (board_id, role) = {
            let inner = self.inner.lock().await;
            let current = inner.current_invite.as_deref().ok_or("Нет приглашения")?;
            let token = inner.tokens.iter().find(|t| t.id == current).ok_or("Нет приглашения")?;
            (token.board_id.clone(), token.role.clone())
        };
        self.issue_invite(&board_id, &role).await
    }

    pub async fn encode_invite_link(&self, token: &str) -> String {
        let inner = self.inner.lock().await;
        let Some(invite) = inner.tokens.iter().find(|item| item.id == token) else {
            return String::new();
        };
        encode_invite_link(
            &inner.public_url,
            &inner.identity.workspace_id,
            &inner.identity.host_id,
            inner.static_domain,
            token,
            &invite.board_id,
            &invite.role,
        )
    }

    pub async fn kick_all(&self) {
        let mut inner = self.inner.lock().await;
        inner.peers.clear();
    }

    pub async fn broadcast(&self, message: ServerMessage, except: Option<&str>) {
        let messages: Vec<(mpsc::Sender<ServerMessage>, ServerMessage)> = {
            let inner = self.inner.lock().await;
            inner.peers.values()
                .filter(|peer| except.is_none_or(|id| peer.id != id))
                .map(|peer| {
                    let scoped = match &message {
                        ServerMessage::State { revision, origin_id, .. } => {
                            match inner.scoped_snapshot(&peer.board_id) {
                                Some(snapshot) => ServerMessage::State {
                                    revision: *revision,
                                    workspace: snapshot.workspace,
                                    origin_id: origin_id.clone(),
                                },
                                None => ServerMessage::Shutdown { reason: "board_removed".into() },
                            }
                        }
                        ServerMessage::Presence { .. } => ServerMessage::Presence {
                            participants: inner.scoped_participants(&peer.board_id),
                        },
                        _ => message.clone(),
                    };
                    (peer.tx.clone(), scoped)
                })
                .collect()
        };
        for (tx, scoped) in messages {
            let _ = tx.send(scoped).await;
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
    board_id: &str,
    role: &str,
) -> String {
    let payload = serde_json::json!({
        "format": "sreda-invite",
        "version": 2,
        "boardId": board_id,
        "role": role,
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
        if value.get("format").and_then(|v| v.as_str()) != Some("sreda-invite")
            || value.get("version").and_then(|v| v.as_u64()) != Some(2)
            || value.get("boardId").and_then(|v| v.as_str()).is_none()
            || !matches!(value.get("role").and_then(|v| v.as_str()), Some("view" | "edit"))
        {
            return Err("Приглашение устарело или не содержит прав доступа".into());
        }
        value
            .get("token")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| "В ссылке нет токена".into())
    } else {
        Ok(text.to_string())
    }
}
