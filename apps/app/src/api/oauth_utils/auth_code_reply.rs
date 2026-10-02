//! A minimal OAuth 2.0 authorization code grant flow redirection/reply loopback URI HTTP
//! server implementation, compliant with [RFC 6749]'s authorization code grant flow and
//! [RFC 8252]'s best current practices for OAuth 2.0 in native apps.
//!
//! This server is needed for the step 4 of the OAuth authentication dance represented in
//! figure 1 of [RFC 8252].
//!
//! Further reading: https://www.oauth.com/oauth2-servers/oauth-native-apps/redirect-urls-for-native-apps/
//!
//! [RFC 6749]: https://datatracker.ietf.org/doc/html/rfc6749
//! [RFC 8252]: https://datatracker.ietf.org/doc/html/rfc8252

use std::{
    net::SocketAddr,
    sync::{LazyLock, Mutex},
    time::Duration,
};

use hyper::body::Incoming;
use hyper_util::rt::{TokioIo, TokioTimer};
use theseus::ErrorKind;
use theseus::prelude::tcp_listen_any_loopback;
use tokio::sync::{broadcast, oneshot};

static SERVER_SHUTDOWN: LazyLock<broadcast::Sender<()>> =
    LazyLock::new(|| broadcast::channel(1024).0);

/// Starts a temporary HTTP server to receive OAuth 2.0 authorization code grant flow redirects
/// on a loopback interface with an ephemeral port. The caller can know the bound socket address
/// by listening on the counterpart channel for `listen_socket_tx`.
///
/// When `expected_state` is `Some`, replies whose `state` query param does not match are ignored
/// (listener keeps waiting). Pass `None` for flows that do not bind a CSRF state on the loopback
/// redirect (Modrinth App OAuth).
///
/// If the server is stopped before receiving an authorization code, `Ok(None)` is returned.
pub async fn listen(
    listen_socket_tx: oneshot::Sender<Result<SocketAddr, theseus::Error>>,
    expected_state: Option<String>,
) -> Result<Option<String>, theseus::Error> {
    let listener = match tcp_listen_any_loopback().await {
        Ok(listener) => {
            listen_socket_tx
                .send(listener.local_addr().map_err(|e| {
                    ErrorKind::OtherError(format!(
                        "Failed to get auth code reply socket address: {e}"
                    ))
                    .into()
                }))
                .ok();

            listener
        }
        Err(e) => {
            let error_msg =
                format!("Failed to bind auth code reply socket: {e}");

            listen_socket_tx
                .send(Err(ErrorKind::OtherError(error_msg.clone()).into()))
                .ok();

            return Err(ErrorKind::OtherError(error_msg).into());
        }
    };

    let mut auth_code = Mutex::new(None);
    let mut shutdown_notification = SERVER_SHUTDOWN.subscribe();

    while auth_code.get_mut().unwrap().is_none() {
        let client_socket = tokio::select! {
            biased;
            _ = shutdown_notification.recv() => {
                break;
            }
            conn_accept_result = listener.accept() => {
                match conn_accept_result {
                    Ok((socket, _)) => socket,
                    Err(e) => {
                        tracing::warn!("Failed to accept auth code reply: {e}");
                        continue;
                    }
                }
            }
        };

        if let Err(e) = hyper::server::conn::http1::Builder::new()
            .keep_alive(false)
            .header_read_timeout(Duration::from_secs(5))
            .timer(TokioTimer::new())
            .auto_date_header(false)
            .serve_connection(
                TokioIo::new(client_socket),
                hyper::service::service_fn(|req| {
                    handle_reply(req, &auth_code, expected_state.as_deref())
                }),
            )
            .await
        {
            tracing::warn!("Failed to handle auth code reply: {e}");
        }
    }

    Ok(auth_code.into_inner().unwrap())
}

/// Stops any active OAuth 2.0 authorization code grant flow reply listening HTTP servers.
pub fn stop_listeners() {
    SERVER_SHUTDOWN.send(()).ok();
}

fn query_param<'a>(query: &'a str, name: &str) -> Option<&'a str> {
    query
        .split('&')
        .filter_map(|query_pair| query_pair.split_once('='))
        .find_map(|(key, value)| (key == name).then_some(value))
}

async fn handle_reply(
    req: hyper::Request<Incoming>,
    auth_code_out: &Mutex<Option<String>>,
    expected_state: Option<&str>,
) -> Result<hyper::Response<String>, hyper::http::Error> {
    if req.method() != hyper::Method::GET {
        return hyper::Response::builder()
            .status(hyper::StatusCode::METHOD_NOT_ALLOWED)
            .header("Allow", "GET")
            .body("".into());
    }

    // The authorization code is guaranteed to be sent as a "code" query parameter
    // in the request URI query string as per RFC 6749 § 4.1.2
    let query = req.uri().query().unwrap_or("");
    let auth_code = query_param(query, "code");
    let reply_state = query_param(query, "state");

    let state_ok = match expected_state {
        Some(expected) => reply_state == Some(expected),
        None => true,
    };

    let response = if let (Some(auth_code), true) = (auth_code, state_ok) {
        *auth_code_out.lock().unwrap() = Some(auth_code.to_string());

        hyper::Response::builder()
            .status(hyper::StatusCode::OK)
            .header("Content-Type", "text/html;charset=utf-8")
            .body(
                include_str!("auth_code_reply/page.html")
                    .replace("{{title}}", "Success")
                    .replace("{{message}}", "You have successfully signed in! You can close this page now."),
            )
    } else if auth_code.is_some() && !state_ok {
        // Keep listening — do not accept a mismatched CSRF state.
        hyper::Response::builder()
            .status(hyper::StatusCode::BAD_REQUEST)
            .header("Content-Type", "text/html;charset=utf-8")
            .body(
                include_str!("auth_code_reply/page.html")
                    .replace("{{title}}", "Error")
                    .replace(
                        "{{message}}",
                        "Sign-in state mismatch. Please try signing in again from the launcher.",
                    ),
            )
    } else {
        hyper::Response::builder()
            .status(hyper::StatusCode::BAD_REQUEST)
            .header("Content-Type", "text/html;charset=utf-8")
            .body(
                include_str!("auth_code_reply/page.html")
                    .replace("{{title}}", "Error")
                    .replace("{{message}}", "Authorization code not found. Please try signing in again."),
            )
    }?;

    Ok(response)
}
