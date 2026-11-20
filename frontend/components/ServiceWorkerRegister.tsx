"use client";

import { useEffect } from "react";

/** Registers /sw.js so the app shell and pre-cached Urdu audio load with no network. */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      /* SW is progressive enhancement; ignore registration failures */
    });
  }, []);
  return null;
}
