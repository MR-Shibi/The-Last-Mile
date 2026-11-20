/** Browser-state hooks built on useSyncExternalStore (hydration-safe: the server snapshot is the default). */
import { useSyncExternalStore } from "react";

function subscribeEvents(events: string[]) {
  return (cb: () => void) => {
    events.forEach((e) => window.addEventListener(e, cb));
    return () => events.forEach((e) => window.removeEventListener(e, cb));
  };
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export const STORAGE_EVENT = "lm-storage";

export function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new Event(STORAGE_EVENT));
}

const storageSub = subscribeEvents(["storage", STORAGE_EVENT]);

/** Raw localStorage value (string snapshots are stable, so no render loops). */
export function useStorageValue(key: string): string | null {
  return useSyncExternalStore(storageSub, () => readStorage(key), () => null);
}

const onlineSub = subscribeEvents(["online", "offline"]);
export function useOnline(): boolean {
  return useSyncExternalStore(onlineSub, () => navigator.onLine, () => true);
}

const noopSub = () => () => undefined;
/** false during SSR / first hydration pass, true afterwards. */
export function useHydrated(): boolean {
  return useSyncExternalStore(noopSub, () => true, () => false);
}
