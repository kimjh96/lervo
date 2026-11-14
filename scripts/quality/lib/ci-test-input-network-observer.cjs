"use strict";

const { isIP } = require("node:net");
const { types } = require("node:util");

const { observeCalls, ownData } = require("./ci-test-input-transparent-call.cjs");

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

const primitive = (value) =>
  value === undefined || value === null || typeof value === "object" || typeof value === "function"
    ? undefined
    : value;

/**
 * Mirrors `net.Socket#connect` overloads, including Node's pre-normalized argument array, from
 * own data properties only: an options object is often the caller's, and its getters run once.
 * An endpoint that cannot be read that way is unknown, which the ledger treats as external.
 */
function endpointOf(args) {
  const [first, second] = args;
  const options = Array.isArray(first) ? ownData(first, 0) : first;
  if (typeof options === "object" && options !== null) {
    if (types.isProxy(options)) return { kind: "external", endpoint: "<unread>" };
    const path = Object.getOwnPropertyDescriptor(options, "path");
    if (path && "value" in path && path.value !== undefined) return { kind: "local" };
    if (path && !("value" in path)) return { kind: "external", endpoint: "<unread>" };
    const host = ownData(options, "host");
    const port = ownData(options, "port");
    const unread = (key) => {
      const descriptor = Object.getOwnPropertyDescriptor(options, key);
      return descriptor !== undefined && !("value" in descriptor);
    };
    if (unread("host") || unread("port") || (host !== undefined && primitive(host) === undefined))
      return { kind: "external", endpoint: "<unread>" };
    return { host: host ?? "localhost", port: primitive(port) };
  }
  if (typeof options === "string" && !/^\d+$/u.test(options)) return { kind: "local" };
  return {
    host: typeof second === "string" ? second : "localhost",
    port: primitive(options),
  };
}

function classifyCiTestEndpoint(args) {
  const endpoint = endpointOf(args);
  if (endpoint.kind) return endpoint;
  if (loopback(endpoint.host)) return { kind: "loopback" };
  return { kind: "external", endpoint: `${endpoint.host}:${endpoint.port ?? ""}` };
}

function installNetworkObserver({ net, observe }) {
  const { prototype } = net.Socket;
  prototype.connect = observeCalls(prototype.connect, {
    before: (args) => observe(classifyCiTestEndpoint(args)),
  });
}

module.exports = { installNetworkObserver };
