import { describe, expect, it } from 'vitest';
import { parseBlocks } from '../../src/components/MarkdownLite';

describe('MarkdownLite (connection setup help)', () => {
  it('splits paragraphs and lists', () => {
    expect(parseBlocks('Intro line\nstill intro\n\n1. one\n2. two\n\n- a\n- b')).toEqual([
      { kind: 'p', text: 'Intro line still intro' },
      { kind: 'ol', items: ['one', 'two'] },
      { kind: 'ul', items: ['a', 'b'] },
    ]);
  });
});
