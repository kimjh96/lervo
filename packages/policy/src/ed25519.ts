import { type KeyObject, sign, verify } from "node:crypto";

import {
  createSignedPolicyApproval,
  createSignedPolicyApprovalRevocation,
  createSignedPolicySnapshot,
  policySigningBytes,
  type PolicySignaturePurpose,
} from "@lervo/policy-contract";
import {
  type PolicyApproval,
  type PolicyApprovalRevocation,
  type PolicySnapshot,
  type RemoteCommandTarget,
} from "@lervo/schemas";

import { type PolicyTrustStore, type TrustedPolicySigner } from "./types.js";

function assertKey(key: KeyObject, type: "private" | "public"): void {
  if (key.type !== type || key.asymmetricKeyType !== "ed25519") {
    throw new Error(`The policy ${type} key must be an Ed25519 key.`);
  }
}

function assertKeyId(keyId: string): void {
  if (!/^key_[A-Za-z0-9][A-Za-z0-9._-]{7,63}$/.test(keyId)) {
    throw new Error("The policy keyId is invalid.");
  }
}

function assertTarget(target: RemoteCommandTarget): void {
  if (
    !/^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(target.projectId) ||
    !/^sha256:[a-f0-9]{64}$/.test(target.projectIdentityHash)
  ) throw new Error("The trusted policy project scope is invalid.");
}

export class Ed25519PolicySigner {
  constructor(readonly keyId: string, private readonly privateKey: KeyObject) {
    assertKeyId(keyId);
    assertKey(privateKey, "private");
  }

  signSnapshot(snapshot: PolicySnapshot) {
    return createSignedPolicySnapshot({
      snapshot,
      keyId: this.keyId,
      signature: sign(null, policySigningBytes({
        purpose: "snapshot",
        original: snapshot,
        keyId: this.keyId,
      }), this.privateKey),
    });
  }

  signApproval(approval: PolicyApproval) {
    return createSignedPolicyApproval({
      approval,
      keyId: this.keyId,
      signature: sign(null, policySigningBytes({
        purpose: "approval",
        original: approval,
        keyId: this.keyId,
      }), this.privateKey),
    });
  }

  signRevocation(revocation: PolicyApprovalRevocation) {
    return createSignedPolicyApprovalRevocation({
      revocation,
      keyId: this.keyId,
      signature: sign(null, policySigningBytes({
        purpose: "revocation",
        original: revocation,
        keyId: this.keyId,
      }), this.privateKey),
    });
  }
}

export interface Ed25519TrustedPolicyKey {
  keyId: string;
  publicKey: KeyObject;
  projects: RemoteCommandTarget[];
  purposes: PolicySignaturePurpose[];
}

export class ConfiguredEd25519PolicyTrustStore implements PolicyTrustStore {
  private readonly signers = new Map<string, TrustedPolicySigner>();

  constructor(keys: readonly Ed25519TrustedPolicyKey[]) {
    if (!Array.isArray(keys) || keys.length < 1 || keys.length > 256) {
      throw new Error("There must be between 1 and 256 trusted policy keys.");
    }
    for (const key of keys) {
      assertKeyId(key.keyId);
      assertKey(key.publicKey, "public");
      if (this.signers.has(key.keyId)) throw new Error("A trusted policy keyId is duplicated.");
      if (!Array.isArray(key.projects) || key.projects.length < 1 || key.projects.length > 256) {
        throw new Error("The trusted policy project scope is invalid.");
      }
      const projectCoordinates = new Set<string>();
      for (const project of key.projects) {
        assertTarget(project);
        const coordinate = `${project.projectId}\u0000${project.projectIdentityHash}`;
        if (projectCoordinates.has(coordinate)) throw new Error("A trusted policy project scope is duplicated.");
        projectCoordinates.add(coordinate);
      }
      const purposes: PolicySignaturePurpose[] = [
        ...new Set<PolicySignaturePurpose>(key.purposes),
      ];
      if (
        purposes.length !== key.purposes.length || purposes.length < 1 ||
        !purposes.every((purpose) =>
          (["snapshot", "approval", "revocation"] as PolicySignaturePurpose[]).includes(purpose)
        )
      ) throw new Error("The trusted policy key purpose is invalid.");
      const publicKey = key.publicKey;
      this.signers.set(key.keyId, {
        keyId: key.keyId,
        projects: structuredClone(key.projects),
        purposes,
        verify: async (input) => verify(null, input.message, publicKey, input.signature),
      });
    }
  }

  async find(keyId: string): Promise<TrustedPolicySigner | null> {
    const signer = this.signers.get(keyId);
    if (signer === undefined) return null;
    return {
      keyId: signer.keyId,
      projects: structuredClone(signer.projects),
      purposes: [...signer.purposes],
      verify: (input) => signer.verify(input),
    };
  }
}
