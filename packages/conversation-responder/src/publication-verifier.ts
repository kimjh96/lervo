import type {
  ConversationPublicationVerifier,
  ConversationReplyCandidate,
} from "@lervo/interaction";
import type { ConversationInboundEvent, ConversationParticipationPolicy } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";
import { readPublishableWritingArtifact } from "@lervo/writing";

import type { ConversationWritingContractResolver } from "./types.js";
import { ManagedConversationResponseError } from "./types.js";

export class VerifiedConversationPublication implements ConversationPublicationVerifier {
  constructor(
    private readonly options: {
      artifactStore: ArtifactStore;
      resolveWritingContract: ConversationWritingContractResolver;
    },
  ) {}

  async verify(input: {
    candidate: ConversationReplyCandidate;
    event: ConversationInboundEvent;
    policy: ConversationParticipationPolicy;
  }): Promise<void> {
    const evidence = input.candidate.publicationEvidence;
    if (
      evidence.artifact.artifactId !== input.candidate.content.artifactId ||
      evidence.artifact.contentHash !== input.candidate.content.contentHash ||
      evidence.artifact.byteCount !== input.candidate.content.byteCount ||
      evidence.artifact.mediaType !== input.candidate.content.mediaType ||
      input.candidate.publicationPermit.surface !== "chat"
    ) {
      throw new ManagedConversationResponseError(
        "writing_publication_blocked",
        "The conversation response content coordinates differ from the writing publication evidence.",
      );
    }
    const contract = await this.options.resolveWritingContract({
      event: input.event,
      policy: input.policy,
    });
    await readPublishableWritingArtifact({
      artifact: evidence.artifact,
      evaluation: evidence.evaluation,
      evaluationArtifact: evidence.evaluationArtifact,
      permit: input.candidate.publicationPermit,
      contract,
      surface: "chat",
      artifactStore: this.options.artifactStore,
    });
  }
}
