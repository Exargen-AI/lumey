/**
 * Pulse — Employee Productivity Tracker + Device Health (2026-05-28).
 *
 * SUPER_ADMIN-only. Tabbed surface:
 *   • Overview  — cards: total / healthy / at-risk / critical / offline /
 *                 missing-patches / disabled-security-features
 *   • Devices   — filterable list, drills into device detail
 *   • Alerts    — open risk findings across all devices, resolvable inline
 *   • Tokens    — issue / list enrollment tokens for new devices
 *
 * Route protection lives in App.tsx (`<ProtectedRoute roles={['SUPER_ADMIN']} />`).
 * The backend double-gates with `requireRoles('SUPER_ADMIN')` + a service-
 * layer check, so a UI bypass still hits a 403.
 */

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Copy,
  Cpu,
  KeyRound,
  Loader2,
  Monitor,
  Package,
  Plus,
  ShieldAlert,
  ShieldCheck,
  UserMinus,
  WifiOff,
  X,
} from 'lucide-react';
import {
  createPulseEnrollmentToken,
  getPulseDevice,
  getPulseEmployee,
  getPulseOverview,
  listPulseAlerts,
  listPulseDevices,
  listPulseEmployees,
  listPulseEnrollmentTokens,
  reassignPulseDevice,
  resolvePulseAlert,
  revokePulseDevice,
  revokePulseEnrollmentToken,
} from '@/api/pulse';
import {
  getTeamClockStatus as getTeamClockStatusApi,
  getDeviceProductivity as getDeviceProductivityApi,
} from '@/api/clock';
import type {
  DeviceAlertSeverity,
  DeviceEnrollmentStatus,
  DeviceRiskLevel,
  PulseDeviceSummary,
} from '@exargen/shared';
import { cn } from '@/lib/cn';

type Tab = 'overview' | 'employees' | 'devices' | 'alerts' | 'tokens' | 'clock';

export function PulsePage() {
  const [tab, setTab] = useState<Tab>('overview');

  // Small live-counts strip — populated by the same overview query so it's
  // always in sync with whatever the user sees on the Overview tab. We
  // keep it in this top component so it persists across tab switches
  // without re-fetching.
  const { data: overview } = useQuery({
    queryKey: ['pulse', 'overview'],
    queryFn: getPulseOverview,
    refetchInterval: 60_000,
  });

  // For the Alerts tab badge — small fleet-wide open-alert count.
  const openAlertsTotal = overview
    ? overview.openAlertsBySeverity.critical +
      overview.openAlertsBySeverity.warning +
      overview.openAlertsBySeverity.info
    : 0;

  return (
    <div className="max-w-7xl mx-auto space-y-6 p-6">
      <header className="bg-gradient-to-br from-brand-50 via-white to-white rounded-2xl border border-gray-200 px-6 py-5 flex flex-wrap items-end justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="grid place-items-center w-12 h-12 rounded-xl bg-brand-600/10 ring-1 ring-brand-600/20">
            <Activity size={24} className="text-brand-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 leading-tight">Pulse</h1>
            <p className="text-sm text-gray-500">
              Employee productivity &amp; device health
              <span className="hidden md:inline text-gray-300 mx-2">·</span>
              <span className="hidden md:inline text-xs uppercase tracking-wide text-gray-400">
                SUPER_ADMIN only
              </span>
            </p>
          </div>
        </div>
        {overview && (
          <div className="flex flex-wrap items-center gap-6 text-sm">
            <HeaderStat
              label="Devices"
              value={overview.totalDevices}
              hint={`${overview.byRiskLevel.healthy} healthy`}
            />
            <HeaderStat
              label="Active today"
              value={formatHoursMinutes(overview.teamActiveSecondsToday)}
              hint={`${overview.reportingDevicesToday} reporting`}
              valueClassName="text-gray-900"
            />
            <HeaderStat
              label="Open alerts"
              value={openAlertsTotal}
              hint={
                overview.openAlertsBySeverity.critical > 0
                  ? `${overview.openAlertsBySeverity.critical} critical`
                  : 'all clear'
              }
              valueClassName={
                overview.openAlertsBySeverity.critical > 0
                  ? 'text-rose-600'
                  : overview.openAlertsBySeverity.warning > 0
                    ? 'text-amber-600'
                    : 'text-emerald-600'
              }
            />
          </div>
        )}
      </header>

      <nav className="flex flex-wrap gap-1 border-b border-gray-200" aria-label="Pulse sections">
        {(
          [
            ['overview', 'Overview', null],
            ['employees', 'Employees', null],
            ['devices', 'Devices', overview?.totalDevices ?? null],
            ['alerts', 'Alerts', openAlertsTotal || null],
            ['clock', 'Clock log', null],
            ['tokens', 'Enrollment tokens', null],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === key
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-gray-500 hover:text-gray-800',
            )}
            aria-current={tab === key ? 'page' : undefined}
          >
            {label}
            {count !== null && count > 0 && (
              <span
                className={cn(
                  'inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[10px] font-semibold tabular-nums',
                  tab === key
                    ? 'bg-brand-600 text-white'
                    : key === 'alerts'
                      ? 'bg-rose-100 text-rose-700'
                      : 'bg-gray-100 text-gray-700',
                )}
              >
                {count}
              </span>
            )}
          </button>
        ))}
      </nav>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'employees' && <EmployeesTab />}
      {tab === 'devices' && <DevicesTab />}
      {tab === 'alerts' && <AlertsTab />}
      {tab === 'clock' && <ClockLogTab />}
      {tab === 'tokens' && <TokensTab />}
    </div>
  );
}

function HeaderStat({
  label,
  value,
  hint,
  valueClassName,
}: {
  label: string;
  value: number | string;
  hint?: string;
  valueClassName?: string;
}) {
  return (
    <div className="leading-tight">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
        {label}
      </div>
      <div className={cn('text-xl font-bold tabular-nums text-gray-900', valueClassName)}>
        {value}
      </div>
      {hint && <div className="text-[11px] text-gray-400">{hint}</div>}
    </div>
  );
}

// ─── Overview ────────────────────────────────────────────────────────

function OverviewTab() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['pulse', 'overview'],
    queryFn: getPulseOverview,
    refetchInterval: 60_000,
  });

  if (isLoading) return <LoadingBlock label="Loading Pulse overview…" />;
  if (error || !data) return <ErrorBlock message="Failed to load overview." />;

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={<Cpu className="text-gray-500" size={20} />}
          label="Total devices"
          value={data.totalDevices}
        />
        <StatCard
          icon={<ShieldCheck className="text-emerald-500" size={20} />}
          label="Healthy"
          value={data.byRiskLevel.healthy}
          tone="positive"
        />
        <StatCard
          icon={<AlertTriangle className="text-amber-500" size={20} />}
          label="At-risk"
          value={data.byRiskLevel.atRisk}
          tone="warning"
        />
        <StatCard
          icon={<ShieldAlert className="text-rose-500" size={20} />}
          label="Critical"
          value={data.byRiskLevel.critical}
          tone="critical"
        />
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">
          Security posture
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            icon={<WifiOff className="text-gray-500" size={20} />}
            label="Agents offline (24h)"
            value={data.agentsOffline}
            tone={data.agentsOffline > 0 ? 'warning' : undefined}
          />
          <StatCard label="Missing patches" value={data.missingPatchesTotal} />
          <StatCard label="Reboot required" value={data.rebootRequiredCount} />
          <StatCard
            label="Antivirus disabled"
            value={data.antivirusDisabledCount}
            tone={data.antivirusDisabledCount > 0 ? 'critical' : undefined}
          />
          <StatCard
            label="Firewall disabled"
            value={data.firewallDisabledCount}
            tone={data.firewallDisabledCount > 0 ? 'warning' : undefined}
          />
          <StatCard
            label="BitLocker disabled"
            value={data.bitlockerDisabledCount}
            tone={data.bitlockerDisabledCount > 0 ? 'warning' : undefined}
          />
          <StatCard
            label="Unsupported OS"
            value={data.unsupportedOsCount}
            tone={data.unsupportedOsCount > 0 ? 'warning' : undefined}
          />
          <StatCard
            label="Devices with risky apps"
            value={data.riskySoftwareDeviceCount}
            tone={data.riskySoftwareDeviceCount > 0 ? 'warning' : undefined}
          />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">
          Productivity today
        </h2>
        <TeamProductivityBar
          activeSeconds={data.teamActiveSecondsToday}
          idleSeconds={data.teamIdleSecondsToday}
          lockedSeconds={data.teamLockedSecondsToday}
          reportingDevices={data.reportingDevicesToday}
        />
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">
          Open alerts
        </h2>
        <div className="grid grid-cols-3 gap-4">
          <StatCard
            label="Critical"
            value={data.openAlertsBySeverity.critical}
            tone="critical"
          />
          <StatCard
            label="Warning"
            value={data.openAlertsBySeverity.warning}
            tone="warning"
          />
          <StatCard label="Info" value={data.openAlertsBySeverity.info} />
        </div>
      </section>

      <p className="text-xs text-gray-400">
        Last refreshed {new Date(data.lastUpdatedAt).toLocaleString()}
      </p>
    </div>
  );
}

