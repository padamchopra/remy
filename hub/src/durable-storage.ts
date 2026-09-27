/// The part of an organization's Durable Object storage that threads, hosted computers and Cursor Cloud share.
export interface KeyValueStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(options: { prefix: string; limit?: number }): Promise<Map<string, T>>;
  transaction<T>(closure: (storage: KeyValueStorage) => Promise<T>): Promise<T>;
}

export class DurableStorage implements KeyValueStorage {
  constructor(private readonly storage: DurableObjectStorage | DurableObjectTransaction) {}
  get<T>(key: string) { return this.storage.get<T>(key); }
  put<T>(key: string, value: T) { return this.storage.put(key, value); }
  delete(key: string) { return this.storage.delete(key); }
  list<T>(options: { prefix: string; limit?: number }) { return this.storage.list<T>(options); }
  transaction<T>(closure: (storage: KeyValueStorage) => Promise<T>): Promise<T> {
    if (!("transaction" in this.storage)) return closure(this);
    return this.storage.transaction((transaction) => closure(new DurableStorage(transaction)));
  }
}

/// Tasks kept the organization board under `board:` and Linear ticket sync kept its bindings under `linear:`.
/// No other state uses either prefix, so clearing them leaves threads, hosted computers and Cursor Cloud untouched.
export const RETIRED_TASKS_PREFIXES = ["board:", "linear:"] as const;
export const RETIRED_TASKS_CLEARED = "retired:tasks-cleared";

/// Deletes what Tasks left in this object, once; later loads read one marker key and stop.
export async function clearRetiredTasks(storage: KeyValueStorage): Promise<number> {
  if (await storage.get(RETIRED_TASKS_CLEARED)) return 0;
  let removed = 0;
  for (const prefix of RETIRED_TASKS_PREFIXES) {
    for (;;) {
      const keys = [...(await storage.list({ prefix, limit: 256 })).keys()].filter((key) => key.startsWith(prefix));
      if (!keys.length) break;
      await Promise.all(keys.map((key) => storage.delete(key)));
      removed += keys.length;
    }
  }
  await storage.put(RETIRED_TASKS_CLEARED, true);
  return removed;
}
