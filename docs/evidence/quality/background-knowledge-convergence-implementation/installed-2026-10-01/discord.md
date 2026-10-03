# October 1 Discord acceptance evidence

## Observed turn

At 01:23:25 UTC, the owner posted human-authored `테스트 전송` in Discord `#general`, channel `1546479355771883612`: message `1555027323827396720`.

WSL inbox event `cve_29976cf07e7eef12c86641b9af37fd3ce3ee98a5675fec1f5e0fb65a6d9b2d58` identifies a human actor and completed once without a failure code. The central executive recorded `respond` with reason `owned_human_message`.

Outbox `cvo_89864ce087e61f2dfd7ac5a54b2f4d40efddc1f79f4e11c3d14a5a28f4db5906` was delivered once at 01:25:36 UTC. A direct channel read found one Tarin reply, message `1555027874891833516`, and no second reply to this turn. The reply reported successful reception after two earlier generation failures belonging to separate turns.

## Evidence boundary and acceptance scope

This turn proves fresh human intake, central ownership, and one delivered Tarin response. It did not exercise post-hire or restart focus, verify Sol/Opus profile selection, or establish a multi-party exchange. Those installed acceptance criteria remain open.

The owner later stated that Kael is no longer operated; a new Kael-addressed test is outside current acceptance scope.

## Later human requests and real model use

At 10:21:54 UTC, the owner sent human-authored `#general` request `1555162839788818473`, addressing Tarin for separate Sol and Opus read-only opinions. Tarin published one reply, `1555165206806794273`, at 10:31:18 UTC.

WSL event `59490` records observed primary-provider usage by Claude `claude-opus-5-5` for the managed work; event `59501` records completed read-only repository work. The reply describes both Sol and Opus opinions, but no managed Codex Sol usage is tied to this source turn. Its prose does not establish two-provider execution. Separate Shiflo run events `10786`, `11071`, and `11144` observe Codex `gpt-6-sol` usage; they do not establish a same-turn Sol/Opus result for the general request.

## Fresh Shiflo delegation

At 12:03:57 UTC, after the installed Shiflo bundle started, the owner sent human-authored `#shiflo` message `1555188522233757737`. Four co-resident inboxes each completed the same source event once. Ruen alone recorded `respond/mentioned`; the other three recorded `observe/turn_not_owned`.

Nuri and Sora used their existing webhook principals, `1547729649688125492` and `1547621764161343489`, respectively. Ruen used application bot `1547405022587781260`.

Sora's task-result outbounds `cvo_97aac7fc7128de9a77becf736f80881cbbc698dc05df81924200842340c0e6e4` and `cvo_d28ef1dbc41951283bded4717aed04cc888cf35df6437ecab6c187fe527489b1` were each delivered in one attempt. Ruen's final outbound `cvo_9635e27f8a9e8881d8c23abd41a2a6fd01ad00ca9845c007a39269133f2c1c4c` was delivered in one attempt; Discord message `1555192083273351190` is the visible substantive summary at 12:18:06 UTC.

Sora outbound `cvo_995d289a913ee4557d80d3704a0ccaf05adb194e690001573bb784126568d9a5` remains `attention_required` after three `adapter_delivery_failed` attempts. Its canonical content contains two Discord mention tokens; `webhookCanPublish` rejects an `observe_only` webhook body containing such addresses before platform replay. Its platform replay table has no row, and the observed channel window contains no message matching its exact 2,196-byte content hash. No receipt, resend, or reviewed nonpublication disposition has been recorded.

## Completed-turn restart check

At about 16:53 UTC, the existing Shiflo systemd Node service restarted from PID `331` to `172857`, returning to aggregate and conversation `ready` with `NRestarts=0`.

Snapshots before restart, immediately after, and at 17:00 UTC showed identical inbox and outbox statuses and attempt counts across all five integrations, including every row for the fresh request. The same eleven Discord message IDs remained visible.

This proves completed-turn restart idempotence for the observed window. It does not prove failure-while-pending recovery or the full two-direction redelivery/failure/retry matrix. The held multi-party approval remains unresolved.

## Latest installed-bundle intake check

After the later Shiflo bundle replacement, a direct Discord read through the installed Ruen bot at 19:50 UTC still found `1555188522233757737`, sent at 12:03:57 UTC, as the latest human message in `#shiflo`. The latest visible bot message was Ruen's `1555192096678219902` at 12:18:09 UTC. The installed Tarin bot likewise saw no newer `#general` message than its 10:31:18 UTC reply, `1555165206806794273`.

The owner reported sending a new request, but neither installed bot saw a post-replacement message in those channels. The exact message link remains unknown. These observations do not establish a new installed multi-party or same-turn Sol/Opus acceptance run.
