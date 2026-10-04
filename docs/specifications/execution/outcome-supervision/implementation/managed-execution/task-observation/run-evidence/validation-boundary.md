# Validation boundary

Tests exercise the built CLI with a protocol fixture provider, real SQLite journals, and a Git worker workspace. They verify:

- Managed changes in the worker.
- Unchanged control files.
- Duplicate-decision suppression.
- Canonical result/verification loading.
- An outstanding artifact-review decision.

This evidence does not constitute production provider or installed Discord acceptance.
