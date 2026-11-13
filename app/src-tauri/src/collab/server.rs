use crate::collab::ingress::{self, Ingress, IngressSettings};
use crate::collab::protocol::{
    ClientMessage, ServerMessage, HEARTBEAT_INTERVAL_SECS, HEARTBEAT_TIMEOUT_SECS,
    HELLO_TIMEOUT_SECS, MAX_CONNECTIONS, MAX_MESSAGE_BYTES,
};
use crate::collab::session::{self, HostEvent, Identity, Session, SessionInner};
use crate::collab::token;
use crate::storage::{self, Snapshot, Workspace};
use axum::extract::ws::{Message, WebSocket};
use axum::extract::{State, WebSocketUpgrade};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

#[derive(Clone)]
pub struct HostHandle {
    pub session: Session,
    shutdown: tokio::sync::watch::Sender<bool>,
    pub public_url: String,
    pub static_domain: bool,
    _server: std::sync::Arc<JoinHandle<()>>,
    _ingress: std::sync::Arc<Ingress>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostStatus {
    pub running: bool,
    pub public_url: Option<String>,
    pub invite_link: Option<String>,
    pub invite_board_id: Option<String>,
    pub invite_role: Option<String>,
    pub static_domain: bool,
    pub workspace_id: Option<String>,
    pub host_id: Option<String>,
    pub participants: Vec<crate::collab::protocol::Participant>,
}

impl HostHandle {
    pub async fn status(&self) -> HostStatus {
        let inner = self.session.inner.lock().await;
        let current = inner.current_invite.as_deref()
            .and_then(|encoded| inner.tokens.iter().find(|token| token.id == encoded));
        let invite_link = current.map(|token| session::encode_invite_link(
            &inner.public_url,
            &inner.identity.workspace_id,
            &inner.identity.host_id,
            inner.static_domain,
            &token.id,
            &token.board_id,
            &token.role,
        ));
        HostStatus {
            running: true,
            public_url: Some(inner.public_url.clone()),
            invite_link,
            invite_board_id: current.map(|token| token.board_id.clone()),
            invite_role: current.map(|token| token.role.clone()),
            static_domain: inner.static_domain,
            workspace_id: Some(inner.identity.workspace_id.clone()),
            host_id: Some(inner.identity.host_id.clone()),
            participants: inner.participants(),
        }
    }

    pub async fn subscribe(&self) -> tokio::sync::broadcast::Receiver<HostEvent> {
        self.session.events.subscribe()
    }

    pub async fn issue_invite(&self, board_id: &str, role: &str) -> Result<String, String> {
        let token = self.session.issue_invite(board_id, role).await?;
        Ok(self.session.encode_invite_link(&token).await)
    }

    pub async fn revoke(&self, board_id: &str, role: &str) -> Result<String, String> {
        self.issue_invite(board_id, role).await
    }

    pub async fn push_local(
        &self,
        workspace: Workspace,
        expected_revision: i64,
    ) -> Result<i64, String> {
        let origin = {
            let inner = self.session.inner.lock().await;
            inner.identity.host_id.clone()
        };
        let result = {
            let mut inner = self.session.inner.lock().await;
            inner.apply_push(expected_revision, workspace, &origin)
        };
        match result {
            Ok((revision, workspace)) => {
                let snapshot = Snapshot {
                    revision,
                    workspace: workspace.clone(),
                };
                let _ = self.session.events.send(HostEvent::State {
                    snapshot,
                    origin_id: origin.clone(),
                });
                self.session
                    .broadcast(
                        ServerMessage::State {
                            revision,
                            workspace,
                            origin_id: origin,
                        },
                        None,
                    )
                    .await;
                Ok(revision)
            }
            Err((message, _)) => Err(message),
        }
    }

    pub async fn set_profile(&self, name: String, color: String) {
        self.session.set_host_profile(name, color).await;
    }

