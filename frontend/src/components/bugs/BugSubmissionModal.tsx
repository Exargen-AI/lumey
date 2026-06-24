import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Bug as BugIcon, CheckCircle2, Loader2 } from 'lucide-react';
import { Modal, Field, Input, Textarea, Select, Button } from '@/components/ui';
import { useAuthStore } from '@/stores/authStore';
import { useCreateTask } from '@/hooks/useTasks';
import { useProducts } from '@/hooks/useProducts';
import { cn } from '@/lib/cn';
import { useNavigate } from 'react-router-dom';

/**
 * Structured bug submission modal. Replaces the "open the task form and
 * fill out an unstructured description" anti-pattern with a guided form
 * that captures the four things every actionable bug report needs:
 *   - Title
 *   - Steps to reproduce (what were you doing?)
 *   - Expected behaviour
 *   - Actual behaviour
 *
 * Plus optional severity + product + affected URL. The output is a
 * regular Task with `taskType=BUG` and a markdown-templated description
 * — so the task itself stays editable later by anyone with the right
 * permission. Severity maps 1:1 to priority (P0 critical → P3 low).
 *
 * Behaviour by role:
 *   - CLIENT: `clientRequested=true` + `clientVisible=true` are forced
 *     by the server's safe-shape rewriter — the team triages from
 *     BACKLOG. Auto-derived; the form doesn't ask.
 *   - everyone else: clientRequested left false; clientVisible defaults
 *     to true (so the client can see the bug their team is working on)
 *     but is a toggle.
 *
 * Defaults:
 *   - `defaultProductId` pre-selects (and optionally locks) the product
 *     dropdown. Used when opening the modal from a product detail page.
 */

interface BugSubmissionModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  defaultProductId?: string | null;
  /** When true, the product dropdown is hidden — the caller already
   *  scoped it. Used by the product detail page. */
  lockProduct?: boolean;
}

const SEVERITIES = [
  { value: 'P0', label: 'P0 — Critical', hint: 'Blocking production for many users; data loss or security' },
  { value: 'P1', label: 'P1 — High',     hint: 'Major feature broken; common workflow impaired' },
  { value: 'P2', label: 'P2 — Medium',   hint: 'Notable issue; workaround available' },
  { value: 'P3', label: 'P3 — Low',      hint: 'Cosmetic, edge-case, or nice-to-have fix' },
];

