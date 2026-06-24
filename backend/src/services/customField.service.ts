import { CustomFieldType, Prisma } from '@prisma/client';
import prisma from '../config/database';
import { NotFoundError, ValidationError } from '../utils/errors';
import { logActivity } from './activity.service';
import { sanitizePlainText } from '../utils/sanitize';

/**
 * Per-project custom field system. Each project can define a small set of
 * fields (CVE ID for Furix, KYC Status for RozCar, Tithi for ManaCalendar),
 * and tasks store the values as a JSON map on `Task.customFields` keyed by
 * `definition.key`.
 *
 * The schema is deliberately stored as JSON rather than a separate value
 * table — keeps task fetches cheap (no extra join) and lets us evolve the
 * shape of `config` per field-type without a migration each time.
 */

// ─── Type-specific config shapes ───
// We don't pull these into Prisma — they live in JSON. Validation lives at
// the service boundary so any caller (REST handler, future GraphQL, seed
// script) gets the same guarantees.

export interface SelectOption {
  value: string;
  label: string;
  /** Optional hex for the chip — falls back to the field's tone in the UI. */
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

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
const MAX_FIELDS_PER_PROJECT = 30;

function validateConfig(fieldType: CustomFieldType, config: unknown): CustomFieldConfig {
  if (config == null) return {};
  if (typeof config !== 'object' || Array.isArray(config)) {
    throw new ValidationError('Config must be an object.');
  }
  const c = config as Record<string, unknown>;
  const out: CustomFieldConfig = {};

  switch (fieldType) {
    case CustomFieldType.TEXT:
      if (c.multiline != null) {
        if (typeof c.multiline !== 'boolean') throw new ValidationError('multiline must be a boolean.');
        out.multiline = c.multiline;
      }
      if (c.maxLength != null) {
        if (typeof c.maxLength !== 'number' || c.maxLength < 1 || c.maxLength > 5000) {
          throw new ValidationError('maxLength must be 1–5000.');
        }
        out.maxLength = c.maxLength;
      }
      break;
    case CustomFieldType.NUMBER:
      for (const k of ['min', 'max', 'step'] as const) {
        if (c[k] != null) {
          if (typeof c[k] !== 'number' || !Number.isFinite(c[k] as number)) {
            throw new ValidationError(`${k} must be a finite number.`);
          }
          (out as any)[k] = c[k];
        }
      }
      if (out.min != null && out.max != null && out.min > out.max) {
        throw new ValidationError('min cannot exceed max.');
      }
      break;
    case CustomFieldType.SELECT: {
      if (!Array.isArray(c.options) || c.options.length === 0) {
        throw new ValidationError('SELECT fields need at least one option.');
      }
      if (c.options.length > 50) {
        throw new ValidationError('SELECT fields are capped at 50 options.');
      }
      const seen = new Set<string>();
      out.options = c.options.map((raw, i) => {
        if (!raw || typeof raw !== 'object') {
          throw new ValidationError(`Option ${i}: expected an object with value + label.`);
        }
        const o = raw as Record<string, unknown>;
        const value = typeof o.value === 'string' ? o.value.trim() : '';
        const label = typeof o.label === 'string' ? o.label.trim() : '';
        if (!value || !label) throw new ValidationError(`Option ${i}: value and label are required.`);
        if (value.length > 80 || label.length > 80) {
          throw new ValidationError(`Option ${i}: value/label exceed 80 chars.`);
        }
        if (seen.has(value)) throw new ValidationError(`Option ${i}: duplicate value "${value}".`);
        seen.add(value);
        const color = typeof o.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.color) ? o.color : undefined;
        return { value, label, ...(color ? { color } : {}) };
      });
      if (c.multi != null) {
        if (typeof c.multi !== 'boolean') throw new ValidationError('multi must be a boolean.');
        out.multi = c.multi;
      }
      break;
    }
    case CustomFieldType.DATE:
      // No config knobs today; leave room.
      break;
    case CustomFieldType.URL:
      // No config knobs today.
      break;
    case CustomFieldType.BADGE:
      if (c.trueLabel != null) out.trueLabel = String(c.trueLabel).slice(0, 40);
      if (c.falseLabel != null) out.falseLabel = String(c.falseLabel).slice(0, 40);
      if (typeof c.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.color)) out.color = c.color;
      break;
  }
  return out;
}

// ─── CRUD ───

export async function listDefinitions(projectId: string) {
  return prisma.customFieldDefinition.findMany({
    where: { projectId },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  });
}

