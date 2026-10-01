# Sources, Policy, and Structural Publication

This specification defines repository source admission, source units, policy, structural compilation, and bounded publication.

- [Sources and source units](structural-publication/sources.md)
- [Policy and preservation boundaries](structural-publication/policy.md)
- [Structural compilation and publication lifecycle](structural-publication/compilation-and-publication.md)

The verification-result source remains bound to its recorded suite hash. If the current suite differs, historical validation checks only the result schema, command outcomes and artifact coordinates, execution times, overall status, and the content-derived verification ID. It does not claim that the recorded commands satisfy the current suite. The [full historical validation contract](structural-publication/sources/verification-results.md) owns the detailed boundary.
