# Snapshot advancement

`assertConvergenceEffectSources` immediately accepts an identical snapshot hash. Otherwise, it compares captured HEAD and path/hash maps. A supplied committedHead is recognized when its before coordinate equals the prior observed HEAD and its after coordinate equals the new capture's HEAD. Git ancestry inspection and stage-receipt authentication remain caller responsibilities.

Duplicate approved-effect paths raise `knowledge_effect_uncertain`. Every changed source path must match an approved before/after pair or raise `source_bytes_changed`. A changed snapshot with neither changed source bytes nor a recognized own commit is also rejected.

Operation conversion ignores unchanged operations, represents moves as deletion and destination creation, and represents other writes or deletions with exact expected and desired hashes.
