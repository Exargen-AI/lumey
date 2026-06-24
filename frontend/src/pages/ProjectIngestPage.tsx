import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, FileText, Upload, Sparkles, AlertCircle, CheckCircle2,
  Loader2, Layers, FolderTree, ListChecks, Calendar, AlertTriangle, Brain,
} from 'lucide-react';
import { useProject } from '@/hooks/useProjects';
import { useAuthStore } from '@/stores/authStore';
import { Button, Badge } from '@/components/ui';
import { cn } from '@/lib/cn';
import { getProjectRoute, PRIORITY_COLORS } from '@/lib/constants';
import { parsePlan, commitPlan, getSmartParseStatus, type ParsedPlan, type ParsedEpic, type ParsedSprint, type ParsedTask, type IngestionReport, type ParseMode, type ParsePlanMeta } from '@/api/projectIngestion';
import { INGESTION_TEMPLATES, materializeTemplate } from '@/lib/ingestionTemplates';

/**
 * Project plan ingestion — paste / upload / pick a template, preview the
 * parsed tree, then atomic-commit.
 *
 * Three-step flow:
 *   1. Source     — text area + file upload + template picker
 *   2. Preview    — parsed tree with totals + warnings; user can go back
 *   3. Done       — IngestionReport with counts, link back to the board
 *
 * Rationale for the split: posting markdown to the server, getting a
 * structured tree back, and committing only after the user reviews
 * means accidental imports never land in the DB. The architecture also
 * lets a future "Smart Parse" (LLM) replace step 1 without touching
 * step 2 or 3.
 *
 * Spec: see docs/INGESTION_SPEC.md.
 */

type Phase = 'source' | 'preview' | 'done';

