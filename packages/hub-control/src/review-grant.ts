import { createHmac, timingSafeEqual } from "node:crypto";

const GRANT_PATTERN = /^hcrg_([1-9][0-9]{9})_([a-f0-9]{64})$/u;
const MINIMUM_SECRET_BYTES = 32;
const DEFAULT_TTL_SECONDS = 600;
const MAXIMUM_TTL_SECONDS = 3_600;
const PRINCIPAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u;
const DESTINATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const PROJECT_ID = /^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const DELIVERY_ID = /^rcd_[a-f0-9]{64}$/u;

export interface HubControlReviewGrantCoordinate {
  principalId: string;
  destinationId: string;
  projectId: string;
  deliveryId: string;
}

function instant(value: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds))
    throw new Error("The Hub control review grant time is invalid.");
  return milliseconds;
}

function message(input: HubControlReviewGrantCoordinate, expiresAtSeconds: number): string {
  return [
    "lervo.hub-control-review.v1",
    String(expiresAtSeconds),
    input.principalId,
    input.destinationId,
    input.projectId,
    input.deliveryId,
  ].join("\0");
}

function validCoordinate(input: HubControlReviewGrantCoordinate): boolean {
  return (
    PRINCIPAL_ID.test(input.principalId) &&
    DESTINATION_ID.test(input.destinationId) &&
    PROJECT_ID.test(input.projectId) &&
    DELIVERY_ID.test(input.deliveryId)
  );
}

export class HubControlReviewGrants {
  private readonly secret: Buffer;
  private readonly ttlSeconds: number;

  constructor(secret: Uint8Array, options: { ttlSeconds?: number } = {}) {
    this.secret = Buffer.from(secret);
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    if (this.secret.byteLength < MINIMUM_SECRET_BYTES) {
      throw new Error(
        `The Hub control review grant secret must be at least ${MINIMUM_SECRET_BYTES} bytes.`,
      );
    }
    if (
      !Number.isSafeInteger(this.ttlSeconds) ||
      this.ttlSeconds < 1 ||
      this.ttlSeconds > MAXIMUM_TTL_SECONDS
    ) {
      throw new Error(
        `The Hub control review grant TTL must be between 1 and ${MAXIMUM_TTL_SECONDS} seconds.`,
      );
    }
  }

  issue(input: HubControlReviewGrantCoordinate & { issuedAt: string }): string {
    if (!validCoordinate(input))
      throw new Error("The Hub control review grant coordinates are invalid.");
    const expiresAtSeconds = Math.floor(instant(input.issuedAt) / 1_000) + this.ttlSeconds;
    const digest = createHmac("sha256", this.secret)
      .update(message(input, expiresAtSeconds), "utf8")
      .digest("hex");
    return `hcrg_${expiresAtSeconds}_${digest}`;
  }

  verify(
    input: HubControlReviewGrantCoordinate & {
      grant: string;
      verifiedAt: string;
    },
  ): boolean {
    if (!validCoordinate(input)) return false;
    const match = GRANT_PATTERN.exec(input.grant);
    if (match === null) return false;
    const expiresAtSeconds = Number(match[1]);
    const verifiedAtSeconds = Math.floor(instant(input.verifiedAt) / 1_000);
    if (
      verifiedAtSeconds < expiresAtSeconds - this.ttlSeconds ||
      verifiedAtSeconds > expiresAtSeconds
    )
      return false;
    const expected = createHmac("sha256", this.secret)
      .update(message(input, expiresAtSeconds), "utf8")
      .digest();
    const supplied = Buffer.from(match[2]!, "hex");
    return supplied.byteLength === expected.byteLength && timingSafeEqual(supplied, expected);
  }
}
