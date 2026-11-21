/**
 * IndexedDB offline outbox. Every queued item carries a unique client_event_id
 * (idempotency key) so the server can safely receive the same item twice.
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export type OutboxKind = "case_submit" | "draft" | "voice_transcript" | "consent_grant";

export interface OutboxItem {
  client_event_id: string;
  kind: OutboxKind;
  payload: Record<string, unknown>;
  created_at: number;
  attempts: number;
  family_id?: number;
  /** Account that queued it: an item is only ever synced with that same account's token. */
  owner_user_id?: number;
}

interface LastMileDB extends DBSchema {
  outbox: { key: string; value: OutboxItem; indexes: { by_created: number } };
  drafts: { key: string; value: { id: string; data: Record<string, unknown>; updated_at: number } };
}

let dbPromise: Promise<IDBPDatabase<LastMileDB>> | null = null;

function getDb(): Promise<IDBPDatabase<LastMileDB>> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB unavailable"));
  if (!dbPromise) {
    dbPromise = openDB<LastMileDB>("lastmile", 1, {
      upgrade(db) {
        const outbox = db.createObjectStore("outbox", { keyPath: "client_event_id" });
        outbox.createIndex("by_created", "created_at");
        db.createObjectStore("drafts", { keyPath: "id" });
      },
    });
  }
  return dbPromise;
}

export function newClientEventId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function enqueue(kind: OutboxKind, payload: Record<string, unknown>, family_id?: number, client_event_id?: string): Promise<OutboxItem> {
  const item: OutboxItem = {
    client_event_id: client_event_id || newClientEventId(), kind, payload, created_at: Date.now(), attempts: 0, family_id,
    owner_user_id: currentUserId(),
  };
  const db = await getDb();
  await db.put("outbox", item);
  return item;
}

function currentUserId(): number | undefined {
  try {
    const raw = window.localStorage.getItem("lm.session");
    return raw ? (JSON.parse(raw) as { user_id?: number }).user_id : undefined;
  } catch {
    return undefined;
  }
}

/** Items queued by this account (legacy items without an owner are treated as belonging to whoever is logged in). */
export function ownedBy(item: OutboxItem, userId: number | undefined): boolean {
  return userId !== undefined && (item.owner_user_id === undefined || item.owner_user_id === userId);
}

export async function listOutbox(): Promise<OutboxItem[]> {
  const db = await getDb();
  return db.getAllFromIndex("outbox", "by_created");
}

export async function removeFromOutbox(ids: string[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("outbox", "readwrite");
  await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
}

export async function saveDraft(id: string, data: Record<string, unknown>): Promise<void> {
  const db = await getDb();
  await db.put("drafts", { id, data, updated_at: Date.now() });
}

export async function loadDraft(id: string): Promise<Record<string, unknown> | undefined> {
  const db = await getDb();
  return (await db.get("drafts", id))?.data;
}

export async function clearDraft(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("drafts", id);
}

/** Remove local form drafts (e.g. "application:") on logout so the next person on a shared phone never sees them. */
export async function clearDraftsWithPrefix(prefix: string): Promise<void> {
  const db = await getDb();
  const keys = await db.getAllKeys("drafts");
  const tx = db.transaction("drafts", "readwrite");
  await Promise.all([...keys.filter((k) => String(k).startsWith(prefix)).map((k) => tx.store.delete(k)), tx.done]);
}
