import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { dirname, posix, relative, resolve, sep } from "node:path";

import { loadProjectManifest } from "@lervo/project";
import {
  canonicalJson,
  loadStoredClaims,
  loadStoredConcepts,
  loadStoredRelations,
  analyzeRepositoryKnowledgeImpact,
  scanConfiguredRepositoryKnowledge,
  sha256,
  stableId,
  type StoredClaim,
  type StoredConcept,
  type StoredRelation,
} from "@lervo/repository-knowledge";
import { parseDocument, stringify } from "yaml";

const MAX_FILES = 512;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const IMPORT_DIRECTORY = ".lervo/state/knowledge/okf-imports";
const KNOWN_FRONTMATTER_KEYS = new Set([
  "type", "title", "description", "resource", "tags", "sources", "usage_window",
  "generated", "verified", "status", "stale_after", "runtime", "parameters",
  "computation", "executor", "attester", "x_lervo",
]);

export class KnowledgeOkfError extends Error {
  readonly code = "knowledge_exchange_invalid" as const;

  constructor(message: string) {
    super(message);
    this.name = "KnowledgeOkfError";
  }
}

export interface OkfLintIssue {
  code: string;
  path: string;
  message: string;
}

export interface OkfConceptDocument {
  conceptId: string;
  path: string;
  contentHash: string;
  frontmatter: Record<string, unknown>;
  unknownMetadata: Record<string, unknown>;
  body: string;
  content: string;
  externalTrust: "unverified" | "machine_confirmed" | "human_reviewed";
  localAssurance: "unreviewed";
}

export interface OkfBundleSnapshot {
  schemaVersion: 1;
  okfVersion: string | null;
  bundleDigest: string;
  files: Array<{ path: string; contentHash: string; content: string }>;
  concepts: OkfConceptDocument[];
}

export interface OkfImportCandidate {
  schemaVersion: 1;
  candidateId: string;
  projectId: string;
  sourceKind: "untrusted_okf_bundle";
  bundleDigest: string;
  okfVersion: string | null;
  localAssurance: "unreviewed";
  externalHumanVerifiedCount: number;
  files: OkfBundleSnapshot["files"];
  concepts: OkfConceptDocument[];
}

export interface OkfImportPlan {
  schemaVersion: 1;
  planId: string;
  projectId: string;
  candidateId: string;
  bundleDigest: string;
  status: "ready" | "already_imported";
  targetPath: string;
  fileCount: number;
  conceptCount: number;
  unknownMetadataConceptCount: number;
  externalHumanVerifiedCount: number;
}

export interface OkfQueryResult {
  schemaVersion: 1;
  semantics: "recommended";
  bundleDigest: string;
  query: string;
  hits: Array<{
    conceptId: string;
    path: string;
    title: string;
    score: number;
    matchedTerms: string[];
    externalTrust: OkfConceptDocument["externalTrust"];
    localAssurance: "unreviewed";
  }>;
}

function fail(message: string): never {
  throw new KnowledgeOkfError(message);
}

