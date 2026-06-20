import { randomUUID } from "node:crypto";

// Prefixed, sortable-ish IDs. Prefix makes logs/debugging readable (usr_, ctr_, lst_…).
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}
