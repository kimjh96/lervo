export interface DocumentByteRange {
  /** Inclusive UTF-8 byte offset. */
  start: number;
  /** Exclusive UTF-8 byte offset. */
  end: number;
}

export type ManagedBlockMarkerFamily = "lervo_v1" | "previous_product_v1";

export interface ParsedManagedBlock {
  blockId: string;
  markerFamily: ManagedBlockMarkerFamily;
  startMarkerRange: DocumentByteRange;
  contentRange: DocumentByteRange;
  endMarkerRange: DocumentByteRange;
  /** Both marker lines, their content and the end marker's line terminator. */
  fullRange: DocumentByteRange;
}

export type IgnoredManagedMarkerReason = "code_block" | "inline_code";

export interface IgnoredManagedMarker {
  range: DocumentByteRange;
  reason: IgnoredManagedMarkerReason;
}

export type ManagedBlockDiagnosticCode =
  | "commonmark_parse_failed"
  | "duplicate_block_id"
  | "input_too_large"
  | "invalid_marker_syntax"
  | "invalid_utf8"
  | "managed_block_too_large"
  | "marker_not_commonmark_html"
  | "marker_not_standalone"
  | "mismatched_end_marker"
  | "mixed_marker_families"
  | "mixed_marker_family"
  | "nested_begin_marker"
  | "too_many_markers"
  | "unclosed_begin_marker"
  | "unexpected_end_marker";

export interface ManagedBlockDiagnostic {
  code: ManagedBlockDiagnosticCode;
  range?: DocumentByteRange;
  blockId?: string;
}

export interface ManagedBlockParseResult {
  parserId: "lervo/commonmark-managed-blocks";
  parserVersion: "1.0.0";
  status: "valid" | "invalid";
  byteCount: number;
  blocks: readonly ParsedManagedBlock[];
  /** Exact complement of block full ranges. Empty when parsing is invalid. */
  unmanagedRanges: readonly DocumentByteRange[];
  ignoredMarkers: readonly IgnoredManagedMarker[];
  diagnostics: readonly ManagedBlockDiagnostic[];
}