export function ProjectIngestPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);
  const { data: project } = useProject(projectId || '');

  const [phase, setPhase] = useState<Phase>('source');
  const [markdown, setMarkdown] = useState('');
  const [parsed, setParsed] = useState<ParsedPlan | null>(null);
  const [parseMeta, setParseMeta] = useState<ParsePlanMeta | null>(null);
  const [parseMode, setParseMode] = useState<ParseMode>('regex');
  const [updateMeta, setUpdateMeta] = useState(false);
  const [report, setReport] = useState<IngestionReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Server tells us whether Smart Parse is wired up (AI_API_KEY set,
  // feature flag on). If not, we hide the toggle entirely — better than
  // letting users click and get a confusing "AI not configured" error.
  const { data: smartParseStatus } = useQuery({
    queryKey: ['smart-parse-status'],
    queryFn: getSmartParseStatus,
    staleTime: 5 * 60 * 1000,
  });

  // ─── Mutations (declared before the early-return per Rules of Hooks) ─────
  // Empty-string fallback avoids the conditional-hook lint error. The
  // mutationFns aren't invoked until the form is submitted, which only
  // happens after the page renders past the projectId guard below.
  const safeProjectId = projectId ?? '';
  const parseMut = useMutation({
    mutationFn: () => parsePlan(safeProjectId, markdown, parseMode),
    onSuccess: ({ plan, meta }) => { setParsed(plan); setParseMeta(meta); setPhase('preview'); setError(null); },
    onError: (err: any) => setError(err?.response?.data?.error?.message || 'Failed to parse plan'),
  });
  const commitMut = useMutation({
    mutationFn: () => parsed ? commitPlan(safeProjectId, parsed, updateMeta) : Promise.reject(new Error('no plan')),
    onSuccess: (data) => { setReport(data); setPhase('done'); setError(null); },
    onError: (err: any) => setError(err?.response?.data?.error?.message || 'Failed to commit plan'),
  });

  if (!projectId) return <div className="text-center py-12 text-gray-500">Invalid URL.</div>;
  const backToBoard = () => navigate(getProjectRoute(user?.role || 'ADMIN', projectId, permissions));

  // ─── File upload handler ────────────────────────────────────────────────
  const handleFile = (file: File) => {
    if (!file.name.match(/\.(md|markdown|txt)$/i)) {
      setError('Please upload a .md / .markdown / .txt file.');
      return;
    }
    if (file.size > 500_000) {
      setError(`File is ${(file.size / 1024).toFixed(0)} KB — max 500 KB. Split into multiple imports.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setMarkdown(String(reader.result || ''));
      setError(null);
    };
    reader.readAsText(file);
  };

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Breadcrumb / back */}
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-obsidian-muted">
        <button onClick={backToBoard} className="inline-flex items-center gap-1.5 hover:text-brand-600 dark:hover:text-brand-400">
          <ArrowLeft size={14} /> Back to {project?.name || 'project'}
        </button>
      </div>

      <div className="flex items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-brand-500/10 dark:bg-brand-500/15 ring-1 ring-brand-500/20 flex items-center justify-center">
            <FolderTree size={18} className="text-brand-600 dark:text-brand-400" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">Ingest plan</h1>
            <p className="text-xs text-gray-500 dark:text-obsidian-muted mt-0.5">
              Turn an implementation plan into Epics → Sprints → Tasks. Re-imports are idempotent.
            </p>
          </div>
        </div>
      </div>

      {/* Phase indicator */}
      <PhasePills phase={phase} />

      {/* Source phase */}
      {phase === 'source' && (
        <SourcePanel
          markdown={markdown}
          onMarkdownChange={setMarkdown}
          onFileChosen={handleFile}
          fileInputRef={fileInputRef}
          onParseClick={() => parseMut.mutate()}
          isParsing={parseMut.isPending}
          error={error}
          parseMode={parseMode}
          onParseModeChange={setParseMode}
          smartParseEnabled={smartParseStatus?.enabled ?? false}
          smartParseModel={smartParseStatus?.model}
        />
      )}

      {/* Preview phase */}
      {phase === 'preview' && parsed && (
        <PreviewPanel
          plan={parsed}
          onPlanChange={setParsed}
          updateMeta={updateMeta}
          onUpdateMetaChange={setUpdateMeta}
          onBack={() => setPhase('source')}
          onCommit={() => commitMut.mutate()}
          isCommitting={commitMut.isPending}
          error={error}
          parseMeta={parseMeta}
        />
      )}

      {/* Done phase */}
      {phase === 'done' && report && (
        <DonePanel
          report={report}
          onBackToBoard={backToBoard}
          onIngestAnother={() => {
            setReport(null); setParsed(null); setMarkdown(''); setPhase('source'); setError(null);
          }}
        />
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Source phase
// ───────────────────────────────────────────────────────────────────────────

function SourcePanel({
  markdown, onMarkdownChange, onFileChosen, fileInputRef, onParseClick, isParsing, error,
  parseMode, onParseModeChange, smartParseEnabled, smartParseModel,
}: {
  markdown: string;
  onMarkdownChange: (v: string) => void;
  onFileChosen: (f: File) => void;
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  onParseClick: () => void;
  isParsing: boolean;
  error: string | null;
  parseMode: ParseMode;
  onParseModeChange: (m: ParseMode) => void;
  smartParseEnabled: boolean;
  smartParseModel?: string;
}) {
  return (
    <div className="space-y-4">
      {/* Parse-mode picker — only shown when server has Smart Parse wired
          up. Default stays on Regex so the free deterministic path is
          one click away; AI is opt-in per parse. */}
      {smartParseEnabled && (
        <div
          role="radiogroup"
          aria-label="Choose how to parse the plan"
          className="grid grid-cols-1 sm:grid-cols-2 gap-2"
        >
          <ParseModeCard
            selected={parseMode === 'regex'}
            onSelect={() => onParseModeChange('regex')}
            title="Standard parser"
            tagline="Free, deterministic, instant"
            description="Recognises a documented grammar (Epic / Sprint / Task headings, tables, **Tags**). Best for plans that already follow the template."
            icon={<Sparkles size={16} />}
          />
          <ParseModeCard
            selected={parseMode === 'llm'}
            onSelect={() => onParseModeChange('llm')}
            title="Smart Parse (AI)"
            tagline={smartParseModel ? `${smartParseModel} · ~5–15s · ~$0.005/plan` : 'AI-assisted · ~5–15s'}
            description="Pass the markdown to an LLM that adapts to any layout — paste a Notion doc, ChatGPT export, or your own freeform plan. Best when the standard parser drops fields."
            icon={<Brain size={16} />}
            accent
          />
        </div>
      )}

      {/* Action row */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          leadingIcon={<Upload size={14} />}
          onClick={() => fileInputRef.current?.click()}
        >
          Upload .md file
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFileChosen(f);
            e.target.value = '';
          }}
        />
        <span className="text-[11px] text-gray-400 dark:text-obsidian-faded">or pick a starter template:</span>
        {INGESTION_TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onMarkdownChange(materializeTemplate(t.markdown))}
            className="text-[12px] px-2.5 py-1 rounded-md border border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-panel hover:border-brand-300 hover:text-brand-700 dark:hover:border-brand-500/40 dark:hover:text-brand-300 transition-colors"
            title={t.description}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Editor */}
      <div className="rounded-xl border border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-panel overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-obsidian-border bg-gray-50 dark:bg-obsidian-sunken/40">
          <div className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-obsidian-muted">
            <FileText size={12} />
            <span>Markdown plan</span>
            <span className="text-gray-300 dark:text-obsidian-faded">·</span>
            {/* Show chars / max so users see they're approaching the cap
                BEFORE submitting. Server enforces 500 KB; we surface
                500_000 chars as the cap (same number, since markdown
                is single-byte ASCII for the most part). QA I-M6. */}
            <span className={cn(
              'font-mono tabular-nums',
              markdown.length > 450_000 && 'text-amber-600 dark:text-amber-400 font-semibold',
              markdown.length > 500_000 && 'text-rose-600 dark:text-rose-400',
            )}>
              {markdown.length.toLocaleString()} / 500,000 chars
            </span>
          </div>
        </div>
        <textarea
          value={markdown}
          onChange={(e) => onMarkdownChange(e.target.value)}
          rows={22}
          spellCheck={false}
          // Hard cap matches the parser's 500 KB DoS guard. Browsers
          // respect maxLength on paste too — pasting a 5 MB blob now
          // truncates client-side instead of hanging the textarea +
          // round-tripping a 400 from the server.
          maxLength={500_000}
          placeholder={`# Project: <name>\n> Short description.\n\n## Epic: <title>\n> Why this epic exists.\n\n### Sprint: Sprint 1 (2026-05-13 → 2026-05-26)\n> Goal: ...\n\n#### Task: <title>\n**Priority:** P0\n**Points:** 5\n**Assignee:** <name>\n\n**Description:**\n...\n\n**Acceptance Criteria:**\n- [ ] criterion 1`}
          className="w-full block font-mono text-[12.5px] leading-relaxed px-3 py-3 bg-transparent text-gray-900 dark:text-obsidian-fg focus:outline-none resize-y"
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs bg-rose-50 border border-rose-200 text-rose-700 dark:bg-rose-500/[0.08] dark:border-rose-500/30 dark:text-rose-300">
          <AlertCircle size={14} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {/* Parse CTA */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] text-gray-500 dark:text-obsidian-muted">
          Parsing only previews the structure — nothing is written to the database until you click <strong>Import</strong> on the next step.
        </p>
        <Button
          variant="primary"
          size="sm"
          leadingIcon={
            isParsing
              ? <Loader2 size={14} className="animate-spin" />
              : parseMode === 'llm' ? <Brain size={14} /> : <Sparkles size={14} />
          }
          onClick={onParseClick}
          disabled={isParsing || !markdown.trim()}
        >
          {isParsing
            ? (parseMode === 'llm' ? 'Smart parsing…' : 'Parsing…')
            : (parseMode === 'llm' ? 'Smart Parse →' : 'Parse plan →')}
        </Button>
      </div>
    </div>
  );
}

function ParseModeCard({
  selected, onSelect, title, tagline, description, icon, accent,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  tagline: string;
  description: string;
  icon: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'text-left rounded-xl border p-3 transition-colors',
        selected
          ? accent
            ? 'border-violet-400 bg-violet-50/60 ring-1 ring-violet-300 dark:border-violet-400/60 dark:bg-violet-500/[0.08] dark:ring-violet-500/30'
            : 'border-brand-400 bg-brand-50/60 ring-1 ring-brand-300 dark:border-brand-400/60 dark:bg-brand-500/[0.08] dark:ring-brand-500/30'
          : 'border-gray-200 bg-white hover:border-gray-300 dark:border-obsidian-border dark:bg-obsidian-panel dark:hover:border-obsidian-faded',
      )}
    >
      <div className="flex items-center gap-2 mb-1">
        <span
          className={cn(
            'inline-flex items-center justify-center w-6 h-6 rounded-md',
            selected
              ? accent
                ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300'
                : 'bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
              : 'bg-gray-100 text-gray-500 dark:bg-obsidian-sunken dark:text-obsidian-muted',
          )}
        >
          {icon}
        </span>
        <div className="font-medium text-[13px] text-gray-900 dark:text-obsidian-fg">{title}</div>
        <span className="ml-auto text-[10.5px] text-gray-400 dark:text-obsidian-faded">{tagline}</span>
      </div>
      <p className="text-[11.5px] leading-relaxed text-gray-500 dark:text-obsidian-muted">
        {description}
      </p>
    </button>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Preview phase
// ───────────────────────────────────────────────────────────────────────────

function PreviewPanel({
  plan, onPlanChange, updateMeta, onUpdateMetaChange, onBack, onCommit, isCommitting, error, parseMeta,
}: {
  plan: ParsedPlan;
  onPlanChange: (p: ParsedPlan) => void;
  updateMeta: boolean;
  onUpdateMetaChange: (v: boolean) => void;
  onBack: () => void;
  onCommit: () => void;
  isCommitting: boolean;
  error: string | null;
  parseMeta: ParsePlanMeta | null;
}) {
  // ─── Aggregate counts ───
  const totalEpics = plan.epics.length;
  const totalSprints = plan.epics.reduce((n, e) => n + e.sprints.length, 0);
  const totalTasks = plan.epics.reduce(
    (n, e) => n + e.backlogTasks.length + e.sprints.reduce((m, s) => m + s.tasks.length, 0),
    0,
  ) + plan.rootBacklogTasks.length;
  const totalPoints = plan.epics.reduce(
    (n, e) => n
      + e.backlogTasks.reduce((m, t) => m + (t.storyPoints ?? 0), 0)
      + e.sprints.reduce((m, s) => m + s.tasks.reduce((k, t) => k + (t.storyPoints ?? 0), 0), 0),
    0,
  ) + plan.rootBacklogTasks.reduce((n, t) => n + (t.storyPoints ?? 0), 0);

  return (
    <div className="space-y-5">
      {/* Parse-meta badge — only shows for Smart Parse, with model + cost.
          Regex parsing is free + instant so a meta strip would be noise. */}
      {parseMeta?.mode === 'llm' && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] rounded-lg px-3 py-2 bg-violet-50 border border-violet-200 text-violet-800 dark:bg-violet-500/[0.08] dark:border-violet-500/30 dark:text-violet-200">
          <Brain size={13} className="shrink-0" />
          <span><strong>Smart Parse</strong>{parseMeta.model ? ` (${parseMeta.model})` : ''}</span>
          {typeof parseMeta.durationMs === 'number' && (
            <>
              <span className="opacity-50">·</span>
              <span>{(parseMeta.durationMs / 1000).toFixed(1)}s</span>
            </>
          )}
          {parseMeta.usage && (
            <>
              <span className="opacity-50">·</span>
              <span className="tabular-nums">
                {parseMeta.usage.inputTokens.toLocaleString()} in / {parseMeta.usage.outputTokens.toLocaleString()} out
              </span>
              {parseMeta.usage.cacheReadInputTokens > 0 && (
                <span className="opacity-70">
                  ({parseMeta.usage.cacheReadInputTokens.toLocaleString()} cached)
                </span>
              )}
              {parseMeta.usage.estimatedCostUsd > 0 && (
                <>
                  <span className="opacity-50">·</span>
                  <span>~${parseMeta.usage.estimatedCostUsd.toFixed(4)}</span>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Stat strip */}
      <div className="grid grid-cols-4 gap-3">
        <Stat icon={<Layers size={14} />} label="Epics" value={totalEpics} />
        <Stat icon={<Calendar size={14} />} label="Sprints" value={totalSprints} />
        <Stat icon={<ListChecks size={14} />} label="Tasks" value={totalTasks} />
        <Stat icon={<Sparkles size={14} />} label="Story points" value={totalPoints} />
      </div>

      {/* Project meta toggle */}
      {(plan.projectName || plan.projectDescription) && (
        <label className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-md bg-brand-50 dark:bg-brand-500/[0.08] border border-brand-200 dark:border-brand-500/30 cursor-pointer">
          <input
            type="checkbox"
            checked={updateMeta}
            onChange={(e) => onUpdateMetaChange(e.target.checked)}
            className="w-4 h-4 mt-0.5 rounded text-brand-600 accent-brand-600"
          />
          <span className="text-[12.5px] text-gray-700 dark:text-obsidian-fg">
            Also update the project's name and description from the plan
            {plan.projectName && <> (<code className="text-[11px] bg-white dark:bg-obsidian-bg px-1 rounded">{plan.projectName}</code>)</>}.
          </span>
        </label>
      )}

      {/* Warnings */}
      {plan.warnings.length > 0 && (
        <details className="rounded-md border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/[0.08]">
          <summary className="cursor-pointer px-3.5 py-2.5 text-[12.5px] text-amber-800 dark:text-amber-300 font-medium inline-flex items-center gap-2">
            <AlertTriangle size={13} /> {plan.warnings.length} warning{plan.warnings.length === 1 ? '' : 's'} from parser
          </summary>
          <ul className="px-5 pb-3 text-[12px] text-amber-700 dark:text-amber-400 list-disc space-y-0.5">
            {plan.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </details>
      )}

      {/* Tree preview */}
      <div className="space-y-4">
        {plan.epics.map((epic, ei) => (
          <EpicCard
            key={epic.hash}
            epic={epic}
            onChangeEpic={(next) => {
              const epics = [...plan.epics];
              epics[ei] = next;
              onPlanChange({ ...plan, epics });
            }}
          />
        ))}
        {plan.rootBacklogTasks.length > 0 && (
          <div className="rounded-xl border-2 border-dashed border-gray-200 dark:border-obsidian-border p-4">
            <div className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-obsidian-muted mb-2">
              Root backlog · no epic, no sprint
            </div>
            <ul className="space-y-1.5">
              {plan.rootBacklogTasks.map((t) => <TaskRow key={t.hash} task={t} />)}
            </ul>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs bg-rose-50 border border-rose-200 text-rose-700 dark:bg-rose-500/[0.08] dark:border-rose-500/30 dark:text-rose-300">
          <AlertCircle size={14} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {/* Commit row */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <Button variant="ghost" size="sm" leadingIcon={<ArrowLeft size={14} />} onClick={onBack}>
          Back to source
        </Button>
        <Button
          variant="primary"
          size="sm"
          leadingIcon={isCommitting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
          onClick={onCommit}
          disabled={isCommitting || (totalEpics === 0 && totalTasks === 0)}
        >
          {isCommitting ? 'Importing…' : `Import ${totalEpics} epic${totalEpics === 1 ? '' : 's'} · ${totalSprints} sprint${totalSprints === 1 ? '' : 's'} · ${totalTasks} task${totalTasks === 1 ? '' : 's'}`}
        </Button>
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-panel px-3.5 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-obsidian-muted flex items-center gap-1.5">
        {icon}{label}
      </div>
      <div className="text-xl font-semibold tabular-nums text-gray-900 dark:text-obsidian-fg mt-0.5">{value}</div>
    </div>
  );
}

function EpicCard({ epic }: { epic: ParsedEpic; onChangeEpic: (next: ParsedEpic) => void }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-panel overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-obsidian-border/60">
        <span
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: epic.color || '#6366f1' }}
          aria-hidden
        />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-gray-900 dark:text-obsidian-fg">{epic.title}</div>
          {epic.description && (
            <p className="text-[11px] text-gray-500 dark:text-obsidian-muted mt-0.5 line-clamp-2">{epic.description}</p>
          )}
        </div>
        <div className="text-[11px] text-gray-400 dark:text-obsidian-faded">
          {epic.sprints.length} sprint{epic.sprints.length === 1 ? '' : 's'} ·{' '}
          {epic.sprints.reduce((n, s) => n + s.tasks.length, 0) + epic.backlogTasks.length} task{(epic.sprints.reduce((n, s) => n + s.tasks.length, 0) + epic.backlogTasks.length) === 1 ? '' : 's'}
        </div>
      </div>

      <div className="p-3 space-y-3">
        {epic.sprints.map((sprint) => (
          <SprintBlock key={sprint.hash} sprint={sprint} />
        ))}
        {epic.backlogTasks.length > 0 && (
          <div className="rounded-lg border-2 border-dashed border-gray-200 dark:border-obsidian-border p-3">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-obsidian-muted mb-1.5">Epic backlog</div>
            <ul className="space-y-1.5">
              {epic.backlogTasks.map((t) => <TaskRow key={t.hash} task={t} />)}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function SprintBlock({ sprint }: { sprint: ParsedSprint }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-obsidian-border bg-gray-50/40 dark:bg-obsidian-bg/40 p-3">
      <div className="flex items-baseline gap-3 mb-2">
        <span className="text-[12px] font-medium text-gray-900 dark:text-obsidian-fg">{sprint.name}</span>
        <span className="text-[11px] text-gray-500 dark:text-obsidian-muted">
          {sprint.startDate} → {sprint.endDate}
        </span>
        {sprint.goal && (
          <span className="text-[11px] text-gray-400 dark:text-obsidian-faded italic line-clamp-1 ml-auto max-w-md">"{sprint.goal}"</span>
        )}
      </div>
      <ul className="space-y-1.5">
        {sprint.tasks.map((t) => <TaskRow key={t.hash} task={t} />)}
        {sprint.tasks.length === 0 && (
          <li className="text-[11px] text-gray-400 dark:text-obsidian-faded italic px-2">No tasks in this sprint.</li>
        )}
      </ul>
    </div>
  );
}

function TaskRow({ task }: { task: ParsedTask }) {
  const priorityColor = PRIORITY_COLORS[task.priority] || '#6b7280';
  return (
    <li className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-gray-100/60 dark:hover:bg-obsidian-raised/40">
      <span
        className="mt-1 px-1 text-[9px] font-bold rounded shrink-0"
        style={{ backgroundColor: priorityColor + '15', color: priorityColor }}
      >
        {task.priority}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] text-gray-900 dark:text-obsidian-fg">{task.title}</div>
        <div className="flex items-center gap-2 flex-wrap mt-0.5 text-[10px] text-gray-400 dark:text-obsidian-faded">
          {task.taskType !== 'FEATURE' && <Badge tone="neutral">{task.taskType}</Badge>}
          {task.storyPoints != null && <span>{task.storyPoints}pt</span>}
          {task.assigneeName && <span>· {task.assigneeName}</span>}
          {task.dueDate && <span>· due {task.dueDate}</span>}
          {task.acceptanceCriteria.length > 0 && <span>· {task.acceptanceCriteria.length} AC</span>}
          {task.subtasks.length > 0 && <span>· {task.subtasks.length} sub</span>}
          {task.labels.length > 0 && <span>· {task.labels.join(', ')}</span>}
        </div>
      </div>
    </li>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Done phase
// ───────────────────────────────────────────────────────────────────────────

function DonePanel({
  report, onBackToBoard, onIngestAnother,
}: {
  report: IngestionReport;
  onBackToBoard: () => void;
  onIngestAnother: () => void;
}) {
  const skippedTotal = report.skippedExisting.epics + report.skippedExisting.sprints + report.skippedExisting.tasks;
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/[0.08] p-5">
        <div className="flex items-center gap-3 mb-3">
          <CheckCircle2 size={22} className="text-emerald-600 dark:text-emerald-400" />
          <h2 className="text-base font-semibold text-emerald-900 dark:text-emerald-200">Plan imported.</h2>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Stat icon={<Layers size={14} />} label="Epics created" value={report.created.epics} />
          <Stat icon={<Calendar size={14} />} label="Sprints created" value={report.created.sprints} />
          <Stat icon={<ListChecks size={14} />} label="Tasks created" value={report.created.tasks} />
        </div>
        {skippedTotal > 0 && (
          <p className="mt-3 text-[12px] text-emerald-800 dark:text-emerald-300">
            <strong>{skippedTotal}</strong> existing item{skippedTotal === 1 ? '' : 's'} skipped (idempotent re-import).
          </p>
        )}
      </div>

      {report.warnings.length > 0 && (
        <details className="rounded-md border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/[0.08]">
          <summary className="cursor-pointer px-3.5 py-2.5 text-[12.5px] text-amber-800 dark:text-amber-300 font-medium inline-flex items-center gap-2">
            <AlertTriangle size={13} /> {report.warnings.length} warning{report.warnings.length === 1 ? '' : 's'}
          </summary>
          <ul className="px-5 pb-3 text-[12px] text-amber-700 dark:text-amber-400 list-disc space-y-0.5">
            {report.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </details>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onIngestAnother}>Ingest another</Button>
        <Button variant="primary" size="sm" onClick={onBackToBoard}>Back to board</Button>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Phase pills
// ───────────────────────────────────────────────────────────────────────────

function PhasePills({ phase }: { phase: Phase }) {
  const order: Phase[] = ['source', 'preview', 'done'];
  const labels: Record<Phase, string> = { source: 'Source', preview: 'Preview', done: 'Done' };
  return (
    <div className="flex items-center gap-2 text-[11px]">
      {order.map((p, i) => (
        <div key={p} className="flex items-center gap-2">
          <span className={cn(
            'inline-flex items-center justify-center w-6 h-6 rounded-full font-semibold',
            p === phase
              ? 'bg-brand-600 text-white'
              : order.indexOf(phase) > i
                ? 'bg-emerald-500 text-white'
                : 'bg-gray-200 text-gray-500 dark:bg-obsidian-raised dark:text-obsidian-muted',
          )}>
            {order.indexOf(phase) > i ? '✓' : i + 1}
          </span>
          <span className={cn(
            'font-medium uppercase tracking-wider',
            p === phase ? 'text-gray-900 dark:text-obsidian-fg' : 'text-gray-400 dark:text-obsidian-faded',
          )}>{labels[p]}</span>
          {i < order.length - 1 && <span className="text-gray-300 dark:text-obsidian-faded">›</span>}
        </div>
      ))}
    </div>
  );
}
