import { afterEach, describe, expect, it, vi } from "vitest";

import {
  closeHubTestServers,
  startHubTestServer,
  token,
  traceSource,
} from "./http-fixture.js";

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
    expect(html).toContain("1단계");
    expect(html).toContain("2단계");
    expect(html).toContain("3단계");
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
      "/assets/trace-navigation.js",
      "/assets/trace-pagination.js",
      "/assets/trace-render.js",
      "/assets/trace.js",
      "/assets/trace-base.css",
      "/assets/trace-workspace.css",
      "/assets/trace-responsive.css",
    ];
    const contents = await Promise.all(paths.map(async (path) => {
      const response = await fetch(`${base}${path}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
      return response.text();
    }));
    const combined = contents.join("\n");

    expect(combined).toContain("/v1/trace/projects");
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
