// Persistence wiring (write-behind + hydrate). A Persistor is the durable backend (Postgres);
// `createPersistentFactory` produces a TableFactory whose tables mirror every mutation to the
// persistor and register themselves so `hydrate()` can reload them at startup. Domain code
// stays fully synchronous; only startup hydrate and periodic flush are async.

import { MemoryTable, type Row, type Table, type TableFactory } from "./store.ts";

export interface Persistor {
  init(): Promise<void>;
  loadAll(table: string): Promise<Row[]>;
  // Enqueue a write (write-behind); flushed in batches.
  write(table: string, op: "upsert" | "delete", row: Row): void;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export type PersistentFactory = {
  tables: TableFactory;
  hydrate: () => Promise<void>;
  flush: () => Promise<void>;
  close: () => Promise<void>;
};

export function createPersistentFactory(persistor: Persistor): PersistentFactory {
  const registry = new Map<string, MemoryTable<Row>>();

  const tables: TableFactory = <T extends Row>(name: string): Table<T> => {
    const table = new MemoryTable<T>((op, row) => persistor.write(name, op, row));
    registry.set(name, table as unknown as MemoryTable<Row>);
    return table;
  };

  const hydrate = async (): Promise<void> => {
    await persistor.init();
    for (const [name, table] of registry) {
      const rows = await persistor.loadAll(name);
      table.load(rows);
    }
  };

  return {
    tables,
    hydrate,
    flush: () => persistor.flush(),
    close: () => persistor.close(),
  };
}
