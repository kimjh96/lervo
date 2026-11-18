#!/usr/bin/env node

// Fixture Claude provider for the ADR-0561 capability install cross-check. Each no-capability
// session approves the exact package hash it was given, so the installed journey exercises the two
// agreeing checks an install needs without a model. It never logs package content. Callers copy it
// to an extensionless `claude`, so it uses no module-only syntax such as top-level await.

if (process.argv.includes("--version")) {
  console.log("claude-capability-review-fixture 1.0.0");
  process.exit(0);
}

async function main() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  const request = JSON.parse(text);
  if (request.task !== "capability_package_review")
    throw new Error(`Unexpected fixture task ${request.task}`);
  const response = {
    packageHash: request.untrustedSourceData.packageHash,
    decision: "approve",
    rationale:
      "Fixture review: every package file matches the manifest summary and intents, and nothing requests undeclared hosts or permissions.",
  };
  console.log(
    JSON.stringify({
      is_error: false,
      result: JSON.stringify(response),
      structured_output: response,
      permission_denials: [],
      stop_reason: "tool_use",
      num_turns: 2,
      usage: { server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 } },
      modelUsage: {
        fixture: {
          inputTokens: 900,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          outputTokens: 150,
          contextWindow: 200_000,
        },
      },
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
