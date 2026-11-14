"use strict";

const { isIP } = require("node:net");

/**
 * Translates outgoing socket connections into observations (ADR-0565). `net.connect`, HTTP
 * agents, TLS and fetch all reach `Socket.prototype.connect`. Only an endpoint outside this host
 * is recorded by name; loopback and local sockets are counted.
 */
function loopback(host) {
  const name = String(host)
    .toLowerCase()
    .replace(/^\[|\]$/gu, "");
  if (name === "localhost" || name.endsWith(".localhost") || name === "::1" || name === "::")
    return true;
  if (name.startsWith("::ffff:")) return loopback(name.slice(7));
  return isIP(name) === 4 && (name.startsWith("127.") || name === "0.0.0.0");
}

/** Mirrors `net.Socket#connect` overloads, including Node's pre-normalized argument array. */
function endpointOf(args) {
  const [first, second] = args;
  const options = Array.isArray(first) ? first[0] : first;
  if (typeof options === "object" && options !== null) {
    if (options.path !== undefined) return { kind: "local" };
    return { host: options.host ?? "localhost", port: options.port };
  }
  if (typeof options === "string" && !/^\d+$/u.test(options)) return { kind: "local" };
  return { host: typeof second === "string" ? second : "localhost", port: options };
}

function classifyCiTestEndpoint(args) {
  const endpoint = endpointOf(args);
  if (endpoint.kind) return endpoint;
  if (loopback(endpoint.host)) return { kind: "loopback" };
  return { kind: "external", endpoint: `${endpoint.host}:${endpoint.port ?? ""}` };
}

function installNetworkObserver({ net, observe }) {
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    try {
      observe(classifyCiTestEndpoint(args));
    } catch {
      // Observation never changes the observed call.
    }
    return connect.apply(this, args);
  };
}

module.exports = { installNetworkObserver };
