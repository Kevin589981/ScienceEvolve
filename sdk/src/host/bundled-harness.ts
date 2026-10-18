import type { AgentHarness } from "../core/agent-runtime.js";
import { accessSync, constants as fsConstants, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface BundledHarnessInvocation {
  executable: string;
  args: string[];
}

/**
 * Resolve CLI packages that ship with the SDK without relying on the caller's
 * PATH or on platform-specific npm shell shims. Pi remains a normal child
 * process; only its versioned JavaScript entry is supplied by the SDK.
 */
export function bundledHarnessInvocation(
  harness: AgentHarness
): BundledHarnessInvocation | undefined {
  if (harness !== "pi") return undefined;
  const root = packageRoot("@earendil-works/pi-coding-agent");
  if (!root) return undefined;
  const cli = path.join(root, "dist", "cli.js");
  try {
    accessSync(cli, fsConstants.R_OK);
    return { executable: process.execPath, args: [cli] };
  } catch {
    return undefined;
  }
}

function packageRoot(name: string): string | undefined {
  const packageSegments = name.split("/");
  const starts = [
    path.dirname(fileURLToPath(import.meta.url)),
    process.cwd()
  ];
  for (const start of starts) {
    let current = path.resolve(start);
    while (true) {
      // Check every standard node_modules boundary. This supports both npm's
      // hoisted workspace layout and a dependency nested under the SDK.
      const candidate = path.join(current, "node_modules", ...packageSegments);
      const manifest = path.join(candidate, "package.json");
      try {
        const parsed = JSON.parse(readFileSync(manifest, "utf8")) as {
          name?: unknown;
        };
        if (parsed.name === name) return candidate;
      } catch {
        // Continue towards the filesystem root until the package is found.
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return undefined;
}