export function BugSubmissionModal({
  open, onClose, projectId, defaultProductId, lockProduct,
}: BugSubmissionModalProps) {
  const userRole = useAuthStore((s) => s.user?.role ?? null);
  const isClient = userRole === 'CLIENT';
  const createTask = useCreateTask(projectId);
  const navigate = useNavigate();

  // Only fetch products if we actually need to render the dropdown.
  // ACTIVE + PAUSED only — archived products shouldn't accept new bugs.
  const { data: products } = useProducts(projectId, { includeArchived: false });

  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState<'P0' | 'P1' | 'P2' | 'P3'>('P2');
  const [productId, setProductId] = useState<string | ''>(defaultProductId ?? '');
  const [reproSteps, setReproSteps] = useState('');
  const [expected, setExpected] = useState('');
  const [actual, setActual] = useState('');
  const [affected, setAffected] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);

  // Reset on open. The form's defaults flip in if `defaultProductId`
  // changes between opens (e.g. user navigates from one product to
  // another and clicks Submit a bug on each).
  useEffect(() => {
    if (!open) return;
    setTitle('');
    setSeverity('P2');
    setProductId(defaultProductId ?? '');
    setReproSteps('');
    setExpected('');
    setActual('');
    setAffected('');
    setError(null);
    setSuccessId(null);
  }, [open, defaultProductId]);

  const valid = useMemo(() => {
    return title.trim().length > 0
      && reproSteps.trim().length > 0
      && (expected.trim().length > 0 || actual.trim().length > 0);
  }, [title, reproSteps, expected, actual]);

  const submit = async () => {
    if (!valid) return;
    setError(null);

    // Compose a structured markdown description. Anyone editing the
    // task later can rewrite freely — this is a friendly starting
    // shape, not an enforced schema.
    const lines: string[] = [];
    if (reproSteps.trim()) {
      lines.push('## What I was doing', reproSteps.trim(), '');
    }
    if (expected.trim()) {
      lines.push('## What I expected', expected.trim(), '');
    }
    if (actual.trim()) {
      lines.push('## What actually happened', actual.trim(), '');
    }
    if (affected.trim()) {
      lines.push('## Affected', affected.trim(), '');
    }
    const description = lines.join('\n').trim();

    try {
      const task: any = await createTask.mutateAsync({
        title: title.trim(),
        description,
        taskType: 'BUG',
        priority: severity,
        // Status forced server-side for clients (BACKLOG). Internal users
        // also start at BACKLOG so triage happens consistently.
        status: 'BACKLOG',
        productId: productId || null,
        // Bugs are visible to clients by default — the team can flip
        // this later if a bug really must stay internal.
        clientVisible: true,
        // Server's safe-shape rewriter forces this true for client
        // actors regardless of what we send.
        clientRequested: isClient,
      });
      setSuccessId(task?.id ?? 'submitted');
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || 'Could not submit the bug. Try again?');
    }
  };

  const pending = createTask.isPending;

  // Success state — same modal, different body. Closing returns the
  // user where they came from. Internal users get a "view it" CTA; for
  // clients we keep the language gentle.
  if (successId) {
    const internalLink = `/projects/${projectId}/tasks/${successId}`;
    const clientLink = `/client/projects/${projectId}/tasks/${successId}`;
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Bug submitted"
        subtitle="The team has it. You'll see updates on the task as triage happens."
        size="md"
        accent="brand"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>Close</Button>
            <Button
              variant="primary"
              onClick={() => {
                onClose();
                navigate(isClient ? clientLink : internalLink);
              }}
            >
              View the bug
            </Button>
          </>
        }
      >
        <div className="flex items-start gap-3 py-3">
          <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center shrink-0">
            <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <p className="text-[14px] font-semibold text-gray-900 dark:text-obsidian-fg">
              Your bug report landed in the team's backlog.
            </p>
            <p className="text-[12.5px] text-gray-500 dark:text-obsidian-muted mt-1 leading-relaxed">
              It'll appear with a <span className="inline-flex items-center gap-1 px-1 py-0.5 rounded bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 text-[10px] font-semibold"><BugIcon size={9} /> Bug</span> badge and a <span className="text-[10px] font-semibold uppercase tracking-wider">{severity}</span> severity. The team will follow up on the task.
            </p>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={() => { if (!pending) onClose(); }}
      title="Submit a bug"
      subtitle="Give the team enough to reproduce — even a one-line repro plus a screenshot link helps."
      size="lg"
      accent="brand"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!valid || pending}>
            {pending && <Loader2 size={13} className="animate-spin mr-1.5" />}
            <BugIcon size={13} /> Submit bug
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Title">
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="One line — what went wrong?"
            maxLength={200}
          />
        </Field>

        {/* Severity + Product — side-by-side on tablets and up, stacked
            on phones so labels + select chrome don't squeeze each other.
            The Expected/Actual row below uses the same pattern. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Severity" hint={SEVERITIES.find((s) => s.value === severity)?.hint}>
            <Select value={severity} onChange={(e) => setSeverity(e.target.value as any)}>
              {SEVERITIES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </Select>
          </Field>
          {!lockProduct && (
            <Field label="Product" hint="Optional — which shipping unit is affected?">
              <Select
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
              >
                <option value="">No specific product</option>
                {(products ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            </Field>
          )}
        </div>

        <Field
          label="What were you doing?"
          hint="The steps that led to the bug. Even a single line helps — 'Logged in on iPhone Safari' is enough."
        >
          <Textarea
            value={reproSteps}
            onChange={(e) => setReproSteps(e.target.value)}
            rows={3}
            maxLength={5_000}
            placeholder="1. Opened the Documents tab&#10;2. Clicked Upload&#10;3. Picked a PDF over 5 MB"
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="What did you expect?" hint="The behaviour you were aiming for.">
            <Textarea
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
              rows={3}
              maxLength={5_000}
              placeholder="The upload starts and a progress bar shows."
            />
          </Field>
          <Field label="What actually happened?" hint="The behaviour you got instead.">
            <Textarea
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              rows={3}
              maxLength={5_000}
              placeholder="The page froze and the button stayed disabled."
            />
          </Field>
        </div>

        <Field
          label="Affected URL or screen"
          hint="Optional — where on the platform did this happen?"
        >
          <Input
            value={affected}
            onChange={(e) => setAffected(e.target.value)}
            placeholder="e.g. /client/projects/abc/documents"
            maxLength={500}
          />
        </Field>

        {error && (
          <div className={cn(
            'flex items-start gap-2 text-[12px] rounded-md p-2.5',
            'bg-rose-50 text-rose-700 border border-rose-200',
            'dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30',
          )}>
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <p className="text-[11px] text-gray-400 dark:text-obsidian-faded">
          {valid
            ? 'Looks good — submit drops this into the team\'s backlog.'
            : 'A title, the repro steps, and either expected OR actual are required.'}
        </p>
      </div>
    </Modal>
  );
}
