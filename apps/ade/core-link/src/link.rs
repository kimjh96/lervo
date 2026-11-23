//! The resident process and the requests in flight to it.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use lervo_session_protocol::core_link::{CoreLinkCodec, CoreLinkResponse};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot};

/// Bytes in one response line. A response carries at most 4,096 events or 1 MiB of input.
const MAX_RESPONSE_LINE_BYTES: usize = 16 * 1024 * 1024;
const REQUEST_QUEUE: usize = 256;

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<CoreLinkResponse>>>>;

/// Why a request got no answer.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum LinkError {
    #[error("core_link_unavailable")]
    Unavailable,
    #[error("core_link_timeout")]
    Timeout,
    /// The resident process a request was meant for has ended, so a newer one would receive it.
    #[error("core_link_replaced")]
    Replaced,
}

/// One running resident process.
struct Connection {
    /// Which start of the resident process this is, counting from 1.
    generation: u64,
    requests: mpsc::Sender<String>,
    pending: Pending,
    /// Cleared by the reader when the process ends, before it fails the waiting requests.
    alive: Arc<AtomicBool>,
    _child: Child,
}

impl Connection {
    fn is_alive(&self) -> bool {
        self.alive.load(Ordering::Acquire)
    }
}

/// The resident Lervo process, started on the first request and again after it exits.
pub struct Link {
    program: String,
    arguments: Vec<String>,
    codec: CoreLinkCodec,
    connection: tokio::sync::Mutex<Option<Connection>>,
    next_id: AtomicU64,
    started: AtomicU64,
}

impl Link {
    pub fn new(program: String, arguments: Vec<String>, codec: CoreLinkCodec) -> Self {
        Self {
            program,
            arguments,
            codec,
            connection: tokio::sync::Mutex::new(None),
            next_id: AtomicU64::new(1),
            started: AtomicU64::new(0),
        }
    }

    /// The codec that validates the resident process's responses.
    pub fn codec(&self) -> &CoreLinkCodec {
        &self.codec
    }

    /// Sends `request` with a fresh `id` and waits up to `deadline` for its answer, with the
    /// generation of the resident process that answered. With `generation`, it sends only to that
    /// process and fails with `Replaced` once another one runs or would have to start.
    pub async fn request(
        self: &Arc<Self>,
        mut request: serde_json::Map<String, Value>,
        deadline: Duration,
        generation: Option<u64>,
    ) -> Result<(CoreLinkResponse, u64), LinkError> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        request.insert("id".to_owned(), Value::from(id));
        let line = Value::Object(request).to_string();
        let (sender, answer) = oneshot::channel();
        let answered_by;
        {
            let mut guard = self.connection.lock().await;
            if !guard.as_ref().is_some_and(Connection::is_alive) {
                if generation.is_some() {
                    return Err(LinkError::Replaced);
                }
                *guard = Some(self.start()?);
            }
            let connection = guard.as_ref().ok_or(LinkError::Unavailable)?;
            if generation.is_some_and(|wanted| wanted != connection.generation) {
                return Err(LinkError::Replaced);
            }
            answered_by = connection.generation;
            lock(&connection.pending).insert(id, sender);
            // The reader may have ended between the check above and the insert.
            if !connection.is_alive() || connection.requests.send(line).await.is_err() {
                lock(&connection.pending).remove(&id);
                return Err(LinkError::Unavailable);
            }
        }
        match tokio::time::timeout(deadline, answer).await {
            Ok(Ok(response)) => Ok((response, answered_by)),
            Ok(Err(_)) => Err(LinkError::Unavailable),
            Err(_) => {
                // A late answer finds no entry and is dropped, so the table stays as large as the
                // requests in flight.
                if let Some(connection) = self.connection.lock().await.as_ref() {
                    lock(&connection.pending).remove(&id);
                }
                Err(LinkError::Timeout)
            }
        }
    }

    fn start(self: &Arc<Self>) -> Result<Connection, LinkError> {
        let mut child = Command::new(&self.program)
            .args(&self.arguments)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|_| LinkError::Unavailable)?;
        let mut stdin = child.stdin.take().ok_or(LinkError::Unavailable)?;
        let stdout = child.stdout.take().ok_or(LinkError::Unavailable)?;
        let (requests, mut queue) = mpsc::channel::<String>(REQUEST_QUEUE);
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));

        tokio::spawn(async move {
            while let Some(line) = queue.recv().await {
                let written = async {
                    stdin.write_all(line.as_bytes()).await?;
                    stdin.write_all(b"\n").await?;
                    stdin.flush().await
                };
                if written.await.is_err() {
                    break;
                }
            }
        });

        let link = Arc::clone(self);
        let routes = Arc::clone(&pending);
        let alive = Arc::new(AtomicBool::new(true));
        let reading = Arc::clone(&alive);
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            let mut line = Vec::new();
            loop {
                line.clear();
                let read = (&mut reader)
                    .take(MAX_RESPONSE_LINE_BYTES as u64)
                    .read_until(b'\n', &mut line)
                    .await;
                let Ok(read) = read else { break };
                if read == 0 || line.last() != Some(&b'\n') {
                    break;
                }
                let Ok(text) = std::str::from_utf8(&line) else {
                    break;
                };
                let Ok(response) = link.codec.decode_response(text.trim_end()) else {
                    break;
                };
                if let Some(answer) = lock(&routes).remove(&response_id(&response)) {
                    let _ = answer.send(response);
                }
            }
            // The process ended or broke the protocol: every waiting request fails, and the
            // next request starts a new process.
            reading.store(false, Ordering::Release);
            lock(&routes).clear();
        });
        Ok(Connection {
            generation: self.started.fetch_add(1, Ordering::Relaxed) + 1,
            requests,
            pending,
            alive,
            _child: child,
        })
    }
}

fn response_id(response: &CoreLinkResponse) -> u64 {
    match response {
        CoreLinkResponse::CoreResultResponse(response) => response.id.get(),
        CoreLinkResponse::CoreFailedResponse(response) => response.id.get(),
        CoreLinkResponse::DecoderDecodedResponse(response) => response.id.get(),
        CoreLinkResponse::TranscriptPageResponse(response) => response.id.get(),
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}
