# Organization policy and credentials

Organization deployment policy is a separate signed, content-addressed boundary. V1 requires strict project tenancy and explicit per-project principals. Credential issuance and runtime delivery use different principals; rotation and revocation have separate permissions. Policy bounds runtime permissions, lifetime, and overlap. Missing policy authority denies the organization operation but never disables local-only execution.

Credential grants bind policy hash, repository identity, Node, destination, subject, permissions, generation, and validity. They contain neither credential material nor a source location.

An injected source supplies bounded bearer bytes only after authority, time, and revocation checks; an injected consumer confirms activation. Source bytes are cleared on every post-load exit. Delivery receipts contain `secretMaterial: excluded` and prove neither authentication nor later use.