export async function createDefinition(
  projectId: string,
  data: { name: string; key: string; fieldType: CustomFieldType; config?: unknown; required?: boolean; hint?: string },
  userId: string,
) {
  const name = data.name?.trim();
  const key  = data.key?.trim();
  if (!name) throw new ValidationError('Field name is required.');
  if (name.length > 80) throw new ValidationError('Field name exceeds 80 chars.');
  if (!key || !KEY_PATTERN.test(key)) {
    throw new ValidationError('Key must start with a lowercase letter and use only lowercase, digits, or underscores (max 40 chars).');
  }
  const validatedConfig = validateConfig(data.fieldType, data.config);

  // Cap how many fields a project can define — protects task payloads from
  // unbounded growth and the settings UI from becoming unscannable.
  const existing = await prisma.customFieldDefinition.count({ where: { projectId } });
  if (existing >= MAX_FIELDS_PER_PROJECT) {
    throw new ValidationError(`A project can define at most ${MAX_FIELDS_PER_PROJECT} custom fields.`);
  }

  const maxOrder = await prisma.customFieldDefinition.aggregate({
    where: { projectId },
    _max: { order: true },
  });
  const nextOrder = (maxOrder._max.order ?? -1) + 1;

  const created = await prisma.$transaction(async (tx) => {
    let row;
    try {
      row = await tx.customFieldDefinition.create({
        data: {
          projectId,
          name,
          key,
          fieldType: data.fieldType,
          config: validatedConfig as unknown as Prisma.InputJsonValue,
          required: data.required ?? false,
          order: nextOrder,
          hint: data.hint?.trim() || null,
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ValidationError(`Key "${key}" is already used in this project.`);
      }
      throw e;
    }
    await logActivity({
      userId,
      projectId,
      action: 'created_custom_field',
      targetType: 'custom_field',
      targetId: row.id,
      details: { name, key, fieldType: data.fieldType },
    }, tx);
    return row;
  });

  return created;
}

export async function updateDefinition(
  definitionId: string,
  data: { name?: string; fieldType?: CustomFieldType; config?: unknown; required?: boolean; hint?: string | null },
  userId: string,
) {
  const existing = await prisma.customFieldDefinition.findUnique({ where: { id: definitionId } });
  if (!existing) throw new NotFoundError('CustomField');

  const updates: Prisma.CustomFieldDefinitionUpdateInput = {};
  if (data.name != null) {
    const n = data.name.trim();
    if (!n) throw new ValidationError('Field name is required.');
    if (n.length > 80) throw new ValidationError('Field name exceeds 80 chars.');
    updates.name = n;
  }
  if (data.fieldType != null && data.fieldType !== existing.fieldType) {
    // Refuse type changes once values exist — coercing CVE ID strings into
    // a SELECT would silently lose data. Force "delete + recreate" when the
    // shape needs to fundamentally change.
    const anyValue = await prisma.task.findFirst({
      where: {
        projectId: existing.projectId,
        NOT: [{ customFields: { equals: Prisma.JsonNull } as any }],
      },
      select: { id: true, customFields: true },
    });
    const valueExists = !!anyValue && (anyValue.customFields as any)?.[existing.key] !== undefined;
    if (valueExists) {
      throw new ValidationError(
        'Cannot change field type after values exist. Delete this field (values will be cleared) and create a new one.',
      );
    }
    updates.fieldType = data.fieldType;
  }
  // Re-validate config against the (possibly new) field type.
  if (data.config !== undefined) {
    const fieldType = (data.fieldType ?? existing.fieldType) as CustomFieldType;
    updates.config = validateConfig(fieldType, data.config) as unknown as Prisma.InputJsonValue;
  }
  if (data.required != null) updates.required = data.required;
  if (data.hint !== undefined) updates.hint = data.hint?.trim() || null;

  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.customFieldDefinition.update({
      where: { id: definitionId },
      data: updates,
    });
    await logActivity({
      userId,
      projectId: existing.projectId,
      action: 'updated_custom_field',
      targetType: 'custom_field',
      targetId: definitionId,
      details: { name: updated.name, key: updated.key },
    }, tx);
    return updated;
  });

  return row;
}

export async function deleteDefinition(definitionId: string, userId: string) {
  const existing = await prisma.customFieldDefinition.findUnique({ where: { id: definitionId } });
  if (!existing) throw new NotFoundError('CustomField');

  await prisma.$transaction(async (tx) => {
    // Drop the value from every task's customFields map — keeps the JSON
    // tidy and avoids ghost values that the UI can't render anymore.
    await tx.$executeRaw`
      UPDATE "tasks"
      SET    "customFields" = "customFields" - ${existing.key}::text
      WHERE  "projectId" = ${existing.projectId}
        AND  "customFields" ? ${existing.key};
    `;
    await tx.customFieldDefinition.delete({ where: { id: definitionId } });
    await logActivity({
      userId,
      projectId: existing.projectId,
      action: 'deleted_custom_field',
      targetType: 'custom_field',
      targetId: definitionId,
      details: { name: existing.name, key: existing.key },
    }, tx);
  });
}

export async function reorderDefinitions(projectId: string, ids: string[], userId: string) {
  // Verify every id belongs to the project — protects against a client
  // sending a stale list that includes IDs from another project.
  const rows = await prisma.customFieldDefinition.findMany({
    where: { projectId },
    select: { id: true },
  });
  const owned = new Set(rows.map((r) => r.id));
  if (ids.length !== rows.length || !ids.every((id) => owned.has(id))) {
    throw new ValidationError('Reorder list must include exactly the existing field IDs for this project.');
  }

  await prisma.$transaction(
    ids.map((id, i) => prisma.customFieldDefinition.update({
      where: { id },
      data: { order: i },
    })),
  );
  await logActivity({
    userId, projectId,
    action: 'reordered_custom_fields',
    targetType: 'project',
    targetId: projectId,
    details: { count: ids.length },
  });
  return listDefinitions(projectId);
}

