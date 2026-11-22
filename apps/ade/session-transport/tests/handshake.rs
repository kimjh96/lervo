//! The handshake over a real Unix domain socket.

// A failing setup step should stop the test at once, so this test file may unwrap.
#![allow(clippy::unwrap_used)]
#![cfg(unix)]

use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use lervo_session_protocol::codec::MessageCodec;
use lervo_session_transport::TransportError;
use lervo_session_transport::client::{ClientIdentity, hello};
use lervo_session_transport::framed::{FrameReader, FrameWriter};
use lervo_session_transport::handshake::{HostIdentity, accept};
use lervo_session_transport::socket::bind;
use lervo_session_transport::token::Token;
use tokio::net::UnixStream;

fn host() -> HostIdentity {
    HostIdentity {
        host_id: "host_test".to_owned(),
        name: "lervo-session-host".to_owned(),
        version: "0.1.0".to_owned(),
    }
}

fn client() -> ClientIdentity {
    ClientIdentity {
        name: "lervo-ade".to_owned(),
        version: "0.1.0".to_owned(),
    }
}

/// Serves one connection and returns the server's handshake result next to the client's.
async fn handshake(
    socket: &Path,
    server_token: Token,
    client_token: Token,
) -> (Result<(), TransportError>, Result<String, TransportError>) {
    let listener = bind(socket).await.unwrap();
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let (read, write) = stream.into_split();
        let (mut reader, mut writer) = (FrameReader::new(read), FrameWriter::new(write));
        let codec = MessageCodec::new().unwrap();
        accept(&mut reader, &mut writer, &codec, &server_token, &host()).await
    });
    let (read, write) = UnixStream::connect(socket).await.unwrap().into_split();
    let (mut reader, mut writer) = (FrameReader::new(read), FrameWriter::new(write));
    let codec = MessageCodec::new().unwrap();
    let welcomed = hello(&mut reader, &mut writer, &codec, &client_token, &client())
        .await
        .map(|welcome| welcome.host.host_id.to_string());
    (server.await.unwrap(), welcomed)
}

#[tokio::test]
async fn welcomes_a_client_with_the_token() {
    let directory = tempfile::tempdir().unwrap();
    let token = Token::generate().unwrap();
    let (server, client) =
        handshake(&directory.path().join("host.sock"), token.clone(), token).await;
    assert!(server.is_ok(), "{server:?}");
    assert_eq!(client.unwrap(), "host_test");
}

#[tokio::test]
async fn rejects_a_client_with_another_token() {
    let directory = tempfile::tempdir().unwrap();
    let (server, client) = handshake(
        &directory.path().join("host.sock"),
        Token::generate().unwrap(),
        Token::generate().unwrap(),
    )
    .await;
    assert!(matches!(
        server,
        Err(TransportError::Rejected("token_invalid"))
    ));
    assert!(matches!(
        client,
        Err(TransportError::Rejected("token_invalid"))
    ));
}

#[tokio::test]
async fn keeps_the_socket_and_its_directory_owner_only() {
    let directory = tempfile::tempdir().unwrap();
    let socket = directory.path().join("private").join("host.sock");
    let _listener = bind(&socket).await.unwrap();
    let mode = |path: &Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode(&socket), 0o600);
    assert_eq!(mode(socket.parent().unwrap()), 0o700);
}

#[tokio::test]
async fn refuses_a_second_host_and_replaces_a_stale_socket() {
    let directory = tempfile::tempdir().unwrap();
    let socket = directory.path().join("host.sock");
    let listener = bind(&socket).await.unwrap();
    assert!(matches!(
        bind(&socket).await,
        Err(TransportError::AlreadyServing)
    ));
    drop(listener);
    assert!(socket.exists());
    assert!(bind(&socket).await.is_ok());
}

#[test]
fn writes_the_token_file_owner_only() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state").join("token");
    let token = Token::generate().unwrap();
    lervo_session_transport::token::write(&path, &token).unwrap();
    assert_eq!(lervo_session_transport::token::read(&path).unwrap(), token);
    assert_eq!(
        std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
}

#[tokio::test]
async fn keeps_frames_whole_when_a_read_is_cancelled() {
    use std::time::Duration;

    let directory = tempfile::tempdir().unwrap();
    let socket = directory.path().join("host.sock");
    let listener = bind(&socket).await.unwrap();
    let sending = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let (_, write) = stream.into_split();
        let mut writer = FrameWriter::new(write);
        for sequence in 1..=20_u64 {
            tokio::time::sleep(Duration::from_millis(3)).await;
            writer.terminal(1, sequence, &[7_u8; 1000]).await.unwrap();
        }
    });
    let (read, _write) = UnixStream::connect(&socket).await.unwrap().into_split();
    let mut reader = FrameReader::new(read);
    let mut sequences = Vec::new();
    while sequences.len() < 20 {
        // A short timeout cancels many reads while frames are still on their way.
        if let Ok(next) = tokio::time::timeout(Duration::from_micros(500), reader.next()).await
            && let Some(lervo_session_transport::framed::Incoming::Terminal {
                sequence, bytes, ..
            }) = next.unwrap()
        {
            assert_eq!(bytes.len(), 1000);
            sequences.push(sequence);
        }
    }
    assert_eq!(sequences, (1..=20).collect::<Vec<_>>());
    sending.await.unwrap();
}
