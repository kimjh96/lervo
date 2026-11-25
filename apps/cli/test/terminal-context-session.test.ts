import { expect, it } from "vitest";

import {
  applyTerminalContextSessionEnvironment,
  terminalContextSessionEnvironment,
  validTerminalContextSessionEnvironment,
} from "../src/terminal-context-session.js";

it("carries the named variables, null when unset, and every GIT_ variable", () => {
  expect(
    terminalContextSessionEnvironment({
      PATH: "/usr/bin",
      GIT_DIR: "/elsewhere/.git",
      HOME: "/home/owner",
      ANTHROPIC_API_KEY: "secret",
    }),
  ).toEqual({
    PATH: "/usr/bin",
    XDG_RUNTIME_DIR: null,
    DBUS_SESSION_BUS_ADDRESS: null,
    GIT_DIR: "/elsewhere/.git",
  });
});

it("accepts only the carried variables, with bounded string values", () => {
  const base = { PATH: "/usr/bin", XDG_RUNTIME_DIR: null, DBUS_SESSION_BUS_ADDRESS: null };
  expect(validTerminalContextSessionEnvironment(undefined)).toBe(true);
  expect(validTerminalContextSessionEnvironment({ ...base, GIT_WORK_TREE: "/w" })).toBe(true);
  expect(validTerminalContextSessionEnvironment({ PATH: "/usr/bin" })).toBe(false);
  expect(validTerminalContextSessionEnvironment({ ...base, ANTHROPIC_API_KEY: "x" })).toBe(false);
  expect(validTerminalContextSessionEnvironment({ ...base, PATH: "a\0b" })).toBe(false);
  expect(validTerminalContextSessionEnvironment({ ...base, PATH: "x".repeat(20_000) })).toBe(false);
  expect(validTerminalContextSessionEnvironment([])).toBe(false);
});

it("applies the session's values for one hook and restores this process's own", () => {
  const environment: NodeJS.ProcessEnv = {
    PATH: "/service/bin",
    XDG_RUNTIME_DIR: "/run/user/1000",
    GIT_CONFIG_GLOBAL: "/service/gitconfig",
    HOME: "/home/owner",
  };
  const restore = applyTerminalContextSessionEnvironment(
    { PATH: "/session/bin", XDG_RUNTIME_DIR: null, DBUS_SESSION_BUS_ADDRESS: null, GIT_DIR: "/g" },
    environment,
  );
  // A GIT_ variable only the service has is removed, as the session lacks it.
  expect(environment).toEqual({ PATH: "/session/bin", GIT_DIR: "/g", HOME: "/home/owner" });
  restore();
  expect(environment).toEqual({
    PATH: "/service/bin",
    XDG_RUNTIME_DIR: "/run/user/1000",
    GIT_CONFIG_GLOBAL: "/service/gitconfig",
    HOME: "/home/owner",
  });
});

it("changes nothing for a client that sent no session", () => {
  const environment: NodeJS.ProcessEnv = { PATH: "/service/bin", GIT_DIR: "/g" };
  applyTerminalContextSessionEnvironment(undefined, environment)();
  expect(environment).toEqual({ PATH: "/service/bin", GIT_DIR: "/g" });
});
