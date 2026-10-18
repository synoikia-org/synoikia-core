import { describe, expect, it } from 'vitest';
import { fill } from '../../src/scaffold.js';

describe('templates', () => {
  it('fills only known placeholders', () => {
    expect(fill('{{name}} at {{connection.baseUrl}} {{other}}', { name: 'Acme' })).toBe(
      'Acme at {{connection.baseUrl}} {{other}}',
    );
    expect(fill('{{constructor}}', {})).toBe('{{constructor}}');
  });
});
