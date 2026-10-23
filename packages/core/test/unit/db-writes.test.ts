import { describe, expect, it } from 'vitest';
import { writeTarget } from '../../src/db/writes.js';

// ADR-0021: a statement that may write names its table, or counts as a write to every table.
describe('writeTarget', () => {
  it('names the table of the writes that Drizzle builds', () => {
    expect(writeTarget('insert into "mcp_tokens" ("id") values (?)', false)).toBe('mcp_tokens');
    expect(writeTarget('update "role_levels" set "level" = ? where "id" = ?', false)).toBe('role_levels');
    expect(writeTarget('delete from "users" where "id" = ?', false)).toBe('users');
    expect(writeTarget('insert into "users" ("id") values (?) on conflict do nothing returning "id"', false)).toBe(
      'users',
    );
  });

  it('names the table in any case, quoted, bracketed or with its schema', () => {
    expect(writeTarget('UPDATE Users SET disabled = 1', false)).toBe('users');
    expect(writeTarget('update [users] set disabled = 1', false)).toBe('users');
    expect(writeTarget('delete from main.mcp_tokens', false)).toBe('mcp_tokens');
    expect(writeTarget('insert or replace into `plugins` values (?)', false)).toBe('plugins');
  });

  it('counts a write it cannot name as a write to every table', () => {
    expect(writeTarget('with t as (select 1) update "role_levels" set "level" = ?', false)).toBe('*');
    expect(writeTarget('/* note */ delete from "mcp_tokens"', false)).toBe('*');
    expect(writeTarget('rollback to savepoint sp1', true)).toBe('*');
  });

  it('leaves reads alone', () => {
    expect(writeTarget('select * from "users" where "id" = ?', true)).toBeUndefined();
  });
});
