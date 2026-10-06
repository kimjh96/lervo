import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { stringify } from "yaml";
import { afterEach, describe, expect, it } from "vitest";

import { decisionTaxonomyIssues } from "../src/decision-taxonomy-validation.js";
import {
  DecisionTaxonomyContractError,
  decisionTaxonomyRequiresUpgrade,
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

  it("accepts a role whose bytes a repository tool generates", () => {
    const taxonomy = structuredClone(defaultDecisionTaxonomy);
    taxonomy.documentPolicy.roles.push({
      roleId: "package_changelog",
      scopePath: ".",
      path: "CHANGELOG.md",
      cardinality: "one_per_package",
      lifecycleOwner: "tool_generated",
      relocation: "preserve",
      rewritePolicy: "repository_tool",
      required: false,
    });
    expect(decisionTaxonomyIssues(taxonomy)).toEqual([]);
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
    taxonomy.routes[0]!.description = " padded ";
    taxonomy.documentPolicy.rewrite.maxRewriters = 99;
    expect(decisionTaxonomyIssues(taxonomy)).toEqual([
      {
        pointer: "/routes/0/description",
        rule: "route_description",
        message: "/routes/0/description must be a trimmed prose scope of 8 to 512 characters.",
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

  it("reads legacy title terms only as a route's prose scope", () => {
    const legacy = {
      ...structuredClone(defaultDecisionTaxonomy),
      routes: [
        {
          id: "platform.api",
          path: "platform/api",
          priority: 10,
          minimumTitleTermMatches: 1,
          titleTerms: ["public api", "compatibility"],
        },
      ],
    };

    expect(decisionTaxonomyIssues(legacy)).toEqual([]);
    expect(decisionTaxonomyRequiresUpgrade(legacy)).toBe(true);
    const current = validateDecisionTaxonomy(legacy);
    expect(current.routes).toEqual([
      {
        id: "platform.api",
        path: "platform/api",
        priority: 10,
        description: "Scope carried from the legacy title terms: public api; compatibility.",
      },
    ]);
    expect(decisionTaxonomyRequiresUpgrade(current)).toBe(false);
  });

  it("requires a route description once title terms are gone", () => {
    const taxonomy = structuredClone(defaultDecisionTaxonomy) as unknown as {
      routes: Array<Record<string, unknown>>;
    };
    delete taxonomy.routes[0]!.description;

    expect(decisionTaxonomyIssues(taxonomy)).toEqual([
      {
        pointer: "/routes/0/description",
        rule: "required",
        message: "/routes/0/description is required.",
      },
    ]);
  });
});