// ─── Team productivity bar ────────────────────────────────────────────
//
// Today's team-wide active / idle / locked breakdown as a single big
// stacked bar. Width segments are proportional to the sum across
// devices. The big number on the left is total team active hours
// today. "reporting devices" gives context — if 5 devices contributed
// 40h of active time, that's 8h/device average.

function TeamProductivityBar({
  activeSeconds,
  idleSeconds,
  lockedSeconds,
  reportingDevices,
}: {
  activeSeconds: number;
  idleSeconds: number;
  lockedSeconds: number;
  reportingDevices: number;
}) {
  const total = Math.max(1, activeSeconds + idleSeconds + lockedSeconds);
  const pct = (n: number) => Math.max(0, Math.min(100, (n / total) * 100));
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-3xl font-bold text-gray-900">
            {formatHoursMinutes(activeSeconds)}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            Total active across {reportingDevices} reporting device
            {reportingDevices === 1 ? '' : 's'} today
          </div>
        </div>
        <div className="text-right text-xs text-gray-500 space-y-0.5">
          <div>
            <span className="inline-block w-2 h-2 rounded-sm bg-emerald-500 mr-1.5" />
            Active {formatHoursMinutes(activeSeconds)}
          </div>
          <div>
            <span className="inline-block w-2 h-2 rounded-sm bg-amber-400 mr-1.5" />
            Idle {formatHoursMinutes(idleSeconds)}
          </div>
          <div>
            <span className="inline-block w-2 h-2 rounded-sm bg-gray-400 mr-1.5" />
            Locked {formatHoursMinutes(lockedSeconds)}
          </div>
        </div>
      </div>
      {activeSeconds + idleSeconds + lockedSeconds === 0 ? (
        <p className="text-sm text-gray-500">
          No productivity data yet today. Wait for the next hourly snapshot.
        </p>
      ) : (
        <div className="h-3 rounded-full overflow-hidden bg-gray-100 flex">
          <div
            className="bg-emerald-500 h-full"
            style={{ width: `${pct(activeSeconds)}%` }}
            title={`Active ${formatHoursMinutes(activeSeconds)}`}
          />
          <div
            className="bg-amber-400 h-full"
            style={{ width: `${pct(idleSeconds)}%` }}
            title={`Idle ${formatHoursMinutes(idleSeconds)}`}
          />
          <div
            className="bg-gray-400 h-full"
            style={{ width: `${pct(lockedSeconds)}%` }}
            title={`Locked ${formatHoursMinutes(lockedSeconds)}`}
          />
        </div>
      )}
    </div>
  );
}

function formatHoursMinutes(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon?: React.ReactNode;
  label: string;
  value: number;
  tone?: 'positive' | 'warning' | 'critical';
}) {
  return (
    <div
      className={cn(
        'group rounded-xl border bg-white p-4 transition-shadow hover:shadow-sm',
        tone === 'critical' && 'border-rose-200 bg-gradient-to-br from-rose-50 to-white',
        tone === 'warning' && 'border-amber-200 bg-gradient-to-br from-amber-50 to-white',
        tone === 'positive' && 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-white',
        !tone && 'border-gray-200',
      )}
    >
      <div className="flex items-center gap-2 text-[11px] font-semibold text-gray-600 uppercase tracking-wider">
        {icon}
        {label}
      </div>
      <div
        className={cn(
          'mt-2 text-3xl font-bold tabular-nums',
          tone === 'critical' && 'text-rose-700',
          tone === 'warning' && 'text-amber-700',
          tone === 'positive' && 'text-emerald-700',
          !tone && 'text-gray-900',
        )}
      >
        {value}
      </div>
    </div>
  );
}

// ─── Devices ─────────────────────────────────────────────────────────

function DevicesTab() {
  const [riskLevel, setRiskLevel] = useState<DeviceRiskLevel | ''>('');
  const [status, setStatus] = useState<DeviceEnrollmentStatus | ''>('');
  const [search, setSearch] = useState('');
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['pulse', 'devices', { riskLevel, status, search }],
    queryFn: () =>
      listPulseDevices({
        riskLevel: riskLevel || undefined,
        status: status || undefined,
        search: search || undefined,
      }),
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <input
          type="search"
          placeholder="Search hostname or owner…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-64"
        />
        <select
          value={riskLevel}
          onChange={(e) => setRiskLevel(e.target.value as DeviceRiskLevel | '')}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
        >
          <option value="">All risk levels</option>
          <option value="HEALTHY">Healthy</option>
          <option value="AT_RISK">At risk</option>
          <option value="CRITICAL">Critical</option>
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as DeviceEnrollmentStatus | '')}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="PENDING_ENROLLMENT">Pending</option>
          <option value="REVOKED">Revoked</option>
          <option value="INACTIVE">Inactive</option>
        </select>
      </div>

      {isLoading ? (
        <LoadingBlock label="Loading devices…" />
      ) : !data || data.length === 0 ? (
        <EmptyBlock
          message="No devices match your filters yet. Issue an enrollment token to onboard one."
        />
      ) : (
        <DeviceTable rows={data} onSelect={setSelectedDeviceId} />
      )}

      {selectedDeviceId && (
        <DeviceDetailDrawer
          deviceId={selectedDeviceId}
          onClose={() => setSelectedDeviceId(null)}
        />
      )}
    </div>
  );
}

function DeviceTable({
  rows,
  onSelect,
}: {
  rows: PulseDeviceSummary[];
  onSelect: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [reassigningDevice, setReassigningDevice] = useState<{
    id: string;
    hostname: string;
    currentOwnerName: string | null;
  } | null>(null);

  const revokeMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      revokePulseDevice(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pulse'] });
      setRevokingId(null);
    },
  });

  const reassignMutation = useMutation({
    mutationFn: ({ id, ownerUserId }: { id: string; ownerUserId: string | null }) =>
      reassignPulseDevice(id, ownerUserId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pulse'] });
      setReassigningDevice(null);
    },
  });

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
          <tr>
            <th className="px-4 py-3">Hostname</th>
            <th className="px-4 py-3">Owner</th>
            <th className="px-4 py-3">Platform</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Risk</th>
            <th className="px-4 py-3">Active today</th>
            <th className="px-4 py-3">Last seen</th>
            <th className="px-4 py-3">Issues</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((d) => (
            <tr
              key={d.id}
              className="hover:bg-gray-50 cursor-pointer"
              onClick={() => onSelect(d.id)}
            >
              <td className="px-4 py-3 font-medium text-gray-900">
                <Monitor size={14} className="inline-block mr-2 text-gray-400" />
                {d.hostname}
                <ChevronRight
                  size={14}
                  className="inline-block ml-1 text-gray-400 group-hover:text-gray-600"
                />
              </td>
              <td className="px-4 py-3 text-gray-700">
                {d.owner ? (
                  <div>
                    <div>{d.owner.name}</div>
                    <div className="text-xs text-gray-500">{d.owner.email}</div>
                  </div>
                ) : (
                  <span className="text-gray-400">Unassigned</span>
                )}
              </td>
              <td className="px-4 py-3 text-gray-600">
                {d.platform}
                {d.osVersion && <div className="text-xs text-gray-400">{d.osVersion}</div>}
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={d.status} />
              </td>
              <td className="px-4 py-3">
                <RiskBadge level={d.currentRiskLevel} score={d.currentRiskScore} />
              </td>
              <td className="px-4 py-3">
                <ActiveTodayCell
                  active={d.todayActiveSeconds}
                  idle={d.todayIdleSeconds}
                  locked={d.todayLockedSeconds}
                />
              </td>
              <td className="px-4 py-3 text-gray-600">
                {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : '—'}
              </td>
              <td className="px-4 py-3 text-gray-600">
                <div className="flex gap-2 flex-wrap text-xs">
                  {d.openAlertCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">
                      {d.openAlertCount} alert{d.openAlertCount === 1 ? '' : 's'}
                    </span>
                  )}
                  {d.missingPatchCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                      {d.missingPatchCount} patch{d.missingPatchCount === 1 ? '' : 'es'}
                    </span>
                  )}
                  {d.riskySoftwareCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">
                      {d.riskySoftwareCount} risky app{d.riskySoftwareCount === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3 text-right">
                {d.status === 'ACTIVE' && (
                  <button
                    onClick={(e) => {
                      // Stop row-click from opening the detail drawer.
                      e.stopPropagation();
                      setRevokingId(d.id);
                    }}
                    className="text-xs text-rose-600 hover:underline"
                  >
                    Revoke
                  </button>
                )}
                {/* Reassign — always available (even on revoked devices,
                    in case you want to change ownership before deletion). */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setReassigningDevice({
                      id: d.id,
                      hostname: d.hostname,
                      currentOwnerName: d.owner?.name ?? null,
                    });
                  }}
                  className="text-xs text-brand-600 hover:underline ml-3"
                >
                  Change owner
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {revokingId && (
        <RevokeDeviceDialog
          deviceId={revokingId}
          isPending={revokeMutation.isPending}
          onCancel={() => setRevokingId(null)}
          onConfirm={(reason) => revokeMutation.mutate({ id: revokingId, reason })}
        />
      )}

      {reassigningDevice && (
        <ReassignDeviceDialog
          hostname={reassigningDevice.hostname}
          currentOwnerName={reassigningDevice.currentOwnerName}
          isPending={reassignMutation.isPending}
          onCancel={() => setReassigningDevice(null)}
          onConfirm={(ownerUserId) =>
            reassignMutation.mutate({ id: reassigningDevice.id, ownerUserId })
          }
        />
      )}
    </div>
  );
}

