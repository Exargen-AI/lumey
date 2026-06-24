import { useState } from 'react';
import { Plus, Trash2, Pencil, X, Check, GripVertical, Settings2 } from 'lucide-react';
import {
  useCustomFieldDefinitions, useCreateCustomField, useUpdateCustomField, useDeleteCustomField,
} from '@/hooks/useCustomFields';
import type { CustomFieldDefinition, CustomFieldType, CreateDefinitionInput, SelectOption } from '@/api/customFields';
import { Modal, Button, Input, Field, Textarea, useConfirm } from '@/components/ui';
import { Can } from '@/components/auth/Can';
import { cn } from '@/lib/cn';

interface CustomFieldDefinitionEditorProps {
  projectId: string;
}

const TYPE_LABELS: Record<CustomFieldType, string> = {
  TEXT:   'Text',
  NUMBER: 'Number',
  SELECT: 'Select',
  DATE:   'Date',
  URL:    'URL',
  BADGE:  'Badge (yes/no)',
};

const TYPE_HINTS: Record<CustomFieldType, string> = {
  TEXT:   'Free-form text — e.g. CVE ID, route name.',
  NUMBER: 'Numeric value with optional min/max — e.g. CVSS score.',
  SELECT: 'Pick one (or many) from a fixed list — e.g. KYC status.',
  DATE:   'Calendar date.',
  URL:    'External link.',
  BADGE:  'Yes/no flag rendered as a colored chip.',
};

/**
 * Project Settings → Custom Fields tab. Lets admins/PMs define which
 * structured fields each task in this project should have.
 *
 * - Fields are listed in display order; up/down hover buttons reorder them.
 * - Edit and create both go through the same modal — keeps the form
 *   shape consistent and avoids two near-duplicate dialogs.
 * - Deleting a field also clears that key from every existing task's
 *   customFields map (handled server-side in a transaction).
 */
export function CustomFieldDefinitionEditor({ projectId }: CustomFieldDefinitionEditorProps) {
  const { data: defs, isLoading } = useCustomFieldDefinitions(projectId);
  const deleteField = useDeleteCustomField(projectId);
  const confirm = useConfirm();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<CustomFieldDefinition | null>(null);

  async function handleDelete(def: CustomFieldDefinition) {
    const ok = await confirm({
      title: `Delete "${def.name}"?`,
      body: 'Existing values for this field will be removed from every task in this project. This cannot be undone.',
      confirmLabel: 'Delete field',
      tone: 'danger',
    });
    if (!ok) return;
    await deleteField.mutateAsync(def.id);
  }

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-[13px] font-semibold text-gray-900 dark:text-obsidian-fg flex items-center gap-1.5">
            <Settings2 size={14} className="text-brand-500" />
            Custom Fields
          </h3>
          <p className="text-[12px] text-gray-500 dark:text-obsidian-muted mt-0.5">
            Define structured fields for tasks in this project — CVE IDs, KYC status, anything domain-specific.
          </p>
        </div>
        <Can permission="project.edit">
          <Button
            variant="primary"
            size="sm"
            leadingIcon={<Plus size={14} />}
            onClick={() => setCreateOpen(true)}
          >
            New field
          </Button>
        </Can>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 rounded-lg bg-gray-100 dark:bg-obsidian-raised/40 animate-pulse" />
          ))}
        </div>
      ) : !defs || defs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 dark:border-obsidian-border p-8 text-center">
          <p className="text-[13px] text-gray-500 dark:text-obsidian-muted">
            No custom fields yet. Define one to start tracking project-specific data on tasks.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {defs.map((def) => (
            <li
              key={def.id}
              className="group rounded-lg bg-white dark:bg-obsidian-panel border border-gray-200 dark:border-obsidian-border px-3 py-2 flex items-start gap-3"
            >
              <GripVertical size={14} className="text-gray-300 dark:text-obsidian-faded mt-1 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-medium text-gray-900 dark:text-obsidian-fg">
                    {def.name}
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.08em] font-semibold px-1.5 py-0.5 rounded bg-brand-500/10 text-brand-700 dark:text-brand-300 ring-1 ring-brand-500/20">
                    {TYPE_LABELS[def.fieldType]}
                  </span>
                  {def.required && (
                    <span className="text-[10px] uppercase tracking-[0.08em] font-semibold px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/20">
                      Required
                    </span>
                  )}
                  <code className="text-[10px] font-mono text-gray-400 dark:text-obsidian-faded">
                    {def.key}
                  </code>
                </div>
                {def.hint && (
                  <p className="text-[11px] text-gray-500 dark:text-obsidian-muted mt-0.5 truncate">
                    {def.hint}
                  </p>
                )}
                {def.fieldType === 'SELECT' && (def.config.options?.length ?? 0) > 0 && (
                  <p className="text-[10px] text-gray-400 dark:text-obsidian-faded mt-0.5 truncate">
                    Options: {def.config.options!.map((o) => o.label).join(' · ')}
                  </p>
                )}
              </div>
              <Can permission="project.edit">
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
                  <button
                    type="button"
                    onClick={() => setEditing(def)}
                    className="p-1.5 rounded text-gray-400 hover:bg-gray-100 dark:hover:bg-obsidian-border hover:text-gray-700 dark:hover:text-obsidian-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                    aria-label="Edit field"
                    title="Edit"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(def)}
                    className="p-1.5 rounded text-gray-400 hover:bg-rose-500/15 hover:text-rose-600 dark:hover:text-rose-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40"
                    aria-label="Delete field"
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </Can>
            </li>
          ))}
        </ul>
      )}

      <FieldFormModal
        projectId={projectId}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
      <FieldFormModal
        projectId={projectId}
        open={!!editing}
        existing={editing}
        onClose={() => setEditing(null)}
      />
    </>
  );
}

