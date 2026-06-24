import './../../test/prismaMock';
import { describe, it, expect } from 'vitest';
import {
  getAdapter,
  listAdapters,
  registerAdapter,
  DEFAULT_ADAPTER_ID,
} from './adapterRegistry';
import { referenceAdapter } from './adapters/reference';

describe('adapterRegistry', () => {
  it('resolves the built-in reference adapter and defaults to it', () => {
    expect(getAdapter('reference')).toBe(referenceAdapter);
    expect(DEFAULT_ADAPTER_ID).toBe('reference');
  });

  it('lists registered adapters', () => {
    expect(listAdapters()).toContain('reference');
  });

  it('throws on an unknown adapter id', () => {
    expect(() => getAdapter('nope')).toThrow(/unknown runtime adapter/);
  });

  it('throws on a duplicate registration', () => {
    expect(() => registerAdapter(referenceAdapter)).toThrow(/duplicate adapter id/);
  });
});
