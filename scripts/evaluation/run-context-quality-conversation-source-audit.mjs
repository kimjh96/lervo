import { auditConversationSources } from "./lib/context-quality-conversation-source-reader.mjs";

const [root, integrations, ...extra] = process.argv.slice(2);
if (!root || !integrations || extra.length)
  throw new Error(
    "Usage: run-context-quality-conversation-source-audit.mjs <repository-root> <integration-ids-comma-separated>",
  );
process.stdout.write(
  JSON.stringify(await auditConversationSources(root, integrations.split(","))) + "\n",
);
