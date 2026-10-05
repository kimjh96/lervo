import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { stringify } from "yaml";
import { afterEach, describe, expect, it } from "vitest";

import { decisionTaxonomyIssues } from "../src/decision-taxonomy-validation.js";
import {
  DecisionTaxonomyContractError,
  defaultDecisionTaxonomy,
  loadDecisionTaxonomy,
  validateDecisionTaxonomy,
} from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function argoLayoutWithoutRewriteAndRoutes(): Record<string, unknown> {
  const { routes: _routes, documentPolicy, ...taxonomy } = structuredClone(defaultDecisionTaxonomy);
  const { rewrite: _rewrite, ...policy } = documentPolicy;
  return { ...taxonomy, documentPolicy: policy };
}

describe("decision taxonomy validation", () => {
  it("accepts the default taxonomy without issues", () => {
    expect(decisionTaxonomyIssues(defaultDecisionTaxonomy)).toEqual([]);
    expect(validateDecisionTaxonomy(structuredClone(defaultDecisionTaxonomy))).toEqual(
      defaultDecisionTaxonomy,
    );
  });

  it("names every missing field when an edit removes rewrite and routes", () => {
    expect(decisionTaxonomyIssues(argoLayoutWithoutRewriteAndRoutes())).toEqual([
      { pointer: "/routes", rule: "required", message: "/routes is required." },
      {
        pointer: "/documentPolicy/rewrite",
        rule: "required",
        message: "/documentPolicy/rewrite is required.",
      },
    ]);
  });

  it("attributes role violations to the role and reports nested pointers", () => {
    const taxonomy = structuredClone(defaultDecisionTaxonomy);
    const role = taxonomy.documentPolicy.roles[1]!;
    (role as { cardinality: string }).cardinality = "many";
    taxonomy.routes[0]!.titleTerms.push("Security");
    taxonomy.documentPolicy.rewrite.maxRewriters = 99;
    expect(decisionTaxonomyIssues(taxonomy)).toEqual([
      {
        pointer: "/routes/0/titleTerms/6",
        rule: "unique",
        message: "/routes/0/titleTerms/6 duplicates an earlier title term.",
      },
      {
        pointer: "/documentPolicy/roles/1/cardinality",
        rule: "enum",
        roleId: role.roleId,
        message: "/documentPolicy/roles/1/cardinality must be one of one, one_per_package.",
      },
      {
        pointer: "/documentPolicy/rewrite/maxRewriters",
        rule: "range",
        message: "/documentPolicy/rewrite/maxRewriters must be an integer from 1 to 16.",
      },
    ]);
  });

  it("reports malformed nested values as issues instead of crashing", () => {
    const taxonomy = structuredClone(defaultDecisionTaxonomy) as unknown as {
      documentPolicy: { capacity: unknown };
      routes: unknown[];
    };
    taxonomy.documentPolicy.capacity = null;
    taxonomy.routes = [null];
    expect(
      decisionTaxonomyIssues(taxonomy).map(({ pointer, rule }) => ({ pointer, rule })),
    ).toEqual([
      { pointer: "/routes/0", rule: "type" },
      { pointer: "/documentPolicy/capacity", rule: "type" },
    ]);
  });

  it("carries structured issues on the thrown load error and in its message", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-taxonomy-"));
    roots.push(root);
    await mkdir(resolve(root, ".lervo/knowledge"), { recursive: true });
    await writeFile(
      resolve(root, ".lervo/knowledge/document-layout.yaml"),
      stringify(argoLayoutWithoutRewriteAndRoutes()),
    );
    const failure = await loadDecisionTaxonomy(root).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DecisionTaxonomyContractError);
    const error = failure as DecisionTaxonomyContractError;
    expect(error.code).toBe("contract_invalid");
    expect(error.issues.map((issue) => issue.pointer)).toEqual([
      "/routes",
      "/documentPolicy/rewrite",
    ]);
    expect(error.message).toContain("(2 issue(s))");
    expect(error.message).toContain("[required] /documentPolicy/rewrite is required.");
    expect(error.message).toContain("[required] /routes is required.");
  });
});
