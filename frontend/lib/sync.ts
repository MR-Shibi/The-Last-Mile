/** Flush the IndexedDB outbox to POST /sync. Safe to call repeatedly: the server dedupes by
 * client_event_id, so a flaky connection can never create duplicate applications. */
import { api, getSession } from "@/lib/api";
import { clearDraft, listOutbox, loadDraft, ownedBy, removeFromOutbox, type OutboxItem } from "@/lib/offlineDb";

export interface SyncResult { client_event_id: string; status: "applied" | "duplicate" | "error" | "conflict"; result?: { case_id?: number }; error?: string }

let running = false;

export async function flushOutbox(): Promise<{ sent: number; done: number; failed: number }> {
  if (running || typeof navigator === "undefined" || !navigator.onLine) return { sent: 0, done: 0, failed: 0 };
  const s = getSession();
  // Only the account that queued an item may send it: after a logout / role switch on a shared phone, another
  // account's token must never carry it (it waits until that person logs in again).
  if (!s || (s.role !== "citizen" && s.role !== "community_helper")) return { sent: 0, done: 0, failed: 0 };
  running = true;
  try {
    const items: OutboxItem[] = (await listOutbox()).filter((i) => ownedBy(i, s.user_id));
    if (!items.length) return { sent: 0, done: 0, failed: 0 };
    const res = await api<{ results: SyncResult[] }>("/sync", {
      body: { events: items.map((i) => ({ client_event_id: i.client_event_id, kind: i.kind, payload: i.payload })) },
    });
    const done: string[] = [];
    for (const r of res.results) {
      if (r.status === "applied" || r.status === "duplicate") {
        done.push(r.client_event_id);
        // photos captured offline are uploaded once the case exists on the server
        const caseId = r.result?.case_id;
        if (caseId) {
          const photo = await loadDraft(`photo:${r.client_event_id}`);
          if (photo?.dataUrl) {
            try {
              const blob = await (await fetch(String(photo.dataUrl))).blob();
              const form = new FormData();
              form.append("file", blob, "cnic.jpg");
              await api(`/cases/${caseId}/documents`, { form });
              await clearDraft(`photo:${r.client_event_id}`);
            } catch {
              /* retried on the next flush */
            }
          }
        }
      }
    }
    await removeFromOutbox(done);
    return { sent: items.length, done: done.length, failed: items.length - done.length };
  } catch {
    return { sent: 0, done: 0, failed: 0 };
  } finally {
    running = false;
  }
}
