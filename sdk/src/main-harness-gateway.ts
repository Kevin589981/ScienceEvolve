import path from "node:path";
import { z } from "zod";
import { readHarnessGateway } from "./host/harness-gateway.js";
import type { GatewayInput } from "./core/agent-runtime.js";

const importSchema = z.object({
  harness: z.enum(["codex", "pi", "dsh", "claude-code", "hermes"]),
  model: z.string().trim().min(1).max(500),
  source: z.enum(["env", "profile"]),
  profilePath: z.string().min(1).refine(path.isAbsolute, "profilePath must be absolute").optional(),
  environment: z.record(z.string().optional()).optional(),
  name: z.string().trim().min(1).max(200).optional()
}).strict().refine((input) => input.source === "profile" || input.profilePath === undefined,
  "profilePath is only valid with source: profile");

/** Explicit, one-time API-key import. Not a native OAuth route or a live profile binding. */
export type MainHarnessGatewayImportOptions = z.infer<typeof importSchema>;

/** Reuse the SDK's read-only native readers, but let the main store validate/save the result. */
export async function readMainHarnessGateway(input: MainHarnessGatewayImportOptions): Promise<GatewayInput> {
  const options = importSchema.parse(input);
  // A supplied environment replaces process.env, rather than silently mixing credentials.
  const environment = { ...(options.environment ?? process.env) };
  if (options.harness === "hermes") {
    if (options.source !== "env") throw new Error("Hermes profile/OAuth import is not supported; use an explicit SDK gateway or env import");
    const url = environment.OPENAI_BASE_URL?.trim(), apiKey = environment.OPENAI_API_KEY?.trim();
    if (!url || !apiKey) throw new Error("Hermes env import requires OPENAI_BASE_URL and OPENAI_API_KEY");
    return { name: options.name ?? "Hermes environment", url, apiKey, protocol: "chat-completions",
      models: [options.model], defaultModel: options.model };
  }
  if (options.profilePath !== undefined) {
    environment[`SDK_${options.harness.toUpperCase().replaceAll("-", "_")}_PROFILE`] = options.profilePath;
  }
  const gateway = await readHarnessGateway(options.harness, options.model, environment, undefined, options.source);
  return { ...gateway, name: options.name ?? gateway.name };
}
