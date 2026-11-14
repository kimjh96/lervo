import { execFileSync } from "node:child_process";

const WORKFLOW_PATH = ".github/workflows/code-quality.yml";

/** Each reusable component, the jobs that executed it, and the artifact name prefix. */
export const CI_REUSE_COMPONENTS = Object.freeze({
  build: { prefix: "lervo-ci-build-", jobs: ["Release manifest and SBOM"] },
  tests: {
    prefix: "lervo-ci-tests-",
    jobs: [1, 2, 3, 4].map((shard) => `Tests (shard ${shard}/4)`),
  },
  distribution: { prefix: "lervo-ci-distribution-", jobs: ["Distribution smoke checks"] },
});

export const ciReuseArtifactName = (component, digest) =>
  `${CI_REUSE_COMPONENTS[component].prefix}${digest}`;

function githubApi(path) {
  return JSON.parse(
    execFileSync("gh", ["api", path], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }),
  );
}

/**
 * Finds a completed, successful Code quality run in this repository whose own jobs executed the
 * component for the same content digest. A receipt artifact only points at that run: the run's
 * conclusion and the exact job results are what establish the earlier verification. Forks,
 * other workflows, unfinished runs and failed jobs never qualify. Any API failure means no reuse.
 */
export function findReusableRun({ repository, component, digest, request = githubApi }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) return null;
  if (!/^[a-f0-9]{40,64}$/u.test(digest)) return null;
  const definition = CI_REUSE_COMPONENTS[component];
  if (!definition) return null;
  try {
    const name = ciReuseArtifactName(component, digest);
    const { artifacts = [] } = request(
      `repos/${repository}/actions/artifacts?name=${name}&per_page=20`,
    );
    for (const artifact of artifacts) {
      if (artifact.name !== name || artifact.expired) continue;
      const runId = artifact.workflow_run?.id;
      if (!Number.isSafeInteger(runId)) continue;
      const run = request(`repos/${repository}/actions/runs/${runId}`);
      if (
        run.path !== WORKFLOW_PATH ||
        run.status !== "completed" ||
        run.conclusion !== "success" ||
        run.repository?.full_name !== repository ||
        run.head_repository?.full_name !== repository
      )
        continue;
      const { jobs = [] } = request(
        `repos/${repository}/actions/runs/${runId}/jobs?filter=latest&per_page=100`,
      );
      const succeeded = new Set(
        jobs.filter((job) => job.conclusion === "success").map((job) => job.name),
      );
      if (definition.jobs.every((job) => succeeded.has(job))) return runId;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Decides what this run may reuse. Tests reuse by the release-metadata-normalized digest. The build
 * and quality checks reuse only for the exact tree, together with tests, and only when any required
 * distribution check can be reused too, because distribution consumes this run's build. The daily
 * audit exists to catch results that change with time on unchanged content, so it reuses nothing.
 */
export function planCiReuse({ coverage, distributionRequired, digests, find, eventName }) {
  const none = { quality: false, build: null, tests: null, distribution: null };
  if (coverage !== "full" || eventName === "schedule") return none;
  const tests = find("tests", digests.tests);
  if (tests === null) return none;
  const build = find("build", digests.tree);
  const distribution = distributionRequired ? find("distribution", digests.tree) : null;
  if (build === null || (distributionRequired && distribution === null)) return { ...none, tests };
  return { quality: true, build, tests, distribution };
}