function within(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`));
}

async function assertSafeDirectory(path: string): Promise<void> {
  const stats = await lstat(path).catch(() => null);
  if (stats === null || !stats.isDirectory() || stats.isSymbolicLink()) fail("The OKF path is not a safe real directory.");
}

async function ensureSafeDirectoryChain(root: string, relativePath: string): Promise<string> {
  let current = root;
  for (const segment of relativePath.split("/").filter(Boolean)) {
    current = resolve(current, segment);
    const existing = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (existing === null) await mkdir(current, { mode: 0o700 });
    await assertSafeDirectory(current);
  }
  return current;
}

async function readSafeFile(root: string, relativePath: string): Promise<string> {
  const target = resolve(root, relativePath);
  if (!within(root, target)) fail("The OKF file escapes the bundle boundary.");
  let current = root;
  for (const [index, segment] of relative(root, target).split(sep).entries()) {
    current = resolve(current, segment);
    const stats = await lstat(current).catch(() => null);
    if (stats === null || stats.isSymbolicLink() || (index === relative(root, target).split(sep).length - 1 ? !stats.isFile() : !stats.isDirectory())) {
      fail("The OKF bundle contains an unsafe file hierarchy.");
    }
  }
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > MAX_FILE_BYTES) fail("The OKF file size limit was exceeded.");
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || bytes.byteLength !== before.size
    ) fail("The OKF file changed while it was being read.");
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return fail("The OKF file must be valid UTF-8."); }
  } finally {
    await handle.close();
  }
}

async function listBundleFiles(root: string): Promise<string[]> {
  await assertSafeDirectory(root);
  const files: string[] = [];
  let total = 0;
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isSymbolicLink()) fail("The OKF bundle cannot contain symlinks.");
      const absolute = resolve(directory, entry.name);
      if (!within(root, absolute)) fail("The OKF entry escapes the bundle boundary.");
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) {
        const path = relative(root, absolute).split(sep).join("/");
        if (!path.endsWith(".md")) continue;
        files.push(path);
        if (files.length > MAX_FILES) fail("The OKF bundle file-count limit was exceeded.");
        const stats = await lstat(absolute);
        total += stats.size;
        if (stats.size > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES) fail("The OKF bundle byte limit was exceeded.");
      } else fail("The OKF bundle allows only regular files and directories.");
    }
  }
  await visit(root);
  return files;
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const normalized = JSON.parse(JSON.stringify(value)) as unknown;
    return normalized !== null && typeof normalized === "object" && !Array.isArray(normalized)
      ? normalized as Record<string, unknown>
      : null;
  } catch { return null; }
}

function splitFrontmatter(content: string, required: boolean): { frontmatter: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (match === null) {
    if (required) fail("The OKF concept has no YAML front matter.");
    return { frontmatter: {}, body: content };
  }
  const document = parseDocument(match[1]!, { schema: "core", uniqueKeys: true });
  if (document.errors.length > 0) fail("The OKF front matter YAML is invalid.");
  const frontmatter = jsonRecord(document.toJS({ maxAliasCount: 0 }));
  if (frontmatter === null) fail("The OKF front matter must be a mapping.");
  return { frontmatter, body: content.slice(match[0].length) };
}

function externalTrust(verified: unknown): OkfConceptDocument["externalTrust"] {
  const values = Array.isArray(verified) ? verified : verified === undefined ? [] : [verified];
  const actors = values.flatMap((value) => {
    const entry = jsonRecord(value);
    return typeof entry?.by === "string" ? [entry.by] : [];
  });
  if (actors.some((actor) => actor.startsWith("human:"))) return "human_reviewed";
  return actors.length > 0 ? "machine_confirmed" : "unverified";
}

function conceptFromFile(file: { path: string; contentHash: string; content: string }): OkfConceptDocument {
  const parsed = splitFrontmatter(file.content, true);
  if (typeof parsed.frontmatter.type !== "string" || parsed.frontmatter.type.trim() === "") fail("The OKF concept type is required.");
  const unknownMetadata = Object.fromEntries(Object.entries(parsed.frontmatter).filter(([key]) => !KNOWN_FRONTMATTER_KEYS.has(key)));
  return {
    conceptId: file.path.slice(0, -3),
    path: file.path,
    contentHash: file.contentHash,
    frontmatter: parsed.frontmatter,
    unknownMetadata,
    body: parsed.body,
    content: file.content,
    externalTrust: externalTrust(parsed.frontmatter.verified),
    localAssurance: "unreviewed",
  };
}

export async function readOkfBundle(bundleRoot: string): Promise<OkfBundleSnapshot> {
  const root = resolve(bundleRoot);
  const paths = await listBundleFiles(root);
  const files: OkfBundleSnapshot["files"] = [];
  const concepts: OkfConceptDocument[] = [];
  let okfVersion: string | null = null;
  for (const path of paths) {
    const content = await readSafeFile(root, path);
    const contentHash = sha256(content);
    files.push({ path, contentHash, content });
    const filename = posix.basename(path);
    if (filename === "index.md") {
      const parsed = splitFrontmatter(content, false);
      if (path === "index.md" && parsed.frontmatter.okf_version !== undefined) {
        if (typeof parsed.frontmatter.okf_version !== "string") fail("The OKF version must be a string.");
        okfVersion = parsed.frontmatter.okf_version;
      } else if (path !== "index.md" && Object.keys(parsed.frontmatter).length > 0) {
        fail("An index.md outside the bundle root cannot have front matter.");
      }
      continue;
    }
    if (filename === "log.md") {
      const parsed = splitFrontmatter(content, false);
      if (Object.keys(parsed.frontmatter).length > 0) fail("OKF log.md cannot have front matter.");
      continue;
    }
    concepts.push(conceptFromFile({ path, contentHash, content }));
  }
  const digestMaterials = files.map(({ path, contentHash }) => ({ path, contentHash })).sort((left, right) => left.path.localeCompare(right.path));
  return {
    schemaVersion: 1,
    okfVersion,
    bundleDigest: sha256(canonicalJson({ okfVersion, files: digestMaterials })),
    files,
    concepts,
  };
}

export async function lintOkfBundle(bundleRoot: string): Promise<{
  schemaVersion: 1;
  valid: boolean;
  bundleDigest: string | null;
  okfVersion: string | null;
  checkedConcepts: number;
  issues: OkfLintIssue[];
}> {
  try {
    const bundle = await readOkfBundle(bundleRoot);
    return { schemaVersion: 1, valid: true, bundleDigest: bundle.bundleDigest, okfVersion: bundle.okfVersion, checkedConcepts: bundle.concepts.length, issues: [] };
  } catch (error) {
    return { schemaVersion: 1, valid: false, bundleDigest: null, okfVersion: null, checkedConcepts: 0, issues: [{ code: "knowledge_exchange_invalid", path: "<bundle>", message: error instanceof KnowledgeOkfError ? error.message : "Could not validate the OKF bundle safely." }] };
  }
}

function terms(value: string): string[] {
  return [...new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}_.-]{2,}/gu) ?? [])];
}

export async function queryOkfBundle(input: { bundleRoot: string; query: string; limit?: number }): Promise<OkfQueryResult> {
  const bundle = await readOkfBundle(input.bundleRoot);
  const queryTerms = terms(input.query);
  if (queryTerms.length === 0) fail("The OKF query requires a search term.");
  const limit = input.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) fail("The OKF query limit must be between 1 and 50.");
  const hits = bundle.concepts.flatMap((concept) => {
    const title = typeof concept.frontmatter.title === "string" ? concept.frontmatter.title : posix.basename(concept.conceptId);
    const titleText = title.toLocaleLowerCase();
    const contentText = `${canonicalJson(concept.frontmatter)}\n${concept.body}`.toLocaleLowerCase();
    const matchedTerms = queryTerms.filter((term) => titleText.includes(term) || contentText.includes(term));
    if (matchedTerms.length === 0) return [];
    const score = matchedTerms.reduce((total, term) => total + (titleText.includes(term) ? 5 : 1), 0);
    return [{ conceptId: concept.conceptId, path: concept.path, title, score, matchedTerms, externalTrust: concept.externalTrust, localAssurance: "unreviewed" as const }];
  }).sort((left, right) => right.score - left.score || left.conceptId.localeCompare(right.conceptId)).slice(0, limit);
  return { schemaVersion: 1, semantics: "recommended", bundleDigest: bundle.bundleDigest, query: input.query, hits };
}

function footnoteId(claim: StoredClaim, versionId: string): string {
  return `lervo-${sha256(`${claim.claimId}:${versionId}`).slice(7, 23)}`;
}

function okfType(concept: StoredConcept): string {
  const type = (concept as StoredConcept & { type?: unknown }).type;
  return typeof type === "string" && type.trim() !== "" ? `Lervo ${type.replaceAll("_", " ")}` : "Lervo Concept";
}

function exportConcept(input: {
  projectId: string;
  concept: StoredConcept;
  publication: string;
  claims: StoredClaim[];
  relations: StoredRelation[];
  freshnessBySubject: Map<string, "current" | "stale" | "unknown">;
}): string {
  const sourceIds = new Map<string, string>();
  for (const claim of input.claims) for (const versionId of claim.evidenceUnitVersionIds) sourceIds.set(versionId, footnoteId(claim, versionId));
  const sources = [...sourceIds.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([versionId, id]) => ({ id, resource: `lervo:source-unit-version:${versionId}` }));
  const xLervo = {
    schema_version: 1,
    project_id: input.projectId,
    native_concept_id: input.concept.conceptId,
    ownership: input.concept.ownership,
    assurance: input.concept.assurance ?? "unreviewed",
    freshness: input.freshnessBySubject.get(`concept:${input.concept.conceptId}`) ?? "current",
    source_unit_version_ids: [...input.concept.sourceUnitVersionIds].sort(),
    claims: input.claims.map((claim) => ({ claim_id: claim.claimId, statement: claim.statement, statement_digest: claim.statementDigest, source_ids: claim.evidenceUnitVersionIds.map((id) => sourceIds.get(id)!), freshness: input.freshnessBySubject.get(`claim:${claim.claimId}`) ?? "current" })),
    relations: input.relations.map((relation) => ({ relation_id: relation.relationId, from: relation.from.id, to: relation.to.id, relation_type: relation.type, evidence_unit_version_ids: [...relation.evidenceUnitVersionIds], freshness: input.freshnessBySubject.get(`relation:${relation.relationId}`) ?? "current" })),
  };
  const frontmatter: Record<string, unknown> = {
    type: okfType(input.concept),
    title: input.concept.title,
    resource: `lervo:project:${input.projectId}:concept:${input.concept.conceptId}`,
    generated: { by: "lervo/0.1.0" },
    status: (input.concept as StoredConcept & { publicationStatus?: string }).publicationStatus === "stable" ? "stable" : "draft",
    ...(sources.length === 0 ? {} : { sources }),
    x_lervo: xLervo,
  };
  const lines = [`---\n${stringify(frontmatter, { lineWidth: 0, sortMapEntries: true })}---`, input.publication.trimEnd()];
  if (input.claims.length > 0) {
    lines.push("", "## Exported claims", "");
    for (const claim of input.claims) {
      const citations = claim.evidenceUnitVersionIds.map((id) => `[^${sourceIds.get(id)!}]`).join("");
      lines.push(`- ${claim.statement}${citations}`);
    }
    lines.push("");
    for (const [versionId, id] of [...sourceIds.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      lines.push(`[^${id}]: Lervo source unit version \`${versionId}\``);
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

