// Minimal repository abstraction. Each module owns its tables through a Table<T> and never
// touches another module's storage directly — the seam that lets a module be extracted into
// its own service later (docs/ARCHITECTURE.md §2).
//
// MemoryTable is the default (zero-dependency, fully synchronous) implementation. For
// durability it accepts a write hook: every mutation is mirrored to a persistor (write-behind),
// while reads stay in-memory and synchronous. `load()` bulk-populates from storage at startup
// (hydrate) without re-triggering the hook. This keeps all domain logic synchronous while the
// system of record lives in Postgres (see platform/store/persistence.ts + pg.ts).

export type Row = { id: string };
export type WriteOp = "upsert" | "delete";
export type WriteHook = (op: WriteOp, row: Row) => void;

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

// Factory used by services so they don't hard-code MemoryTable; the durable factory wires a
// write hook + registers the table for hydration (platform/store/persistence.ts).
export type TableFactory = <T extends Row>(name: string) => Table<T>;

export class MemoryTable<T extends Row> implements Table<T> {
  private readonly rows = new Map<string, T>();
  private readonly onWrite: WriteHook | undefined;

  constructor(onWrite?: WriteHook) {
    this.onWrite = onWrite;
  }

  // Bulk-load from storage during hydrate — does NOT fire the write hook.
  load(rows: T[]): void {
    for (const row of rows) this.rows.set(row.id, structuredClone(row));
  }

  insert(row: T): T {
    if (this.rows.has(row.id)) {
      throw new Error(`duplicate id: ${row.id}`);
    }
    this.rows.set(row.id, structuredClone(row));
    this.onWrite?.("upsert", row);
    return row;
  }

  upsert(row: T): T {
    this.rows.set(row.id, structuredClone(row));
    this.onWrite?.("upsert", row);
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
    this.onWrite?.("upsert", next);
    return structuredClone(next);
  }

  delete(id: string): void {
    const row = this.rows.get(id);
    this.rows.delete(id);
    if (row !== undefined) this.onWrite?.("delete", row);
  }

  size(): number {
    return this.rows.size;
  }
}

// The default factory: plain in-memory tables, no persistence.
export const memoryTableFactory: TableFactory = <T extends Row>(_name: string): Table<T> =>
  new MemoryTable<T>();
