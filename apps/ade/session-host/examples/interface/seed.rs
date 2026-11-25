//! The seeded conversation: deterministic turns of a user message, tool activity, and an agent
//! reply, in English and Korean, about 400 bytes per item on average. It is stored the way the
//! native session stores items, so the session host opens it as its own index.

use std::path::Path;

use lervo_session_core::paging::item_id;
use lervo_session_protocol::ConversationItem;
use lervo_session_protocol::codec::encode;
use lervo_session_store::ConversationStore;
use serde_json::json;

const CACHE_BYTES: usize = 1024 * 1024;
/// 2026-11-01 00:00 UTC; each item is one second after the previous one.
const FIRST_ITEM_MS: u64 = 1_793_491_200_000;

const REQUESTS: [&str; 6] = [
    "Review the session host protocol and list what the interface still lacks.",
    "세션 호스트가 종료된 세션을 얼마나 오래 보관하는지 확인해줘.",
    "Measure the conversation index with a hundred thousand items.",
    "작업공간 목록에 상태 점이 언제 나타나는지 정리해줘.",
    "Check that the composer keeps the text when sending fails.",
    "터미널 대화에서 붙여넣기가 한 번에 전달되는지 봐줘.",
];

const SENTENCES: [&str; 12] = [
    "The session host keeps each ended session for ten minutes, then releases its scrollback.",
    "I read the protocol specification and the generated schema, and they agree on every field.",
    "The index stores items in fixed segments, so opening it reads only the offset tables.",
    "Each streamed delta merges with the next one until a status change or the size limit.",
    "The interface keeps at most six hundred items and asks for older pages as you scroll.",
    "I ran the focused tests for the conversation window; all of them passed.",
    "세션이 끝나면 마지막 256 KiB만 남기고 나머지 스크롤백은 해제합니다.",
    "작업공간을 다시 열면 기록은 움직임 없이 그대로 나타납니다.",
    "상태 점은 작업 중일 때만 숨 쉬듯 깜빡이고, 창이 숨겨지면 멈춥니다.",
    "변경은 아직 커밋하지 않았고, 확인한 파일은 두 개입니다.",
    "Nothing in this change touches the provider adapters or the event schema.",
    "The next step is to measure first paint with the real webview.",
];

const TOOLS: [&str; 4] = ["Read", "Grep", "Bash", "Edit"];

/// A fixed linear congruential sequence, so every run seeds the same conversation.
struct Sequence(u64);

impl Sequence {
    fn next(&mut self, bound: usize) -> usize {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        usize::try_from(self.0 >> 33).unwrap_or(0) % bound.max(1)
    }
}

/// Appends items until the index at `directory` holds `items`. A complete index is left as is.
pub fn conversation(directory: &Path, items: u64) -> Result<(), Box<dyn std::error::Error>> {
    let mut store = ConversationStore::open(directory, CACHE_BYTES)?;
    let mut sequence = Sequence(0x2545_F491_4F6C_DD1D);
    // Replays the sequence up to the stored items, so a partial index continues identically.
    for position in 0..items {
        let item = item(position, &mut sequence)?;
        if position >= store.len() {
            store.append(&encode(&item)?)?;
        }
    }
    Ok(())
}

fn item(position: u64, sequence: &mut Sequence) -> Result<ConversationItem, serde_json::Error> {
    let id = item_id(position);
    let created = FIRST_ITEM_MS + position * 1_000;
    let value = match position % 4 {
        0 => json!({
            "kind": "user_message", "itemId": id, "createdAtMs": created, "state": "complete",
            "text": REQUESTS[sequence.next(REQUESTS.len())],
        }),
        1 => {
            let name = TOOLS[sequence.next(TOOLS.len())];
            // The draw for the old call count keeps the rest of the sequence as it was.
            let _ = sequence.next(6);
            json!({
                "kind": "tool_activity", "itemId": id, "createdAtMs": created, "state": "complete",
                "tool": { "name": name, "status": "succeeded", "calls": 1, "detail": detail(name) },
            })
        }
        _ => json!({
            "kind": "agent_message", "itemId": id, "createdAtMs": created, "state": "complete",
            "text": reply(sequence),
        }),
    };
    serde_json::from_value(value)
}

/// What each seeded tool call acted on and showed.
fn detail(name: &str) -> serde_json::Value {
    match name {
        "Read" => {
            json!({ "subject": { "kind": "path", "text": "src/session/index.ts" }, "counts": { "lines": 42 } })
        }
        "Grep" => json!({
            "subject": { "kind": "pattern", "text": "maximum" },
            "counts": { "files": 3 },
            "preview": {
                "format": "output",
                "lines": ["src/login.ts", "src/limits.ts", "docs/limits.md"],
                "omittedLines": 0, "omittedAt": 3,
            },
        }),
        "Bash" => json!({
            "subject": { "kind": "command", "text": "pnpm test login" },
            "preview": {
                "format": "output",
                "lines": [" ✓ login.test.ts (4 tests) 12ms", "", " Test Files  1 passed (1)", "      Tests  4 passed (4)"],
                "omittedLines": 0, "omittedAt": 4,
            },
        }),
        _ => json!({
            "subject": { "kind": "path", "text": "src/login.ts" },
            "counts": { "added": 2, "removed": 1 },
            "preview": {
                "format": "diff",
                "lines": [
                    "@@ -3,1 +3,2 @@",
                    "-export const maximum = 64;",
                    "+/** Every password limit lives here. */",
                    "+export const maximum = 1024;",
                ],
                "omittedLines": 0, "omittedAt": 4,
            },
        }),
    }
}

/// One to three paragraphs of one to three sentences.
fn reply(sequence: &mut Sequence) -> String {
    let paragraphs = sequence.next(3) + 1;
    (0..paragraphs)
        .map(|_| {
            let sentences = sequence.next(3) + 1;
            (0..sentences)
                .map(|_| SENTENCES[sequence.next(SENTENCES.len())])
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}
