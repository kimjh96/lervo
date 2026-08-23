# ADR-0179: Bounded Parser-Grade CSS Symbol Units

- Status: accepted
- Decision date: 2026-08-23

## Context

CSS was the largest remaining code kind after JS and TS but had only file units. Regex cannot safely parse comments, strings, escapes, nesting, or braces, while semantic build or plugin execution exceeds source-unit scope.

## Decision

`css-symbol-v1+postcss-8.5.26` calls only `postcss.parse(content,{from:undefined})`, with no processor, plugin, configuration, import, source map, filesystem, shell, or network access.

It extracts rules, custom properties, and named `container`, `custom-media`, `keyframes`, `-webkit-keyframes`, `layer`, `media`, `property`, `scope`, and `supports` at-rules. Other at-rules and ordinary declarations are outside symbol coverage.

Locators encode normalized ancestry and symbol labels using RFC 6901 escaping. Repeated qualified symbols receive source-order occurrence numbers. Public start-inclusive, end-exclusive offsets are converted once from UTF-16 to UTF-8 and line coordinates. Versions bind exact unit bytes and the adapter, isolating siblings.

Limits are 16,384 AST nodes, depth 128, 2,048-character labels, and 8,192-character locators. Parser, range, or bound failures return no partial units. Rule and named at-rule units include full blocks; custom properties also receive fine-grained units. No claim is made about cascade, equivalence, compatibility, dead code, imports, or build output.

Errors reveal no content, selectors, values, URLs, paths, or parser text and mutate nothing.

## Consequences

Fixtures cover Unicode offsets, layers, qualified rules, custom properties, keyframes, duplicate occurrences, sibling isolation, malformed or deeply nested CSS, full builds, packed CLI behavior, and actual repository CSS processing.
