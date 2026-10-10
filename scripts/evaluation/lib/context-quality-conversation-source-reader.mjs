import { DatabaseSync } from "node:sqlite";
import { lstat, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  conversationSourceLimits,
  createConversationSourceReport,
} from "./context-quality-conversation-source-report.mjs";

const ownerDigest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
async function ownerBuild(root) {
  const entries = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".js"))
        entries.push([path.slice(root.length + 1), ownerDigest(await readFile(path))]);
      if (entries.length > 5000) throw new Error("Conversation audit owner-build bound exceeded.");
    }
  }
  for (const name of ["project", "conversation-contract", "schemas", "event-contract", "cas"])
    await visit(resolve(root, "packages", name, "dist"));
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  return { fileCount: entries.length, digest: ownerDigest(JSON.stringify(entries)) };
}

/** Reads scoped existing stores without opening a writer or exporting conversation bodies. */
export async function auditConversationSources(root, integrationIds) {
  root = resolve(root);
  if (
    !integrationIds.length ||
    integrationIds.length > 8 ||
    new Set(integrationIds).size !== integrationIds.length ||
    integrationIds.some((id) => !/^itg_[A-Za-z0-9_-]{7,63}$/u.test(id))
  )
    throw new Error("Expected one through eight distinct integration IDs.");
  const before = await ownerBuild(root);
  const { assertConversationInboundEvent } = await import(
    resolve(root, "packages/conversation-contract/dist/index.js")
  );
  const { FileSystemCas } = await import(resolve(root, "packages/cas/dist/index.js"));
  const { loadProjectManifest } = await import(resolve(root, "packages/project/dist/index.js"));
  const project = await loadProjectManifest(root);
  const report = createConversationSourceReport(
    project.projectId,
    integrationIds,
    assertConversationInboundEvent,
  );
  const sources = new Map();
  for (const name of integrationIds)
    sources.set(
      name,
      await FileSystemCas.openReadOnly(
        resolve(root, ".lervo/data/conversation", name, "artifacts"),
      ),
    );
  const stores = [];
  const observedAt = new Date().toISOString();
  for (const name of integrationIds) {
    const path = resolve(root, ".lervo/data/conversation", name, "interactions.sqlite");
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Unsafe conversation source.");
    const db = new DatabaseSync(path, { readOnly: true, allowExtension: false });
    let rows = 0;
    try {
      db.exec("PRAGMA query_only=ON; BEGIN;");
      const quickCheck = db.prepare("PRAGMA quick_check").get().quick_check;
      const foreignKeyViolations = db.prepare("PRAGMA foreign_key_check").all().length;
      const schemaVersion = db.prepare("PRAGMA user_version").get().user_version;
      if (quickCheck !== "ok" || foreignKeyViolations !== 0)
        throw new Error("Conversation source SQLite integrity failed.");
      for (const row of db
        .prepare(
          "SELECT event_id,project_id,integration_id,conversation_id,event_json FROM conversation_inbox ORDER BY event_id,role_id LIMIT 20001",
        )
        .iterate()) {
        rows++;
        const event = report.observe(row, name);
        if (event === null) continue;
        let bytes = null;
        try {
          const hash = event.content.contentHash.slice(7);
          const object = resolve(
            root,
            ".lervo/data/conversation",
            event.target.integrationId,
            "artifacts/sha256",
            hash.slice(0, 2),
            hash.slice(2),
          );
          const info = await lstat(object);
          if (
            !info.isFile() ||
            info.isSymbolicLink() ||
            info.size > conversationSourceLimits.maximumAcceptedBodyBytes
          )
            throw new Error("Unsafe or oversized conversation source body.");
          bytes = await sources.get(event.target.integrationId).get(`lervo-cas://sha256/${hash}`);
        } catch {
          // The aggregate explicitly distinguishes a missing/corrupt body from a verified source.
        }
        report.observeBody(event, bytes);
      }
      stores.push({ integrationId: name, schemaVersion, quickCheck, foreignKeyViolations, rows });
    } finally {
      db.close();
    }
  }
  if ((await ownerBuild(root)).digest !== before.digest)
    throw new Error("Conversation audit owner build changed.");
  return {
    schemaVersion: 1,
    auditId: "context-quality-remote-conversation-source-v1",
    observedAt,
    nodeVersion: process.version,
    projectId: project.projectId,
    ownerBuild: before,
    validationScope:
      "Normalized inbound schema/hash and row coordinates, SQLite quick/foreign-key checks, exact body hash/size/UTF-8. Not full interaction lifecycle validation or human task review.",
    limits: conversationSourceLimits,
    stores,
    complete: true,
    unchangedOwnerBuild: true,
    ...report.finish(),
  };
}
