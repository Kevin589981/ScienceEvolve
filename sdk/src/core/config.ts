import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { validateProjectDirectoryAliases } from "./project-directory-aliases.js";
import {
  BUILTIN_HARNESS_DESCRIPTORS,
  DEFAULT_HARNESS_ID,
  isRejectedHarnessExecutable
} from "./harness-runtime/registry.js";

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function setting(name: string): string | undefined {
  return process.env[`SCIENCEEVOLVE_${name}`];
}

function secretSetting(name: string, projectRoot: string): string | undefined {
  const inlineValue = setting(name)?.trim();
  if (inlineValue) return inlineValue;

  const configuredFile = setting(`${name}_FILE`)?.trim();
  if (!configuredFile) return undefined;
  const secretFile = path.isAbsolute(configuredFile)
    ? configuredFile
    : path.resolve(projectRoot, configuredFile);
  const value = readFileSync(secretFile, "utf8").trim();
  if (!value) {
    throw new Error(`SCIENCEEVOLVE_${name}_FILE 指向的密钥文件为空`);
  }
  return value;
}

export interface AppConfig {
  host: string;
  port: number;
  dataDir: string;
  /** Internal deployment mapping for retained project directories, verified by storage. */
  projectDirectoryAliases?: Readonly<Record<string, string>>;
  codexBin: string;
  inspireBin: string;
  inspireConfigPath?: string;
  inspireNoProxy: string[];
  inspireWorkspaceRoot: string;
  userSkillRoot: string;
  skillRoots: string[];
  modelSuggestions: string[];
  agentConcurrency: number;
  retryBaseMs: number;
  retryMaxMs: number;
  /** Substantive model-progress inactivity deadline for one invocation. */
  agentActivityIdleWindowMs: number;
  /** Per-tool inactivity deadline while a tool call is active. */
  agentToolActivityIdleWindowMs: number;
  dshHandshakeTimeoutMs: number;
  residentModelInactivityTimeoutMs: number;
  residentToolInactivityTimeoutMs: number;
  dshTurnIdleTimeoutMs: number;
  protocolProxyTimeoutMs: number;
  /** Bounded grace period before an interrupt force-cleans a runner. */
  interruptForceTimeoutMs: number;
  maxEventHistory: number;
  githubOAuthClientId?: string;
  githubOAuthClientSecret?: string;
  githubOAuthCallbackUrl?: string;
}

export type ExplainerSandboxMode = "read-only" | "danger-full-access";

export interface ExplainerSandboxConfiguration {
  mode?: ExplainerSandboxMode;
  verified: boolean;
  unavailableReason?: string;
}

export interface ExplainerSandboxResolutionOptions {
  env?: NodeJS.ProcessEnv;
}

/**
 * Fail closed until OpenFARS has an actual process wrapper and boundary probe
 * for a host-enforced snapshot sandbox. Merely finding bwrap/sandbox-exec is
 * not evidence that an Adapter is launched through a snapshot-only policy.
 * The dangerous legacy value is retained only so the Facade rejects it
 * explicitly instead of silently changing semantics.
 */
export async function resolveExplainerSandboxConfiguration(
  options: ExplainerSandboxResolutionOptions = {}
): Promise<ExplainerSandboxConfiguration> {
  const env = options.env ?? process.env;
  const configured = env.SCIENCEEVOLVE_EXPLAINER_SANDBOX_MODE?.trim();
  if (configured === "danger-full-access") {
    return {
      mode: configured,
      verified: false,
      unavailableReason: "Project Explainer 禁止使用 danger-full-access"
    };
  }
  if (configured && configured !== "read-only") {
    return {
      verified: false,
      unavailableReason: "SCIENCEEVOLVE_EXPLAINER_SANDBOX_MODE 仅允许 read-only"
    };
  }
  return {
    ...(configured === "read-only" ? { mode: configured } : {}),
    verified: false,
    unavailableReason: "宿主快照隔离包装与边界探针尚未实现"
  };
}

