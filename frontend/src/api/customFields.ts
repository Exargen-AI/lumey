import api from './client';

export type CustomFieldType = 'TEXT' | 'NUMBER' | 'SELECT' | 'DATE' | 'URL' | 'BADGE';

export interface SelectOption {
  value: string;
  label: string;
  color?: string;
}

export interface CustomFieldConfig {
  // TEXT
  multiline?: boolean;
  maxLength?: number;
  // NUMBER
  min?: number;
  max?: number;
  step?: number;
  // SELECT
  options?: SelectOption[];
  multi?: boolean;
  // BADGE
  trueLabel?: string;
  falseLabel?: string;
  color?: string;
}

export interface CustomFieldDefinition {
  id: string;
  projectId: string;
  name: string;
  key: string;
  fieldType: CustomFieldType;
  config: CustomFieldConfig;
  required: boolean;
  order: number;
  hint: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CustomFieldValue = string | number | boolean | string[] | null | undefined;
export type CustomFieldValues = Record<string, CustomFieldValue>;

export async function listDefinitions(projectId: string): Promise<CustomFieldDefinition[]> {
  const { data } = await api.get(`/projects/${projectId}/custom-fields`);
  return data.data;
}

export interface CreateDefinitionInput {
  name: string;
  key: string;
  fieldType: CustomFieldType;
  config?: CustomFieldConfig;
  required?: boolean;
  hint?: string;
}

export async function createDefinition(projectId: string, input: CreateDefinitionInput): Promise<CustomFieldDefinition> {
  const { data } = await api.post(`/projects/${projectId}/custom-fields`, input);
  return data.data;
}

export async function updateDefinition(
  fieldId: string,
  input: Partial<Omit<CreateDefinitionInput, 'key'>>,
): Promise<CustomFieldDefinition> {
  const { data } = await api.put(`/custom-fields/${fieldId}`, input);
  return data.data;
}

export async function deleteDefinition(fieldId: string) {
  const { data } = await api.delete(`/custom-fields/${fieldId}`);
  return data.data;
}

export async function reorderDefinitions(projectId: string, ids: string[]): Promise<CustomFieldDefinition[]> {
  const { data } = await api.post(`/projects/${projectId}/custom-fields/reorder`, { ids });
  return data.data;
}
