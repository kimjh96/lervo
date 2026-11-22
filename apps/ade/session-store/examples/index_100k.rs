//! Measures the conversation index with 100,000 items (ADE performance budgets, "a conversation
//! with 100,000 items, opened and scrolled").
//!
//! `cargo run --release -p lervo-session-store --example index_100k` appends 100,000 items of
//! about 400 bytes, reopens the index, and reads the newest page and 200 random pages of 100
//! items, printing one JSON line with the timings and the bytes on disk.

use std::time::{Duration, Instant};

use lervo_session_store::ConversationStore;

const ITEMS: u64 = 100_000;
const PAGE: u64 = 100;
const PAGES: u64 = 200;
const CACHE_BYTES: usize = 1024 * 1024;

fn percentile(samples: &mut [Duration], fraction: f64) -> f64 {
    samples.sort();
    let index = ((samples.len() as f64 - 1.0) * fraction).round() as usize;
    samples
        .get(index)
        .map_or(0.0, |sample| sample.as_secs_f64() * 1000.0)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("ses_measure");
    let item = vec![b'x'; 400];

    let started = Instant::now();
    let mut store = ConversationStore::open(&path, CACHE_BYTES)?;
    for _ in 0..ITEMS {
        store.append(&item)?;
    }
    let append = started.elapsed();
    drop(store);

    let opened = Instant::now();
    let mut store = ConversationStore::open(&path, CACHE_BYTES)?;
    let open = opened.elapsed();

    let newest = Instant::now();
    store.read(ITEMS - PAGE, ITEMS)?;
    let first_page = newest.elapsed();

    // A fixed linear congruential sequence keeps the pages the same on every run.
    let mut seed: u64 = 0x2545_F491_4F6C_DD1D;
    let mut pages = Vec::new();
    for _ in 0..PAGES {
        seed = seed.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1);
        let start = (seed >> 33) % (ITEMS - PAGE);
        let read = Instant::now();
        store.read(start, start + PAGE)?;
        pages.push(read.elapsed());
    }
    let disk: u64 = std::fs::read_dir(&path)?
        .filter_map(Result::ok)
        .filter_map(|entry| entry.metadata().ok())
        .map(|metadata| metadata.len())
        .sum();
    println!(
        "{{\"items\":{ITEMS},\"appendMs\":{:.0},\"openMs\":{:.2},\"newestPageMs\":{:.3},\"randomPageP50Ms\":{:.3},\"randomPageP95Ms\":{:.3},\"diskBytes\":{disk}}}",
        append.as_secs_f64() * 1000.0,
        open.as_secs_f64() * 1000.0,
        first_page.as_secs_f64() * 1000.0,
        percentile(&mut pages.clone(), 0.5),
        percentile(&mut pages, 0.95),
    );
    Ok(())
}
