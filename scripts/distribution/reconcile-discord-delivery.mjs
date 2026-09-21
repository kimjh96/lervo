import { reconcileDiscordDelivery } from "./lib/discord-delivery-reconciliation.mjs";

const argumentsByName = new Map();
let apply = false;
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--apply") {
    apply = true;
    continue;
  }
  const value = process.argv[index + 1];
  if (!argument?.startsWith("--") || value === undefined || value.startsWith("--")) {
    throw new Error("Use --config, --integration, --outbound, and --message.");
  }
  argumentsByName.set(argument, value);
  index += 1;
}

const configPath = argumentsByName.get("--config");
const integrationId = argumentsByName.get("--integration");
const outboundId = argumentsByName.get("--outbound");
const messageId = argumentsByName.get("--message");
if (
  argumentsByName.size !== 4 ||
  [configPath, integrationId, outboundId, messageId].some((value) => value === undefined)
) {
  throw new Error("Use --config, --integration, --outbound, and --message.");
}

try {
  const result = await reconcileDiscordDelivery({
    configPath,
    integrationId,
    outboundId,
    messageId,
    apply,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Delivery reconciliation failed."}\n`,
  );
  process.exitCode = 1;
}
