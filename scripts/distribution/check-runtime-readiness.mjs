import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

const MAXIMUM_HEALTH_BYTES = 4_096;
const MAXIMUM_CA_BYTES = 64 * 1_024;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export class RuntimeReadinessError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "RuntimeReadinessError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new RuntimeReadinessError(code, message);
}

function parse(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (
      !key?.startsWith("--") ||
      value === undefined ||
      value.startsWith("--") ||
      values.has(key)
    ) {
      fail("invalid_arguments", "A runtime preflight argument is invalid.");
    }
    values.set(key, value);
  }
  const runtime = values.get("--runtime");
  if (runtime === "hub") {
    const allowed = new Set([
      "--runtime",
      "--url",
      "--hub-identity",
      "--ca-certificate",
      "--timeout-ms",
    ]);
    if ([...values.keys()].some((key) => !allowed.has(key))) {
      fail("invalid_arguments", "An unknown Hub preflight argument was provided.");
    }
    const url = values.get("--url");
    const hubIdentityHash = values.get("--hub-identity");
    if (url === undefined || !HASH_PATTERN.test(hubIdentityHash ?? "")) {
      fail("invalid_arguments", "A Hub URL and identity hash are required.");
    }
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      fail("invalid_arguments", "The Hub URL is invalid.");
    }
    const loopback =
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "[::1]";
    if (
      (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.search !== "" ||
      parsed.hash !== "" ||
      parsed.pathname !== "/"
    ) {
      fail(
        "invalid_arguments",
        "The Hub URL must be an HTTPS root URL without credentials or a query.",
      );
    }
    const timeoutMs = values.has("--timeout-ms") ? Number(values.get("--timeout-ms")) : 5_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300_000) {
      fail("invalid_arguments", "The Hub preflight timeout is invalid.");
    }
    const caCertificate = values.get("--ca-certificate");
    if (
      caCertificate !== undefined &&
      (!isAbsolute(caCertificate) || caCertificate.includes("\0"))
    ) {
      fail("invalid_arguments", "The CA certificate must use an absolute path.");
    }
    return {
      runtime,
      url: parsed,
      hubIdentityHash,
      timeoutMs,
      ...(caCertificate === undefined ? {} : { caCertificate: resolve(caCertificate) }),
    };
  }
  if (runtime === "node") {
    if ([...values.keys()].some((key) => key !== "--runtime" && key !== "--snapshot")) {
      fail("invalid_arguments", "An unknown Node preflight argument was provided.");
    }
    const snapshot = values.get("--snapshot");
    if (snapshot === undefined || !isAbsolute(snapshot) || snapshot.includes("\0")) {
      fail("invalid_arguments", "An absolute Node readiness snapshot path is required.");
    }
    return { runtime, snapshot: resolve(snapshot) };
  }
  fail("invalid_arguments", "The runtime must be hub or node.");
}

async function boundedRegularFile(path, maximumBytes, ownerOnly) {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    throw new RuntimeReadinessError(
      "health_unavailable",
      "The readiness input could not be read.",
      {
        cause: error,
      },
    );
  }
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > maximumBytes ||
    (ownerOnly && process.platform !== "win32" && (metadata.mode & 0o077) !== 0)
  ) {
    fail("unsafe_health_input", "The readiness input file is unsafe.");
  }
  return readFile(path);
}

function processAlive(processId, probe = process.kill) {
  try {
    probe(processId, 0);
    return true;
  } catch {
    return false;
  }
}

function component(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (value.status === "pending" || value.status === "ready" || value.status === "disabled") {
    return keys.length === 1;
  }
  return (
    value.status === "unavailable" &&
    typeof value.failureCode === "string" &&
    /^[a-z][a-z0-9_]{0,63}$/u.test(value.failureCode) &&
    keys.length === 2
  );
}

