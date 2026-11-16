import { describe, expect, it } from "vitest";

import {
  repositoryReplicaPeerLauncher,
  repositoryReplicaPerCallLauncherGuidance,
} from "../src/index.js";

describe("replica peer per-call launcher detection (ADR-0570)", () => {
  it("names a WSL launcher in the remote command and nothing else", () => {
    expect(
      repositoryReplicaPeerLauncher({
        remoteCommandPrefix: ["wsl.exe", "-d", "Ubuntu", "--"],
        remoteNodeExecutable: "/home/owner/.local/bin/node",
      }),
    ).toBe("wsl.exe");
    expect(
      repositoryReplicaPeerLauncher({
        remoteCommandPrefix: ["C:\\Windows\\System32\\WSL.EXE"],
        remoteNodeExecutable: "node",
      }),
    ).toBe("wsl.exe");
    expect(repositoryReplicaPeerLauncher({ remoteNodeExecutable: "ubuntu2204.exe" })).toBe(
      "ubuntu2204.exe",
    );
    expect(
      repositoryReplicaPeerLauncher({
        remoteCommandPrefix: ["env", "LANG=C"],
        remoteNodeExecutable: "/home/owner/.local/bin/node",
      }),
    ).toBeNull();
    // The owner's live configuration after pointing the destination at the WSL sshd.
    expect(repositoryReplicaPeerLauncher({ remoteNodeExecutable: "/usr/bin/node" })).toBeNull();
    expect(repositoryReplicaPeerLauncher(undefined)).toBeNull();
    expect(repositoryReplicaPeerLauncher({ remoteCommandPrefix: "wsl.exe" })).toBeNull();
  });

  it("tells the operator what to change without naming any path", () => {
    expect(repositoryReplicaPerCallLauncherGuidance("wsl.exe")).toMatch(
      /launches wsl\.exe .* Point peer\.destination at the WSL sshd/u,
    );
  });
});
