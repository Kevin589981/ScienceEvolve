import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { GitHubCredentialResolver } from "./core/collaboration-git/index.js";

const absolutePath = z.string().min(1).refine(path.isAbsolute, "Path must be absolute");
const duration = z.number().int().positive().max(2_147_483_647);
const siiSchema = z.object({
  inspireBin: absolutePath, workspaceRoot: absolutePath,
  configPath: absolutePath.optional(), knowledgeRoot: absolutePath.optional(),
  noProxy: z.array(z.string().trim().min(1)).optional(),
  refreshMs: z.number().int().min(1_000).max(2_147_483_647).optional()
}).strict();
const executionSchema = z.object({
  retryBaseMs: duration.optional(), retryMaxMs: duration.optional(),
  agentConcurrency: z.number().int().positive().safe().optional(),
  interruptForceTimeoutMs: duration.optional(),
  agentActivityIdleWindowMs: duration.optional(), agentToolActivityIdleWindowMs: duration.optional()
}).strict().refine((value) => (value.retryBaseMs ?? 2_000) <= (value.retryMaxMs ?? 60_000),
  "retryBaseMs must not exceed retryMaxMs (including runtime defaults)");
const timeoutsSchema = z.object({
  residentModelInactivityTimeoutMs: duration.optional(), residentToolInactivityTimeoutMs: duration.optional(),
  protocolProxyTimeoutMs: duration.optional(), dshHandshakeTimeoutMs: duration.optional(), dshTurnIdleTimeoutMs: duration.optional()
}).strict();
const identitySchema = z.object({ id: z.number().int().positive().safe(), login: z.string().trim().min(1) }).strict();
const harnessPath = z.custom<string>((value) => typeof value === "string" && path.isAbsolute(value), {
  message: "Use an absolute native executable or JavaScript CLI path (legacy executable+args is not supported)"
});
const optionsSchema = z.object({
  dataDir: absolutePath,
  harnesses: z.record(harnessPath).optional(),
  nativeCodexProfiles: z.record(z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), absolutePath).optional(),
  skillRoots: z.array(absolutePath).optional(), userSkillRoot: absolutePath.optional(),
  execution: executionSchema.optional(), timeouts: timeoutsSchema.optional(),
  sii: siiSchema.optional(),
  git: z.object({
    credentialResolver: z.custom<GitHubCredentialResolver>((value) => typeof value === "function", {
      message: "credentialResolver must be a function"
    }).optional(),
    expectedIdentity: identitySchema.optional()
  }).strict().optional()
}).strict();

/** Whitelisted public options only: no adapter, runner, control bridge or internal host injection. */
export type MainResearchSdkOptions = z.infer<typeof optionsSchema>;
export function validateMainResearchSdkOptions(input: unknown): MainResearchSdkOptions {
  return optionsSchema.parse(input);
}

const nativeBinding = z.object({ nativeCodexProfileId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/) }).strict();
const bindingsSchema = z.object({ defaultGatewayId: z.string().trim().min(1).optional(),
  defaultNativeCodexProfileId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).optional(),
  agents: z.record(z.union([z.string().trim().min(1), nativeBinding])).optional() }).strict()
  .refine((input) => !(input.defaultGatewayId && input.defaultNativeCodexProfileId), "Choose one default model route, not both");
export type MainGatewayBindings = z.infer<typeof bindingsSchema>;
export function validateMainGatewayBindings(input: unknown): MainGatewayBindings {
  return bindingsSchema.parse(input);
}

// JSON accepts references to credentials, never the credential itself or executable callbacks.
const runtimeConfigSchema = optionsSchema.omit({ dataDir: true, git: true }).extend({
  git: z.object({ tokenEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
    expectedIdentity: identitySchema.optional() }).strict().optional()
}).strict();

/** File-relative deployment paths are resolved here; portable workflow JSON remains credential-free. */
export async function loadMainRuntimeConfig(file: string): Promise<Omit<MainResearchSdkOptions, "dataDir">> {
  const absolute = path.resolve(file);
  const raw: unknown = JSON.parse(await readFile(absolute, "utf8"));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Runtime config must be a JSON object");
  const source = raw as Record<string, unknown>;
  const resolvePath = (value: unknown) => typeof value === "string" && value.length ? path.resolve(path.dirname(absolute), value) : value;
  const parsed = runtimeConfigSchema.parse({ ...source,
    ...(source.harnesses && typeof source.harnesses === "object" && !Array.isArray(source.harnesses)
      ? { harnesses: Object.fromEntries(Object.entries(source.harnesses).map(([id, value]) => [id, resolvePath(value)])) } : {}),
    ...(source.nativeCodexProfiles && typeof source.nativeCodexProfiles === "object" && !Array.isArray(source.nativeCodexProfiles)
      ? { nativeCodexProfiles: Object.fromEntries(Object.entries(source.nativeCodexProfiles).map(([id, value]) => [id, resolvePath(value)])) } : {}),
    ...(Array.isArray(source.skillRoots) ? { skillRoots: source.skillRoots.map(resolvePath) } : {}),
    ...(source.sii && typeof source.sii === "object" && !Array.isArray(source.sii)
      ? { sii: Object.fromEntries(Object.entries(source.sii).map(([key, value]) =>
        [key, ["inspireBin", "workspaceRoot", "configPath", "knowledgeRoot"].includes(key) ? resolvePath(value) : value])) } : {}),
    ...(source.userSkillRoot !== undefined ? { userSkillRoot: resolvePath(source.userSkillRoot) } : {})
  });
  const { git, ...options } = parsed;
  if (!git) return options;
  const tokenEnv = git.tokenEnv;
  return { ...options, git: {
    ...(git.expectedIdentity ? { expectedIdentity: git.expectedIdentity } : {}),
    ...(tokenEnv ? { credentialResolver: async (signal?: AbortSignal) => {
      signal?.throwIfAborted();
      // Resolve lazily for each API/transport use; rotation does not require recreating the SDK.
      const token = process.env[tokenEnv];
      if (!token) throw new Error(`Git credential environment variable ${tokenEnv} is empty or unset`);
      return { token, requestedScopes: ["repo"] };
    } } : {})
  } };
}
