// Per-file teardown. `bun test` does not run process exit handlers, so every
// test file ends its afterAll with `finishFile()`: any child that is still
// alive is SIGKILLed and the file's scratch directory is removed
// (`E2E_KEEP=1` keeps it for debugging).
import { cleanupScratch } from "./env";
import { killAll } from "./procs";

export function finishFile(): void {
  killAll();
  cleanupScratch();
}
