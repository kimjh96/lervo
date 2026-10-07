# Exchange

OKF v0.2 export creates a content-addressed, schema-versioned bundle. Import preserves unknown metadata and original bundle bytes, but maps external verification to local `unreviewed`.

Hub document sharing uses structured shared-context coordinates plus CAS bytes. Repository knowledge exchange uses OKF rather than an opaque upload; capability packages use a separate kind-tagged envelope.

A clone or another installation can lint, query, and re-export without a Hub.
