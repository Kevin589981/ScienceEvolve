import type { CollaborationResidentLauncher } from "./core/collaboration-runtime.js";

/** Host lifecycle guard; it does not change the core's ownership or Stop facts. */
export function trackMainResidents(launcher: CollaborationResidentLauncher) {
  return trackResidentOpens(launcher);
}

/** Track the lower adapter too: production decideRoute opens it inside a closure, bypassing launcher.open. */
export function trackResidentOpens<T extends { open: (...args: any[]) => Promise<{ close(): Promise<void> }> }>(launcher: T) {
  type Handle = Awaited<ReturnType<T["open"]>>;
  const pending = new Set<Handle>();
  const open = async (...args: Parameters<T["open"]>): Promise<Handle> => {
    const handle = await launcher.open(...args) as Handle;
    const tracked = new Proxy(handle, {
      get(target, key) {
        if (key === "close") return async () => {
          await target.close();
          pending.delete(tracked);
        };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    pending.add(tracked);
    return tracked;
  };
  const wrapped = new Proxy(launcher, {
    get(target, key) {
      if (key === "open") return open;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  return {
    launcher: wrapped,
    async stopRemaining() {
      const outcomes = await Promise.allSettled([...pending].map((handle) => handle.close()));
      const failures = outcomes.filter((entry) => entry.status === "rejected");
      if (failures.length || pending.size) {
        throw new Error("Resident Stop was not confirmed; runtime directory remains locked. Retry close(), or inspect the native processes before operator recovery.");
      }
    }
  };
}
