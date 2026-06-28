import api from './client';

/** An agent's effective governance policy (always fully defaulted by the server). */
export interface EffectivePolicy {
  enabled: boolean;
  /** If set, the only tools the agent may use; null = all tools. */
  allowedTools: string[] | null;
  maxRunTokens: number | null;
  maxRunSteps: number | null;
  model: string | null;
}

export async function getAgentPolicy(agentId: string): Promise<EffectivePolicy> {
  const { data } = await api.get(`/agents/${agentId}/policy`);
  return data.data;
}