async function readRepositoryPublication(root: string, path: string): Promise<string> {
  return readSafeFile(root, path);
}

async function writeNewBundle(outputRoot: string, files: Array<{ path: string; content: string }>): Promise<void> {
  const output = resolve(outputRoot);
  const parent = dirname(output);
  await assertSafeDirectory(parent);
  if (await lstat(output).catch(() => null) !== null) fail("The OKF output path already exists. Specify a new path.");
  await mkdir(output, { mode: 0o755 });
  try {
    for (const file of files) {
      const target = resolve(output, file.path);
      if (!within(output, target)) fail("The OKF output file escapes the bundle boundary.");
      await mkdir(dirname(target), { recursive: true, mode: 0o755 });
      const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o644);
      try { await handle.writeFile(file.content); await handle.sync(); } finally { await handle.close(); }
    }
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
}

export async function exportRepositoryKnowledgeToOkf(input: { repositoryRoot: string; outputRoot: string }): Promise<{
  schemaVersion: 1;
  format: "okf-0.2";
  bundleDigest: string;
  outputRoot: string;
  conceptCount: number;
  fileCount: number;
}> {
  const root = resolve(input.repositoryRoot);
  const project = await loadProjectManifest(root);
  const { scan } = await scanConfiguredRepositoryKnowledge(root);
  const impact = await analyzeRepositoryKnowledgeImpact({ repositoryRoot: root, scan });
  const freshnessBySubject = new Map(impact.items.map((item) => [`${item.subjectKind}:${item.subjectId}`, item.freshness]));
  const loadedConcepts = await loadStoredConcepts(root);
  const loadedClaims = await loadStoredClaims(root);
  const loadedRelations = await loadStoredRelations(root);
  if ([...loadedConcepts, ...loadedClaims, ...loadedRelations].some((item) => item.value === null)) fail("Export is blocked by an invalid native knowledge sidecar.");
  const concepts = loadedConcepts.map((item) => item.value! as StoredConcept);
  const claims = loadedClaims.map((item) => item.value! as StoredClaim);
  const relations = loadedRelations.map((item) => item.value! as StoredRelation);
  const files: Array<{ path: string; content: string }> = [];
  for (const concept of concepts.sort((left, right) => left.conceptId.localeCompare(right.conceptId))) {
    files.push({
      path: `concepts/${concept.conceptId}.md`,
      content: exportConcept({
        projectId: project.projectId,
        concept,
        publication: await readRepositoryPublication(root, concept.path),
        claims: claims.filter((claim) => claim.conceptId === concept.conceptId).sort((left, right) => left.claimId.localeCompare(right.claimId)),
        relations: relations.filter((relation) => relation.from.id === concept.conceptId || relation.to.id === concept.conceptId).sort((left, right) => left.relationId.localeCompare(right.relationId)),
        freshnessBySubject,
      }),
    });
  }
  const index = [
    "---",
    'okf_version: "0.2"',
    "---",
    "# Lervo knowledge export",
    "",
    ...concepts.map((concept) => `* [${concept.title}](concepts/${concept.conceptId}.md)`),
    "",
  ].join("\n");
  files.unshift({ path: "index.md", content: index });
  const digest = sha256(canonicalJson({ okfVersion: "0.2", files: files.map((file) => ({ path: file.path, contentHash: sha256(file.content) })).sort((left, right) => left.path.localeCompare(right.path)) }));
  await writeNewBundle(input.outputRoot, files);
  return { schemaVersion: 1, format: "okf-0.2", bundleDigest: digest, outputRoot: resolve(input.outputRoot), conceptCount: concepts.length, fileCount: files.length };
}

