import { mkdir, lstat, chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ProjectStorage } from "@lervo/project-storage";
import type { WorkforceAssignment } from "@lervo/agent-workforce";
import { canonicalJson, sha256, stableId } from "@lervo/repository-knowledge";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import { sqliteRow, sqliteRows } from "./sqlite-row.js";

/** Private exact effect coordinates, retained until their canonical obligation is terminal. */
export async function convergenceEffectCheckpoint<T>(input: {
  storage: ProjectStorage;
  assignment: WorkforceAssignment;
  effect: string;
  prepare(): Promise<T>;
}): Promise<T> {
  const { storage, assignment } = input;
  if (!assignment.convergence || !assignment.lease)
    throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
  const directory = resolve(storage.paths.repositoryRoot, ".lervo/state/knowledge");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const parent = await lstat(directory);
  if (!parent.isDirectory() || parent.isSymbolicLink())
    throw new KnowledgeConvergenceRuntimeError("host_coordinate_invalid");
  const path = resolve(directory, "convergence-effects.sqlite");
  try {
    const file = await lstat(path);
    if (!file.isFile() || file.isSymbolicLink())
      throw new KnowledgeConvergenceRuntimeError("host_coordinate_invalid");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const db = new DatabaseSync(path);
  await chmod(path, 0o600);
  db.exec(
    "PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS checkpoints (coordinate_hash TEXT PRIMARY KEY, obligation_id TEXT NOT NULL, artifact_hash TEXT NOT NULL, assignment_id TEXT, input_hash TEXT, effect TEXT, lease_generation INTEGER)",
  );
  const columns = sqliteRows(db.prepare("PRAGMA table_info(checkpoints)").all()).map(
    (row) => row.name,
  );
  for (const [name, type] of [
    ["assignment_id", "TEXT"],
    ["input_hash", "TEXT"],
    ["effect", "TEXT"],
    ["lease_generation", "INTEGER"],
  ])
    if (!columns.includes(name)) db.exec(`ALTER TABLE checkpoints ADD COLUMN ${name} ${type}`);
  const coordinate = sha256(
    canonicalJson([
      assignment.assignmentId,
      assignment.convergence.inputArtifactHash,
      assignment.lease,
      input.effect,
    ]),
  );
  try {
    const prior = sqliteRow(
      db.prepare("SELECT artifact_hash FROM checkpoints WHERE coordinate_hash=?").get(coordinate),
    );
    if (prior) {
      const hash = String(prior.artifact_hash);
      if (!/^sha256:[a-f0-9]{64}$/u.test(hash))
        throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
      const bytes = await storage.artifacts.get(`lervo-cas://sha256/${hash.slice(7)}`);
      if (sha256(bytes) !== hash)
        throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
      const stored = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes));
      if (stored.coordinate !== coordinate)
        throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
      return stored.value as T;
    }
    for (const row of sqliteRows(
      db.prepare("SELECT DISTINCT obligation_id FROM checkpoints LIMIT 8192").all(),
    )) {
      const id = String(row.obligation_id);
      const terminal = storage.events.get(stableId("evt", [id, "terminal"], 32));
      if (
        terminal?.type === "repository.knowledge.convergence.recorded" &&
        terminal.payload.obligationId === id
      )
        db.prepare("DELETE FROM checkpoints WHERE obligation_id=?").run(id);
    }
    if (
      Number(sqliteRow(db.prepare("SELECT count(*) AS count FROM checkpoints").get())!.count) >=
      8192
    )
      throw new KnowledgeConvergenceRuntimeError("knowledge_capacity_unavailable");
    const value = await input.prepare();
    const proof = await storage.artifacts.put(
      canonicalJson({ schemaVersion: 1, coordinate, assignment, effect: input.effect, value }),
    );
    db.prepare(
      "INSERT INTO checkpoints(coordinate_hash,obligation_id,artifact_hash,assignment_id,input_hash,effect,lease_generation) VALUES(?,?,?,?,?,?,?)",
    ).run(
      coordinate,
      assignment.convergence.obligationId,
      proof.contentHash,
      assignment.assignmentId,
      assignment.convergence.inputArtifactHash,
      input.effect,
      assignment.lease.generation,
    );
    return value;
  } finally {
    db.close();
  }
}

/** Read-only recovery lookup. A retained receipt never revives the predecessor lease. */
export async function readConvergenceEffectCheckpoint<T>(input: {
  storage: ProjectStorage;
  assignmentId: string;
  inputArtifactHash: string;
  effect: string;
}): Promise<T | null> {
  const path = resolve(
    input.storage.paths.repositoryRoot,
    ".lervo/state/knowledge/convergence-effects.sqlite",
  );
  try {
    const file = await lstat(path);
    if (!file.isFile() || file.isSymbolicLink())
      throw new KnowledgeConvergenceRuntimeError("host_coordinate_invalid");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (
      !sqliteRows(db.prepare("PRAGMA table_info(checkpoints)").all()).some(
        (row) => row.name === "assignment_id",
      )
    )
      return null;
    const row = sqliteRow(
      db
        .prepare(
          "SELECT coordinate_hash,artifact_hash FROM checkpoints WHERE assignment_id=? AND input_hash=? AND effect=? ORDER BY lease_generation DESC LIMIT 1",
        )
        .get(input.assignmentId, input.inputArtifactHash, input.effect),
    );
    if (!row) return null;
    const hash = String(row.artifact_hash);
    const bytes = await input.storage.artifacts.get(`lervo-cas://sha256/${hash.slice(7)}`);
    if (sha256(bytes) !== hash)
      throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
    const proof = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes)) as {
      coordinate: string;
      assignment: WorkforceAssignment;
      effect: string;
      value: T;
    };
    if (
      proof.assignment?.assignmentId !== input.assignmentId ||
      proof.assignment.convergence?.inputArtifactHash !== input.inputArtifactHash ||
      proof.effect !== input.effect ||
      proof.coordinate !== row.coordinate_hash ||
      proof.coordinate !==
        sha256(
          canonicalJson([
            proof.assignment.assignmentId,
            input.inputArtifactHash,
            proof.assignment.lease,
            input.effect,
          ]),
        )
    )
      throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
    return proof.value;
  } finally {
    db.close();
  }
}
