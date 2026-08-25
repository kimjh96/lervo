# Evidence-bound repository changes

Status: `active`
As of: 2026-08-26

Before changing user-owned repository bytes or durable lifecycle state, create a bounded, content-bound plan. Name every target and intended disposition, bind current hashes and policy inputs, and specify the verification required for review. Apply only after exact plan approval, and recheck the same bindings immediately before mutation.

Keep provider behavior outside this contract. Plans and durable events must exclude source bodies, credentials, absolute paths, and unrestricted errors. Provider results, repeated observations, and matching model outputs are evidence for review only; they are never approval or proof of use.

Stage changes so prior bytes can be restored if persistence fails. Record success only after validation. If the durable event cannot commit, roll back repository changes and emit no success. Interrupted work must leave an explicit recovery marker and block conflicting mutation until recovery either restores the prior state or completes a proven commit.

Read-only inspection requires no apply authority. A replace-current projection may advance without invalidating an unrelated target, but every selected target and protection input remains content-bound. Before finishing, run the plan's declared verification commands and the repository completion contract.