// ─── Value validation ───
// Used by createTask + updateTask to coerce + validate the customFields
// payload against the project's current definitions.

export async function validateValuesForProject(
  projectId: string,
  values: unknown,
  // Optional transaction client. When called from inside `prisma.$transaction`
  // pass `tx` so the field-definition read participates in the same snapshot
  // — closes the TOCTOU window between validate and insert (QA finding #38).
  client: Pick<typeof prisma, 'customFieldDefinition'> = prisma,
): Promise<Record<string, unknown>> {
  if (values == null) return {};
  if (typeof values !== 'object' || Array.isArray(values)) {
    throw new ValidationError('customFields must be an object.');
  }
  const input = values as Record<string, unknown>;

  const defs = await client.customFieldDefinition.findMany({ where: { projectId } });
  const byKey = new Map(defs.map((d) => [d.key, d]));

  // Reject unknown keys — keeps the schema honest and prevents accidental
  // accumulation of orphaned data when a field is renamed/deleted.
  for (const k of Object.keys(input)) {
    if (!byKey.has(k)) {
      throw new ValidationError(`Unknown custom field "${k}".`);
    }
  }

  const out: Record<string, unknown> = {};
  for (const def of defs) {
    const raw = input[def.key];
    const present = raw !== undefined && raw !== null && raw !== '';
    if (!present) {
      if (def.required) throw new ValidationError(`Field "${def.name}" is required.`);
      continue;
    }
    const config = (def.config ?? {}) as CustomFieldConfig;

    switch (def.fieldType) {
      case CustomFieldType.TEXT: {
        if (typeof raw !== 'string') throw new ValidationError(`Field "${def.name}" must be text.`);
        // Sanitize BEFORE the length check — the length cap is on the value
        // we store, not the attacker's pre-stripped payload (so a 500-char
        // `<script>` blob that strips to 8 chars is fine, not a violation).
        // Round 2 finding R4: TEXT used to accept `<script>alert(1)</script>`
        // and stored it verbatim; UI rendered as text node so safe in-app,
        // but exports / future renderers would have eaten the payload raw.
        const sanitized = sanitizePlainText(raw);
        const maxLen = config.maxLength ?? 1000;
        if (sanitized.length > maxLen) throw new ValidationError(`Field "${def.name}" exceeds ${maxLen} chars.`);
        out[def.key] = sanitized;
        break;
      }
      case CustomFieldType.NUMBER: {
        const num = typeof raw === 'string' ? Number(raw) : raw;
        if (typeof num !== 'number' || !Number.isFinite(num)) {
          throw new ValidationError(`Field "${def.name}" must be a number.`);
        }
        if (config.min != null && num < config.min) throw new ValidationError(`Field "${def.name}" must be ≥ ${config.min}.`);
        if (config.max != null && num > config.max) throw new ValidationError(`Field "${def.name}" must be ≤ ${config.max}.`);
        out[def.key] = num;
        break;
      }
      case CustomFieldType.SELECT: {
        const optionValues = (config.options ?? []).map((o) => o.value);
        if (config.multi) {
          if (!Array.isArray(raw)) throw new ValidationError(`Field "${def.name}" must be an array.`);
          for (const v of raw) {
            if (typeof v !== 'string' || !optionValues.includes(v)) {
              throw new ValidationError(`Field "${def.name}" got an invalid option "${v}".`);
            }
          }
          out[def.key] = Array.from(new Set(raw));
        } else {
          if (typeof raw !== 'string' || !optionValues.includes(raw)) {
            throw new ValidationError(`Field "${def.name}" got an invalid option.`);
          }
          out[def.key] = raw;
        }
        break;
      }
      case CustomFieldType.DATE: {
        if (typeof raw !== 'string') throw new ValidationError(`Field "${def.name}" must be a date string.`);
        // Accept YYYY-MM-DD or full ISO; normalize to YYYY-MM-DD.
        const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
        if (!m) throw new ValidationError(`Field "${def.name}" needs YYYY-MM-DD.`);
        out[def.key] = m[1];
        break;
      }
      case CustomFieldType.URL: {
        if (typeof raw !== 'string') throw new ValidationError(`Field "${def.name}" must be a URL.`);
        const trimmed = raw.trim();
        try {
          const u = new URL(trimmed);
          if (!['http:', 'https:'].includes(u.protocol)) {
            throw new Error();
          }
        } catch {
          throw new ValidationError(`Field "${def.name}" must be an http(s) URL.`);
        }
        if (trimmed.length > 2000) throw new ValidationError(`Field "${def.name}" URL exceeds 2000 chars.`);
        out[def.key] = trimmed;
        break;
      }
      case CustomFieldType.BADGE: {
        if (typeof raw !== 'boolean') throw new ValidationError(`Field "${def.name}" must be true/false.`);
        out[def.key] = raw;
        break;
      }
    }
  }
  return out;
}
