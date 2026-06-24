import { describe, it, expect } from 'vitest';
import { ConfigEntitlements } from './entitlements';

describe('ConfigEntitlements', () => {
  it('enables every module when nothing is disabled', () => {
    const e = new ConfigEntitlements(undefined);
    expect(e.isEnabled('comments')).toBe(true);
    expect(e.isEnabled('anything')).toBe(true);
  });

  it('treats an empty string as "all enabled"', () => {
    const e = new ConfigEntitlements('');
    expect(e.isEnabled('comments')).toBe(true);
  });

  it('disables exactly the listed entitlement keys', () => {
    const e = new ConfigEntitlements('comments,observability');
    expect(e.isEnabled('comments')).toBe(false);
    expect(e.isEnabled('observability')).toBe(false);
    expect(e.isEnabled('kanban')).toBe(true);
  });

  it('tolerates whitespace and empty segments in the list', () => {
    const e = new ConfigEntitlements(' comments , , observability ,');
    expect(e.isEnabled('comments')).toBe(false);
    expect(e.isEnabled('observability')).toBe(false);
    expect(e.isEnabled('kanban')).toBe(true);
  });
});
