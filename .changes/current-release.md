<!-- lervo-release package="@lervo/cli" version="0.20.0" schema="1" -->

## What's changed

- Accept workspace coordination permissions in Hub credential files so convergence owner leases can be granted.
- Capture owner rules automatically on every host: owner turns are assessed semantically where they were observed, candidates are shared through the Hub and applied by the convergence owner, and instruction intake no longer times out or hides why it failed.
- Coordinate background knowledge convergence across hosts with one Hub-leased owner, a commit fence, and standalone contention detection.
- Drop superseded knowledge commits on every replicated checkout so the repository replica never resurrects them.
- Knowledge publication pushes unchanged content once, merges only after every check succeeds, records gh failure causes, and formats knowledge outputs before committing and publishing.
- Publish knowledge commits only on top of the current remote base, supersede stale ones that conflict, and name the Hub failure cause of an unverifiable convergence owner.
- Publish the convergence owner's settled knowledge commits through one rolling pull request and merge it after checks pass.
- Update knowledge publication pull requests through the REST API and never let a description update block the merge.