function candidateFrom(projectId: string, bundle: OkfBundleSnapshot): OkfImportCandidate {
  const materials = {
    projectId,
    bundleDigest: bundle.bundleDigest,
    okfVersion: bundle.okfVersion,
    fileHashes: bundle.files.map(({ path, contentHash }) => ({ path, contentHash })),
  };
  return {
    schemaVersion: 1,
    candidateId: stableId("okfimport", materials),
    projectId,
    sourceKind: "untrusted_okf_bundle",
    bundleDigest: bundle.bundleDigest,
    okfVersion: bundle.okfVersion,
    localAssurance: "unreviewed",
    externalHumanVerifiedCount: bundle.concepts.filter((concept) => concept.externalTrust === "human_reviewed").length,
    files: bundle.files,
    concepts: bundle.concepts,
  };
}

async function buildOkfImportPlan(input: { repositoryRoot: string; bundleRoot: string }): Promise<{ plan: OkfImportPlan; candidate: OkfImportCandidate }> {
  const root = resolve(input.repositoryRoot);
  const project = await loadProjectManifest(root);
  const bundle = await readOkfBundle(input.bundleRoot);
  const candidate = candidateFrom(project.projectId, bundle);
  const targetPath = `${IMPORT_DIRECTORY}/${candidate.candidateId}.json`;
  const target = resolve(root, targetPath);
  const existing = await lstat(target).catch(() => null);
  if (existing !== null && (!existing.isFile() || existing.isSymbolicLink())) fail("The OKF import candidate target is not a safe regular file.");
  if (existing !== null && sha256(await readFile(target)) !== sha256(`${canonicalJson(candidate)}\n`)) fail("Different bytes exist for the same OKF import candidate ID.");
  const planMaterials = { projectId: project.projectId, candidateId: candidate.candidateId, bundleDigest: bundle.bundleDigest, targetPath };
  const plan: OkfImportPlan = {
    schemaVersion: 1,
    planId: stableId("okfplan", planMaterials),
    projectId: project.projectId,
    candidateId: candidate.candidateId,
    bundleDigest: bundle.bundleDigest,
    status: existing === null ? "ready" : "already_imported",
    targetPath,
    fileCount: bundle.files.length,
    conceptCount: bundle.concepts.length,
    unknownMetadataConceptCount: bundle.concepts.filter((concept) => Object.keys(concept.unknownMetadata).length > 0).length,
    externalHumanVerifiedCount: candidate.externalHumanVerifiedCount,
  };
  return { plan, candidate };
}

