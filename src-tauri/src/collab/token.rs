use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use std::time::{Duration, Instant};
use subtle::ConstantTimeEq;

pub const TOKEN_BYTES: usize = 32;

#[derive(Debug, Clone)]
pub struct InviteToken {
    pub id: String,
    secret: [u8; TOKEN_BYTES],
    pub expires_at: Instant,
    pub revoked: bool,
}

impl InviteToken {
    pub fn issue(ttl: Duration) -> (String, Self) {
        let mut secret = [0u8; TOKEN_BYTES];
        rand::rngs::OsRng.fill_bytes(&mut secret);
        let encoded = URL_SAFE_NO_PAD.encode(secret);
        let token = Self {
            id: encoded.clone(),
            secret,
            expires_at: Instant::now() + ttl,
            revoked: false,
        };
        (encoded, token)
    }

    pub fn is_active(&self, now: Instant) -> bool {
        !self.revoked && now < self.expires_at
    }
}

pub fn decode_secret(presented: &str) -> Result<[u8; TOKEN_BYTES], String> {
    let bytes = URL_SAFE_NO_PAD
        .decode(presented.trim())
        .map_err(|_| "Некорректный токен приглашения".to_string())?;
    if bytes.len() != TOKEN_BYTES {
        return Err("Некорректный токен приглашения".into());
    }
    let mut secret = [0u8; TOKEN_BYTES];
    secret.copy_from_slice(&bytes);
    Ok(secret)
}

/// Always compares against every token to avoid leaking which entry matched.
pub fn find_active(tokens: &[InviteToken], presented: &str, now: Instant) -> Option<usize> {
    let Ok(secret) = decode_secret(presented) else {
        return None;
    };
    let mut found = None;
    for (index, token) in tokens.iter().enumerate() {
        let matches: bool = token.secret.ct_eq(&secret).into();
        if matches && token.is_active(now) {
            found = Some(index);
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn issued_token_matches_constant_time_and_revoked_does_not() {
        let (encoded, mut token) = InviteToken::issue(Duration::from_secs(60));
        assert!(encoded.len() >= 43);
        let tokens = vec![token.clone()];
        assert_eq!(find_active(&tokens, &encoded, Instant::now()), Some(0));
        assert_eq!(find_active(&tokens, "not-a-token", Instant::now()), None);
        token.revoked = true;
        assert_eq!(find_active(&[token], &encoded, Instant::now()), None);
    }

    #[test]
    fn expired_token_is_rejected() {
        let (encoded, mut token) = InviteToken::issue(Duration::from_secs(60));
        token.expires_at = Instant::now() - Duration::from_secs(1);
        assert_eq!(find_active(&[token], &encoded, Instant::now()), None);
    }
}
