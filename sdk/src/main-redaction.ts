import { isSensitiveCredentialKey, redactTrace } from "./core/utils.js";

/** Host-owned secrets supplement main's format-based redaction, including opaque test/provider keys. */
export function mainRedactor() {
  const secrets = new Set<string>();
  function remember(secret: string | undefined) {
    if (typeof secret === "string" && secret.length) {
      secrets.add(secret);
      secrets.add(encodeURIComponent(secret));
    }
  }
  function clean<T>(value: T): T {
    const ordered = [...secrets].sort((a, b) => b.length - a.length);
    function visit(item: unknown): unknown {
      if (typeof item === "string") {
        for (const secret of ordered) item = (item as string).split(secret).join("[REDACTED]");
        return redactTrace(item as string);
      }
      if (Array.isArray(item)) return item.map(visit);
      if (item && typeof item === "object") return Object.fromEntries(Object.entries(item)
        .filter(([key]) => !isSensitiveCredentialKey(key) && !/^(?:cookie|gatewaysnapshot|capability)$/i.test(key.replace(/[_-]/g, "")))
        .map(([key, child]) => [key, visit(child)]));
      return item;
    }
    return visit(value) as T;
  }
  function error(value: unknown) {
    const safe = new Error(clean(value instanceof Error ? value.message : String(value)));
    safe.name = value instanceof Error ? value.name : "Error";
    return safe;
  }
  return { remember, clean, error };
}
export type MainRedactor = ReturnType<typeof mainRedactor>;