export async function createOkfImportPlan(input: { repositoryRoot: string; bundleRoot: string }): Promise<OkfImportPlan> {
  return (await buildOkfImportPlan(input)).plan;
}

export async function applyOkfImportPlan(input: { repositoryRoot: string; bundleRoot: string; planId: string }): Promise<{
  schemaVersion: 1;
  planId: string;
  candidateId: string;
  candidatePath: string;
  created: boolean;
  localAssurance: "unreviewed";
}> {
  const { plan: current, candidate } = await buildOkfImportPlan({ repositoryRoot: input.repositoryRoot, bundleRoot: input.bundleRoot });
  if (current.planId !== input.planId) fail("The current OKF bundle and apply request plan IDs differ.");
  const root = resolve(input.repositoryRoot);
  const directory = await ensureSafeDirectoryChain(root, IMPORT_DIRECTORY);
  const target = resolve(root, current.targetPath);
  const content = `${canonicalJson(candidate)}\n`;
  if (current.status === "already_imported") return { schemaVersion: 1, planId: current.planId, candidateId: current.candidateId, candidatePath: current.targetPath, created: false, localAssurance: "unreviewed" };
  const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
  const directoryHandle = await open(directory, constants.O_RDONLY);
  try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  return { schemaVersion: 1, planId: current.planId, candidateId: current.candidateId, candidatePath: current.targetPath, created: true, localAssurance: "unreviewed" };
}

