import { afterAll } from "vitest";

// Vitest setup file (ADR-0565), added only while the CI test ledger is on. With isolated forks
// each worker process runs exactly one test file, so binding the worker binds everything it
// observes. Children inherit the binding through LERVO_CI_TEST_FILE. The record is also spooled
// after the file's own hooks, in case the worker is killed before its exit handler runs.
const recorder = globalThis[Symbol.for("lervo.ciTestInputRecorder")];
if (recorder) {
  recorder.bind(globalThis.__vitest_worker__?.filepath);
  afterAll(() => recorder.flush());
}
