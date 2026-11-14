"use strict";

/**
 * The text whose SHA-256 is a directory's listing digest (ADR-0565). The recorder hashes it when
 * a record is spooled, and the shadow predictor hashes it again at the head, so both must build
 * it here. `names` are the entry names `readdirSync` returned; a recursive listing is prefixed so
 * it never equals a plain one.
 */
function ciTestListingText(names, recursive) {
  return `${recursive ? "recursive\n" : ""}${names.sort().join("\n")}`;
}

module.exports = { ciTestListingText };