// Shared dropdown that lists employees from the Pulse view (same source
// as the Employees tab). Used by both the reassign-device dialog and
// the pre-bind dropdown in the issue-token dialog so they stay in sync.
function EmployeePicker({
  value,
  onChange,
  includeUnassigned,
  unassignedLabel = 'Unassigned',
  required,
}: {
  value: string | '';
  onChange: (v: string | '') => void;
  includeUnassigned: boolean;
  unassignedLabel?: string;
  required?: boolean;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['pulse', 'employees'],
    queryFn: listPulseEmployees,
  });

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as string | '')}
      required={required}
      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
    >
      <option value="" disabled={required && !includeUnassigned}>
        {isLoading
          ? 'Loading employees…'
          : includeUnassigned
            ? unassignedLabel
            : 'Pick an employee…'}
      </option>
      {data?.map((e) => (
        <option key={e.user.id} value={e.user.id}>
          {e.user.name} — {e.user.email} ({e.user.role})
        </option>
      ))}
    </select>
  );
}

function ReassignDeviceDialog({
  hostname,
  currentOwnerName,
  isPending,
  onCancel,
  onConfirm,
}: {
  hostname: string;
  currentOwnerName: string | null;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: (ownerUserId: string | null) => void;
}) {
  const [selected, setSelected] = useState<string | ''>('');
  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-xl w-full max-w-md p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold text-gray-900">
          Change owner — {hostname}
        </h3>
        <p className="text-sm text-gray-600">
          Currently owned by{' '}
          <span className="font-medium">
            {currentOwnerName ?? 'no one (Unassigned)'}
          </span>
          . Pick a new owner. Telemetry will roll up to them on the next
          dashboard refresh.
        </p>
        <EmployeePicker
          value={selected}
          onChange={setSelected}
          includeUnassigned
          unassignedLabel="— Pick employee or leave unassigned —"
        />
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(selected === '' ? null : selected)}
            disabled={isPending}
            className="px-4 py-2 text-sm bg-brand-600 text-white rounded-lg disabled:opacity-50"
          >
            {isPending ? 'Saving…' : 'Save owner'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RevokeDeviceDialog({
  deviceId,
  isPending,
  onCancel,
  onConfirm,
}: {
  deviceId: string;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl w-full max-w-md p-6 space-y-4">
        <h3 className="font-semibold text-gray-900">Revoke device {deviceId.slice(0, 8)}…</h3>
        <p className="text-sm text-gray-600">
          The agent's API key will be rejected on the next call. The device row is preserved
          for audit; re-enrollment with a new token will reactivate it.
        </p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional, e.g. employee offboarded)"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          rows={3}
        />
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(reason)}
            disabled={isPending}
            className="px-4 py-2 text-sm bg-rose-600 text-white rounded-lg disabled:opacity-50"
          >
            {isPending ? 'Revoking…' : 'Revoke'}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: DeviceEnrollmentStatus }) {
  const palette: Record<DeviceEnrollmentStatus, string> = {
    ACTIVE: 'bg-emerald-100 text-emerald-700',
    PENDING_ENROLLMENT: 'bg-gray-100 text-gray-700',
    REVOKED: 'bg-rose-100 text-rose-700',
    INACTIVE: 'bg-gray-100 text-gray-500',
  };
  return (
    <span className={cn('px-2 py-0.5 rounded text-xs font-medium', palette[status])}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function RiskBadge({
  level,
  score,
}: {
  level: DeviceRiskLevel | null;
  score: number | null;
}) {
  if (!level) return <span className="text-xs text-gray-400">—</span>;
  const palette: Record<DeviceRiskLevel, string> = {
    HEALTHY: 'bg-emerald-100 text-emerald-700',
    AT_RISK: 'bg-amber-100 text-amber-700',
    CRITICAL: 'bg-rose-100 text-rose-700',
  };
  return (
    <span className={cn('px-2 py-0.5 rounded text-xs font-medium', palette[level])}>
      {level.replace(/_/g, ' ')}
      {score !== null && <span className="ml-1 opacity-70">({score})</span>}
    </span>
  );
}

// Compact "active today" cell — big active time + mini stacked-bar
// underneath showing idle/locked split. Tells the SUPER_ADMIN
// at-a-glance whether the device is actually being used.
function ActiveTodayCell({
  active,
  idle,
  locked,
}: {
  active: number;
  idle: number;
  locked: number;
}) {
  const total = active + idle + locked;
  if (total === 0) {
    return <span className="text-xs text-gray-400">No data yet</span>;
  }
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / total) * 100))}%`;
  return (
    <div className="space-y-1 min-w-[110px]">
      <div className="text-sm font-semibold text-gray-900">
        {formatHoursMinutes(active)}
      </div>
      <div className="h-1.5 rounded-full overflow-hidden bg-gray-100 flex">
        <div className="bg-emerald-500" style={{ width: pct(active) }} />
        <div className="bg-amber-400" style={{ width: pct(idle) }} />
        <div className="bg-gray-400" style={{ width: pct(locked) }} />
      </div>
    </div>
  );
}

// ─── Alerts ──────────────────────────────────────────────────────────

function AlertsTab() {
  const qc = useQueryClient();
  const [severity, setSeverity] = useState<DeviceAlertSeverity | ''>('');

  const { data, isLoading } = useQuery({
    queryKey: ['pulse', 'alerts', { severity }],
    queryFn: () => listPulseAlerts({ severity: severity || undefined }),
    refetchInterval: 60_000,
  });

  const resolveMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => resolvePulseAlert(id, note),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pulse'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value as DeviceAlertSeverity | '')}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
        >
          <option value="">All severities</option>
          <option value="CRITICAL">Critical</option>
          <option value="WARNING">Warning</option>
          <option value="INFO">Info</option>
        </select>
      </div>

      {isLoading ? (
        <LoadingBlock label="Loading alerts…" />
      ) : !data || data.length === 0 ? (
        <EmptyBlock message="No open alerts. Fleet is healthy." />
      ) : (
        <ul className="space-y-2">
          {data.map((a) => (
            <li
              key={a.id}
              className="bg-white rounded-xl border border-gray-200 p-4 flex items-start gap-4"
            >
              <SeverityIcon severity={a.severity} />
              <div className="flex-1">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                  {a.type.replace(/_/g, ' ')}
                  <span className="text-xs text-gray-500">
                    on {a.device.hostname}
                    {a.device.ownerName && ` · ${a.device.ownerName}`}
                  </span>
                </div>
                <p className="text-sm text-gray-700 mt-1">{a.message}</p>
                <p className="text-xs text-gray-400 mt-1">
                  Opened {new Date(a.openedAt).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() =>
                  resolveMutation.mutate({ id: a.id, note: 'Resolved by admin' })
                }
                className="text-xs text-brand-600 hover:underline"
              >
                Resolve
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SeverityIcon({ severity }: { severity: DeviceAlertSeverity }) {
  if (severity === 'CRITICAL') return <ShieldAlert className="text-rose-500 mt-1" size={20} />;
  if (severity === 'WARNING') return <AlertTriangle className="text-amber-500 mt-1" size={20} />;
  return <CheckCircle2 className="text-gray-400 mt-1" size={20} />;
}

// ─── Enrollment tokens ────────────────────────────────────────────────

function TokensTab() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['pulse', 'tokens'],
    queryFn: () => listPulseEnrollmentTokens(),
  });

  const createMutation = useMutation({
    mutationFn: createPulseEnrollmentToken,
    onSuccess: (resp) => {
      setIssuedToken(resp.token);
      setShowCreate(false);
      qc.invalidateQueries({ queryKey: ['pulse', 'tokens'] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: revokePulseEnrollmentToken,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pulse', 'tokens'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-600">
          Issue a single-use token to onboard a new device. The token is shown ONCE on creation.
        </p>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-3 py-2 bg-brand-600 text-white rounded-lg text-sm"
        >
          <Plus size={16} />
          Issue token
        </button>
      </div>

      {showCreate && (
        <IssueTokenDialog
          isPending={createMutation.isPending}
          onCancel={() => setShowCreate(false)}
          onSubmit={({ note, assignedUserId }) =>
            createMutation.mutate({ note, assignedUserId })
          }
        />
      )}

      {issuedToken && (
        <NewTokenDialog token={issuedToken} onClose={() => setIssuedToken(null)} />
      )}

      {isLoading ? (
        <LoadingBlock label="Loading tokens…" />
      ) : !data || data.length === 0 ? (
        <EmptyBlock message="No open enrollment tokens." />
      ) : (
        <ul className="space-y-2">
          {data.map((t) => (
            <li
              key={t.id}
              className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <KeyRound className="text-gray-400" size={20} />
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    {t.note || 'Untitled token'}{' '}
                    <span className="text-gray-400 font-normal">····{t.tokenSuffix}</span>
                  </div>
                  <div className="text-xs text-gray-500">
                    Issued by {t.issuedBy.name} ·{' '}
                    {t.assignedUser
                      ? `Assigned to ${t.assignedUser.name}`
                      : 'Unassigned'}{' '}
                    · Expires {new Date(t.expiresAt).toLocaleDateString()}
                  </div>
                </div>
              </div>
              <button
                onClick={() => revokeMutation.mutate(t.id)}
                className="text-xs text-rose-600 hover:underline"
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function IssueTokenDialog({
  isPending,
  onCancel,
  onSubmit,
}: {
  isPending: boolean;
  onCancel: () => void;
  onSubmit: (args: { note: string; assignedUserId?: string }) => void;
}) {
  const [note, setNote] = useState('');
  const [assignedUserId, setAssignedUserId] = useState<string | ''>('');
  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-xl w-full max-w-md p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold text-gray-900">Issue enrollment token</h3>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Note
          </label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. 'Karthik's MacBook'"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Assign to employee (recommended)
          </label>
          <EmployeePicker
            value={assignedUserId}
            onChange={setAssignedUserId}
            includeUnassigned
            unassignedLabel="— Issue without pre-binding —"
          />
          <p className="text-xs text-gray-500 mt-1">
            Pre-binding means the device auto-assigns to this employee at
            enrollment. Without it, you'll have to assign manually later.
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600">
            Cancel
          </button>
          <button
            onClick={() =>
              onSubmit({
                note,
                assignedUserId: assignedUserId === '' ? undefined : assignedUserId,
              })
            }
            disabled={isPending}
            className="px-4 py-2 text-sm bg-brand-600 text-white rounded-lg disabled:opacity-50"
          >
            {isPending ? 'Issuing…' : 'Issue'}
          </button>
        </div>
      </div>
    </div>
  );
}

function NewTokenDialog({ token, onClose }: { token: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl w-full max-w-md p-6 space-y-4">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="font-semibold text-gray-900">Enrollment token issued</h3>
            <p className="text-xs text-rose-600 mt-1">
              Shown only once — copy now and hand to the employee.
            </p>
          </div>
          <button onClick={onClose}>
            <X size={20} className="text-gray-400 hover:text-gray-600" />
          </button>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 font-mono text-xs break-all">
          {token}
        </div>
        <button
          onClick={() => {
            navigator.clipboard.writeText(token).then(() => setCopied(true));
          }}
          className="flex items-center gap-2 px-3 py-2 bg-brand-600 text-white rounded-lg text-sm w-full justify-center"
        >
          <Copy size={14} />
          {copied ? 'Copied!' : 'Copy to clipboard'}
        </button>
      </div>
    </div>
  );
}

// ─── Device detail drawer ─────────────────────────────────────────────
//
// Slide-over from the right showing everything we have about one
// device: latest snapshot (security flags, uptime), installed software
// (with risky-app badges + filter), missing patches (severity-sorted),
// open alerts. Backend returns it all in one round-trip via
// GET /admin/pulse/devices/:id.

function DeviceDetailDrawer({
  deviceId,
  onClose,
}: {
  deviceId: string;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['pulse', 'device', deviceId],
    queryFn: () => getPulseDevice(deviceId),
    refetchInterval: 60_000,
  });

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex justify-end"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-3xl h-full overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Monitor size={20} className="text-brand-600" />
            <div>
              <h2 className="font-semibold text-gray-900">
                {data?.hostname ?? 'Device'}
              </h2>
              {data?.owner ? (
                <p className="text-xs text-gray-500">
                  {data.owner.name} · {data.owner.email}
                </p>
              ) : (
                <p className="text-xs text-gray-400">Unassigned</p>
              )}
            </div>
          </div>
          <button onClick={onClose}>
            <X size={20} className="text-gray-400 hover:text-gray-700" />
          </button>
        </div>

        {isLoading ? (
          <LoadingBlock label="Loading device…" />
        ) : error || !data ? (
          <ErrorBlock message="Failed to load device detail." />
        ) : (
          <div className="p-6 space-y-6">
            <DeviceIdentitySection device={data} />
            <DeviceSnapshotSection snapshot={data.latestSnapshot} />
            <DeviceProductivitySection device={data} />
            <DeviceAlertsSection alerts={data.openAlerts} />
            <DevicePatchesSection patches={data.missingPatches} />
            <DeviceSoftwareSection software={data.installedSoftware} />
          </div>
        )}
      </div>
    </div>
  );
}

function DeviceIdentitySection({
  device,
}: {
  device: import('@exargen/shared').PulseDeviceDetail;
}) {
  return (
    <section>
      <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
        Identity
      </h3>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <Field label="Platform" value={device.platform} />
        <Field label="OS" value={device.osVersion ?? '—'} />
        <Field label="Build" value={device.osBuild ?? '—'} />
        <Field label="Arch" value={device.arch ?? '—'} />
        <Field
          label="Status"
          value={device.status.replace(/_/g, ' ')}
        />
        <Field
          label="API key prefix"
          value={`${device.apiKeyPrefix}…`}
        />
        <Field
          label="Last seen"
          value={
            device.lastSeenAt
              ? new Date(device.lastSeenAt).toLocaleString()
              : '—'
          }
        />
        <Field label="Agent version" value={device.agentVersion ?? '—'} />
      </dl>
    </section>
  );
}

function DeviceSnapshotSection({
  snapshot,
}: {
  snapshot: import('@exargen/shared').PulseDeviceDetail['latestSnapshot'];
}) {
  if (!snapshot) {
    return (
      <section>
        <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
          Latest snapshot
        </h3>
        <p className="text-sm text-gray-500">
          No snapshot yet — first hourly capture pending.
        </p>
      </section>
    );
  }
  const h = Math.floor(snapshot.uptimeSeconds / 3600);
  const m = Math.floor((snapshot.uptimeSeconds % 3600) / 60);
  return (
    <section>
      <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
        Latest snapshot
        <span className="ml-2 font-normal text-gray-400 normal-case">
          {new Date(snapshot.capturedAt).toLocaleString()}
        </span>
      </h3>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <Field
          label="Risk"
          value={`${snapshot.riskLevel.replace('_', ' ')} (${snapshot.riskScore})`}
        />
        <Field label="Power state" value={snapshot.powerState} />
        <Field label="Uptime" value={`${h}h ${m}m`} />
        <Field
          label="Last boot"
          value={
            snapshot.lastBootAt
              ? new Date(snapshot.lastBootAt).toLocaleString()
              : '—'
          }
        />
        <BooleanField label="Antivirus" value={snapshot.defenderEnabled} positiveTrue />
        <BooleanField label="Firewall" value={snapshot.firewallEnabled} positiveTrue />
        <BooleanField label="BitLocker" value={snapshot.bitlockerEnabled} positiveTrue />
        <BooleanField
          label="Reboot pending"
          value={snapshot.rebootRequired}
          positiveTrue={false}
        />
        <BooleanField
          label="Unsupported OS"
          value={snapshot.unsupportedOs}
          positiveTrue={false}
        />
        {/* 2026-05-31 — session + device-health signals. Each renders
            only when the agent actually reported it (older agents and
            hardware-dependent fields like battery come back null). The
            `?? null` guards keep a desktop-without-battery from showing
            a misleading "0%". */}
        {snapshot.loggedInUserName != null && (
          <Field label="Logged-in user" value={snapshot.loggedInUserName} />
        )}
        {snapshot.currentSessionStart != null && (
          <Field
            label="Session start"
            value={new Date(snapshot.currentSessionStart).toLocaleString()}
          />
        )}
        {snapshot.runningProcessCount != null && (
          <Field label="Processes" value={String(snapshot.runningProcessCount)} />
        )}
        {snapshot.batteryPercent != null && (
          <Field
            label="Battery"
            value={`${snapshot.batteryPercent}%${snapshot.batteryCharging ? ' (charging)' : ''}${
              snapshot.batteryHealthPercent != null
                ? ` · ${snapshot.batteryHealthPercent}% health`
                : ''
            }`}
          />
        )}
        {snapshot.diskFreePercent != null && (
          <Field
            label="Disk free"
            value={`${snapshot.diskFreePercent}%${
              snapshot.diskFreeGb != null ? ` (${snapshot.diskFreeGb} GB)` : ''
            }`}
          />
        )}
        {snapshot.networkType != null && (
          <Field
            label="Network"
            value={`${snapshot.networkType}${
              snapshot.networkConnectivity ? ` · ${snapshot.networkConnectivity}` : ''
            }`}
          />
        )}
        {snapshot.tamperProcessCount != null && snapshot.tamperProcessCount > 0 && (
          <Field
            label="Tamper processes"
            value={
              snapshot.runningTamperProcesses && snapshot.runningTamperProcesses.length > 0
                ? snapshot.runningTamperProcesses.map((p) => p.name).join(', ')
                : String(snapshot.tamperProcessCount)
            }
          />
        )}
      </dl>
    </section>
  );
}

// ─── Per-device productivity ──────────────────────────────────────────
//
// Two pieces:
//   • Today's split — big "active hours" number + idle/locked counts +
//     a single-line stacked bar
//   • 7-day chart — one stacked-bar column per day for the last week
//     so the SUPER_ADMIN can see whether today is on-trend or an
//     outlier
//
// The 7-day chart fetches /admin/pulse/devices/:id/productivity?days=7
// (already exposed by the backend). Falls back gracefully when a day
// has no snapshots ("offSeconds" fills the column).

function DeviceProductivitySection({
  device,
}: {
  device: import('@exargen/shared').PulseDeviceDetail;
}) {
  const { data: rollup, isLoading } = useQuery({
    queryKey: ['pulse', 'productivity', device.id],
    queryFn: () => getDeviceProductivityApi(device.id, 7),
    refetchInterval: 60_000,
  });

  return (
    <section>
      <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
        Productivity
      </h3>
      <TodayProductivityHeader
        active={device.todayActiveSeconds}
        idle={device.todayIdleSeconds}
        locked={device.todayLockedSeconds}
      />
      <div className="mt-4">
        {isLoading ? (
          <p className="text-xs text-gray-400">Loading chart…</p>
        ) : !rollup || rollup.days.length === 0 ? null : (
          <SevenDayChart days={rollup.days} />
        )}
      </div>
    </section>
  );
}

function TodayProductivityHeader({
  active,
  idle,
  locked,
}: {
  active: number;
  idle: number;
  locked: number;
}) {
  const total = Math.max(1, active + idle + locked);
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className="rounded-lg border border-gray-200 p-4 space-y-3">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-2xl font-bold text-gray-900">
            {formatHoursMinutes(active)}
          </div>
          <div className="text-xs text-gray-500">active today</div>
        </div>
        <div className="text-right text-xs text-gray-500 space-y-0.5">
          <div>Idle {formatHoursMinutes(idle)}</div>
          <div>Locked {formatHoursMinutes(locked)}</div>
        </div>
      </div>
      {active + idle + locked === 0 ? (
        <p className="text-xs text-gray-500">
          No buckets yet today — next hourly snapshot will populate this.
        </p>
      ) : (
        <div className="h-2 rounded-full overflow-hidden bg-gray-100 flex">
          <div className="bg-emerald-500" style={{ width: pct(active) }} />
          <div className="bg-amber-400" style={{ width: pct(idle) }} />
          <div className="bg-gray-400" style={{ width: pct(locked) }} />
        </div>
      )}
    </div>
  );
}

function SevenDayChart({
  days,
}: {
  days: { date: string; activeSeconds: number; idleSeconds: number; lockedSeconds: number; offSeconds: number }[];
}) {
  // Pin the y-axis at 24h. Each column's segments are heights
  // proportional to that day's accounting. Off seconds (gap when the
  // agent wasn't running) get a faint background so the column always
  // reaches 24h — making it visually obvious how much of the day was
  // actually tracked vs. not.
  const DAY_SECONDS = 24 * 60 * 60;
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-medium text-gray-700">Last 7 days</h4>
        <div className="text-xs text-gray-500 space-x-3">
          <Legend color="bg-emerald-500" label="Active" />
          <Legend color="bg-amber-400" label="Idle" />
          <Legend color="bg-gray-400" label="Locked" />
          <Legend color="bg-gray-100" label="No data" />
        </div>
      </div>
      <div className="flex items-end gap-2 h-40 bg-white">
        {days.map((d) => {
          const activeH = (d.activeSeconds / DAY_SECONDS) * 100;
          const idleH = (d.idleSeconds / DAY_SECONDS) * 100;
          const lockedH = (d.lockedSeconds / DAY_SECONDS) * 100;
          const offH = (d.offSeconds / DAY_SECONDS) * 100;
          return (
            <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
              <div
                className="w-full h-full rounded-md overflow-hidden flex flex-col-reverse border border-gray-200"
                title={`${d.date}\nActive ${formatHoursMinutes(d.activeSeconds)}\nIdle ${formatHoursMinutes(d.idleSeconds)}\nLocked ${formatHoursMinutes(d.lockedSeconds)}\nNo data ${formatHoursMinutes(d.offSeconds)}`}
              >
                <div className="bg-emerald-500" style={{ height: `${activeH}%` }} />
                <div className="bg-amber-400" style={{ height: `${idleH}%` }} />
                <div className="bg-gray-400" style={{ height: `${lockedH}%` }} />
                <div className="bg-gray-100" style={{ height: `${offH}%` }} />
              </div>
              <div className="text-[10px] text-gray-500">
                {formatShortDate(d.date)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block w-2 h-2 rounded-sm ${color}`} />
      {label}
    </span>
  );
}

