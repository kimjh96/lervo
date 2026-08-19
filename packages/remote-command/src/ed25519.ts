import {
  type KeyObject,
  sign,
  verify,
} from "node:crypto";

import {
  createSignedRemoteCommandEnvelope,
  remoteCommandSigningBytes,
} from "@lervo/remote-command-contract";
import {
  type RemoteCommand,
  type RemoteCommandTarget,
  type SignedRemoteCommand,
} from "@lervo/schemas";

import {
  type RemoteCommandTrustStore,
  type TrustedRemoteCommandSigner,
} from "./types.js";

function assertEd25519Key(key: KeyObject, type: "private" | "public"): void {
  if (key.type !== type || key.asymmetricKeyType !== "ed25519") {
    throw new Error(`remote command ${type} key는 Ed25519 key여야 합니다.`);
  }
}

function assertKeyId(keyId: string): void {
  if (!/^key_[A-Za-z0-9][A-Za-z0-9._-]{7,63}$/.test(keyId)) {
    throw new Error("remote command keyId가 유효하지 않습니다.");
  }
}

function assertProjectTarget(target: RemoteCommandTarget): void {
  if (
    !/^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(target.projectId) ||
    !/^sha256:[a-f0-9]{64}$/.test(target.projectIdentityHash)
  ) {
    throw new Error("trusted remote command project scope가 유효하지 않습니다.");
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class Ed25519RemoteCommandSigner {
  constructor(
    readonly keyId: string,
    private readonly privateKey: KeyObject,
  ) {
    assertKeyId(keyId);
    assertEd25519Key(privateKey, "private");
  }

  sign(command: RemoteCommand): SignedRemoteCommand {
    const signature = sign(null, remoteCommandSigningBytes({
      command,
      keyId: this.keyId,
    }), this.privateKey);
    return createSignedRemoteCommandEnvelope({
      command,
      keyId: this.keyId,
      signature,
    });
  }
}

export interface Ed25519TrustedRemoteCommandKey {
  keyId: string;
  publicKey: KeyObject;
  projects: RemoteCommandTarget[];
}

export class ConfiguredEd25519RemoteCommandTrustStore implements RemoteCommandTrustStore {
  private readonly signers = new Map<string, TrustedRemoteCommandSigner>();

  constructor(keys: readonly Ed25519TrustedRemoteCommandKey[]) {
    if (!Array.isArray(keys) || keys.length === 0 || keys.length > 256) {
      throw new Error("trusted remote command key는 1개 이상 256개 이하여야 합니다.");
    }
    for (const key of keys) {
      assertKeyId(key.keyId);
      assertEd25519Key(key.publicKey, "public");
      if (!Array.isArray(key.projects) || key.projects.length < 1 || key.projects.length > 256) {
        throw new Error("trusted remote command project scope는 1개 이상 256개 이하여야 합니다.");
      }
      if (this.signers.has(key.keyId)) {
        throw new Error("trusted remote command keyId가 중복되었습니다.");
      }
      const projects = clone(key.projects);
      const projectCoordinates = new Set<string>();
      for (const project of projects) {
        assertProjectTarget(project);
        const coordinate = `${project.projectId}\u0000${project.projectIdentityHash}`;
        if (projectCoordinates.has(coordinate)) {
          throw new Error("trusted remote command project scope가 중복되었습니다.");
        }
        projectCoordinates.add(coordinate);
      }
      const publicKey = key.publicKey;
      this.signers.set(key.keyId, {
        keyId: key.keyId,
        projects,
        async verify(input) {
          return verify(null, input.message, publicKey, input.signature);
        },
      });
    }
  }

  async find(keyId: string): Promise<TrustedRemoteCommandSigner | null> {
    const signer = this.signers.get(keyId);
    if (signer === undefined) return null;
    return {
      keyId: signer.keyId,
      projects: clone(signer.projects),
      verify: (input) => signer.verify(input),
    };
  }
}
