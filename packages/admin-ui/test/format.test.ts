import { describe, expect, it } from 'vitest';
import { describeHosts } from '../src/format';

describe('describeHosts', () => {
  const schema = { properties: { baseUrl: { type: 'string', title: 'Base URL' }, region: { type: 'string' } } };

  it('names a connection field by its title, or its name without one', () => {
    expect(describeHosts(['{{connection.baseUrl}}', '{{ connection.region }}'], schema)).toEqual([
      { text: "the host of each endpoint's Base URL", literal: false },
      { text: "the host of each endpoint's region", literal: false },
    ]);
  });

  it('keeps literal hosts and fills placeholders inside a host', () => {
    expect(describeHosts(['api.example.com', 'api.{{connection.region}}.example.com'], schema)).toEqual([
      { text: 'api.example.com', literal: true },
      { text: 'api.‹region›.example.com', literal: false },
    ]);
    expect(describeHosts(['{{connection.baseUrl}}'])[0]!.text).toBe("the host of each endpoint's baseUrl");
  });
});
