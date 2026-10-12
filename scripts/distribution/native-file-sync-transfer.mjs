import { resolve } from "node:path";
import {
  createNativeFileSyncTransfer,
  restoreNativeFileSyncTransfer,
} from "./lib/native-file-sync-transfer.mjs";
const [operation, destination, ...rest] = process.argv.slice(2);
if (!["create", "restore"].includes(operation) || !destination || rest.length)
  throw new Error("Usage: native-file-sync-transfer.mjs <create|restore> <artifact-directory>");
const owner = operation === "create" ? createNativeFileSyncTransfer : restoreNativeFileSyncTransfer;
const receipt = await owner({
  repositoryRoot: resolve(import.meta.dirname, "../.."),
  artifactDirectory: resolve(destination),
});
process.stdout.write(JSON.stringify(receipt) + "\n");
