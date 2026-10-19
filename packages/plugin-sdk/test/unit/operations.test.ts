import { describe, expect, it } from 'vitest';
import { OperationDescriptorSchema } from '../../src/index.js';

const base = {
  key: 'app.upgrade',
  kind: 'method',
  group: 'app',
  classification: 'write',
  classificationReason: 'naming:upgrade',
};

describe('OperationDescriptorSchema', () => {
  it('applies defaults', () => {
    expect(OperationDescriptorSchema.parse(base)).toMatchObject({
      locked: false,
      attestationRequired: false,
      needsReview: false,
    });
  });
});
