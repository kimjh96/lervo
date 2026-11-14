# Composition contract

ADR-0306 permits this bounded v2 composition above compatibility ports:

```text
0..1 query-projection stage -> 1..3 retrieve stages -> 0..1 fusion stage -> 0..1 rerank stage
```

It supports distinct complete-plan candidates for external-only replacement, local-plus-external augmentation, and external reranking. The ports and evaluation executor exist; the layer is neither a general DAG nor an operationally selectable plan.

V2 separates index preparation from query execution, binds an immutable preparation receipt, and records a privacy-bounded receipt for every stage.

Query projection stays outside engine adapters and cannot establish truth, effects, authority, or plan selection. A reranker may only reorder or drop its bounded registered input; it cannot introduce a source.

Required-stage failure fails the complete plan closed. A reduced plan requires separate review and must not serve as a runtime fallback.