export function loadConfig(cwd = process.cwd()): AppConfig {
  const projectRoot = path.basename(cwd) === "server" ? path.dirname(cwd) : cwd;
  const defaultHarness = BUILTIN_HARNESS_DESCRIPTORS.find((item) => item.id === DEFAULT_HARNESS_ID)!;
  const embeddedCodexBin = path.join(
    projectRoot,
    "harness",
    defaultHarness.id,
    "node_modules",
    ".bin",
    defaultHarness.defaultCommand
  );
  const configuredCodexBin = process.env[defaultHarness.executableEnv]?.trim();
  const useEmbeddedCodex = existsSync(embeddedCodexBin) &&
    (!configuredCodexBin || isRejectedHarnessExecutable(defaultHarness, configuredCodexBin));
  const builtinSkillRoot = path.resolve(projectRoot, ".agents", "skills");
  const dataDir = path.resolve(
    projectRoot,
    setting("DATA_DIR") || "data"
  );
  const directoryAliases = setting("PROJECT_DIRECTORY_ALIASES")?.trim();
  let projectDirectoryAliases: AppConfig["projectDirectoryAliases"];
  if (directoryAliases) {
    try {
      projectDirectoryAliases = validateProjectDirectoryAliases(JSON.parse(directoryAliases));
    } catch {
      throw new Error("Invalid SCIENCEEVOLVE_PROJECT_DIRECTORY_ALIASES deployment configuration");
    }
  }
  const userSkillRoot = path.join(dataDir, "skills");
  const extraRoots = (setting("SKILL_ROOTS") ?? "")
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => path.resolve(projectRoot, item));
  const userHome = process.env.HOME;
  const codexHome = process.env.CODEX_HOME
    ? path.resolve(process.env.CODEX_HOME)
    : userHome
      ? path.join(userHome, ".codex")
      : undefined;
  const standardRoots = [
    userHome ? path.join(userHome, ".agents", "skills") : undefined,
    codexHome ? path.join(codexHome, "skills") : undefined,
    "/etc/codex/skills"
  ].filter((item): item is string => Boolean(item));
  const configuredModels = (setting("MODELS") ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const inspireConfigValue = setting("INSPIRE_CONFIG_PATH")?.trim();
  const inspireNoProxy = (setting("INSPIRE_NO_PROXY") ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const residentModelInactivityTimeoutMs = positiveInt(
    setting("RESIDENT_MODEL_INACTIVITY_TIMEOUT_MS"),
    20 * 60_000
  );
  const residentToolInactivityTimeoutMs = positiveInt(
    setting("RESIDENT_TOOL_INACTIVITY_TIMEOUT_MS"),
    120 * 60_000
  );
  return {
    host: process.env.HOST?.trim() || "127.0.0.1",
    port: positiveInt(process.env.PORT, 4311),
    dataDir,
    ...(projectDirectoryAliases ? { projectDirectoryAliases } : {}),
    codexBin: useEmbeddedCodex
      ? embeddedCodexBin
      : configuredCodexBin || defaultHarness.defaultCommand,
    inspireBin: setting("INSPIRE_BIN")?.trim() || "inspire",
    inspireConfigPath: inspireConfigValue
      ? path.resolve(projectRoot, inspireConfigValue)
      : undefined,
    inspireNoProxy,
    inspireWorkspaceRoot: path.resolve(
      setting("INSPIRE_WORKSPACE_ROOT")?.trim() || "/inspire/qb-ilm"
    ),
    userSkillRoot,
    skillRoots: [
      ...new Set([
        builtinSkillRoot,
        userSkillRoot,
        ...extraRoots,
        ...standardRoots
      ])
    ],
    modelSuggestions:
      configuredModels.length > 0
        ? configuredModels
        : ["nex-agi/Nex-N2-Pro", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.5", "gpt-5.4"],
    agentConcurrency: positiveInt(
      setting("AGENT_CONCURRENCY"),
      10
    ),
    retryBaseMs: positiveInt(setting("RETRY_BASE_MS"), 2_000),
    retryMaxMs: positiveInt(setting("RETRY_MAX_MS"), 60_000),
    agentActivityIdleWindowMs: positiveInt(
      setting("AGENT_ACTIVITY_IDLE_WINDOW_MS"),
      20 * 60_000
    ),
    agentToolActivityIdleWindowMs: positiveInt(
      setting("AGENT_TOOL_ACTIVITY_IDLE_WINDOW_MS"),
      120 * 60_000
    ),
    dshHandshakeTimeoutMs: positiveInt(setting("DSH_HANDSHAKE_TIMEOUT_MS"), 60_000),
    residentModelInactivityTimeoutMs,
    residentToolInactivityTimeoutMs,
    dshTurnIdleTimeoutMs: positiveInt(setting("DSH_TURN_IDLE_TIMEOUT_MS"), 20 * 60_000),
    protocolProxyTimeoutMs: positiveInt(setting("PROTOCOL_PROXY_TIMEOUT_MS"), 20 * 60_000),
    interruptForceTimeoutMs: positiveInt(setting("INTERRUPT_FORCE_TIMEOUT_MS"), 8_000),
    maxEventHistory: positiveInt(setting("MAX_EVENT_HISTORY"), 10_000),
    githubOAuthClientId: setting("GITHUB_OAUTH_CLIENT_ID")?.trim() || undefined,
    githubOAuthClientSecret: secretSetting("GITHUB_OAUTH_CLIENT_SECRET", projectRoot),
    githubOAuthCallbackUrl: setting("GITHUB_OAUTH_CALLBACK_URL")?.trim() || undefined
  };
}
