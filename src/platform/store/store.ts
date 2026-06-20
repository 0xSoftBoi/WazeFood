// Minimal repository abstraction. Each module owns its tables through a Table<T> and never
// touches another module's storage directly — the seam that lets a module be extracted into
// its own service later (docs/ARCHITECTURE.md §2). The in-memory Table makes everything
// runnable without Postgres; a pg-backed Table implements the same shape in production.

export type Row = { id: string };

export interface Table<T extends Row> {
  insert(row: T): T;
  upsert(row: T): T;
  get(id: string): T | undefined;
  find(predicate: (row: T) => boolean): T[];
  findOne(predicate: (row: T) => boolean): T | undefined;
  all(): T[];
  update(id: string, patch: Partial<T>): T | undefined;
  delete(id: string): void;
  size(): number;
}

export class MemoryTable<T extends Row> implements Table<T> {
  private readonly rows = new Map<string, T>();

  insert(row: T): T {
    if (this.rows.has(row.id)) {
      throw new Error(`duplicate id: ${row.id}`);
    }
    this.rows.set(row.id, structuredClone(row));
    return row;
  }

  upsert(row: T): T {
    this.rows.set(row.id, structuredClone(row));
    return row;
  }

  get(id: string): T | undefined {
    const row = this.rows.get(id);
    return row === undefined ? undefined : structuredClone(row);
  }

  find(predicate: (row: T) => boolean): T[] {
    return [...this.rows.values()].filter(predicate).map((r) => structuredClone(r));
  }

  findOne(predicate: (row: T) => boolean): T | undefined {
    for (const row of this.rows.values()) {
      if (predicate(row)) return structuredClone(row);
    }
    return undefined;
  }

  all(): T[] {
    return [...this.rows.values()].map((r) => structuredClone(r));
  }

  update(id: string, patch: Partial<T>): T | undefined {
    const row = this.rows.get(id);
    if (row === undefined) return undefined;
    const next = { ...row, ...patch };
    this.rows.set(id, next);
    return structuredClone(next);
  }

  delete(id: string): void {
    this.rows.delete(id);
  }

  size(): number {
    return this.rows.size;
  }
}
