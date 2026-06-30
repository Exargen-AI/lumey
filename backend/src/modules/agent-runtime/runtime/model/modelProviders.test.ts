import { describe, it, expect } from 'vitest';
import { listModelProviders, selectProvider } from './modelProviders';

describe('listModelProviders', () => {
  it('returns all three tiers in priority order, none configured, no default, on empty env', () => {
    const ps = listModelProviders({});
    expect(ps.map((p) => p.kind)).toEqual(['LOCAL', 'SELF_HOSTED', 'FRONTIER']);
    expect(ps.every((p) => !p.configured)).toBe(true);
    expect(ps.some((p) => p.isDefault)).toBe(false);
  });

  it('marks local configured + default when LUMEY_LOCAL_MODEL is set', () => {
    const local = listModelProviders({ LUMEY_LOCAL_MODEL: 'qwen2.5-coder:14b' }).find((p) => p.kind === 'LOCAL')!;
    expect(local).toMatchObject({ configured: true, isDefault: true, model: 'qwen2.5-coder:14b' });
  });

  it('treats self-hosted as configured only with both model AND url', () => {
    expect(listModelProviders({ LUMEY_SELFHOSTED_MODEL: 'mixtral' }).find((p) => p.kind === 'SELF_HOSTED')!.configured).toBe(false);
    expect(
      listModelProviders({ LUMEY_SELFHOSTED_MODEL: 'mixtral', LUMEY_SELFHOSTED_URL: 'https://gpu/v1' }).find((p) => p.kind === 'SELF_HOSTED')!.configured,
    ).toBe(true);
  });

  it('honours LUMEY_MODEL_BACKEND=frontier when frontier is configured (else first configured wins)', () => {
    const env = { LUMEY_LOCAL_MODEL: 'qwen', LUMEY_FRONTIER_MODEL: 'gpt', LUMEY_FRONTIER_URL: 'https://api', LUMEY_FRONTIER_API_KEY: 'k', LUMEY_MODEL_BACKEND: 'frontier' };
    const ps = listModelProviders(env);
    expect(ps.find((p) => p.kind === 'FRONTIER')!.isDefault).toBe(true);
    expect(ps.find((p) => p.kind === 'LOCAL')!.isDefault).toBe(false);
    // a backend hint for an UNconfigured tier is ignored — first configured wins
    expect(listModelProviders({ LUMEY_LOCAL_MODEL: 'qwen', LUMEY_MODEL_BACKEND: 'frontier' }).find((p) => p.kind === 'LOCAL')!.isDefault).toBe(true);
  });

  it('redacts credentials from the endpoint', () => {
    const sh = listModelProviders({ LUMEY_SELFHOSTED_MODEL: 'm', LUMEY_SELFHOSTED_URL: 'https://user:pass@gpu:8000/v1' }).find((p) => p.kind === 'SELF_HOSTED')!;
    expect(sh.endpoint).not.toContain('pass');
    expect(sh.endpoint).toContain('gpu:8000');
  });
});

describe('selectProvider', () => {
  const env = { LUMEY_LOCAL_MODEL: 'qwen', LUMEY_SELFHOSTED_MODEL: 'mixtral', LUMEY_SELFHOSTED_URL: 'https://gpu/v1' };
  const ps = listModelProviders(env);

  it('prefers the tier whose model matches the preference', () => {
    expect(selectProvider(ps, 'mixtral')?.kind).toBe('SELF_HOSTED');
  });

  it('falls back to the default tier when the preference has no configured match', () => {
    expect(selectProvider(ps, 'something-else')?.isDefault).toBe(true); // local default
  });

  it('uses the default tier when no preference is given', () => {
    expect(selectProvider(ps)?.kind).toBe('LOCAL');
  });

  it('returns null when nothing is configured', () => {
    expect(selectProvider(listModelProviders({}))).toBeNull();
  });
});
