/// Public entry point for guests. The ngrok crate is only used here, as a
/// listener/forwarder in front of the local WebSocket server.
pub struct Ingress {
    pub public_url: String,
    pub static_domain: bool,
    /// Keep the tunnel alive for the lifetime of the share session.
    _tunnel: Option<NgrokForwarding>,
}

struct NgrokForwarding {
    // Keep session + forwarder alive without naming ngrok's concrete generic types.
    _hold: Box<dyn std::any::Any + Send + Sync>,
}

#[derive(Debug, Clone, Default)]
pub struct IngressSettings {
    pub authtoken: Option<String>,
    pub static_domain: Option<String>,
}

pub async fn bind_local() -> Result<(tokio::net::TcpListener, u16, String), String> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Не удалось открыть локальный порт: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let url = format!("http://127.0.0.1:{port}");
    Ok((listener, port, url))
}

pub async fn open_ingress(local_port: u16, settings: &IngressSettings) -> Result<Ingress, String> {
    let local = format!("http://127.0.0.1:{local_port}");
    let Some(token) = settings
        .authtoken
        .as_ref()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
    else {
        if settings
            .static_domain
            .as_ref()
            .is_some_and(|d| !d.trim().is_empty())
        {
            return Err("Для статического домена нужен токен ngrok".into());
        }
        return Ok(Ingress {
            public_url: local,
            static_domain: false,
            _tunnel: None,
        });
    };

    open_ngrok(&local, &token, settings.static_domain.as_deref()).await
}

async fn open_ngrok(
    local_url: &str,
    authtoken: &str,
    static_domain: Option<&str>,
) -> Result<Ingress, String> {
    use ngrok::prelude::*;
    let session = ngrok::Session::builder()
        .authtoken(authtoken)
        .connect()
        .await
        .map_err(|e| format!("Не удалось подключиться к ngrok: {e}"))?;
    let mut builder = session.http_endpoint();
    let static_set = static_domain
        .map(|d| d.trim().to_string())
        .filter(|d| !d.is_empty());
    if let Some(domain) = static_set.clone() {
        builder.domain(domain);
    }
    let forward_url: url::Url = local_url
        .parse()
        .map_err(|e| format!("Некорректный локальный адрес: {e}"))?;
    let forwarding = builder
        .listen_and_forward(forward_url)
        .await
        .map_err(|e| format!("Не удалось открыть туннель ngrok: {e}"))?;
    let public_url = forwarding.url().to_string();
    let public_url = public_url.trim_end_matches('/').to_string();
    Ok(Ingress {
        public_url,
        static_domain: static_set.is_some(),
        _tunnel: Some(NgrokForwarding {
            _hold: Box::new((session, forwarding)),
        }),
    })
}