    pub async fn share_theme(&self, theme: String) {
        let origin = {
            let inner = self.session.inner.lock().await;
            inner.identity.host_id.clone()
        };
        self.session
            .broadcast(
                ServerMessage::Theme {
                    theme,
                    origin_id: origin,
                },
                None,
            )
            .await;
    }

    pub async fn stop(self) {
        let _ = self.shutdown.send(true);
        self.session
            .broadcast(
                ServerMessage::Shutdown {
                    reason: "closed".into(),
                },
                None,
            )
            .await;
        tokio::time::sleep(Duration::from_millis(250)).await;
        self.session.kick_all().await;
        let _ = self.session.events.send(HostEvent::Stopped);
        self._server.abort();
    }
}

pub async fn start(
    db_path: PathBuf,
    identity: Identity,
    ingress_settings: IngressSettings,
) -> Result<HostHandle, String> {
    let snapshot = storage::load(&db_path)?;
    let (listener, port, local_url) = ingress::bind_local().await?;
    let ingress = ingress::open_ingress(port, &ingress_settings).await?;
    let public_url = ingress.public_url.clone();
    let static_domain = ingress.static_domain;
    let session = Session::new(
        identity,
        db_path,
        snapshot,
        public_url.clone(),
        static_domain,
    );
     let (shutdown, shutdown_rx) = tokio::sync::watch::channel(false);
    let router = Router::new()
        .route("/ws", get(upgrade_ws))
        .route("/health", get(|| async { "ok" }))
        .with_state(session.clone());
    let server = tokio::spawn(async move {
        let _local_url = local_url;
        let mut shutdown_rx = shutdown_rx;
        axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.wait_for(|stop| *stop).await;
            })
            .await
            .ok();
    });
    Ok(HostHandle {
        session,
        shutdown,
        public_url,
        static_domain,
        _server: std::sync::Arc::new(server),
        _ingress: std::sync::Arc::new(ingress),
    })
}

async fn upgrade_ws(ws: WebSocketUpgrade, State(session): State<Session>) -> impl IntoResponse {
    let count = session.inner.lock().await.peers.len();
    if count >= MAX_CONNECTIONS {
        return (StatusCode::SERVICE_UNAVAILABLE, "too many connections").into_response();
    }
    ws.max_message_size(MAX_MESSAGE_BYTES)
        .on_upgrade(move |socket| handle_socket(socket, session))
        .into_response()
}

