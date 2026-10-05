# Reader compatibility

Reader compatibility is advertised separately from registration and writer selection. The local trace surface, owner-only Node health snapshot, and Hub `GET /v1/health/capabilities` return the same `EventReaderCapabilitiesV1` meaning. The sync transport authenticates Hub identity before trusting the body and does not send the bearer secret to this unauthenticated endpoint.

The report contains only its schema, the fixed `event_reader` capability name, and ascending readable event-schema versions. It grants no write or rollout authority.

A missing, invalid, unverified, or v2-incapable peer report blocks future v2 writer activation without disabling local execution or current v1 synchronization.
