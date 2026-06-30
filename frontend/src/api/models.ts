import api from './client';

export type ModelProviderKind = 'LOCAL' | 'SELF_HOSTED' | 'FRONTIER';

/** A redacted description of a model tier (local / self-hosted / frontier). */
export interface ModelProvider {
  id: string;
  kind: ModelProviderKind;
  label: string;
  model: string | null;
  endpoint: string | null;
  requiresKey: boolean;
  configured: boolean;
  isDefault: boolean;
}

/** The configured model tiers + which is the default (no secrets). */
export async function listModelProviders(): Promise<ModelProvider[]> {
  const { data } = await api.get('/models/providers');
  return data.data;
}