async fn handle_socket(socket: WebSocket, session: Session) {
    let (mut sink, mut stream) = socket.split();
    let hello = tokio::time::timeout(
        Duration::from_secs(HELLO_TIMEOUT_SECS),
        recv_hello(&mut stream),
    )
    .await;
    let (token, guest_id, name, color) = match hello {
        Ok(Ok(values)) => values,
        Ok(Err(message)) => {
            let _ = send(&mut sink, ServerMessage::Error { message }).await;
            return;
        }
        Err(_) => {
            let _ = send(
                &mut sink,
                ServerMessage::Error {
                    message: "Истекло время ожидания приветствия".into(),
                },
            )
            .await;
            return;
        }
    };

    let (peer_tx, mut peer_rx) = mpsc::channel::<ServerMessage>(32);
    let (welcome, guest_id) = {
        let mut inner = session.inner.lock().await;
        let now = Instant::now();
        let Some(token_index) = token::find_active(&inner.tokens, &token, now) else {
            drop(inner);
            let _ = send(
                &mut sink,
                ServerMessage::Error {
                    message: "Недействительный или отозванный токен".into(),
                },
            )
            .await;
            return;
        };
        let invite = inner.tokens[token_index].clone();
        let Some(scoped_snapshot) = inner.scoped_snapshot(&invite.board_id) else {
            drop(inner);
            let _ = send(&mut sink, ServerMessage::Error {
                message: "Доска из приглашения больше недоступна".into(),
            }).await;
            return;
        };
        if inner.peers.len() >= MAX_CONNECTIONS {
            drop(inner);
            let _ = send(
                &mut sink,
                ServerMessage::Error {
                    message: "Достигнут предел числа участников".into(),
                },
            )
            .await;
            return;
        }
        let guest_id = unique_guest_id(&inner, &guest_id);
        let selected_board_id = Some(invite.board_id.clone());
        inner.peers.insert(
            guest_id.clone(),
            crate::collab::session::Peer {
                id: guest_id.clone(),
                name: sanitize_name(&name),
                color: sanitize_color(color.as_deref()),
                token: token.clone(),
                selected_board_id,
                board_id: invite.board_id.clone(),
                role: invite.role.clone(),
                tx: peer_tx,
            },
        );
        (
            ServerMessage::Welcome {
                workspace_id: inner.identity.workspace_id.clone(),
                host_id: inner.identity.host_id.clone(),
                snapshot: scoped_snapshot,
                self_id: guest_id.clone(),
                static_domain: inner.static_domain,
                participants: inner.scoped_participants(&invite.board_id),
            },
            guest_id,
        )
    };
    if send(&mut sink, welcome).await.is_err() {
        return;
    }
    session.emit_presence().await;

    let mut last_activity = Instant::now();
    let mut heartbeat = tokio::time::interval(Duration::from_secs(HEARTBEAT_INTERVAL_SECS));
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        tokio::select! {
            incoming = stream.next() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        last_activity = Instant::now();
                        if let Err(message) = handle_client(&session, &guest_id, text.as_bytes()).await {
                            let _ = send(&mut sink, ServerMessage::Error { message }).await;
                        }
                    }
                    Some(Ok(Message::Binary(bytes))) => {
                        last_activity = Instant::now();
                        if let Err(message) = handle_client(&session, &guest_id, &bytes).await {
                            let _ = send(&mut sink, ServerMessage::Error { message }).await;
                        }
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        last_activity = Instant::now();
                        let _ = sink.send(Message::Pong(payload)).await;
                    }
                    Some(Ok(Message::Pong(_))) => {
                        last_activity = Instant::now();
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                }
            }
            outbound = peer_rx.recv() => {
                let Some(message) = outbound else { break; };
                if send(&mut sink, message).await.is_err() { break; }
            }
            _ = heartbeat.tick() => {
                if last_activity.elapsed() > Duration::from_secs(HEARTBEAT_TIMEOUT_SECS) {
                    break;
                }
                if send(&mut sink, ServerMessage::Heartbeat).await.is_err() { break; }
            }
        }
    }

    {
        let mut inner = session.inner.lock().await;
        inner.peers.remove(&guest_id);
    }
    session.emit_presence().await;
}

async fn recv_hello(
    stream: &mut futures_util::stream::SplitStream<WebSocket>,
) -> Result<(String, String, String, Option<String>), String> {
    loop {
        match stream.next().await {
            Some(Ok(Message::Text(text))) => match ClientMessage::from_bytes(text.as_bytes())? {
                ClientMessage::Hello {
                    token,
                    guest_id,
                    name,
                    color,
                } => return Ok((token, guest_id, name, color)),
                _ => return Err("Сначала нужно представиться".into()),
            },
            Some(Ok(Message::Binary(bytes))) => match ClientMessage::from_bytes(&bytes)? {
                ClientMessage::Hello {
                    token,
                    guest_id,
                    name,
                    color,
                } => return Ok((token, guest_id, name, color)),
                _ => return Err("Сначала нужно представиться".into()),
            },
            Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => continue,
            _ => return Err("Соединение закрыто до приветствия".into()),
        }
    }
}

