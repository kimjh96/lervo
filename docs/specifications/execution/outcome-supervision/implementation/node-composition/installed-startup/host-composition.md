# Host composition

`openNodeSupervisionService` composes the existing native owner, canonical readers, effect adapters, exclusive owner lease and serial change loop without a Hub dependency. Opening validates the installed binding; `start` activates the loop once; `close` cancels active provider work, removes watchers and waits for shutdown.

Local unavailable-work tests verify startup and cleanup without launching a provider; they do not prove a completed positive local journey.

Stock Node startup opens this service with its existing transport and conversation runtimes. Node `start` activates supervision; shutdown closes supervision before its conversation delivery adapter. Failed startup closes already opened resources. The deployment entrypoint delegates current-credential Hub transports and idle hints to a dedicated transport composition module.

A configured result origin uses the canonical conversation origin schema: source event, participation policy, target and actor. Startup requires:

- Its exact integration to exist in this Node.
- Its configured agent to equal the accountable owner.
- Its participant to match the configured speaker.
- Its project to match the repository.
- Its conversation to belong to that deployment.

The existing conversation adapter is selected by integration ID; a runtime group rejects conflicting matches. The origin grants no additional publication authority. Actual queue admission still verifies canonical goal acceptance, semantic publication evidence, current mandate and the exact origin.