export async function loadOkfImportCandidate(input: { repositoryRoot: string; candidateId: string }): Promise<OkfImportCandidate> {
  if (!/^okfimport_[a-f0-9]{24}$/.test(input.candidateId)) fail("The OKF import candidate ID is invalid.");
  const path = resolve(input.repositoryRoot, IMPORT_DIRECTORY, `${input.candidateId}.json`);
  const stats = await lstat(path).catch(() => null);
  if (stats === null || !stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_TOTAL_BYTES * 2) fail("The OKF import candidate cannot be read safely.");
  let value: OkfImportCandidate;
  try { value = JSON.parse(await readFile(path, "utf8")) as OkfImportCandidate; } catch { return fail("The OKF import candidate JSON is invalid."); }
  if (value.schemaVersion !== 1 || value.candidateId !== input.candidateId || value.sourceKind !== "untrusted_okf_bundle" || value.localAssurance !== "unreviewed" || !Array.isArray(value.files) || !Array.isArray(value.concepts)) fail("The OKF import candidate contract is invalid.");
  const project = await loadProjectManifest(resolve(input.repositoryRoot));
  if (value.projectId !== project.projectId) fail("The OKF import candidate project binding is invalid.");
  if (value.files.length > MAX_FILES || new Set(value.files.map((file) => file.path)).size !== value.files.length) fail("The OKF import candidate file list is invalid.");
  let totalBytes = 0;
  for (const file of value.files) {
    if (typeof file.path !== "string" || typeof file.content !== "string" || typeof file.contentHash !== "string" || posix.isAbsolute(file.path) || file.path.split("/").includes("..")) fail("The OKF import candidate file coordinates are invalid.");
    const bytes = Buffer.byteLength(file.content);
    totalBytes += bytes;
    if (bytes > MAX_FILE_BYTES || totalBytes > MAX_TOTAL_BYTES || sha256(file.content) !== file.contentHash) fail("The OKF import candidate file content binding is invalid.");
  }
  const digest = sha256(canonicalJson({ okfVersion: value.okfVersion, files: value.files.map(({ path: filePath, contentHash }) => ({ path: filePath, contentHash })).sort((left, right) => left.path.localeCompare(right.path)) }));
  if (digest !== value.bundleDigest) fail("The OKF import candidate bundle digest is invalid.");
  const expectedConcepts: OkfConceptDocument[] = [];
  let observedVersion: string | null = null;
  for (const file of value.files) {
    if (!file.path.endsWith(".md")) fail("Only Markdown files are allowed in an OKF import candidate.");
    const filename = posix.basename(file.path);
    if (filename === "index.md") {
      const parsed = splitFrontmatter(file.content, false);
      if (file.path === "index.md" && parsed.frontmatter.okf_version !== undefined) {
        if (typeof parsed.frontmatter.okf_version !== "string") fail("The OKF import candidate version is invalid.");
        observedVersion = parsed.frontmatter.okf_version;
      } else if (file.path !== "index.md" && Object.keys(parsed.frontmatter).length > 0) fail("The OKF import candidate nested index is invalid.");
    } else if (filename === "log.md") {
      if (Object.keys(splitFrontmatter(file.content, false).frontmatter).length > 0) fail("The OKF import candidate log is invalid.");
    } else expectedConcepts.push(conceptFromFile(file));
  }
  if (observedVersion !== value.okfVersion || canonicalJson(expectedConcepts) !== canonicalJson(value.concepts)) fail("The OKF import concept metadata binding is invalid.");
  const rebuilt = candidateFrom(value.projectId, { schemaVersion: 1, okfVersion: value.okfVersion, bundleDigest: value.bundleDigest, files: value.files, concepts: value.concepts });
  if (canonicalJson(rebuilt) !== canonicalJson(value)) fail("The OKF import candidate content binding is invalid.");
  return value;
}

export async function reExportOkfImportCandidate(input: { repositoryRoot: string; candidateId: string; outputRoot: string }): Promise<{ bundleDigest: string; outputRoot: string; fileCount: number }> {
  const candidate = await loadOkfImportCandidate(input);
  await writeNewBundle(input.outputRoot, candidate.files.map(({ path, content }) => ({ path, content })));
  return { bundleDigest: candidate.bundleDigest, outputRoot: resolve(input.outputRoot), fileCount: candidate.files.length };
}
