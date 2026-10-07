# Transfer and readiness

A bundle request binds the exact snapshot hash selected by reconciliation. Source advancement before bundle creation cannot substitute newer bytes for that decision's bytes.

After an exact target apply, the coordinator persists the transferred snapshot as the new common base before recapturing the active source. If the source advanced concurrently, the cycle remains pending; its successor proceeds as a one-sided change rather than manufacturing dual divergence from the older base.

A readiness receipt is written only after both observed sides are equal. After a transfer, both sides must first be recaptured. Readiness admission compares the receipt with a fresh capture.
