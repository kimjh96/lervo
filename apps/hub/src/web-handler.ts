import { readFileSync } from "node:fs";
import { type IncomingMessage, type ServerResponse } from "node:http";

const MAX_WEB_ASSET_BYTES = 262_144;
const WEB_SECURITY_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy": [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; "),
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const;

interface HubWebAsset {
  body: Buffer;
  contentType: string;
}

const assetDefinitions = [
  ["/trace", "trace.html", "text/html; charset=utf-8"],
  ["/control", "control.html", "text/html; charset=utf-8"],
  ["/assets/control.css", "control.css", "text/css; charset=utf-8"],
  ["/assets/control-api.js", "control-api.js", "text/javascript; charset=utf-8"],
  ["/assets/control-coordinates.js", "control-coordinates.js", "text/javascript; charset=utf-8"],
  ["/assets/control.js", "control.js", "text/javascript; charset=utf-8"],
  ["/assets/control-render.js", "control-render.js", "text/javascript; charset=utf-8"],
  ["/assets/trace-base.css", "trace-base.css", "text/css; charset=utf-8"],
  ["/assets/trace-workspace.css", "trace-workspace.css", "text/css; charset=utf-8"],
  ["/assets/trace-responsive.css", "trace-responsive.css", "text/css; charset=utf-8"],
  ["/assets/trace-graph.css", "trace-graph.css", "text/css; charset=utf-8"],
  ["/assets/trace-api.js", "trace-api.js", "text/javascript; charset=utf-8"],
  ["/assets/trace-labels.js", "trace-labels.js", "text/javascript; charset=utf-8"],
  ["/assets/trace-graph.js", "trace-graph.js", "text/javascript; charset=utf-8"],
  ["/assets/trace-graph-controller.js", "trace-graph-controller.js", "text/javascript; charset=utf-8"],
  ["/assets/trace-navigation.js", "trace-navigation.js", "text/javascript; charset=utf-8"],
  ["/assets/trace-pagination.js", "trace-pagination.js", "text/javascript; charset=utf-8"],
  ["/assets/trace-render.js", "trace-render.js", "text/javascript; charset=utf-8"],
  ["/assets/trace.js", "trace.js", "text/javascript; charset=utf-8"],
] as const;

function loadAssets(): Map<string, HubWebAsset> {
  const assets = new Map<string, HubWebAsset>();
  for (const [route, filename, contentType] of assetDefinitions) {
    const body = readFileSync(new URL(`../assets/${filename}`, import.meta.url));
    if (body.byteLength > MAX_WEB_ASSET_BYTES) {
      throw new Error(`Hub web asset 크기가 ${MAX_WEB_ASSET_BYTES} bytes를 초과했습니다: ${filename}`);
    }
    assets.set(route, { body, contentType });
  }
  return assets;
}

function send(
  response: ServerResponse,
  status: number,
  body: Buffer | string,
  contentType: string,
  extraHeaders: Record<string, string> = {},
): void {
  const contentLength = typeof body === "string" ? Buffer.byteLength(body, "utf8") : body.byteLength;
  response.writeHead(status, {
    ...WEB_SECURITY_HEADERS,
    "content-length": String(contentLength),
    "content-type": contentType,
    ...extraHeaders,
  });
  response.end(body);
}

export function createHubWebHandler() {
  const assets = loadAssets();

  return function handleHubTraceWebRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): boolean {
    const url = new URL(request.url ?? "", "http://lervo.invalid");
    const asset = assets.get(url.pathname);
    if (asset === undefined) return false;
    if (request.method !== "GET") {
      send(response, 405, "이 화면은 GET 요청만 지원합니다.", "text/plain; charset=utf-8", {
        allow: "GET",
      });
      return true;
    }
    if (url.search !== "") {
      send(response, 400, "화면 URL에는 query parameter를 사용할 수 없습니다.", "text/plain; charset=utf-8");
      return true;
    }
    if (
      request.headers["transfer-encoding"] !== undefined ||
      (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0")
    ) {
      send(response, 400, "GET 화면 요청에는 body를 보낼 수 없습니다.", "text/plain; charset=utf-8");
      return true;
    }
    send(response, 200, asset.body, asset.contentType);
    return true;
  };
}

export const createHubTraceWebHandler = createHubWebHandler;
