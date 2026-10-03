# Hub event compatibility repair

The Hub still ran the 2026-09-19 r25 artifact while Nodes emitted a later valid schema-v2 type. Arca's 93-event contiguous outbox began at sequence 5392 with `conversation.repository_work.completed`. The old Hub rejected even that single event with HTTP 400 while registration, authenticated reads, identity, TLS, and the advertised `[1,2,3]` reader envelope remained valid. The Node retried under overly broad `hub_unavailable`.

Matching Hub distribution `sha256:f486acc4ffc7257a9af92def51ea41a4f355b61e30ac15583caf3a871364e9c6` (`runtime-f486acc4-r47`) was installed transactionally; the exact r25 service definition remains for rollback.

Three consecutive observations found the Hub active on r47 with zero restarts. Arca acknowledged all 93 events without rewriting them, reached zero unacknowledged outbox rows, and regained ready sync/workstream replication.

This establishes installed compatibility repair, not fresh human-authored Lervo or Shiflo response acceptance.
