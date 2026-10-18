import { rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
// Remove obsolete compiled modules before producing the installable package.
await rm(new URL("../dist/", import.meta.url), { recursive: true, force: true });
execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", fileURLToPath(new URL("../tsconfig.json", import.meta.url))], { stdio: "inherit" });
