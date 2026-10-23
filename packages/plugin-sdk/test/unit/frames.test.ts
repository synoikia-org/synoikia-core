import { describe, expect, it } from 'vitest';
import { createFrameReader, encodeFrame } from '../../src/frames.js';

describe('createFrameReader', () => {
  it('splits lines across chunks and keeps a partial line for the next chunk', () => {
    const read = createFrameReader();
    expect(read(Buffer.from('{"a":1}\n{"b":'))).toEqual([{ ok: true, value: { a: 1 } }]);
    expect(read(Buffer.from('2}\n'))).toEqual([{ ok: true, value: { b: 2 } }]);
  });

  it('reads a line break inside a string as part of the value', () => {
    const read = createFrameReader();
    expect(read(Buffer.from(encodeFrame({ text: 'one\ntwo' })))).toEqual([{ ok: true, value: { text: 'one\ntwo' } }]);
  });

  it('marks a line that is not JSON and goes on with the next line', () => {
    const read = createFrameReader();
    expect(read(Buffer.from('not json\n{"c":3}\n'))).toEqual([{ ok: false }, { ok: true, value: { c: 3 } }]);
  });

  it('keeps a multi-byte character that a chunk splits', () => {
    const read = createFrameReader();
    const bytes = Buffer.from(encodeFrame({ name: 'Grüße' }));
    expect(read(bytes.subarray(0, 12))).toEqual([]);
    expect(read(bytes.subarray(12))).toEqual([{ ok: true, value: { name: 'Grüße' } }]);
  });

  it('breaks the stream once a line passes the limit, also across chunks', () => {
    expect(createFrameReader(8)(Buffer.from('"123456789"\n'))).toBeNull();
    const read = createFrameReader(8);
    expect(read(Buffer.from('"12345'))).toEqual([]);
    expect(read(Buffer.from('6789"'))).toBeNull();
    expect(createFrameReader(8)(Buffer.from('"123456"\n'))).toEqual([{ ok: true, value: '123456' }]);
  });
});
