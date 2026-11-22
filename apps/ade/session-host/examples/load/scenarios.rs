//! The streaming, flood, and soak scenarios.

use std::time::{Duration, Instant};

use lervo_session_protocol::HostMessage;
use lervo_session_transport::framed::Incoming;
use serde_json::{Value, json};

use crate::client::{Client, percentiles};
use crate::{FLOOD_PROBES, SOAK_SESSIONS, STREAM_LINES, now_ns};

pub async fn streaming(client: &mut Client) -> Option<Value> {
    let (session, _) = client.open("wks_stream").await?;
    // The provider waits for this line, so every delta arrives after the attach.
    client
        .send(json!({"kind": "session.send", "requestId": "req_go", "sessionId": session, "text": "go"}))
        .await?;
    let (mut latencies, started) = (Vec::new(), Instant::now());
    // A line that the 256 KiB item limit splits does not parse, so the stream also ends after two
    // quiet seconds.
    while (latencies.len() as u64) < STREAM_LINES {
        let Ok(next) = tokio::time::timeout(Duration::from_secs(2), client.reader.next()).await
        else {
            break;
        };
        if let Incoming::Control(payload) = next.ok()??
            && let HostMessage::ConversationDeltaMessage(delta) =
                client.codec.decode_host(&payload).ok()?
        {
            {
                for line in delta.append.lines() {
                    if let Ok(sent) = line.trim().parse::<u128>() {
                        latencies.push((now_ns().saturating_sub(sent)) as f64 / 1e6);
                    }
                }
            }
        }
    }
    let seconds = started.elapsed().as_secs_f64();
    let (p50, p95) = percentiles(latencies);
    Some(
        json!({"scenario": "streaming", "lines": STREAM_LINES, "linesPerSecond": (STREAM_LINES as f64 / seconds).round(), "providerToClientP50Ms": p50, "providerToClientP95Ms": p95}),
    )
}

pub async fn flood(client: &mut Client) -> Option<Value> {
    let (session, channel) = client.open("wks_flood").await?;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let started = Instant::now();
    let mut latencies = Vec::new();
    let mut flooded: u64 = 0;
    let (mut last, mut resyncs) = (0_u64, 0_u32);
    for probe in 0..FLOOD_PROBES {
        // Read the flood for 50 ms between probes, as a user types while a build prints.
        let pause = Instant::now();
        while pause.elapsed() < Duration::from_millis(50) {
            if let Ok(Ok(Some(Incoming::Terminal {
                bytes, sequence, ..
            }))) = tokio::time::timeout(Duration::from_millis(5), client.reader.next()).await
            {
                last = last.max(sequence);
                flooded += bytes.len() as u64;
            }
        }
        let marker = format!("MARK{probe:04}Z");
        let sent = Instant::now();
        client
            .writer
            .terminal(channel, 0, format!("{marker}\n").as_bytes())
            .await
            .ok()?;
        let mut tail = String::new();
        loop {
            let incoming = client.reader.next().await.ok()??;
            // A client that falls behind is asked to resynchronize; it attaches again from the
            // last sequence it read, as the interface does.
            if let Incoming::Control(payload) = &incoming
                && let Ok(HostMessage::SessionResyncRequiredMessage(_)) =
                    client.codec.decode_host(payload)
            {
                resyncs += 1;
                client.send(json!({"kind": "session.attach", "requestId": "req_resync", "sessionId": session, "afterSequence": last})).await?;
                continue;
            }
            if let Incoming::Terminal {
                bytes, sequence, ..
            } = incoming
            {
                last = last.max(sequence);
                flooded += bytes.len() as u64;
                tail.push_str(&String::from_utf8_lossy(&bytes));
                if std::env::var_os("LOAD_DEBUG").is_some()
                    && flooded % (64 * 1024 * 1024) < bytes.len() as u64
                {
                    eprintln!("probe {probe}: {flooded} bytes, last {last}, resyncs {resyncs}");
                }
                if tail.contains(&marker) {
                    latencies.push(sent.elapsed().as_secs_f64() * 1000.0);
                    break;
                }
                let keep = tail.len().saturating_sub(marker.len());
                tail.drain(..keep.min(tail.len()));
            }
        }
    }
    let (p50, p95) = percentiles(latencies);
    Some(
        json!({"scenario": "flood", "probes": FLOOD_PROBES, "floodBytesRead": flooded, "floodBytesPerSecond": (flooded as f64 / started.elapsed().as_secs_f64()).round(), "resyncs": resyncs, "inputEchoP50Ms": p50, "inputEchoP95Ms": p95}),
    )
}

fn rss_kib() -> Option<u64> {
    let output = std::process::Command::new("ps")
        .args(["-o", "rss=", "-p", &std::process::id().to_string()])
        .output()
        .ok()?;
    String::from_utf8_lossy(&output.stdout).trim().parse().ok()
}

/// Opens and stops `SOAK_SESSIONS` sessions, then lets the session host settle.
async fn soak_round(client: &mut Client, offset: u32) -> Option<()> {
    for index in offset..offset + SOAK_SESSIONS {
        let (session, _) = client.open(&format!("wks_soak{index}")).await?;
        client
            .send(json!({"kind": "session.stop", "requestId": "req_stop", "sessionId": session}))
            .await?;
        client
            .send(json!({"kind": "session.detach", "sessionId": session}))
            .await?;
    }
    tokio::time::sleep(Duration::from_secs(2)).await;
    Some(())
}

pub async fn soak(client: &mut Client) -> Option<Value> {
    tokio::time::sleep(Duration::from_millis(500)).await;
    let cold = rss_kib()?;
    soak_round(client, 0).await?;
    let warm = rss_kib()?;
    soak_round(client, SOAK_SESSIONS).await?;
    let after = rss_kib()?;
    let growth = |base: u64| (after as f64 - base as f64) * 100.0 / base as f64;
    Some(json!({
        "scenario": "soak",
        "sessionsPerRound": SOAK_SESSIONS,
        "rssColdKiB": cold,
        "rssAfterFirstRoundKiB": warm,
        "rssAfterSecondRoundKiB": after,
        "growthFromColdPercent": growth(cold),
        "growthFromWarmPercent": growth(warm),
    }))
}
