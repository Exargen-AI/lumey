import { useState, useCallback, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Clock, Save, Send, RotateCcw, CheckCircle2, XCircle, AlertTriangle, Pencil, X, Plane } from 'lucide-react';
import { useWeeklyTimesheet, useLogTime, useTimesheetStatus, useSubmitTimesheet, useReopenTimesheet } from '@/hooks/useTimesheet';
import { useMyLeaves } from '@/hooks/useLeaves';
import { Button, Tooltip } from '@/components/ui';
import { cn } from '@/lib/cn';
import { toLocalDateString } from '@/lib/formatters';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function formatWeekRange(monday: Date): string {
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${monday.toLocaleDateString('en-US', opts)} – ${sunday.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`;
}

/**
 * `embedded` mode hides the page header (icon + title + subtitle) so this
 * component can be rendered as a tab inside the combined "My Time" page.
 * The week-status pill still renders in the embedded layout, but in a
 * less prominent slot.
 */
export function TimesheetPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [weekOffset, setWeekOffset] = useState(0);
  const monday = getMonday(new Date());
  monday.setDate(monday.getDate() + weekOffset * 7);
  const weekStart = toLocalDateString(monday);

  const { data, isLoading } = useWeeklyTimesheet(weekStart);
  const { data: statusData } = useTimesheetStatus(weekStart);
  const logTime = useLogTime();
  const submitTimesheet = useSubmitTimesheet();
  const reopenTimesheet = useReopenTimesheet();

  const tsStatus = statusData?.status || 'DRAFT';
  const isLocked = tsStatus === 'SUBMITTED' || tsStatus === 'APPROVED';

  // Local edit buffer — keys are `projectId:date`, values are hours.
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  const getDates = useCallback(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(d.getDate() + i);
      return toLocalDateString(d);
    });
  }, [monday.getTime()]);

  const dates = getDates();
  const isCurrentWeek = weekOffset === 0;

  // Approved-leave overlay. Builds a Set<YYYY-MM-DD> of days in this week
  // that are covered by an approved leave so each cell can render an "ON
  // LEAVE" pill instead of forcing a 0-hour entry. Team feedback #6.
  // Pulls all of the user's leaves once (cheap — bounded list) and filters
  // client-side by date overlap with the current week's dates.
  const { data: myLeaves } = useMyLeaves();
  const leaveByDate = useMemo(() => {
    const m = new Map<string, { id: string; type: string }>();
    if (!myLeaves) return m;
    const weekStartTs = new Date(`${dates[0]}T00:00:00.000Z`).getTime();
    const weekEndTs = new Date(`${dates[dates.length - 1]}T00:00:00.000Z`).getTime();
    for (const leave of myLeaves) {
      if (leave.status !== 'APPROVED') continue;
      const lStart = new Date(leave.startDate).getTime();
      const lEnd = new Date(leave.endDate).getTime();
      if (lEnd < weekStartTs || lStart > weekEndTs) continue; // disjoint
      // Mark every date in the leave that's also in this displayed week.
      for (const d of dates) {
        const ts = new Date(`${d}T00:00:00.000Z`).getTime();
        if (ts >= lStart && ts <= lEnd) m.set(d, { id: leave.id, type: leave.leaveType });
      }
    }
    return m;
  }, [myLeaves, dates]);

  const getCellKey = (projectId: string, date: string) => `${projectId}:${date}`;

  const getCellValue = (projectId: string, date: string): number => {
    const key = getCellKey(projectId, date);
    if (edits[key] !== undefined) return edits[key];
    const proj = data?.projects?.find((p: any) => p.projectId === projectId);
    return proj?.days?.[date] || 0;
  };

  const handleCellChange = (projectId: string, date: string, value: string) => {
    const num = parseFloat(value) || 0;
    const key = getCellKey(projectId, date);
    setEdits({ ...edits, [key]: Math.min(24, Math.max(0, num)) });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const promises = Object.entries(edits).map(([key, hours]) => {
        const [projectId, date] = key.split(':');
        return logTime.mutateAsync({ projectId, date, hours });
      });
      await Promise.all(promises);
      setEdits({});
    } catch {
      // Mutation surfaces its own error
    } finally {
      setSaving(false);
    }
  };

  const getDayTotal = (date: string): number => {
    if (!data?.projects) return 0;
    return data.projects.reduce((sum: number, p: any) => sum + getCellValue(p.projectId, date), 0);
  };

  const getProjectTotal = (projectId: string): number => {
    return dates.reduce((sum, date) => sum + getCellValue(projectId, date), 0);
  };

  const grandTotal = dates.reduce((sum, date) => sum + getDayTotal(date), 0);
  const hasEdits = Object.keys(edits).length > 0;
  const todayDate = toLocalDateString();

  return (
    <div className="space-y-6 pb-20">
      {/* ─── Header ─── (suppressed when embedded — parent owns it). The
          status pill always renders since the user needs to see whether
          this week is Draft / Submitted / Approved / Rejected. */}
      {!embedded ? (
        <div className="flex items-end justify-between gap-4 animate-fade-in-down">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-brand-500/10 dark:bg-brand-500/15 ring-1 ring-brand-500/20 flex items-center justify-center">
              <Clock size={18} className="text-brand-600 dark:text-brand-400" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">Timesheet</h1>
              <p className="text-[12px] text-gray-500 dark:text-obsidian-muted mt-0.5">Log your hours by project, day by day</p>
            </div>
          </div>
          <StatusPill status={tsStatus} approverName={statusData?.approver?.name} />
        </div>
      ) : (
        <div className="flex justify-end">
          <StatusPill status={tsStatus} approverName={statusData?.approver?.name} />
        </div>
      )}

      {/* ─── Rejection reason banner ─── */}
      {tsStatus === 'REJECTED' && statusData?.rejectionReason && (
        <div className={cn(
          'flex items-start gap-3 rounded-xl p-4',
          'bg-rose-50 border border-rose-200 dark:bg-rose-500/[0.06] dark:border-rose-500/30',
        )}>
          <AlertTriangle size={18} className="text-rose-500 dark:text-rose-400 mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-rose-700 dark:text-rose-300">Timesheet rejected</p>
            <p className="text-[13px] text-rose-600 dark:text-rose-400 mt-0.5 leading-relaxed">{statusData.rejectionReason}</p>
            <p className="text-[11px] text-rose-500/80 dark:text-rose-400/80 mt-1">By {statusData.approver?.name}</p>
          </div>
        </div>
      )}

      {/* ─── Week navigation ─── */}
      <div className={cn(
        'flex items-center justify-between rounded-xl p-3',
        'bg-white border border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
        'shadow-soft dark:shadow-soft-dark',
      )}>
        <Tooltip content="Previous week" side="bottom">
          <button
            onClick={() => setWeekOffset(weekOffset - 1)}
            className="w-9 h-9 inline-flex items-center justify-center rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-obsidian-muted dark:hover:text-obsidian-fg dark:hover:bg-obsidian-raised transition-colors"
            aria-label="Previous week"
          >
            <ChevronLeft size={18} />
          </button>
        </Tooltip>
        <div className="text-center">
          <p className="text-[14px] font-semibold text-gray-900 dark:text-obsidian-fg">{formatWeekRange(monday)}</p>
          {isCurrentWeek && (
            <p className="text-[10px] text-brand-600 dark:text-brand-400 font-semibold uppercase tracking-[0.1em] mt-0.5">Current week</p>
          )}
        </div>
        <Tooltip content="Next week" side="bottom">
          <button
            onClick={() => setWeekOffset(weekOffset + 1)}
            disabled={weekOffset >= 0}
            className={cn(
              'w-9 h-9 inline-flex items-center justify-center rounded-md transition-colors',
              'text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-obsidian-muted dark:hover:text-obsidian-fg dark:hover:bg-obsidian-raised',
              'disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-500',
            )}
            aria-label="Next week"
          >
            <ChevronRight size={18} />
          </button>
        </Tooltip>
      </div>

      {/* ─── Timesheet grid ─── */}
      <div className={cn(
        'rounded-2xl overflow-hidden',
        'bg-white border border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
        'shadow-soft dark:shadow-soft-dark',
      )}>
        {isLoading ? (
          <div className="p-8 space-y-3">
            <div className="skeleton h-6 rounded w-1/3" />
            <div className="skeleton h-12 rounded" />
            <div className="skeleton h-12 rounded" />
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 dark:bg-obsidian-sunken/60 border-b border-gray-200 dark:border-obsidian-border">
                <th className="text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted px-4 py-3 w-48">
                  Project
                </th>
                {dates.map((date, i) => {
                  const d = new Date(date);
                  const isToday = date === todayDate;
                  const isWeekend = i >= 5;
                  return (
                    <th
                      key={date}
                      className={cn(
                        'text-center text-[10px] font-semibold uppercase tracking-[0.1em] px-2 py-3 w-20',
                        isToday
                          ? 'text-brand-600 dark:text-brand-400 bg-brand-50/50 dark:bg-brand-500/[0.08]'
                          : isWeekend
                            ? 'text-gray-400 dark:text-obsidian-faded bg-gray-50/40 dark:bg-obsidian-bg/20'
                            : 'text-gray-500 dark:text-obsidian-muted',
                      )}
                    >
                      <div>{DAY_NAMES[i]}</div>
                      <div className="text-[10px] font-medium mt-0.5 normal-case tracking-normal">{d.getDate()}</div>
                    </th>
                  );
                })}
                <th className="text-center text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted px-3 py-3 w-20 bg-gray-50 dark:bg-obsidian-sunken/60">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {(!data?.projects || data.projects.length === 0) ? (
                <tr>
                  <td colSpan={9} className="text-center py-14 text-sm text-gray-400 dark:text-obsidian-faded">
                    No projects assigned. Join a project to start logging time.
                  </td>
                </tr>
              ) : (
                <>
                  {data.projects.map((project: any) => {
                    const projTotal = getProjectTotal(project.projectId);
                    return (
                      <tr key={project.projectId} className="border-b border-gray-100 dark:border-obsidian-border/60 hover:bg-gray-50/40 dark:hover:bg-obsidian-raised/40 transition-colors">
                        <td className="px-4 py-3">
                          <span className="text-[13px] font-medium text-gray-900 dark:text-obsidian-fg">{project.projectName}</span>
                        </td>
                        {dates.map((date, i) => {
                          const isToday = date === todayDate;
                          const isWeekend = i >= 5;
                          const value = getCellValue(project.projectId, date);
                          const key = getCellKey(project.projectId, date);
                          const isEdited = edits[key] !== undefined;
                          // Approved leave overlay — render "ON LEAVE" pill
                          // and disable hour entry. Applies once per row of
                          // the day; all projects on a leave day are
                          // un-fillable. Team feedback #6.
                          //
                          // QA L-M4: if the user logged hours BEFORE the
                          // leave was approved, those hours stay in the
                          // DB (we don't auto-zero on approval). The cell
                          // now surfaces "(2h logged)" beneath the pill so
                          // they can decide to clear them, and the daily/
                          // weekly totals are honest about the discrepancy.
                          const onLeave = leaveByDate.get(date);
                          if (onLeave) {
                            return (
                              <td key={date} className={cn(
                                'px-1 py-2 text-center',
                                isToday && 'bg-brand-50/30 dark:bg-brand-500/[0.04]',
                                isWeekend && !isToday && 'bg-gray-50/30 dark:bg-obsidian-bg/10',
                              )}>
                                <Tooltip
                                  content={value > 0
                                    ? `On leave (${onLeave.type.toLowerCase()}). ${value}h was logged here before the leave was approved — clear it via the project edit view if needed.`
                                    : `On leave (${onLeave.type.toLowerCase()})`}
                                  side="top"
                                >
                                  <div className={cn(
                                    'inline-flex flex-col items-center justify-center gap-0.5 w-16 px-1.5 py-1 rounded-md border',
                                    'bg-amber-50 dark:bg-amber-500/[0.12] border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-300',
                                  )}>
                                    <div className="inline-flex items-center gap-1">
                                      <Plane size={10} />
                                      <span className="text-[10px] font-semibold uppercase tracking-wider">Leave</span>
                                    </div>
                                    {value > 0 && (
                                      <span className="text-[9px] text-amber-600 dark:text-amber-400">{value}h logged</span>
                                    )}
                                  </div>
                                </Tooltip>
                              </td>
                            );
                          }
                          return (
                            <td key={date} className={cn(
                              'px-1 py-2 text-center',
                              isToday && 'bg-brand-50/30 dark:bg-brand-500/[0.04]',
                              isWeekend && !isToday && 'bg-gray-50/30 dark:bg-obsidian-bg/10',
                            )}>
                              <input
                                type="number"
                                min="0"
                                max="24"
                                step="0.5"
                                value={value || ''}
                                onChange={(e) => handleCellChange(project.projectId, date, e.target.value)}
                                placeholder="0"
                                disabled={isLocked}
                                className={cn(
                                  'w-16 text-center text-[13px] tabular-nums rounded-md px-1 py-1.5 transition-colors',
                                  'focus:outline-none focus:border-brand-500 dark:focus:border-brand-400',
                                  isLocked
                                    ? 'bg-gray-50 dark:bg-obsidian-bg/40 text-gray-500 dark:text-obsidian-muted cursor-not-allowed border border-gray-100 dark:border-obsidian-border/40'
                                    : isEdited
                                      ? 'border border-brand-300 dark:border-brand-500/40 bg-brand-50 dark:bg-brand-500/[0.10] font-semibold text-brand-700 dark:text-brand-200'
                                      : value > 0
                                        ? 'border border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-raised font-medium text-gray-900 dark:text-obsidian-fg'
                                        : 'border border-gray-100 dark:border-obsidian-border/60 bg-transparent text-gray-300 dark:text-obsidian-faded',
                                )}
                              />
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-center">
                          <span className={cn(
                            'text-[13px] font-semibold tabular-nums',
                            projTotal > 0 ? 'text-gray-900 dark:text-obsidian-fg' : 'text-gray-300 dark:text-obsidian-faded',
                          )}>
                            {projTotal > 0 ? `${projTotal}h` : '—'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {/* Daily totals row */}
                  <tr className="bg-gray-50 dark:bg-obsidian-sunken/40 border-t-2 border-gray-200 dark:border-obsidian-border">
                    <td className="px-4 py-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-gray-700 dark:text-obsidian-muted">
                      Daily total
                    </td>
                    {dates.map((date) => {
                      const dayTotal = getDayTotal(date);
                      const isOver = dayTotal > 8;
                      return (
                        <td key={date} className="px-2 py-3 text-center">
                          <span className={cn(
                            'text-[13px] font-bold tabular-nums',
                            isOver
                              ? 'text-rose-600 dark:text-rose-400'
                              : dayTotal > 0
                                ? 'text-gray-900 dark:text-obsidian-fg'
                                : 'text-gray-300 dark:text-obsidian-faded',
                          )}>
                            {dayTotal > 0 ? `${dayTotal}h` : '—'}
                          </span>
                        </td>
                      );
                    })}
                    <td className="px-3 py-3 text-center">
                      <span className="text-[14px] font-bold text-brand-600 dark:text-brand-400 tabular-nums">
                        {grandTotal > 0 ? `${grandTotal}h` : '—'}
                      </span>
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* ─── Weekly summary ─── */}
      {data && grandTotal > 0 && (
        <div className="stagger-fade grid grid-cols-3 gap-4">
          <SummaryStat label="Total hours" value={`${grandTotal}h`} />
          <SummaryStat label="Daily average" value={`${(grandTotal / 5).toFixed(1)}h`} hint="across weekdays" />
          <SummaryStat
            label="Target (40h)"
            value={`${Math.round((grandTotal / 40) * 100)}%`}
            tone={grandTotal >= 40 ? 'success' : 'warning'}
          />
        </div>
      )}

      {/* ─── Floating action bar ─── */}
      {(hasEdits || (tsStatus === 'DRAFT' && grandTotal > 0) || tsStatus === 'REJECTED') && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 animate-fade-in-up">
          <div className={cn(
            'flex items-center gap-2 rounded-2xl px-4 py-2.5',
            'bg-white border border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border-strong',
            'shadow-pop dark:shadow-pop-dark',
          )}>
            {hasEdits && !isLocked && (
              <>
                <Button variant="ghost" size="sm" leadingIcon={<X size={13} />} onClick={() => setEdits({})}>
                  Discard
                </Button>
                <Button variant="primary" size="sm" loading={saving} leadingIcon={<Save size={13} />} onClick={handleSave}>
                  {saving ? 'Saving…' : 'Save Draft'}
                </Button>
              </>
            )}
            {tsStatus === 'DRAFT' && grandTotal > 0 && !hasEdits && (
              <Button
                variant="success"
                size="sm"
                loading={submitTimesheet.isPending}
                leadingIcon={<Send size={13} />}
                onClick={() => submitTimesheet.mutate(weekStart)}
              >
                {submitTimesheet.isPending ? 'Submitting…' : 'Submit for approval'}
              </Button>
            )}
            {tsStatus === 'REJECTED' && (
              <Button
                variant="primary"
                size="sm"
                loading={reopenTimesheet.isPending}
                leadingIcon={<RotateCcw size={13} />}
                onClick={() => reopenTimesheet.mutate(weekStart)}
              >
                Revise & resubmit
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ───

function StatusPill({ status, approverName }: { status: string; approverName?: string }) {
  const config = {
    DRAFT:     { icon: Pencil,        label: 'Editing',           tone: 'bg-brand-100 text-brand-700 border-brand-200 dark:bg-brand-500/15 dark:text-brand-300 dark:border-brand-500/30' },
    SUBMITTED: { icon: Clock,         label: 'Awaiting approval', tone: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30' },
    APPROVED:  { icon: CheckCircle2,  label: approverName ? `Approved by ${approverName}` : 'Approved', tone: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30' },
    REJECTED:  { icon: XCircle,       label: 'Rejected',          tone: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30' },
  }[status] || { icon: Pencil, label: status, tone: 'bg-gray-100 text-gray-700 dark:bg-obsidian-raised dark:text-obsidian-muted' };

  const Icon = config.icon;
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-full border', config.tone)}>
      <Icon size={12} /> {config.label}
    </span>
  );
}

function SummaryStat({ label, value, hint, tone }: {
  label: string; value: string; hint?: string; tone?: 'success' | 'warning';
}) {
  const valueClass = tone === 'success'
    ? 'text-emerald-600 dark:text-emerald-400'
    : tone === 'warning'
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-gray-900 dark:text-obsidian-fg';
  const surfaceClass = tone === 'success'
    ? 'bg-emerald-50/60 border-emerald-200 dark:bg-emerald-500/[0.05] dark:border-emerald-500/25'
    : tone === 'warning'
      ? 'bg-amber-50/60 border-amber-200 dark:bg-amber-500/[0.05] dark:border-amber-500/25'
      : 'bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border';

  return (
    <div className={cn(
      'rounded-xl border p-5 hover-lift',
      'shadow-soft dark:shadow-soft-dark',
      surfaceClass,
    )}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted">{label}</p>
      <p className={cn('text-2xl font-semibold tracking-tight tabular-nums mt-1.5', valueClass)}>{value}</p>
      {hint && <p className="text-[11px] text-gray-400 dark:text-obsidian-faded mt-0.5">{hint}</p>}
    </div>
  );
}