async fn handle_client(session: &Session, guest_id: &str, bytes: &[u8]) -> Result<(), String> {
    match ClientMessage::from_bytes(bytes)? {
        ClientMessage::Hello { .. } => Ok(()),
        ClientMessage::Heartbeat => Ok(()),
        ClientMessage::Presence {
            name,
            selected_board_id,
            color,
        } => {
            {
                let mut inner = session.inner.lock().await;
                if let Some(peer) = inner.peers.get_mut(guest_id) {
                    peer.name = sanitize_name(&name);
                    peer.color = sanitize_color(color.as_deref());
                    peer.selected_board_id = selected_board_id
                        .filter(|id| id == &peer.board_id)
                        .or_else(|| Some(peer.board_id.clone()));
                }
            }
            session.emit_presence().await;
            Ok(())
        }
        ClientMessage::Push {
            expected_revision,
            workspace,
        } => {
            let result = {
                let mut inner = session.inner.lock().await;
                inner.apply_guest_push(guest_id, expected_revision, workspace)
            };
            match result {
                Ok((revision, workspace)) => {
                    let snapshot = Snapshot {
                        revision,
                        workspace: workspace.clone(),
                    };
                    let _ = session.events.send(HostEvent::State {
                        snapshot,
                        origin_id: guest_id.to_string(),
                    });
                    session
                        .broadcast(
                            ServerMessage::State {
                                revision,
                                workspace,
                                origin_id: guest_id.to_string(),
                            },
                            None,
                        )
                        .await;
                    Ok(())
                }
                Err((message, snapshot)) => {
                    let response = {
                        let inner = session.inner.lock().await;
                        inner.peers.get(guest_id).map(|peer| {
                            let answer = match inner.scoped_snapshot(&peer.board_id) {
                                Some(scoped) => ServerMessage::Rejected {
                                    expected_revision: scoped.revision,
                                    message,
                                    snapshot: scoped,
                                },
                                None => ServerMessage::Shutdown { reason: "board_removed".into() },
                            };
                            (peer.tx.clone(), answer)
                        })
                    };
                    if let Some((tx, answer)) = response {
                        let _ = tx.send(answer).await;
                    }
                    Ok(())
                }
            }
        }
        ClientMessage::ShareTheme { theme } => {
            let can_edit = {
                let inner = session.inner.lock().await;
                inner.peers.get(guest_id).is_some_and(|peer| peer.role == "edit")
            };
            if !can_edit {
                return Err("Это приглашение разрешает только просмотр".into());
            }
            if theme.len() > 100_000 || theme_forbidden(&theme) {
                return Err("Тема не прошла проверку".into());
            }
            let _ = session.events.send(HostEvent::Theme {
                theme: theme.clone(),
                origin_id: guest_id.to_string(),
            });
            session
                .broadcast(
                    ServerMessage::Theme {
                        theme,
                        origin_id: guest_id.to_string(),
                    },
                    Some(guest_id),
                )
                .await;
            Ok(())
        }
    }
}

fn theme_forbidden(theme: &str) -> bool {
    let lowered = theme.to_ascii_lowercase();
    lowered.contains("@import")
        || lowered.contains("javascript:")
        || lowered.contains("expression(")
        || lowered.contains("url(")
        || lowered.contains("<script")
}

async fn send(
    sink: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    message: ServerMessage,
) -> Result<(), ()> {
    let bytes = message.to_bytes().map_err(|_| ())?;
    let text = String::from_utf8(bytes).map_err(|_| ())?;
    sink.send(Message::Text(text.into())).await.map_err(|_| ())
}

fn sanitize_name(name: &str) -> String {
    let trimmed = name.trim();
    let chars: String = trimmed.chars().take(40).collect();
    if chars.is_empty() {
        "Гость".into()
    } else {
        chars
    }
}

fn sanitize_color(color: Option<&str>) -> String {
    match color.map(str::trim) {
        Some("sage") => "sage".into(),
        Some("blue") => "blue".into(),
        Some("amber") => "amber".into(),
        Some("rose") => "rose".into(),
        Some("violet") => "violet".into(),
        Some("gray") => "gray".into(),
        _ => "sage".into(),
    }
}

