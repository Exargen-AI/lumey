/**
 * Per-product custom field demo seed. Idempotent: skips fields that already
 * exist (matched by projectId + key). Run after the main seed:
 *
 *   npx tsx backend/src/seed/customFields-demo.ts
 */
import { CustomFieldType } from '@prisma/client';
import prisma from '../config/database';

interface FieldSpec {
  name: string;
  key: string;
  fieldType: CustomFieldType;
  config?: Record<string, unknown>;
  required?: boolean;
  hint?: string;
}

const PER_PRODUCT: Record<string, FieldSpec[]> = {
  'furix-ai': [
    { name: 'CVE ID',           key: 'cve_id',   fieldType: CustomFieldType.TEXT,
      hint: 'e.g. CVE-2026-1872' },
    { name: 'CVSS Score',       key: 'cvss',     fieldType: CustomFieldType.NUMBER,
      config: { min: 0, max: 10, step: 0.1 }, hint: 'CVSS 3.1 base score (0–10)' },
    { name: 'Affected Component', key: 'component', fieldType: CustomFieldType.SELECT,
      config: {
        options: [
          { value: 'auth',         label: 'Auth' },
          { value: 'rag',          label: 'RAG retrieval' },
          { value: 'vector_store', label: 'Vector store' },
          { value: 'voice',        label: 'Voice pipeline' },
          { value: 'inference',    label: 'Inference' },
          { value: 'sandbox',      label: 'Sandbox runtime' },
        ],
      },
    },
  ],
  'rozcar': [
    { name: 'KYC Status',  key: 'kyc_status',  fieldType: CustomFieldType.SELECT,
      config: {
        options: [
          { value: 'pending',  label: 'Pending',  color: '#f59e0b' },
          { value: 'verified', label: 'Verified', color: '#10b981' },
          { value: 'failed',   label: 'Failed',   color: '#ef4444' },
          { value: 'expired',  label: 'Expired',  color: '#6b7280' },
        ],
      },
    },
    { name: 'Affected Route', key: 'route',      fieldType: CustomFieldType.TEXT,
      hint: 'e.g. Mumbai → Pune' },
  ],
  'manacalendar': [
    { name: 'Tithi',         key: 'tithi',         fieldType: CustomFieldType.TEXT,
      hint: 'e.g. Krishna Paksha Trayodashi' },
    { name: 'Samvatsaram',   key: 'samvatsaram',   fieldType: CustomFieldType.TEXT,
      hint: 'e.g. Plava' },
  ],
  'dhandhaphone': [
    { name: 'Affected Locale', key: 'locale', fieldType: CustomFieldType.SELECT,
      config: {
        options: [
          { value: 'hi-IN', label: 'Hindi (India)' },
          { value: 'en-IN', label: 'English (India)' },
          { value: 'ta-IN', label: 'Tamil' },
          { value: 'te-IN', label: 'Telugu' },
          { value: 'mr-IN', label: 'Marathi' },
        ],
      },
    },
  ],
  'hpcl-analytics': [
    { name: 'Vehicle Class', key: 'vehicle_class', fieldType: CustomFieldType.SELECT,
      config: {
        options: [
          { value: 'truck',  label: 'Truck' },
          { value: 'bowser', label: 'Tank bowser' },
          { value: 'sedan',  label: 'Sedan' },
          { value: 'two_wheeler', label: 'Two-wheeler' },
        ],
      },
    },
  ],
  'bountipos': [
    { name: 'GST Type', key: 'gst_type', fieldType: CustomFieldType.SELECT,
      config: {
        options: [
          { value: 'cgst_sgst', label: 'CGST + SGST (intra-state)' },
          { value: 'igst',      label: 'IGST (inter-state)' },
          { value: 'exempt',    label: 'Exempt' },
        ],
      },
    },
  ],
};

async function main() {
  console.log('🌱 Custom field demo seed — adding per-product field definitions…\n');
  let added = 0, skipped = 0;

  for (const [slug, fields] of Object.entries(PER_PRODUCT)) {
    const project = await prisma.project.findUnique({ where: { slug } });
    if (!project) {
      console.log(`  ⚠️  ${slug}: project not found, skipping.`);
      continue;
    }
    let order = 0;
    for (const spec of fields) {
      const exists = await prisma.customFieldDefinition.findUnique({
        where: { projectId_key: { projectId: project.id, key: spec.key } },
      });
      if (exists) {
        skipped++;
        continue;
      }
      await prisma.customFieldDefinition.create({
        data: {
          projectId: project.id,
          name: spec.name,
          key: spec.key,
          fieldType: spec.fieldType,
          config: (spec.config ?? {}) as any,
          required: spec.required ?? false,
          order: order++,
          hint: spec.hint ?? null,
        },
      });
      added++;
    }
    console.log(`  ✅ ${project.name}: defined ${fields.length} field${fields.length === 1 ? '' : 's'}`);
  }

  console.log(`\n🎉 Done — added ${added}, skipped ${skipped} existing.\n`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