async function checkNode(input, options) {
  const bytes = await boundedRegularFile(input.snapshot, MAXIMUM_HEALTH_BYTES, true);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("invalid_health_snapshot", "The Node readiness snapshot JSON is invalid.");
  }
  const expectedKeys = [
    "processId",
    "remoteControl",
    "schemaVersion",
    "startedAt",
    "status",
    "sync",
    "updatedAt",
  ];
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys) ||
    value.schemaVersion !== 1 ||
    !["starting", "ready", "degraded", "stopping"].includes(value.status) ||
    !Number.isSafeInteger(value.processId) ||
    value.processId < 1 ||
    !Number.isFinite(Date.parse(value.startedAt)) ||
    !Number.isFinite(Date.parse(value.updatedAt)) ||
    Date.parse(value.updatedAt) < Date.parse(value.startedAt) ||
    !component(value.sync) ||
    !component(value.remoteControl)
  ) {
    fail("invalid_health_snapshot", "The Node readiness snapshot contract is invalid.");
  }
  if (!processAlive(value.processId, options.processProbe)) {
    return { runtime: "node", status: "not_ready", failureCode: "process_unavailable" };
  }
  if (value.status !== "ready") {
    return {
      runtime: "node",
      status: "not_ready",
      failureCode: value.status === "degraded" ? "runtime_degraded" : `runtime_${value.status}`,
    };
  }
  return { runtime: "node", status: "ready" };
}

function performHubRequest(input, ca) {
  return new Promise((resolvePromise, reject) => {
    const request = (input.url.protocol === "https:" ? httpsRequest : httpRequest)(
      {
        protocol: input.url.protocol,
        hostname: input.url.hostname.startsWith("[")
          ? input.url.hostname.slice(1, -1)
          : input.url.hostname,
        port: input.url.port,
        path: "/v1/health/ready",
        method: "GET",
        headers: { accept: "application/json" },
        ...(ca === undefined ? {} : { ca }),
        timeout: input.timeoutMs,
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAXIMUM_HEALTH_BYTES) request.destroy(new Error("response too large"));
          else chunks.push(chunk);
        });
        response.once("end", () =>
          resolvePromise({
            statusCode: response.statusCode,
            identity: response.headers["x-lervo-hub-identity"],
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.once("timeout", () => request.destroy(new Error("timeout")));
    request.once("error", reject);
    request.end();
  });
}

async function checkHub(input, options) {
  const ca =
    input.caCertificate === undefined
      ? undefined
      : await boundedRegularFile(input.caCertificate, MAXIMUM_CA_BYTES, false);
  let response;
  try {
    response = await (options.hubRequest ?? performHubRequest)(input, ca);
  } catch {
    return { runtime: "hub", status: "not_ready", failureCode: "hub_unavailable" };
  }
  if (response.identity !== input.hubIdentityHash) {
    return { runtime: "hub", status: "not_ready", failureCode: "peer_identity_mismatch" };
  }
  let body;
  try {
    body = JSON.parse(response.body);
  } catch {
    return { runtime: "hub", status: "not_ready", failureCode: "invalid_health_response" };
  }
  const bodyKeys =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? Object.keys(body).sort()
      : [];
  if (
    response.statusCode === 200 &&
    body?.schemaVersion === 1 &&
    body?.status === "ready" &&
    JSON.stringify(bodyKeys) === JSON.stringify(["schemaVersion", "status"])
  ) {
    return { runtime: "hub", status: "ready" };
  }
  if (
    response.statusCode === 503 &&
    body?.schemaVersion === 1 &&
    body?.status === "not_ready" &&
    body?.failureCode === "storage_unavailable" &&
    JSON.stringify(bodyKeys) === JSON.stringify(["failureCode", "schemaVersion", "status"])
  ) {
    return { runtime: "hub", status: "not_ready", failureCode: "runtime_degraded" };
  }
  return { runtime: "hub", status: "not_ready", failureCode: "invalid_health_response" };
}

export async function checkRuntimeReadiness(args, options = {}) {
  const input = parse(args[0] === "--" ? args.slice(1) : args);
  return input.runtime === "hub" ? checkHub(input, options) : checkNode(input, options);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  try {
    const result = await checkRuntimeReadiness(process.argv.slice(2));
    process.stdout.write(`Lervo ${result.runtime} readiness: ${result.status}.\n`);
    if (result.status !== "ready") process.exitCode = 1;
  } catch (error) {
    const code = error instanceof RuntimeReadinessError ? error.code : "readiness_check_failed";
    process.stderr.write(`Lervo runtime readiness check failed (${code}).\n`);
    process.exitCode = 1;
  }
}
