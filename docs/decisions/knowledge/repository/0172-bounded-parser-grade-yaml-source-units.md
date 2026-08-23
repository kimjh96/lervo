# ADR-0172: Bounded Parser-Grade YAML Source Units

- Status: accepted
- Decision date: 2026-08-23

## Context

File-level YAML units and regex scanning cannot safely represent nested keys, documents, sequences, anchors, aliases, tags, duplicates, or fine-grained freshness.

## Decision

yaml-key-pointer-v1+yaml-2.9.0 pins YAML 2.9.0 and parses .yaml/.yml with YAML 1.2 core schema, string keys, and uniqueness. Every mapping key becomes config_key at yaml-pointer:doc=<index>:<RFC-6901-pointer>, recursively including sequences and documents.

Exact unit bytes span key start through value end. Parents include subtrees; sibling changes do not alter unrelated versions. Unit versions bind stable unit ID, exact bytes, adapter ID, and unit mode; source hash remains separately bound. Older adapters retain compatibility.

Anchors are traversed at declaration. Aliases retain only their own locator/token range and are never expanded; merge keys are not materialized. Any parser error/warning, duplicate/non-string key, unknown tag, more than 16,384 keys, or depth over 128 fails the complete scan. The adapter never converts to executable objects or runs tags, code, shell, or network.

Errors reveal no paths, bytes, payloads, or secrets; sources remain canonical and units rebuildable.

## Consequences

Fixtures cover nested maps/sequences, escaped pointers, multiple documents, anchors/aliases, exact ranges, stable sibling versions, malformed/ambiguous YAML, bounds, and controlled redaction.
