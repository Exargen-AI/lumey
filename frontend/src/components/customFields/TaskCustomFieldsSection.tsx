import { useEffect, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { useCustomFieldDefinitions } from '@/hooks/useCustomFields';
import { useUpdateTask } from '@/hooks/useTasks';
import type { CustomFieldDefinition, CustomFieldValue, CustomFieldValues } from '@/api/customFields';
import { CustomFieldInput } from './CustomFieldRenderer';

interface TaskCustomFieldsSectionProps {
  taskId: string;
  projectId: string;
  /** Current map of values from the task. */
  values: CustomFieldValues;
  /** Whether the current user can edit this task's fields. */
  canEdit: boolean;
}

/**
 * Renders the project's custom fields on the task detail panel/page.
 * Each field auto-saves on change/blur via PUT /tasks/:id. If the server
 * rejects a value (required missing, out of range, invalid option), we
 * surface that error inline next to the offending field.
 */
export function TaskCustomFieldsSection({
  taskId, projectId, values, canEdit,
}: TaskCustomFieldsSectionProps) {
  const { data: defs, isLoading } = useCustomFieldDefinitions(projectId);
  const updateTask = useUpdateTask();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [localValues, setLocalValues] = useState<CustomFieldValues>(values);

  // Sync from server when the task refreshes (e.g. another field saved).
  useEffect(() => { setLocalValues(values); }, [values, taskId]);

  if (isLoading || !defs || defs.length === 0) return null;

  async function persist(def: CustomFieldDefinition, next: CustomFieldValue) {
    setErrors((e) => { const { [def.key]: _, ...rest } = e; return rest; });
    const merged: CustomFieldValues = { ...localValues, [def.key]: next };
    setLocalValues(merged);
    try {
      // We send the WHOLE map every time so server-side validation has full
      // context (required-field checks, removing other keys cleanly).
      // Strip undefined / empty so the wire payload is minimal.
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(merged)) {
        if (v === undefined || v === null || v === '') continue;
        if (Array.isArray(v) && v.length === 0) continue;
        cleaned[k] = v;
      }
      await updateTask.mutateAsync({ id: taskId, data: { customFields: cleaned } });
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message ?? 'Could not save.';
      setErrors((e) => ({ ...e, [def.key]: msg }));
    }
  }

  return (
    <div>
      <label className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-obsidian-muted block mb-3 flex items-center gap-1.5">
        <Settings2 size={11} />
        Custom Fields
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {defs.map((def) => (
          <CustomFieldInput
            key={def.id}
            definition={def}
            value={localValues[def.key]}
            onChange={(v) => persist(def, v)}
            disabled={!canEdit}
            error={errors[def.key] ?? null}
          />
        ))}
      </div>
    </div>
  );
}