function formatShortDate(yyyymmdd: string): string {
  // Trust the YYYY-MM-DD string; render as "Wed" / "Mon" etc.
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}

function DeviceAlertsSection({
  alerts,
}: {
  alerts: import('@exargen/shared').PulseDeviceDetail['openAlerts'];
}) {
  if (alerts.length === 0) {
    return (
      <section>
        <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
          Open alerts
        </h3>
        <p className="text-sm text-gray-500 flex items-center gap-2">
          <CheckCircle2 size={14} className="text-emerald-500" />
          None
        </p>
      </section>
    );
  }
  return (
    <section>
      <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
        Open alerts ({alerts.length})
      </h3>
      <ul className="space-y-2">
        {alerts.map((a) => (
          <li
            key={a.id}
            className="rounded-lg border border-gray-200 p-3 flex items-start gap-3"
          >
            <SeverityIcon severity={a.severity} />
            <div>
              <div className="text-sm font-medium text-gray-900">
                {a.type.replace(/_/g, ' ')}
              </div>
              <div className="text-xs text-gray-600">{a.message}</div>
              <div className="text-xs text-gray-400 mt-0.5">
                Opened {new Date(a.openedAt).toLocaleString()}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DevicePatchesSection({
  patches,
}: {
  patches: import('@exargen/shared').PulseDeviceDetail['missingPatches'];
}) {
  if (patches.length === 0) {
    return (
      <section>
        <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
          Missing patches
        </h3>
        <p className="text-sm text-gray-500 flex items-center gap-2">
          <CheckCircle2 size={14} className="text-emerald-500" />
          Fully patched
        </p>
      </section>
    );
  }
  return (
    <section>
      <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
        Missing patches ({patches.length})
      </h3>
      <div className="rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-600 uppercase">
            <tr>
              <th className="px-3 py-2">KB / Patch ID</th>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Severity</th>
              <th className="px-3 py-2">First seen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {patches.map((p) => (
              <tr key={p.id}>
                <td className="px-3 py-2 font-mono text-xs text-gray-900">
                  {p.patchId}
                </td>
                <td className="px-3 py-2 text-gray-700">
                  {p.title ?? '—'}
                  {p.classification && (
                    <div className="text-xs text-gray-400">{p.classification}</div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <PatchSeverityBadge severity={p.severity} />
                </td>
                <td className="px-3 py-2 text-xs text-gray-500">
                  {new Date(p.firstSeenAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DeviceSoftwareSection({
  software,
}: {
  software: import('@exargen/shared').PulseDeviceDetail['installedSoftware'];
}) {
  const [showRiskyOnly, setShowRiskyOnly] = useState(false);
  const riskyCount = software.filter((s) => s.isRisky).length;
  const visible = showRiskyOnly ? software.filter((s) => s.isRisky) : software;

  if (software.length === 0) {
    return (
      <section>
        <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
          Installed software
        </h3>
        <p className="text-sm text-gray-500">
          No software inventory yet — first hourly snapshot pending.
        </p>
      </section>
    );
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
          Installed software ({software.length}
          {riskyCount > 0 && `, ${riskyCount} risky`})
        </h3>
        {riskyCount > 0 && (
          <button
            onClick={() => setShowRiskyOnly((v) => !v)}
            className="text-xs text-brand-600 hover:underline"
          >
            {showRiskyOnly ? 'Show all' : 'Show risky only'}
          </button>
        )}
      </div>
      <div className="rounded-lg border border-gray-200 overflow-hidden max-h-96 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-600 uppercase sticky top-0">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Version</th>
              <th className="px-3 py-2">Publisher</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {visible.map((s) => (
              <tr key={s.id}>
                <td className="px-3 py-2 text-gray-900 flex items-center gap-2">
                  <Package size={12} className="text-gray-400" />
                  {s.name}
                </td>
                <td className="px-3 py-2 text-gray-600 text-xs">
                  {s.version || '—'}
                </td>
                <td className="px-3 py-2 text-gray-500 text-xs">
                  {s.publisher || '—'}
                </td>
                <td className="px-3 py-2">
                  {s.isRisky && (
                    <span
                      className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-xs"
                      title={s.riskReason ?? undefined}
                    >
                      Risky
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-900">{value}</dd>
    </div>
  );
}

function BooleanField({
  label,
  value,
  positiveTrue,
}: {
  label: string;
  value: boolean | null;
  // When positiveTrue=true (e.g. "Antivirus enabled"), true is good (green),
  // false is bad (red). When positiveTrue=false (e.g. "Reboot pending"),
  // true is bad (red), false is good (green).
  positiveTrue: boolean;
}) {
  let display = '—';
  let cls = 'text-gray-400';
  if (value === true) {
    display = positiveTrue ? 'Enabled' : 'Yes';
    cls = positiveTrue ? 'text-emerald-700' : 'text-rose-700';
  } else if (value === false) {
    display = positiveTrue ? 'Disabled' : 'No';
    cls = positiveTrue ? 'text-rose-700' : 'text-emerald-700';
  }
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className={`text-sm font-medium ${cls}`}>{display}</dd>
    </div>
  );
}

function PatchSeverityBadge({ severity }: { severity: string | null }) {
  if (!severity) return <span className="text-xs text-gray-400">—</span>;
  const sev = severity.trim().toLowerCase();
  let cls = 'bg-gray-100 text-gray-700';
  if (sev === 'critical') cls = 'bg-rose-100 text-rose-700';
  else if (sev === 'important') cls = 'bg-amber-100 text-amber-700';
  else if (sev === 'moderate') cls = 'bg-yellow-100 text-yellow-700';
  else if (sev === 'low') cls = 'bg-gray-100 text-gray-600';
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {severity}
    </span>
  );
}

// ─── Shared blocks ───────────────────────────────────────────────────

function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-gray-500 py-12 justify-center">
      <Loader2 size={16} className="animate-spin" />
      {label}
    </div>
  );
}

function EmptyBlock({ message }: { message: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-500">
      {message}
    </div>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-sm text-rose-700">
      {message}
    </div>
  );
}

// ─── Employees tab (per-employee activity, 2026-05-29) ───────────────

function EmployeesTab() {
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [hideUnenrolled, setHideUnenrolled] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ['pulse', 'employees'],
    queryFn: listPulseEmployees,
    refetchInterval: 30_000,
  });

  // Sort: enrolled employees first (those with at least one device), broken
  // by productivity score. Unenrolled employees go to the bottom in name
  // order — they don't have a meaningful score and shouldn't be ranked
  // against people whose laptops are actually reporting.
  const sorted = useMemo(() => {
    if (!data) return [];
    return [...data].sort((a, b) => {
      const aEnrolled = a.deviceCount > 0 ? 1 : 0;
      const bEnrolled = b.deviceCount > 0 ? 1 : 0;
      if (aEnrolled !== bEnrolled) return bEnrolled - aEnrolled;
      if (a.deviceCount > 0 && b.deviceCount > 0) {
        return b.productivityScore - a.productivityScore;
      }
      return a.user.name.localeCompare(b.user.name);
    });
  }, [data]);

  const enrolledCount = data?.filter((e) => e.deviceCount > 0).length ?? 0;
  const unenrolledCount = (data?.length ?? 0) - enrolledCount;

  const visible = hideUnenrolled ? sorted.filter((e) => e.deviceCount > 0) : sorted;

  if (isLoading) return <LoadingBlock label="Loading employees…" />;
  if (error || !data) return <ErrorBlock message="Failed to load employees." />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            {enrolledCount} enrolled
          </span>
          {unenrolledCount > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-100 text-gray-600 font-medium">
              <UserMinus size={11} />
              {unenrolledCount} not yet enrolled
            </span>
          )}
        </div>
        {unenrolledCount > 0 && (
          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={hideUnenrolled}
              onChange={(e) => setHideUnenrolled(e.target.checked)}
              className="rounded border-gray-300"
            />
            Hide unenrolled
          </label>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50/80 text-left text-[11px] font-semibold text-gray-600 uppercase tracking-wider">
            <tr>
              <th className="px-4 py-3">Employee</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Score</th>
              <th className="px-4 py-3">Current app</th>
              <th className="px-4 py-3">Active today</th>
              <th className="px-4 py-3">Category split</th>
              <th className="px-4 py-3 text-center">Devices</th>
              <th className="px-4 py-3 text-center">Alerts</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {visible.map((e) => {
              const isEnrolled = e.deviceCount > 0;
              return (
                <tr
                  key={e.user.id}
                  className={cn(
                    'group cursor-pointer transition-colors',
                    isEnrolled ? 'hover:bg-brand-50/40' : 'hover:bg-gray-50 text-gray-500',
                  )}
                  onClick={() => setSelectedUserId(e.user.id)}
                >
                  <td className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-3">
                      <EmployeeAvatar name={e.user.name} dimmed={!isEnrolled} />
                      <div>
                        <div className={isEnrolled ? 'text-gray-900' : 'text-gray-700'}>
                          {e.user.name}
                        </div>
                        <div className="text-xs text-gray-400">{e.user.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {isEnrolled ? (
                      <PresenceBadge presence={e.presence} />
                    ) : (
                      <NotEnrolledBadge />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isEnrolled ? (
                      <ProductivityScoreBadge
                        score={e.productivityScore}
                        band={e.productivityBand}
                        summary={e.productivitySummary}
                      />
                    ) : (
                      <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-400">
                        —
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {e.currentApp ? (
                      <div>
                        <div className="text-gray-900">
                          {e.currentApp.appDisplayName ?? e.currentApp.appName}
                        </div>
                        <div className="text-xs text-gray-500 truncate max-w-[200px]">
                          {e.currentApp.windowTitle ?? ''}
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isEnrolled ? (
                      <span className="font-semibold text-gray-900 tabular-nums">
                        {formatHoursMinutes(e.todayActiveSeconds)}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 min-w-[180px]">
                    <CategorySplitBar
                      productive={e.todayProductiveSeconds}
                      communication={e.todayCommunicationSeconds}
                      entertainment={e.todayEntertainmentSeconds}
                      personal={e.todayPersonalSeconds}
                      unknown={e.todayUnknownSeconds}
                      tamper={e.todayTamperSeconds}
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    {e.deviceCount > 0 ? (
                      <span className="inline-flex items-center gap-1 text-gray-700 font-medium tabular-nums">
                        <Monitor size={12} className="text-gray-400" />
                        {e.deviceCount}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-300">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {e.openAlertCount > 0 ? (
                      <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[11px] font-semibold bg-rose-100 text-rose-700 tabular-nums">
                        {e.openAlertCount}
                      </span>
                    ) : isEnrolled ? (
                      <CheckCircle2 size={14} className="text-emerald-500 inline-block" />
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-sm text-gray-500">
                  No employees match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedUserId && (
        <EmployeeDetailDrawer
          userId={selectedUserId}
          onClose={() => setSelectedUserId(null)}
        />
      )}
    </div>
  );
}

// Tiny initials avatar (no image fetch needed). Deterministic colour from
// a hash of the name so the same person always gets the same chip.
function EmployeeAvatar({ name, dimmed }: { name: string; dimmed?: boolean }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  // Deterministic colour: simple djb2-ish hash mod the palette length.
  const palettes = [
    'bg-rose-100 text-rose-700',
    'bg-amber-100 text-amber-700',
    'bg-emerald-100 text-emerald-700',
    'bg-sky-100 text-sky-700',
    'bg-violet-100 text-violet-700',
    'bg-fuchsia-100 text-fuchsia-700',
    'bg-cyan-100 text-cyan-700',
    'bg-lime-100 text-lime-700',
  ];
  let hash = 5381;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) + hash + name.charCodeAt(i)) & 0xffffffff;
  }
  const colour = palettes[Math.abs(hash) % palettes.length];
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center w-9 h-9 rounded-full font-semibold text-xs ring-1 ring-inset ring-white/40 shrink-0',
        dimmed ? 'bg-gray-100 text-gray-400' : colour,
      )}
      aria-hidden
    >
      {initials || '?'}
    </span>
  );
}

// "Not enrolled" is materially different from "OFFLINE":
//   * OFFLINE = device exists, heartbeat stopped (could be agent crash)
//   * NOT ENROLLED = no device row at all (we have nothing to report)
// Showing both as the same gray "OFFLINE" pill made the table feel like
// the whole org was dark. This is the neutral state.
function NotEnrolledBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
      <UserMinus size={11} />
      Not enrolled
    </span>
  );
}

function ProductivityScoreBadge({
  score,
  band,
  summary,
}: {
  score: number;
  band: 'HIGH' | 'MEDIUM' | 'LOW';
  summary: string;
}) {
  // Special-case: an enrolled employee whose agent simply hasn't reported
  // any activity yet today shouldn't be flagged red as "LOW productivity".
  // Score 0 with a stock summary message gets a neutral pill saying "no
  // data yet" — much truer to what's happening.
  if (score === 0 && band === 'LOW') {
    return (
      <div
        title={summary || 'No productivity data reported yet today.'}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-gray-200 bg-gray-50 text-gray-500 text-xs font-medium"
      >
        <span className="font-bold text-sm tabular-nums">—</span>
        <span className="uppercase tracking-wide text-[10px]">No data</span>
      </div>
    );
  }
  const palette: Record<typeof band, string> = {
    HIGH: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    MEDIUM: 'bg-amber-50 text-amber-700 border-amber-200',
    LOW: 'bg-rose-50 text-rose-700 border-rose-200',
  };
  return (
    <div
      title={summary}
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border ${palette[band]} text-xs font-medium`}
    >
      <span className="font-bold text-sm tabular-nums">{score}</span>
      <span className="opacity-80 uppercase tracking-wide text-[10px]">{band}</span>
    </div>
  );
}

function PresenceBadge({ presence }: { presence: import('@exargen/shared').EmployeePresence }) {
  const palette: Record<typeof presence, string> = {
    ONLINE: 'bg-emerald-100 text-emerald-700',
    AWAY: 'bg-amber-100 text-amber-700',
    LOCKED: 'bg-gray-100 text-gray-700',
    OFFLINE: 'bg-gray-100 text-gray-500',
  };
  const dotPalette: Record<typeof presence, string> = {
    ONLINE: 'bg-emerald-500',
    AWAY: 'bg-amber-400',
    LOCKED: 'bg-gray-400',
    OFFLINE: 'bg-gray-300',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${palette[presence]}`}
    >
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full ${dotPalette[presence]} ${
          presence === 'ONLINE' ? 'animate-pulse' : ''
        }`}
      />
      {presence}
    </span>
  );
}

function CategorySplitBar({
  productive,
  communication,
  entertainment,
  personal,
  unknown,
  tamper,
}: {
  productive: number;
  communication: number;
  entertainment: number;
  personal: number;
  unknown: number;
  tamper: number;
}) {
  const realTotal = productive + communication + entertainment + personal + unknown + tamper;

  // When there's no data yet, draw a faint ghost track + a quiet caption
  // instead of an invisible zero-width bar — empty state should still
  // communicate "the row exists, we just have nothing to plot".
  if (realTotal === 0) {
    return (
      <div>
        <div className="h-2 rounded-full bg-gray-100" />
        <div className="mt-1 text-[10px] text-gray-400 italic">No activity yet</div>
      </div>
    );
  }

  const pct = (n: number) => `${(n / realTotal) * 100}%`;
  return (
    <div>
      <div className="h-2 rounded-full overflow-hidden bg-gray-100 flex">
        <div className="bg-emerald-500" style={{ width: pct(productive) }} title={`Productive ${formatHoursMinutes(productive)}`} />
        <div className="bg-sky-400" style={{ width: pct(communication) }} title={`Communication ${formatHoursMinutes(communication)}`} />
        <div className="bg-rose-400" style={{ width: pct(entertainment) }} title={`Entertainment ${formatHoursMinutes(entertainment)}`} />
        <div className="bg-violet-400" style={{ width: pct(personal) }} title={`Personal ${formatHoursMinutes(personal)}`} />
        <div className="bg-gray-300" style={{ width: pct(unknown) }} title={`Unknown ${formatHoursMinutes(unknown)}`} />
        <div className="bg-orange-600" style={{ width: pct(tamper) }} title={`Tamper ${formatHoursMinutes(tamper)}`} />
      </div>
      <div className="mt-1 text-[10px] text-gray-500 tabular-nums">
        Prod {formatHoursMinutes(productive)}
        <span className="text-gray-300 mx-1">·</span>
        Comm {formatHoursMinutes(communication)}
        <span className="text-gray-300 mx-1">·</span>
        Ent {formatHoursMinutes(entertainment)}
      </div>
    </div>
  );
}

function EmployeeDetailDrawer({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['pulse', 'employee', userId],
    queryFn: () => getPulseEmployee(userId),
    refetchInterval: 30_000,
  });

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex justify-end"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-3xl h-full overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity size={20} className="text-brand-600" />
            <div>
              <h2 className="font-semibold text-gray-900">
                {data?.user.name ?? 'Employee'}
              </h2>
              <p className="text-xs text-gray-500">
                {data?.user.email} · {data?.user.role}
              </p>
            </div>
            {data && <PresenceBadge presence={data.presence} />}
          </div>
          <button onClick={onClose}>
            <X size={20} className="text-gray-400 hover:text-gray-700" />
          </button>
        </div>

        {isLoading ? (
          <LoadingBlock label="Loading employee…" />
        ) : error || !data ? (
          <ErrorBlock message="Failed to load employee detail." />
        ) : (
          <div className="p-6 space-y-6">
            <EmployeeTodaySection employee={data} />
            <EmployeeWeekChart days={data.weekHistory} />
            <EmployeeAppsSection apps={data.allAppsToday} />
            <EmployeeDevicesSection devices={data.devices} />
          </div>
        )}
      </div>
    </div>
  );
}

function EmployeeScorePanel({ employee }: { employee: import('@exargen/shared').PulseEmployeeDetail }) {
  const bandStyle: Record<typeof employee.productivityBand, { ring: string; text: string; bg: string }> = {
    HIGH: { ring: 'ring-emerald-300', text: 'text-emerald-700', bg: 'bg-emerald-50' },
    MEDIUM: { ring: 'ring-amber-300', text: 'text-amber-700', bg: 'bg-amber-50' },
    LOW: { ring: 'ring-rose-300', text: 'text-rose-700', bg: 'bg-rose-50' },
  };
  const style = bandStyle[employee.productivityBand];
  return (
    <div className={`rounded-lg p-4 ring-1 ${style.ring} ${style.bg}`}>
      <div className="flex items-start gap-4">
        <div className="text-center min-w-[80px]">
          <div className={`text-4xl font-extrabold tabular-nums ${style.text}`}>
            {employee.productivityScore}
          </div>
          <div className={`text-xs font-semibold ${style.text}`}>{employee.productivityBand}</div>
        </div>
        <div className="flex-1">
          <div className="text-sm font-medium text-gray-900 mb-2">
            {employee.productivitySummary}
          </div>
          {employee.productivityBreakdown.length > 0 && (
            <ul className="text-xs space-y-1">
              {employee.productivityBreakdown.map((b, i) => (
                <li key={i} className="flex items-center gap-2 text-gray-700">
                  <span
                    className={`tabular-nums font-mono w-10 text-right ${
                      b.delta > 0
                        ? 'text-emerald-600'
                        : b.delta < 0
                          ? 'text-rose-600'
                          : 'text-gray-400'
                    }`}
                  >
                    {b.delta > 0 ? '+' : ''}
                    {b.delta}
                  </span>
                  <span>{b.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function EmployeeTodaySection({ employee }: { employee: import('@exargen/shared').PulseEmployeeDetail }) {
  return (
    <section className="rounded-lg border border-gray-200 p-4 space-y-4">
      <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
        Today
      </h3>
      <EmployeeScorePanel employee={employee} />
      <div className="grid grid-cols-3 gap-3">
        <div>
          <div className="text-2xl font-bold text-gray-900">{formatHoursMinutes(employee.todayActiveSeconds)}</div>
          <div className="text-xs text-gray-500">screen time (active)</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-emerald-600">{formatHoursMinutes(employee.todayProductiveSeconds)}</div>
          <div className="text-xs text-gray-500">productive</div>
        </div>
        <div>
          <div className={`text-2xl font-bold ${employee.todayEntertainmentSeconds > 0 ? 'text-rose-600' : 'text-gray-400'}`}>
            {formatHoursMinutes(employee.todayEntertainmentSeconds)}
          </div>
          <div className="text-xs text-gray-500">entertainment</div>
        </div>
      </div>
      <CategorySplitBar
        productive={employee.todayProductiveSeconds}
        communication={employee.todayCommunicationSeconds}
        entertainment={employee.todayEntertainmentSeconds}
        personal={employee.todayPersonalSeconds}
        unknown={employee.todayUnknownSeconds}
        tamper={employee.todayTamperSeconds}
      />
      {employee.currentSessionStart && (
        <div className="text-xs text-gray-500">
          Logged in at {new Date(employee.currentSessionStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}
      {employee.currentApp && (
        <div className="text-xs text-gray-700 mt-2">
          <span className="font-medium">Now on:</span>{' '}
          {employee.currentApp.appDisplayName ?? employee.currentApp.appName}
          {employee.currentApp.windowTitle && (
            <span className="text-gray-500"> — {employee.currentApp.windowTitle}</span>
          )}
        </div>
      )}
      {employee.todayTamperSeconds > 0 && (
        <div className="bg-orange-50 border border-orange-200 text-orange-800 rounded-md p-2 text-xs">
          ⚠ Tamper tool detected for {formatHoursMinutes(employee.todayTamperSeconds)} today.
        </div>
      )}
    </section>
  );
}

function EmployeeAppsSection({ apps }: { apps: import('@exargen/shared').PulseEmployeeAppSummary[] }) {
  if (apps.length === 0) {
    return (
      <section>
        <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
          Apps today
        </h3>
        <p className="text-sm text-gray-500">No app activity reported yet today.</p>
      </section>
    );
  }
  return (
    <section>
      <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
        Apps today ({apps.length})
      </h3>
      <div className="rounded-lg border border-gray-200 overflow-hidden max-h-96 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-600 uppercase sticky top-0">
            <tr>
              <th className="px-3 py-2">App</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Latest window title</th>
              <th className="px-3 py-2 text-right">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {apps.map((a) => (
              <tr key={a.appName}>
                <td className="px-3 py-2 text-gray-900">{a.appDisplayName ?? a.appName}</td>
                <td className="px-3 py-2"><CategoryBadge category={a.category} reason={a.categoryReason} /></td>
                <td className="px-3 py-2 text-xs text-gray-500 truncate max-w-[280px]">
                  {a.lastWindowTitle ?? '—'}
                </td>
                <td className="px-3 py-2 text-right font-medium text-gray-900">
                  {formatHoursMinutes(a.foregroundSeconds)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CategoryBadge({
  category,
  reason,
}: {
  category: import('@exargen/shared').AppCategory;
  reason: string | null;
}) {
  const palette: Record<typeof category, string> = {
    PRODUCTIVE: 'bg-emerald-100 text-emerald-700',
    COMMUNICATION: 'bg-sky-100 text-sky-700',
    ENTERTAINMENT: 'bg-rose-100 text-rose-700',
    PERSONAL: 'bg-violet-100 text-violet-700',
    UNKNOWN: 'bg-gray-100 text-gray-600',
    TAMPER: 'bg-orange-100 text-orange-800',
  };
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-xs font-medium ${palette[category]}`}
      title={reason ?? undefined}
    >
      {category}
    </span>
  );
}

function EmployeeWeekChart({
  days,
}: {
  days: import('@exargen/shared').PulseEmployeeDetail['weekHistory'];
}) {
  const DAY_SECONDS = 24 * 60 * 60;
  return (
    <section>
      <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
        Last 7 days
      </h3>
      <div className="flex items-end gap-2 h-40">
        {days.map((d) => {
          const pH = (d.productiveSeconds / DAY_SECONDS) * 100;
          const cH = (d.communicationSeconds / DAY_SECONDS) * 100;
          const eH = (d.entertainmentSeconds / DAY_SECONDS) * 100;
          const persH = (d.personalSeconds / DAY_SECONDS) * 100;
          const uH = (d.unknownSeconds / DAY_SECONDS) * 100;
          const tH = (d.tamperSeconds / DAY_SECONDS) * 100;
          return (
            <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
              <div
                className="w-full h-full rounded-md overflow-hidden flex flex-col-reverse border border-gray-200"
                title={`${d.date}\nProductive ${formatHoursMinutes(d.productiveSeconds)}\nCommunication ${formatHoursMinutes(d.communicationSeconds)}\nEntertainment ${formatHoursMinutes(d.entertainmentSeconds)}\nPersonal ${formatHoursMinutes(d.personalSeconds)}\nUnknown ${formatHoursMinutes(d.unknownSeconds)}\nTamper ${formatHoursMinutes(d.tamperSeconds)}`}
              >
                <div className="bg-emerald-500" style={{ height: `${pH}%` }} />
                <div className="bg-sky-400" style={{ height: `${cH}%` }} />
                <div className="bg-rose-400" style={{ height: `${eH}%` }} />
                <div className="bg-violet-400" style={{ height: `${persH}%` }} />
                <div className="bg-gray-300" style={{ height: `${uH}%` }} />
                <div className="bg-orange-600" style={{ height: `${tH}%` }} />
              </div>
              <div className="text-[10px] text-gray-500">
                {formatShortDate(d.date)}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function EmployeeDevicesSection({
  devices,
}: {
  devices: import('@exargen/shared').PulseDeviceSummary[];
}) {
  return (
    <section>
      <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
        Devices ({devices.length})
      </h3>
      {devices.length === 0 ? (
        <p className="text-sm text-gray-500">No active devices.</p>
      ) : (
        <ul className="space-y-2">
          {devices.map((d) => (
            <li key={d.id} className="rounded-lg border border-gray-200 p-3 flex items-center justify-between">
              <div>
                <div className="font-medium text-gray-900">{d.hostname}</div>
                <div className="text-xs text-gray-500">
                  {d.platform} · {d.osVersion ?? '—'} · last seen {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleTimeString() : '—'}
                </div>
              </div>
              <RiskBadge level={d.currentRiskLevel} score={d.currentRiskScore} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Clock log (team-wide, SUPER_ADMIN) ──────────────────────────────

function ClockLogTab() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const { data, isLoading } = useQuery({
    queryKey: ['pulse', 'clock', date],
    queryFn: () => getTeamClockStatusApi(date),
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-600">Date</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
        />
      </div>
      {isLoading ? (
        <LoadingBlock label="Loading clock log…" />
      ) : !data || data.length === 0 ? (
        <EmptyBlock message="No one has clocked in or out on this date." />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Sessions</th>
                <th className="px-4 py-3">Total today</th>
                <th className="px-4 py-3">Currently in since</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.map((row) => {
                const h = Math.floor(row.totalSecondsToday / 3600);
                const m = Math.floor((row.totalSecondsToday % 3600) / 60);
                return (
                  <tr key={row.user.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {row.user.name}
                      <div className="text-xs text-gray-500">{row.user.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      {row.openSession ? (
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700">
                          Clocked in
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                          Clocked out
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{row.sessionCountToday}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {h}h {m.toString().padStart(2, '0')}m
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {row.openSession
                        ? new Date(row.openSession.clockedInAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
