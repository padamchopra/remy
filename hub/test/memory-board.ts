import type { BoardStorage } from "../src/organization-board.js";
export class MemoryBoard implements BoardStorage {
  constructor(private values = new Map<string, unknown>()) {}
  async get<T>(key: string) {
    return structuredClone(this.values.get(key)) as T | undefined;
  }
  async put<T>(key: string, value: T) {
    this.values.set(key, structuredClone(value));
  }
  async delete(key: string) {
    return this.values.delete(key);
  }
  async list<T>({ prefix }: { prefix: string }) {
    return new Map(
      [...this.values]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => [key, structuredClone(value) as T]),
    );
  }
  async transaction<T>(work: (storage: BoardStorage) => Promise<T>) {
    const copy = new MemoryBoard(new Map(structuredClone([...this.values]))),
      result = await work(copy);
    this.values = copy.values;
    return result;
  }
}
