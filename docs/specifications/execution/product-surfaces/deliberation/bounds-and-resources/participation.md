# Provider-proven deliberation participation

Under [ADR-0460](../../../../../decisions/coordination/deliberation/0460-trigger-tiered-deliberation-at-decision-points.md), `deliberation.artifact.recorded` carries `usageVerification`. It is `verified` only when the producing run recorded complete `deliberation`-scope usage for the producing provider; otherwise it is `unverified`. Readers treat historical events without the field as `unverified`.

`deliberation.completed` carries `verifiedParticipantCount`, the number of participant roles whose every artifact is verified. The runtime refuses a `converged` outcome while any artifact is unverified and reports `deliberation_participant_unverified`; `no_consensus` and `failed` outcomes still record.

Conversation replies pass the `provider_claim_unproven` check before writing evaluation. A reply attributing opinions to more than one provider must cite a `dlb_` identifier whose recorded artifacts are all verified and come from at least two providers. Otherwise the reply is repaired, not refused: opinion sentences naming another provider are removed, and a note in the reply language states that the reply reflects the one observed provider.

The check covers Discord repository-work replies and managed conversation replies. Provider names include model family names such as Sol and Opus; the events carry only identifiers and verification states.