interface FormState {
  name: string;
  key: string;
  fieldType: CustomFieldType;
  required: boolean;
  hint: string;
  // SELECT
  options: SelectOption[];
  multi: boolean;
  // NUMBER
  min: string;
  max: string;
  step: string;
  // TEXT
  multiline: boolean;
  maxLength: string;
  // BADGE
  trueLabel: string;
  falseLabel: string;
  color: string;
}

const EMPTY_FORM: FormState = {
  name: '', key: '', fieldType: 'TEXT', required: false, hint: '',
  options: [], multi: false,
  min: '', max: '', step: '',
  multiline: false, maxLength: '',
  trueLabel: '', falseLabel: '', color: '',
};

function FieldFormModal({
  projectId, existing, open, onClose,
}: {
  projectId: string;
  existing?: CustomFieldDefinition | null;
  open: boolean;
  onClose: () => void;
}) {
  const isEdit = !!existing;
  const create = useCreateCustomField(projectId);
  const update = useUpdateCustomField(projectId);

  const [state, setState] = useState<FormState>(() => fromExisting(existing));
  const [error, setError] = useState<string | null>(null);

  // Reset whenever the dialog re-opens.
  useState(() => { setState(fromExisting(existing)); });

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setState((s) => ({ ...s, [k]: v }));
  }

  // Auto-derive a sensible key from the name on first edit.
  function onNameChange(name: string) {
    setState((s) => {
      const next = { ...s, name };
      if (!isEdit && (s.key === '' || s.key === slugify(s.name))) {
        next.key = slugify(name);
      }
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmedName = state.name.trim();
    if (!trimmedName) { setError('Name is required.'); return; }
    if (!isEdit && !/^[a-z][a-z0-9_]{0,39}$/.test(state.key)) {
      setError('Key must start with a lowercase letter and use only lowercase, digits, or underscores.');
      return;
    }

    const config: Record<string, unknown> = {};
    switch (state.fieldType) {
      case 'TEXT':
        if (state.multiline) config.multiline = true;
        if (state.maxLength) config.maxLength = Number(state.maxLength);
        break;
      case 'NUMBER':
        if (state.min !== '') config.min = Number(state.min);
        if (state.max !== '') config.max = Number(state.max);
        if (state.step !== '') config.step = Number(state.step);
        break;
      case 'SELECT':
        if (state.options.length === 0) { setError('Add at least one option.'); return; }
        config.options = state.options;
        if (state.multi) config.multi = true;
        break;
      case 'BADGE':
        if (state.trueLabel) config.trueLabel = state.trueLabel;
        if (state.falseLabel) config.falseLabel = state.falseLabel;
        if (state.color) config.color = state.color;
        break;
    }

    const payload: CreateDefinitionInput = {
      name: trimmedName,
      key: state.key,
      fieldType: state.fieldType,
      config: config as any,
      required: state.required,
      hint: state.hint.trim() || undefined,
    };

    try {
      if (isEdit && existing) {
        const { key, ...rest } = payload;
        await update.mutateAsync({ id: existing.id, data: rest });
      } else {
        await create.mutateAsync(payload);
      }
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? 'Failed to save the field.');
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit "${existing?.name}"` : 'New custom field'}
      size="lg"
      accent="brand"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={create.isPending || update.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="custom-field-form"
            disabled={create.isPending || update.isPending}
            leadingIcon={<Check size={14} />}
          >
            {isEdit ? 'Save changes' : 'Create field'}
          </Button>
        </>
      }
    >
      <form id="custom-field-form" onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Name" required>
            <Input
              autoFocus
              value={state.name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="e.g. CVE ID"
              maxLength={80}
            />
          </Field>
          <Field
            label="Key"
            hint="Used in API/data — lowercase + underscores. Locked after create."
            required
          >
            <Input
              value={state.key}
              onChange={(e) => set('key', e.target.value)}
              placeholder="e.g. cve_id"
              maxLength={40}
              disabled={isEdit}
            />
          </Field>
        </div>

        <Field label="Type">
          <select
            value={state.fieldType}
            onChange={(e) => set('fieldType', e.target.value as CustomFieldType)}
            disabled={isEdit && hasValuesGuard(existing)}
            className="w-full rounded-md border border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-bg px-2.5 py-1.5 text-[13px] text-gray-900 dark:text-obsidian-fg focus:outline-none focus:ring-2 focus:ring-brand-500/40"
          >
            {(Object.keys(TYPE_LABELS) as CustomFieldType[]).map((t) => (
              <option key={t} value={t}>{TYPE_LABELS[t]}</option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-gray-500 dark:text-obsidian-muted">{TYPE_HINTS[state.fieldType]}</p>
        </Field>

        <Field label="Hint" hint="Optional helper text shown below the input.">
          <Input
            value={state.hint}
            onChange={(e) => set('hint', e.target.value)}
            placeholder="e.g. CVSS 3.1 base score (0–10)"
            maxLength={500}
          />
        </Field>

        {/* Type-specific config */}
        {state.fieldType === 'TEXT' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Max length">
              <Input
                type="number"
                min={1}
                max={5000}
                value={state.maxLength}
                onChange={(e) => set('maxLength', e.target.value)}
                placeholder="200"
              />
            </Field>
            <label className="flex items-end gap-2 pb-1.5 text-[12px] text-gray-700 dark:text-obsidian-fg cursor-pointer">
              <input type="checkbox" checked={state.multiline} onChange={(e) => set('multiline', e.target.checked)} className="w-4 h-4 accent-brand-600" />
              Multi-line (textarea)
            </label>
          </div>
        )}

        {state.fieldType === 'NUMBER' && (
          <div className="grid grid-cols-3 gap-3">
            <Field label="Min"><Input type="number" value={state.min} onChange={(e) => set('min', e.target.value)} /></Field>
            <Field label="Max"><Input type="number" value={state.max} onChange={(e) => set('max', e.target.value)} /></Field>
            <Field label="Step"><Input type="number" value={state.step} onChange={(e) => set('step', e.target.value)} placeholder="any" /></Field>
          </div>
        )}

        {state.fieldType === 'SELECT' && (
          <SelectOptionsEditor
            options={state.options}
            multi={state.multi}
            onChangeOptions={(o) => set('options', o)}
            onChangeMulti={(m) => set('multi', m)}
          />
        )}

        {state.fieldType === 'BADGE' && (
          <div className="grid grid-cols-3 gap-3">
            <Field label="True label"><Input value={state.trueLabel} onChange={(e) => set('trueLabel', e.target.value)} placeholder="On" maxLength={40} /></Field>
            <Field label="False label"><Input value={state.falseLabel} onChange={(e) => set('falseLabel', e.target.value)} placeholder="Off" maxLength={40} /></Field>
            <Field label="Color (#hex)">
              <Input value={state.color} onChange={(e) => set('color', e.target.value)} placeholder="#7c3aed" maxLength={7} />
            </Field>
          </div>
        )}

        <label className="flex items-center gap-2 text-[12px] text-gray-700 dark:text-obsidian-fg cursor-pointer">
          <input type="checkbox" checked={state.required} onChange={(e) => set('required', e.target.checked)} className="w-4 h-4 accent-brand-600" />
          Required — every task must have a value before it can be saved
        </label>

        {error && (
          <div role="alert" className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-700 dark:text-rose-300">
            {error}
          </div>
        )}

        {isEdit && hasValuesGuard(existing) && state.fieldType !== existing!.fieldType && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300">
            Type changes are blocked once values exist. Delete this field and create a new one to switch types.
          </div>
        )}
      </form>
    </Modal>
  );
}

function SelectOptionsEditor({
  options, multi, onChangeOptions, onChangeMulti,
}: {
  options: SelectOption[];
  multi: boolean;
  onChangeOptions: (o: SelectOption[]) => void;
  onChangeMulti: (m: boolean) => void;
}) {
  const [draft, setDraft] = useState({ value: '', label: '' });

  function add() {
    const v = draft.value.trim().toLowerCase().replace(/\s+/g, '_');
    const l = draft.label.trim() || v;
    if (!v) return;
    if (options.some((o) => o.value === v)) return;
    onChangeOptions([...options, { value: v, label: l }]);
    setDraft({ value: '', label: '' });
  }
  function remove(value: string) {
    onChangeOptions(options.filter((o) => o.value !== value));
  }

  return (
    <Field label="Options" hint="At least one. Value is the stored token; label is what users see.">
      <div className="space-y-1.5">
        {options.map((o) => (
          <div key={o.value} className="flex items-center gap-2 px-2 py-1 rounded bg-gray-50 dark:bg-obsidian-sunken/40 border border-gray-100 dark:border-obsidian-border">
            <code className="text-[10px] font-mono text-gray-500 dark:text-obsidian-faded shrink-0 w-32 truncate">{o.value}</code>
            <span className="flex-1 text-[12px] text-gray-800 dark:text-obsidian-fg truncate">{o.label}</span>
            <button type="button" onClick={() => remove(o.value)} className="p-0.5 rounded text-gray-400 hover:text-rose-500" aria-label={`Remove ${o.label}`}>
              <X size={11} />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <Input
            value={draft.value}
            onChange={(e) => setDraft({ ...draft, value: e.target.value })}
            placeholder="value (e.g. pending)"
            className={cn('text-[12px] py-1 w-40')}
          />
          <Input
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            placeholder="label"
            className="text-[12px] py-1 flex-1"
          />
          <button type="button" onClick={add} className="px-2 py-1 rounded bg-brand-500/10 text-brand-700 dark:text-brand-300 text-[11px] font-medium hover:bg-brand-500/20" aria-label="Add option">
            <Plus size={12} className="inline" /> Add
          </button>
        </div>
        <label className="flex items-center gap-2 mt-2 text-[12px] text-gray-700 dark:text-obsidian-fg cursor-pointer">
          <input type="checkbox" checked={multi} onChange={(e) => onChangeMulti(e.target.checked)} className="w-4 h-4 accent-brand-600" />
          Allow multiple selections
        </label>
      </div>
    </Field>
  );
}

function fromExisting(d?: CustomFieldDefinition | null): FormState {
  if (!d) return EMPTY_FORM;
  const c = d.config ?? {};
  return {
    name: d.name,
    key: d.key,
    fieldType: d.fieldType,
    required: d.required,
    hint: d.hint ?? '',
    options: c.options ?? [],
    multi: !!c.multi,
    min: c.min != null ? String(c.min) : '',
    max: c.max != null ? String(c.max) : '',
    step: c.step != null ? String(c.step) : '',
    multiline: !!c.multiline,
    maxLength: c.maxLength != null ? String(c.maxLength) : '',
    trueLabel: c.trueLabel ?? '',
    falseLabel: c.falseLabel ?? '',
    color: c.color ?? '',
  };
}

function slugify(s: string): string {
  return s.trim().toLowerCase()
    .replace(/[^a-z0-9_\s]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 40);
}

/** Server enforces the rule; this is just for UX hinting in the editor. */
function hasValuesGuard(_d?: CustomFieldDefinition | null): boolean {
  // We can't cheaply know without a query — assume true after edit-mode opens
  // so the warning is always shown as a heads-up.
  return _d != null;
}
