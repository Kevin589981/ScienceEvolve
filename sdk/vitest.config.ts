import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Real Git/SQLite on Windows can exceed Vitest's default five seconds.
    // Keep bounded timeouts and cap workers rather than timing out while a
    // Git subprocess is still writing an isolated test checkout.
    testTimeout: process.platform === "win32" ? 60_000 : 30_000,
    hookTimeout: 30_000,
    // Upstream Git suites each own several real subprocesses. Running four
    // files together on Windows starves their bounded closing/recovery gates.
    maxWorkers: process.platform === "win32" ? 1 : 4
  }
});
