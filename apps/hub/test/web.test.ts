import { afterEach, describe, expect, it, vi } from "vitest";

import { closeHubTestServers, startHubTestServer, token, traceSource } from "./http-fixture.js";

afterEach(closeHubTestServers);

describe("Hub trace web view", () => {
  it("serves a data-free shell with strict browser security headers", async () => {
    const querySource = traceSource();
    const authenticate = vi.fn(async () => null);
    const base = await startHubTestServer(querySource, undefined, { authenticate });
    const response = await fetch(`${base}/trace`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("content-security-policy")).toContain("connect-src 'self'");
    expect(html).toContain("Step 1");
    expect(html).toContain("Step 2");
    expect(html).toContain("Step 3");
    expect(html).toContain("Knowledge graph");
    expect(html).toContain('src="/assets/trace.js"');
    expect(html).not.toContain('name="token"');
    expect(html).not.toContain(token);
    expect(html).not.toContain("prj_allowed01");
    expect(authenticate).not.toHaveBeenCalled();
    expect(querySource.listProjects).not.toHaveBeenCalled();
  });

  it("serves fixed same-origin assets without browser credential persistence code", async () => {
    const querySource = traceSource();
    const base = await startHubTestServer(querySource);
    const paths = [
      "/assets/trace-api.js",
      "/assets/trace-labels.js",
      "/assets/trace-graph.js",
      "/assets/trace-graph-controller.js",
      "/assets/trace-navigation.js",
      "/assets/trace-pagination.js",
      "/assets/trace-render.js",
      "/assets/trace.js",
      "/assets/trace-base.css",
      "/assets/trace-workspace.css",
      "/assets/trace-responsive.css",
      "/assets/trace-graph.css",
    ];
    const contents = await Promise.all(
      paths.map(async (path) => {
        const response = await fetch(`${base}${path}`);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
        return response.text();
      }),
    );
    const combined = contents.join("\n");

    expect(combined).toContain("/v1/trace/projects");
    expect(combined).toContain("/graph");
    expect(combined).toContain("createElementNS");
    expect(combined).toContain("replaceChildren");
    expect(combined).toContain("textContent");
    expect(combined).not.toContain("localStorage");
    expect(combined).not.toContain("sessionStorage");
    expect(combined).not.toContain("innerHTML");
    expect(combined).not.toContain(token);
    expect(querySource.listProjects).not.toHaveBeenCalled();
  });

  it("rejects query credentials and write methods without echoing or querying them", async () => {
    const querySource = traceSource();
    const base = await startHubTestServer(querySource);
    const secret = "must-not-be-echoed";
    const queryResponse = await fetch(`${base}/trace?token=${secret}`);
    const queryBody = await queryResponse.text();
    const methodResponse = await fetch(`${base}/trace`, { method: "POST" });

    expect(queryResponse.status).toBe(400);
    expect(queryBody).not.toContain(secret);
    expect(methodResponse.status).toBe(405);
    expect(methodResponse.headers.get("allow")).toBe("GET");
    expect(querySource.listProjects).not.toHaveBeenCalled();
  });
});

describe("Hub command control web view", () => {
  it("serves a data-free reauthentication shell with memory-only credentials", async () => {
    const querySource = traceSource();
    const base = await startHubTestServer(querySource);
    const page = await fetch(`${base}/control`);
    const html = await page.text();
    const scriptPaths = [
      "/assets/control-api.js",
      "/assets/control-coordinates.js",
      "/assets/control-render.js",
      "/assets/control.js",
    ];
    const scriptResponses = await Promise.all(scriptPaths.map((path) => fetch(`${base}${path}`)));
    const scripts = await Promise.all(scriptResponses.map((response) => response.text()));
    const script = scripts.join("\n");

    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(html).toContain("Conversation messages and reactions cannot create approvals.");
    expect(html).toContain('src="/assets/control.js"');
    expect(html).not.toContain(token);
    expect(scriptResponses.every((response) => response.status === 200)).toBe(true);
    expect(script).toContain("x-lervo-control-review");
    expect(script.match(/x-lervo-control-review/g)).toHaveLength(1);
    expect(script).toContain("/v1/policy/projects/");
    expect(script).toContain("history.replaceState");
    expect(script).not.toContain("localStorage");
    expect(script).not.toContain("sessionStorage");
    expect(script).not.toContain("innerHTML");
    expect(querySource.listProjects).not.toHaveBeenCalled();
  });
});
