import type Database from 'better-sqlite3';
import { getTableName } from 'drizzle-orm';
import type { Table } from 'drizzle-orm';
import type { Db, DbLike } from './index.js';

/** ADR-0021: core counts the writes to each table, so a cache in memory knows when to read again. */

const WRITE = /^\s*(?:insert|replace|update|delete)\b(?:\s+or\s+\w+)?(?:\s+into|\s+from)?\s+(?:\w+\.)?["`[]?(\w+)/i;
const ROLLBACK = /^\s*rollback\b/i;
const RUNS = ['run', 'get', 'all', 'iterate'] as const;
const MAX_PREPARED = 256;

/** The table a statement writes, `*` for a write it cannot name (it fails closed), or nothing for a read. */
export function writeTarget(source: string, readonly: boolean): string | undefined {
  if (ROLLBACK.test(source)) return '*';
  const table = WRITE.exec(source)?.[1];
  if (table) return table.toLowerCase();
  return readonly ? undefined : '*';
}

export class TableWrites {
  private readonly counts = new Map<string, number>();
  /** Each table with the tables whose rows a write to it can change through a foreign key. */
  private readonly reach = new Map<string, string[]>();
  private everything = 0;

  constructor(sqlite: Database.Database) {
    const children = new Map<string, Set<string>>();
    const tables = sqlite.prepare(`select name from sqlite_master where type = 'table'`).pluck().all() as string[];
    for (const child of tables)
      for (const fk of sqlite.pragma(`foreign_key_list("${child}")`) as { table: string }[]) {
        if (!children.has(fk.table)) children.set(fk.table, new Set());
        children.get(fk.table)!.add(child);
      }
    for (const table of tables) {
      const seen = new Set([table]);
      const queue = [table];
      while (queue.length)
        for (const c of children.get(queue.shift()!) ?? [])
          if (!seen.has(c)) {
            seen.add(c);
            queue.push(c);
          }
      this.reach.set(
        table.toLowerCase(),
        [...seen].map((t) => t.toLowerCase()),
      );
    }
  }

  wrote(table: string) {
    const reached = this.reach.get(table);
    if (!reached) return this.wroteEverything();
    for (const t of reached) this.counts.set(t, (this.counts.get(t) ?? 0) + 1);
  }

  /** A rollback, raw SQL or a write to a table it cannot name: every table may have changed. */
  wroteEverything() {
    this.everything++;
  }

  /** Grows each time one of these tables is written. */
  version(tables: readonly string[]): number {
    let v = this.everything;
    for (const t of tables) v += this.counts.get(t) ?? 0;
    return v;
  }
}

const registry = new WeakMap<Database.Database, TableWrites>();

/** Counts every write that goes through this connection from now on. */
export function countWrites(sqlite: Database.Database): TableWrites {
  const writes = new TableWrites(sqlite);
  registry.set(sqlite, writes);
  const prepare = sqlite.prepare.bind(sqlite);
  // Each statement holds native SQLite memory until it is collected: reuse it rather than prepare it again.
  const prepared = new Map<string, Database.Statement>();
  sqlite.prepare = ((source: string) => {
    const kept = prepared.get(source);
    if (kept && !kept.busy) {
      prepared.delete(source);
      prepared.set(source, kept);
      // Drizzle turns raw mode on and expects a fresh statement to have it off.
      if (kept.reader) kept.pluck(false).expand(false).raw(false);
      return kept;
    }
    const stmt = prepare(source);
    if (!kept) {
      prepared.set(source, stmt);
      if (prepared.size > MAX_PREPARED) prepared.delete(prepared.keys().next().value!);
    }
    const table = writeTarget(source, stmt.readonly);
    if (table)
      for (const m of RUNS) {
        const run = (stmt[m] as (...a: unknown[]) => unknown).bind(stmt);
        (stmt as unknown as Record<string, unknown>)[m] = (...args: unknown[]) => {
          if (table === '*') writes.wroteEverything();
          else writes.wrote(table);
          return run(...args);
        };
      }
    return stmt;
  }) as typeof sqlite.prepare;
  const exec = sqlite.exec.bind(sqlite);
  sqlite.exec = ((source: string) => {
    writes.wroteEverything();
    return exec(source);
  }) as typeof sqlite.exec;
  const transaction = sqlite.transaction.bind(sqlite);
  sqlite.transaction = ((fn: (...a: unknown[]) => unknown) =>
    transaction((...args: unknown[]) => {
      try {
        return fn(...args);
      } catch (err) {
        writes.wroteEverything();
        throw err;
      }
    })) as typeof sqlite.transaction;
  return writes;
}

const isRoot = (db: DbLike): db is Db => '$client' in db;

/** Values read from `tables`, kept until one of them is written (ADR-0021). A miss is never kept, so
 * unknown keys cannot grow the cache, and nothing is kept while a transaction is open. */
export function tableCache<K, V>(tables: Table[], load: (db: DbLike, key: K) => V | undefined) {
  const names = tables.map((t) => getTableName(t).toLowerCase());
  const perDb = new WeakMap<Db, { version: number; values: Map<K, V> }>();
  return (db: DbLike, key: K): V | undefined => {
    const writes = isRoot(db) ? registry.get(db.$client) : undefined;
    if (!writes || (db as Db).$client.inTransaction) return load(db, key);
    const version = writes.version(names);
    let entry = perDb.get(db as Db);
    if (!entry || entry.version !== version) perDb.set(db as Db, (entry = { version, values: new Map() }));
    if (entry.values.has(key)) return entry.values.get(key);
    const value = load(db, key);
    if (value !== undefined) entry.values.set(key, value);
    return value;
  };
}