fn unique_guest_id(inner: &SessionInner, requested: &str) -> String {
    let cleaned = requested
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(80)
        .collect::<String>();
    let base = if cleaned.is_empty() {
        format!("guest_{}", uuid::Uuid::new_v4().as_simple())
    } else {
        cleaned
    };
    if !inner.peers.contains_key(&base) && base != inner.identity.host_id {
        return base;
    }
    format!("{base}_{}", uuid::Uuid::new_v4().simple())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::Workspace;
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message as TMessage;

    fn sample() -> Workspace {
        serde_json::from_value(serde_json::json!({
            "schemaVersion": 1,
            "selectedBoardId": "b1",
            "boards": [{
                "id": "b1",
                "name": "Работа",
                "description": "",
                "columns": [
                    {"id": "c1", "name": "Нужно сделать", "kind": "todo", "tasks": []},
                    {"id": "c2", "name": "Готово", "kind": "done", "tasks": []}
                ]
            }]
        }))
        .unwrap()
    }

    fn temp_db() -> PathBuf {
        static ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "sreda-collab-{}-{}",
            std::process::id(),
            ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("sreda.sqlite3");
        storage::save(&path, &sample(), 0).unwrap();
        path
    }

    fn identity() -> Identity {
        Identity {
            host_id: "host_test".into(),
            workspace_id: "ws_test".into(),
        }
    }

    async fn boot() -> (HostHandle, String) {
        let handle = start(temp_db(), identity(), IngressSettings::default())
            .await
            .unwrap();
        handle.issue_invite("b1", "edit").await.unwrap();
        let status = handle.status().await;
        let token = handle
            .session
            .inner
            .lock()
            .await
            .current_invite
            .clone()
            .unwrap();
        let url = status.public_url.unwrap().replace("http://", "ws://") + "/ws";
        let _ = token;
        (handle, url)
    }

    async fn connect(
        url: &str,
        token: &str,
        name: &str,
    ) -> tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>
    {
        let (mut socket, _) = tokio_tungstenite::connect_async(url)
            .await
            .expect("connect");
        let hello = serde_json::json!({
            "type": "hello",
            "token": token,
            "guestId": name,
            "name": name
        });
        socket
            .send(TMessage::Text(hello.to_string().into()))
            .await
            .unwrap();
        socket
    }

    async fn next_json(
        socket: &mut tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
    ) -> serde_json::Value {
        loop {
            match socket.next().await {
                Some(Ok(TMessage::Text(text))) => return serde_json::from_str(&text).unwrap(),
                Some(Ok(TMessage::Ping(_))) | Some(Ok(TMessage::Pong(_))) => continue,
                other => panic!("unexpected frame {other:?}"),
            }
        }
    }

    #[tokio::test]
    async fn two_clients_see_broadcast_ops() {
        let (host, url) = boot().await;
        let token = host
            .session
            .inner
            .lock()
            .await
            .current_invite
            .clone()
            .unwrap();
        let mut alice = connect(&url, &token, "alice").await;
        let mut bob = connect(&url, &token, "bob").await;
        let welcome_a = next_json(&mut alice).await;
        let welcome_b = next_json(&mut bob).await;
        assert_eq!(welcome_a["type"], "welcome");
        assert_eq!(welcome_b["type"], "welcome");
        // presence updates may arrive; drain quickly
        let mut workspace = sample();
        workspace.boards[0].name = "Общая".into();
        let push = serde_json::json!({
            "type": "push",
            "expectedRevision": 1,
            "workspace": workspace
        });
        alice
            .send(TMessage::Text(push.to_string().into()))
            .await
            .unwrap();
        let mut seen_state = false;
        for _ in 0..8 {
            let msg = next_json(&mut bob).await;
            if msg["type"] == "state" {
                assert_eq!(msg["workspace"]["boards"][0]["name"], "Общая");
                assert_eq!(msg["revision"], 2);
                seen_state = true;
                break;
            }
        }
        assert!(seen_state, "bob should receive the pushed workspace");
        host.stop().await;
    }

    #[tokio::test]
    async fn bad_token_is_rejected() {
        let (host, url) = boot().await;
        let mut socket = connect(&url, "this-is-not-a-valid-token-value-xxxxxx", "mallory").await;
        let msg = next_json(&mut socket).await;
        assert_eq!(msg["type"], "error");
        assert!(msg["message"].as_str().unwrap().contains("токен"));
        host.stop().await;
    }

    #[tokio::test]
    async fn revoke_rejects_a_new_connection_with_the_old_token() {
        let (host, url) = boot().await;
        let old = host
            .session
            .inner
            .lock()
            .await
            .current_invite
            .clone()
            .unwrap();
        let _new_link = host.revoke().await.unwrap();
        let mut socket = connect(&url, &old, "late").await;
        let msg = next_json(&mut socket).await;
        assert_eq!(msg["type"], "error");
        assert!(msg["message"].as_str().unwrap().contains("токен"));
        host.stop().await;
    }

    #[tokio::test]
    async fn host_shutdown_is_signalled_to_clients() {
        let (host, url) = boot().await;
        let token = host
            .session
            .inner
            .lock()
            .await
            .current_invite
            .clone()
            .unwrap();
        let mut guest = connect(&url, &token, "guest").await;
        let welcome = next_json(&mut guest).await;
        assert_eq!(welcome["type"], "welcome");
        let task = tokio::spawn(async move {
            loop {
                match guest.next().await {
                    Some(Ok(TMessage::Text(text))) => {
                        let msg: serde_json::Value = serde_json::from_str(&text).unwrap();
                        if msg["type"] == "shutdown" {
                            assert_eq!(msg["reason"], "closed");
                            return;
                        }
                    }
                    Some(Ok(_)) => continue,
                    other => panic!("expected shutdown, got {other:?}"),
                }
            }
        });
        host.stop().await;
        tokio::time::timeout(Duration::from_secs(3), task)
            .await
            .expect("shutdown delivered")
            .unwrap();
    }

    fn sample_two_boards() -> Workspace {
        let mut workspace = sample();
        let mut secret = workspace.boards[0].clone();
        secret.id = "b2".into();
        secret.name = "Секретная доска".into();
        for column in &mut secret.columns {
            column.id = format!("secret_{}", column.id);
        }
        workspace.boards.push(secret);
        workspace
    }

    async fn next_type(
        socket: &mut tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        expected: &str,
    ) -> serde_json::Value {
        for _ in 0..16 {
            let message = next_json(socket).await;
            if message["type"] == expected {
                return message;
            }
        }
        panic!("message type {expected} not received");
    }

    #[tokio::test]
    async fn invited_guest_sees_only_its_board_in_welcome_and_state() {
        let (host, url) = boot().await;
        host.push_local(sample_two_boards(), 1).await.unwrap();
        let token = host.session.inner.lock().await.current_invite.clone().unwrap();
        let mut guest = connect(&url, &token, "alice").await;
        let welcome = next_type(&mut guest, "welcome").await;
        assert_eq!(welcome["snapshot"]["workspace"]["boards"].as_array().unwrap().len(), 1);
        assert_eq!(welcome["snapshot"]["workspace"]["boards"][0]["id"], "b1");
        assert!(!welcome.to_string().contains("Секретная доска"));

        let mut changed = sample_two_boards();
        changed.boards[1].name = "Ещё один секрет".into();
        host.push_local(changed, 2).await.unwrap();
        let state = next_type(&mut guest, "state").await;
        assert_eq!(state["workspace"]["boards"].as_array().unwrap().len(), 1);
        assert_eq!(state["workspace"]["boards"][0]["id"], "b1");
        assert!(!state.to_string().contains("Ещё один секрет"));
        host.stop().await;
    }

    #[tokio::test]
    async fn guest_cannot_push_other_boards_or_remove_host_boards() {
        let (host, url) = boot().await;
        host.push_local(sample_two_boards(), 1).await.unwrap();
        let db_path = host.session.inner.lock().await.db_path.clone();
        let before = storage::load(&db_path).unwrap();
        let token = host.session.inner.lock().await.current_invite.clone().unwrap();
        let mut guest = connect(&url, &token, "malicious").await;
        next_type(&mut guest, "welcome").await;

        for mut forged in [sample_two_boards(), sample_two_boards()] {
            // Try to send the entire host workspace and then only the *other* board.
            if forged.boards.len() == 2 {
                if forged.boards[1].name == "Секретная доска" {
                    forged.boards[1].name = "Украдено".into();
                }
            }
            let message = serde_json::json!({
                "type": "push",
                "expectedRevision": before.revision,
                "workspace": forged
            });
            guest.send(TMessage::Text(message.to_string().into())).await.unwrap();
            let rejected = next_type(&mut guest, "rejected").await;
            assert_eq!(rejected["snapshot"]["workspace"]["boards"].as_array().unwrap().len(), 1);
            assert_eq!(storage::load(&db_path).unwrap().workspace, before.workspace);
        }
        let mut only_other = sample_two_boards();
        only_other.boards.remove(0);
        only_other.selected_board_id = Some("b2".into());
        let forged = serde_json::json!({
            "type": "push",
            "expectedRevision": before.revision,
            "workspace": only_other,
        });
        guest.send(TMessage::Text(forged.to_string().into())).await.unwrap();
        next_type(&mut guest, "rejected").await;
        assert_eq!(storage::load(&db_path).unwrap().workspace, before.workspace);
        host.stop().await;
    }

    #[tokio::test]
    async fn view_only_invite_rejects_all_guest_writes() {
        let (host, url) = boot().await;
        host.issue_invite("b1", "view").await.unwrap();
        let db_path = host.session.inner.lock().await.db_path.clone();
        let before = storage::load(&db_path).unwrap();
        let token = host.session.inner.lock().await.current_invite.clone().unwrap();
        let mut guest = connect(&url, &token, "viewer").await;
        next_type(&mut guest, "welcome").await;
        let push = serde_json::json!({
            "type": "push", "expectedRevision": before.revision, "workspace": sample()
        });
        guest.send(TMessage::Text(push.to_string().into())).await.unwrap();
        let rejected = next_type(&mut guest, "rejected").await;
        assert!(rejected["message"].as_str().unwrap().contains("просмотр"));
        assert_eq!(storage::load(&db_path).unwrap().workspace, before.workspace);
        host.stop().await;
    }

    #[tokio::test]
    async fn edit_invite_can_change_card_without_touching_other_board() {
        let (host, url) = boot().await;
        host.push_local(sample_two_boards(), 1).await.unwrap();
        let db_path = host.session.inner.lock().await.db_path.clone();
        let before = storage::load(&db_path).unwrap();
        let token = host.session.inner.lock().await.current_invite.clone().unwrap();
        let mut guest = connect(&url, &token, "editor").await;
        let welcome = next_type(&mut guest, "welcome").await;
        let mut workspace: Workspace = serde_json::from_value(welcome["snapshot"]["workspace"].clone()).unwrap();
        let task = serde_json::json!({
            "id": "t1",
            "title": "Изменённая карточка",
            "description": "",
            "label": "",
            "color": "sage",
            "priority": "medium"
        });
        workspace.boards[0].columns[0].tasks.push(serde_json::from_value(task).unwrap());
        let push = serde_json::json!({
            "type": "push", "expectedRevision": before.revision, "workspace": workspace
        });
        guest.send(TMessage::Text(push.to_string().into())).await.unwrap();
        let state = next_type(&mut guest, "state").await;
        assert_eq!(state["workspace"]["boards"].as_array().unwrap().len(), 1);
        let after = storage::load(&db_path).unwrap();
        assert_eq!(after.workspace.boards[0].columns[0].tasks[0].title, "Изменённая карточка");
        assert_eq!(
            serde_json::to_vec(&after.workspace.boards[1]).unwrap(),
            serde_json::to_vec(&before.workspace.boards[1]).unwrap()
        );
        host.stop().await;
    }

}
