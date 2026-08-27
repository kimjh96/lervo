import type { ProtocolCoordinate, ProtocolCoordinateKind } from "./types.js";

const coordinatePatterns: Record<ProtocolCoordinateKind, RegExp> = {
  agent_id: /^agt_[a-f0-9]{24}$/u,
  assignment_id: /^asn_[a-f0-9]{24}$/u,
  workstream_id: /^wks_[a-f0-9]{24}$/u,
  approval_id: /^(?:wapr|apr)_[A-Za-z0-9_-]{8,128}$/u,
  deliberation_id: /^dlb_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u,
  repository_path: /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)(?!.*\0)[^\r\n]{1,512}$/u,
};

export function validateProtocolCoordinate(coordinate: ProtocolCoordinate): ProtocolCoordinate {
  if (!coordinatePatterns[coordinate.kind].test(coordinate.value)) {
    throw new TypeError(`Invalid ${coordinate.kind} protocol coordinate.`);
  }
  return coordinate;
}

const extractableCoordinates: Array<{
  kind: Exclude<ProtocolCoordinateKind, "repository_path">;
  pattern: RegExp;
}> = [
  { kind: "agent_id", pattern: /(?<![A-Za-z0-9_-])agt_[a-f0-9]{24}(?![A-Za-z0-9_-])/gu },
  { kind: "assignment_id", pattern: /(?<![A-Za-z0-9_-])asn_[a-f0-9]{24}(?![A-Za-z0-9_-])/gu },
  { kind: "workstream_id", pattern: /(?<![A-Za-z0-9_-])wks_[a-f0-9]{24}(?![A-Za-z0-9_-])/gu },
  {
    kind: "approval_id",
    pattern: /(?<![A-Za-z0-9_-])(?:wapr|apr)_[A-Za-z0-9_-]{8,128}(?![A-Za-z0-9_-])/gu,
  },
  {
    kind: "deliberation_id",
    pattern: /(?<![A-Za-z0-9_-])dlb_[A-Za-z0-9][A-Za-z0-9_-]{7,63}(?![A-Za-z0-9_-])/gu,
  },
];

/** Extracts protocol coordinates only. It performs no semantic interpretation. */
export function extractProtocolCoordinates(text: string): ProtocolCoordinate[] {
  const coordinates: ProtocolCoordinate[] = [];
  for (const descriptor of extractableCoordinates) {
    for (const match of text.matchAll(descriptor.pattern)) {
      coordinates.push({ kind: descriptor.kind, value: match[0] });
    }
  }
  for (const match of text.matchAll(
    /(?<![A-Za-z0-9_-])repo-path:([A-Za-z0-9._/-]{1,512})(?![A-Za-z0-9._/-])/gu,
  )) {
    coordinates.push(validateProtocolCoordinate({ kind: "repository_path", value: match[1]! }));
  }
  return [...new Map(coordinates.map((item) => [`${item.kind}:${item.value}`, item])).values()];
}
