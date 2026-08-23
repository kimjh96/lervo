# ADR-0172: Bounded Parser-Grade YAML Source Units

- Status: accepted
- Decision date: 2026-08-23

## Context

File-level YAML units and regex scanning cannot safely represent nested keys, documents, sequences, anchors, aliases, tags, duplicates, or fine-grained freshness.

## Decision

`yaml-key-pointer-v1+yaml-2.9.0` pins YAML 2.9.0 and parses `.yaml` and `.yml` using the YAML 1.2 core schema, string keys, and uniqueness. Every mapping key becomes `config_key` at `yaml-pointer:doc=<index>:<RFC-6901-pointer>`, recursively across sequences and documents.

Exact unit bytes span from the key start through the value end. Parent units include subtrees; sibling changes do not alter unrelated versions. Unit versions bind the stable unit ID, exact bytes, adapter ID, and unit mode. The source hash remains separately bound, and older adapters remain compatible.

Anchors are traversed at their declarations. Aliases retain only their own locator and token range and are never expanded; merge keys are not materialized. Any parser error or warning, duplicate or non-string key, unknown tag, more than 16,384 keys, or depth greater than 128 fails the entire scan. The adapter never converts input into executable objects or runs tags, code, shell, or network operations.

Errors reveal no paths, bytes, payloads, or secrets. Sources remain canonical, and units remain rebuildable.

## Consequences

Fixtures cover nested maps and sequences, escaped pointers, multiple documents, anchors and aliases, exact ranges, stable sibling versions, malformed or ambiguous YAML, bounds, and controlled redaction.
