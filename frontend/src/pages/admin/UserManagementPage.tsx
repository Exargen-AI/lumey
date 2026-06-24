import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Plus, UserPlus, UserMinus, Edit2, AlertCircle, Users, Bot } from 'lucide-react';
import { getUsers, createUser, updateUser, resetUserPassword, deactivateUser, setAgentViewers } from '@/api/users';
import { ROLE_LABELS } from '@/lib/constants';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/formatters';
import { Can } from '@/components/auth/Can';
import { Button, Modal, Field, Input, Select, Tooltip, Badge, useConfirm } from '@/components/ui';
import { useAuthStore } from '@/stores/authStore';

type UserTypeFilter = 'all' | 'human' | 'agent';

export function UserManagementPage() {
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [resettingUser, setResettingUser] = useState<any>(null);
  const [userTypeFilter, setUserTypeFilter] = useState<UserTypeFilter>('all');
  const [showAgentAccessModal, setShowAgentAccessModal] = useState(false);
  const qc = useQueryClient();

  // Super-admin armor for the agent-platform UI: only super-admins see the
  // userType filter, the AGENT pill in rows, and the "Agent Configuration"
  // section in the add/edit modals. Other admins see the page exactly as it
  // worked before the agent-platform feature shipped — agents look like any
  // other user (ghost-in-team mode for v1).
  const isSuperAdmin = useAuthStore((s) => s.user?.role === 'SUPER_ADMIN');

  const deactivateMutation = useMutation({
    mutationFn: deactivateUser,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => updateUser(id, { isActive: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  const confirm = useConfirm();
  const handleToggleActive = async (user: any) => {
    const action = user.isActive ? 'Deactivate' : 'Reactivate';
    const ok = await confirm({
      title: `${action} ${user.name}?`,
      body: user.isActive
        ? 'They will lose access to the platform immediately.'
        : 'They will regain access to the platform.',
      tone: user.isActive ? 'danger' : 'brand',
      confirmLabel: action,
    });
    if (!ok) return;
    if (user.isActive) deactivateMutation.mutate(user.id);
    else reactivateMutation.mutate(user.id);
  };

  const params: Record<string, string> = {};
  if (search) params.search = search;

  const { data: users, isLoading } = useQuery({
    queryKey: ['users', params],
    queryFn: () => getUsers(Object.keys(params).length > 0 ? params : undefined),
  });

  const filteredUsers = useMemo(() => {
    const list = users ?? [];
    if (!isSuperAdmin || userTypeFilter === 'all') return list;
    const wanted = userTypeFilter === 'agent' ? 'AGENT' : 'HUMAN';
    return list.filter((u: any) => (u.userType ?? 'HUMAN') === wanted);
  }, [users, userTypeFilter, isSuperAdmin]);

  return (
    <div className="space-y-6">
      {/* ─── Header ─── */}
      <div className="flex items-end justify-between gap-4 animate-fade-in-down">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-brand-500/10 dark:bg-brand-500/15 ring-1 ring-brand-500/20 flex items-center justify-center">
            <Users size={18} className="text-brand-600 dark:text-brand-400" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">User Management</h1>
            <p className="text-[12px] text-gray-500 dark:text-obsidian-muted mt-0.5">
              {filteredUsers.length > 0
                ? `${filteredUsers.length} ${filteredUsers.length === 1 ? 'user' : 'users'} in the workspace`
                : 'Manage workspace members and their access'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* 2026-06-01 — SUPER_ADMIN manages who can see AI agents. */}
          {isSuperAdmin && (
            <Button variant="secondary" size="sm" leadingIcon={<Bot size={14} />} onClick={() => setShowAgentAccessModal(true)}>
              Agent access
            </Button>
          )}
          <Button variant="primary" size="sm" leadingIcon={<Plus size={14} />} onClick={() => setShowAddModal(true)}>
            Add User
          </Button>
        </div>
      </div>

      {/* ─── Search + (super-admin only) user-type filter ─── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-md flex-1 min-w-[240px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-obsidian-faded pointer-events-none" />
          <Input
            type="text"
            placeholder="Search users by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {isSuperAdmin && (
          <div className="inline-flex rounded-md border border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-panel p-0.5 text-[12px] font-medium">
            {(['all', 'human', 'agent'] as UserTypeFilter[]).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setUserTypeFilter(opt)}
                className={cn(
                  'px-3 py-1 rounded',
                  userTypeFilter === opt
                    ? 'bg-brand-500/10 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                    : 'text-gray-600 dark:text-obsidian-muted hover:text-gray-900 dark:hover:text-obsidian-fg',
                )}
              >
                {opt === 'all' ? 'All' : opt === 'human' ? 'Humans' : 'Agents'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ─── User table ─── */}
      <div className={cn(
        'rounded-2xl overflow-hidden',
        'bg-white border border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
        'shadow-soft dark:shadow-soft-dark',
      )}>
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 dark:border-obsidian-border bg-gray-50 dark:bg-obsidian-sunken/60">
              {['Name', 'Email', 'Role', 'Status', 'Created'].map((h) => (
                <th key={h} className="text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted px-6 py-3">
                  {h}
                </th>
              ))}
              <th className="text-right text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted px-6 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <>
                {[1, 2, 3, 4, 5].map((i) => (
                  <tr key={i} className="border-b border-gray-100 dark:border-obsidian-border/60">
                    <td colSpan={6} className="px-6 py-4">
                      <div className="skeleton h-4 rounded w-3/4" />
                    </td>
                  </tr>
                ))}
              </>
            ) : filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-14">
                  <Users size={32} strokeWidth={1.5} className="mx-auto text-gray-300 dark:text-obsidian-faded mb-3" />
                  <p className="text-sm text-gray-500 dark:text-obsidian-muted">
                    {search ? `No users match "${search}"` : 'No users found.'}
                  </p>
                  {search && (
                    <button
                      onClick={() => setSearch('')}
                      className="mt-2 text-[12px] text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 font-medium"
                    >
                      Clear search
                    </button>
                  )}
                </td>
              </tr>
            ) : (
              filteredUsers.map((user: any) => (
                <tr key={user.id} className="border-b border-gray-100 dark:border-obsidian-border/60 last:border-b-0 hover:bg-gray-50/60 dark:hover:bg-obsidian-raised/40 transition-colors">
                  <td className="px-6 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        'w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-semibold text-white',
                        // Visual differentiation for agents in the super-admin
                        // view only — gradient swaps from brand violet to a
                        // teal so a quick glance shows which row is non-human.
                        // Non-super-admins see the standard avatar (ghost mode).
                        isSuperAdmin && user.userType === 'AGENT'
                          ? 'bg-gradient-to-br from-teal-400 to-teal-600'
                          : 'bg-gradient-to-br from-brand-400 to-brand-600',
                      )}>
                        {isSuperAdmin && user.userType === 'AGENT' ? (
                          <Bot size={14} />
                        ) : (
                          user.name.charAt(0).toUpperCase()
                        )}
                      </div>
                      <span className="text-[13px] font-medium text-gray-900 dark:text-obsidian-fg flex items-center gap-2">
                        {user.name}
                        {isSuperAdmin && user.userType === 'AGENT' && (
                          <span className="text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300">
                            Agent
                          </span>
                        )}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-3.5 text-[13px] text-gray-600 dark:text-obsidian-muted">{user.email}</td>
                  <td className="px-6 py-3.5">
                    <Badge tone="neutral">{ROLE_LABELS[user.role as keyof typeof ROLE_LABELS] ?? user.role}</Badge>
                  </td>
                  <td className="px-6 py-3.5">
                    <Badge tone={user.isActive ? 'success' : 'danger'} dot>
                      {user.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                  <td className="px-6 py-3.5 text-[12px] text-gray-400 dark:text-obsidian-faded">{formatDate(user.createdAt)}</td>
                  <td className="px-6 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Can permission="user.edit">
                        <Tooltip content="Edit user" side="top">
                          <button
                            onClick={() => setEditingUser(user)}
                            className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-obsidian-raised text-gray-400 hover:text-brand-600 dark:text-obsidian-faded dark:hover:text-brand-400 transition-colors"
                            aria-label="Edit user"
                          >
                            <Edit2 size={14} />
                          </button>
                        </Tooltip>
                      </Can>
                      <Can permission="user.deactivate">
                        <Tooltip content={user.isActive ? 'Deactivate user' : 'Reactivate user'} side="top">
                          <button
                            onClick={() => handleToggleActive(user)}
                            className={cn(
                              'p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-obsidian-raised transition-colors',
                              user.isActive
                                ? 'text-gray-400 hover:text-rose-600 dark:text-obsidian-faded dark:hover:text-rose-400'
                                : 'text-gray-400 hover:text-emerald-600 dark:text-obsidian-faded dark:hover:text-emerald-400',
                            )}
                            aria-label={user.isActive ? 'Deactivate user' : 'Reactivate user'}
                          >
                            {user.isActive ? <UserMinus size={14} /> : <UserPlus size={14} />}
                          </button>
                        </Tooltip>
                      </Can>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ─── Modals ─── */}
      {showAddModal && (
        <AddUserModal
          isSuperAdmin={isSuperAdmin}
          onClose={() => setShowAddModal(false)}
          onSuccess={() => { qc.invalidateQueries({ queryKey: ['users'] }); setShowAddModal(false); }}
        />
      )}
      {editingUser && (
        <EditUserModal
          user={editingUser}
          isSuperAdmin={isSuperAdmin}
          onClose={() => setEditingUser(null)}
          onOpenReset={() => { setResettingUser(editingUser); setEditingUser(null); }}
          onSuccess={() => { qc.invalidateQueries({ queryKey: ['users'] }); setEditingUser(null); }}
        />
      )}
      {resettingUser && (
        <ResetPasswordModal
          user={resettingUser}
          onClose={() => setResettingUser(null)}
          onSuccess={() => { qc.invalidateQueries({ queryKey: ['users'] }); setResettingUser(null); }}
        />
      )}
      {showAgentAccessModal && (
        <AgentAccessModal
          users={users ?? []}
          onClose={() => setShowAgentAccessModal(false)}
          onSuccess={() => { qc.invalidateQueries({ queryKey: ['users'] }); setShowAgentAccessModal(false); }}
        />
      )}
    </div>
  );
}

// ─── Agent visibility allowlist (SUPER_ADMIN multi-select) ───
//
// AI agents and everything they touch are hidden from everyone except
// SUPER_ADMIN and the users picked here. This is the management surface
// for that allowlist — a flat checklist of every human user, pre-ticked
// from `canViewAgents`, saved in one shot via PUT /users/agent-viewers.
function AgentAccessModal({ users, onClose, onSuccess }: {
  users: any[]; onClose: () => void; onSuccess: () => void;
}) {
  // Only humans are eligible (you don't grant agent-visibility to an
  // agent). SUPER_ADMINs see agents implicitly — show them as locked-on.
  const humans = useMemo(
    () => (users ?? []).filter((u) => u.userType !== 'AGENT'),
    [users],
  );
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set((users ?? []).filter((u) => u.canViewAgents).map((u) => u.id)),
  );
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return humans;
    return humans.filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(q));
  }, [humans, query]);

  const mutation = useMutation({
    // SUPER_ADMINs are always implicitly allowed; we don't include them
    // in the payload (their flag is irrelevant). Send exactly the
    // non-super-admin selections — the backend grants those and revokes
    // everyone else.
    mutationFn: () => setAgentViewers(
      humans.filter((u) => u.role !== 'SUPER_ADMIN' && selected.has(u.id)).map((u) => u.id),
    ),
    onSuccess: () => onSuccess(),
    onError: (err: any) => setError(err?.response?.data?.error?.message || 'Failed to update agent access'),
  });

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Who can see AI agents?"
      subtitle="Agents and their tasks, comments, and activity are hidden from everyone else."
      size="md"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" loading={mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Saving…' : 'Save access list'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[12px] text-gray-500 dark:text-obsidian-muted">
          You (and any Super Admin) always see agents. Tick the people who should
          also see agent work; un-ticking someone revokes it.
        </p>
        <Input
          type="text"
          placeholder="Search people…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="max-h-[340px] overflow-y-auto rounded-lg border border-gray-200 dark:border-obsidian-border divide-y divide-gray-100 dark:divide-obsidian-border">
          {filtered.length === 0 && (
            <p className="px-3 py-4 text-sm text-gray-500 dark:text-obsidian-muted">No matching people.</p>
          )}
          {filtered.map((u) => {
            const isSuper = u.role === 'SUPER_ADMIN';
            return (
              <label
                key={u.id}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 text-sm',
                  isSuper ? 'opacity-60' : 'cursor-pointer hover:bg-gray-50 dark:hover:bg-obsidian-sunken/40',
                )}
              >
                <input
                  type="checkbox"
                  checked={isSuper || selected.has(u.id)}
                  disabled={isSuper}
                  onChange={() => !isSuper && toggle(u.id)}
                />
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-gray-900 dark:text-obsidian-fg">{u.name}</span>
                  <span className="block truncate text-[11px] text-gray-500 dark:text-obsidian-muted">{u.email}</span>
                </span>
                <span className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-obsidian-faded">
                  {isSuper ? 'Always' : (ROLE_LABELS[u.role as keyof typeof ROLE_LABELS] ?? u.role)}
                </span>
              </label>
            );
          })}
        </div>
        {error && <ErrorBanner message={error} />}
      </div>
    </Modal>
  );
}

// ─── Add user modal ───

function AddUserModal({ isSuperAdmin, onClose, onSuccess }: { isSuperAdmin: boolean; onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'ENGINEER',
    // Agent-platform fields. Defaults make the form behave exactly as it did
    // before this feature shipped — the agent section stays collapsed unless
    // the super-admin opens it.
    userType: 'HUMAN' as 'HUMAN' | 'AGENT',
    agentRole: '',
    agentBudgetMonthlyUsd: '',
    agentActive: true,
  });
  const [showAgentSection, setShowAgentSection] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => createUser({
      name: form.name,
      email: form.email,
      password: form.password,
      role: form.role,
      // Only send agent fields if super-admin opted in. Backend strips them
      // for non-super-admins regardless, but skipping them client-side keeps
      // the request body clean for typical adds.
      ...(isSuperAdmin && form.userType === 'AGENT' ? {
        userType: 'AGENT',
        agentRole: form.agentRole || null,
        agentActive: form.agentActive,
        agentBudgetMonthlyUsdCents: form.agentBudgetMonthlyUsd
          ? Math.round(parseFloat(form.agentBudgetMonthlyUsd) * 100)
          : null,
      } : {}),
    }),
    onSuccess: () => onSuccess(),
    onError: (err: any) => {
      const data = err?.response?.data;
      const fieldErrors = data?.error?.details?.fieldErrors;
      if (fieldErrors) {
        const messages = Object.entries(fieldErrors).map(([k, v]: any) => `${k.replace('body.', '')}: ${v.join(', ')}`);
        setError(messages.join('; '));
      } else {
        setError(data?.error?.message || 'Failed to create user');
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.password) {
      setError('All fields are required');
      return;
    }
    mutation.mutate();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Add User"
      size="md"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" loading={mutation.isPending} onClick={(e) => handleSubmit(e as unknown as React.FormEvent)}>
            {mutation.isPending ? 'Creating…' : 'Create User'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Name" required>
          <Input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Full name"
            autoFocus
          />
        </Field>
        <Field label="Email" required>
          <Input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="user@example.com"
          />
        </Field>
        <Field
          label="Password"
          required
          hint="At least 10 chars with uppercase, lowercase, digit, and symbol"
        >
          <Input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="Initial password"
            minLength={10}
          />
        </Field>
        <Field label="Role">
          <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {Object.entries(ROLE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </Select>
        </Field>

        {/* Agent Configuration — collapsed by default, super-admin only.
            When closed, the form behaves as it did before this feature
            shipped (the user is created as HUMAN with all agent fields null). */}
        {isSuperAdmin && (
          <div className="rounded-lg border border-gray-200 dark:border-obsidian-border bg-gray-50/40 dark:bg-obsidian-sunken/40">
            <button
              type="button"
              onClick={() => setShowAgentSection((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 text-[12px] font-medium text-gray-600 dark:text-obsidian-muted hover:text-gray-900 dark:hover:text-obsidian-fg"
            >
              <span className="flex items-center gap-2">
                <Bot size={14} className="text-teal-600 dark:text-teal-400" />
                Agent Configuration {form.userType === 'AGENT' && <span className="text-teal-600 dark:text-teal-400">(active)</span>}
              </span>
              <span className="text-[10px] uppercase tracking-wider">{showAgentSection ? 'Hide' : 'Show'}</span>
            </button>
            {showAgentSection && (
              <div className="px-3 pb-3 space-y-3 border-t border-gray-200 dark:border-obsidian-border">
                <Field label="User type">
                  <Select
                    value={form.userType}
                    onChange={(e) => setForm({ ...form, userType: e.target.value as 'HUMAN' | 'AGENT' })}
                  >
                    <option value="HUMAN">Human</option>
                    <option value="AGENT">Agent (autonomous)</option>
                  </Select>
                </Field>
                {form.userType === 'AGENT' && (
                  <>
                    <Field label="Agent role" hint="Free-text label, e.g. junior-coder, pm-agent. No RBAC effect.">
                      <Input
                        type="text"
                        value={form.agentRole}
                        onChange={(e) => setForm({ ...form, agentRole: e.target.value })}
                        placeholder="junior-coder"
                      />
                    </Field>
                    <Field label="Monthly budget (USD)" hint="Leave blank for no limit. Used by the runtime for soft enforcement.">
                      <Input
                        type="number"
                        value={form.agentBudgetMonthlyUsd}
                        onChange={(e) => setForm({ ...form, agentBudgetMonthlyUsd: e.target.value })}
                        placeholder="e.g. 500"
                        min="0"
                        step="1"
                      />
                    </Field>
                    <label className="flex items-center gap-2 text-[12px] text-gray-700 dark:text-obsidian-muted">
                      <input
                        type="checkbox"
                        checked={form.agentActive}
                        onChange={(e) => setForm({ ...form, agentActive: e.target.checked })}
                      />
                      Agent active (uncheck to pause without deactivating the user account)
                    </label>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {error && <ErrorBanner message={error} />}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ─── Edit user modal ───

function EditUserModal({ user, isSuperAdmin, onClose, onOpenReset, onSuccess }: {
  user: any; isSuperAdmin: boolean; onClose: () => void; onOpenReset: () => void; onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    name: user.name,
    email: user.email,
    role: user.role,
    company: user.company || '',
    // Agent-platform fields. Pre-populated from the existing row so an edit
    // doesn't accidentally clear them.
    userType: (user.userType ?? 'HUMAN') as 'HUMAN' | 'AGENT',
    agentRole: user.agentRole ?? '',
    agentBudgetMonthlyUsd: user.agentBudgetMonthlyUsdCents != null
      ? String(user.agentBudgetMonthlyUsdCents / 100)
      : '',
    agentActive: user.agentActive ?? true,
  });
  const [showAgentSection, setShowAgentSection] = useState(user.userType === 'AGENT');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => updateUser(user.id, {
      name: form.name,
      email: form.email,
      role: form.role,
      company: form.company,
      // Only super-admin can flip these. Backend strips them otherwise.
      ...(isSuperAdmin ? {
        userType: form.userType,
        agentRole: form.userType === 'AGENT' ? (form.agentRole || null) : null,
        agentBudgetMonthlyUsdCents: form.userType === 'AGENT' && form.agentBudgetMonthlyUsd
          ? Math.round(parseFloat(form.agentBudgetMonthlyUsd) * 100)
          : null,
        agentActive: form.userType === 'AGENT' ? form.agentActive : true,
      } : {}),
    }),
    onSuccess: () => onSuccess(),
    onError: (err: any) => setError(err?.response?.data?.error?.message || 'Failed to update user'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.email) { setError('Name and email are required'); return; }
    mutation.mutate();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit User"
      subtitle={user.email}
      size="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onOpenReset} className="mr-auto">
            Reset Password
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" loading={mutation.isPending} onClick={(e) => handleSubmit(e as unknown as React.FormEvent)}>
            {mutation.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Name" required>
          <Input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Email" required>
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Role">
          <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {Object.entries(ROLE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Company" hint="Optional">
          <Input
            type="text"
            value={form.company}
            onChange={(e) => setForm({ ...form, company: e.target.value })}
            placeholder="Company name"
          />
        </Field>

        {/* 2026-06-02 — the old global "Extended access" checkbox was
            retired. Full client access is now granted PER PROJECT (and
            SUPER_ADMIN-only) from Project → Settings → "Client full
            access". This pointer keeps super-admins from hunting for the
            old checkbox. */}
        {isSuperAdmin && form.role === 'CLIENT' && (
          <div className="rounded-lg border border-gray-200 dark:border-obsidian-border bg-gray-50/60 dark:bg-obsidian-sunken/40 px-3 py-3 text-[12px] text-gray-600 dark:text-obsidian-muted">
            To let this client see a project's full internal view (board,
            decisions, internal tasks, comments), open that{' '}
            <span className="font-medium text-gray-800 dark:text-obsidian-fg">project → Settings → Client full access</span>{' '}
            and grant it there. Access is scoped per project.
          </div>
        )}

        {/* Agent Configuration — collapsed by default. Pre-expanded if the
            user being edited is already an agent so the super-admin sees
            the existing settings without an extra click. */}
        {isSuperAdmin && (
          <div className="rounded-lg border border-gray-200 dark:border-obsidian-border bg-gray-50/40 dark:bg-obsidian-sunken/40">
            <button
              type="button"
              onClick={() => setShowAgentSection((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 text-[12px] font-medium text-gray-600 dark:text-obsidian-muted hover:text-gray-900 dark:hover:text-obsidian-fg"
            >
              <span className="flex items-center gap-2">
                <Bot size={14} className="text-teal-600 dark:text-teal-400" />
                Agent Configuration {form.userType === 'AGENT' && <span className="text-teal-600 dark:text-teal-400">(active)</span>}
              </span>
              <span className="text-[10px] uppercase tracking-wider">{showAgentSection ? 'Hide' : 'Show'}</span>
            </button>
            {showAgentSection && (
              <div className="px-3 pb-3 space-y-3 border-t border-gray-200 dark:border-obsidian-border">
                <Field label="User type">
                  <Select
                    value={form.userType}
                    onChange={(e) => setForm({ ...form, userType: e.target.value as 'HUMAN' | 'AGENT' })}
                  >
                    <option value="HUMAN">Human</option>
                    <option value="AGENT">Agent (autonomous)</option>
                  </Select>
                </Field>
                {form.userType === 'AGENT' && (
                  <>
                    <Field label="Agent role" hint="Free-text label, e.g. junior-coder, pm-agent. No RBAC effect.">
                      <Input
                        type="text"
                        value={form.agentRole}
                        onChange={(e) => setForm({ ...form, agentRole: e.target.value })}
                        placeholder="junior-coder"
                      />
                    </Field>
                    <Field label="Monthly budget (USD)" hint="Leave blank for no limit.">
                      <Input
                        type="number"
                        value={form.agentBudgetMonthlyUsd}
                        onChange={(e) => setForm({ ...form, agentBudgetMonthlyUsd: e.target.value })}
                        placeholder="e.g. 500"
                        min="0"
                        step="1"
                      />
                    </Field>
                    {user.agentBudgetUsedUsdCents != null && (
                      <p className="text-[11px] text-gray-500 dark:text-obsidian-muted">
                        Used this period: ${(user.agentBudgetUsedUsdCents / 100).toFixed(2)}
                      </p>
                    )}
                    <label className="flex items-center gap-2 text-[12px] text-gray-700 dark:text-obsidian-muted">
                      <input
                        type="checkbox"
                        checked={form.agentActive}
                        onChange={(e) => setForm({ ...form, agentActive: e.target.checked })}
                      />
                      Agent active (uncheck to pause without deactivating the user account)
                    </label>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {error && <ErrorBanner message={error} />}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ─── Reset password modal ───

function ResetPasswordModal({ user, onClose, onSuccess }: {
  user: any; onClose: () => void; onSuccess: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => resetUserPassword(user.id, password),
    onSuccess: () => onSuccess(),
    onError: (err: any) => setError(err?.response?.data?.error?.message || 'Failed to reset password'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || !confirmPassword) { setError('Please enter and confirm the new password'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    // Match server policy (auth.schema.ts) — 10+ chars with character
    // class diversity. QA A-M6: was previously the laxer "8 chars"
    // which let users submit passwords the server then rejected.
    if (password.length < 10) { setError('Password must be at least 10 characters'); return; }
    if (!/[A-Z]/.test(password)) { setError('Password must contain an uppercase letter'); return; }
    if (!/[a-z]/.test(password)) { setError('Password must contain a lowercase letter'); return; }
    if (!/[0-9]/.test(password)) { setError('Password must contain a digit'); return; }
    if (!/[^A-Za-z0-9]/.test(password)) { setError('Password must contain a symbol'); return; }
    mutation.mutate();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Reset Password"
      subtitle={`Set a new password for ${user.name}`}
      size="md"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" loading={mutation.isPending} onClick={(e) => handleSubmit(e as unknown as React.FormEvent)}>
            {mutation.isPending ? 'Saving…' : 'Reset Password'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="New Password" required>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter new password"
            autoFocus
          />
        </Field>
        <Field label="Confirm Password" required>
          <Input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
          />
        </Field>
        {error && <ErrorBanner message={error} />}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ─── Shared error banner ───

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className={cn(
      'flex items-start gap-2.5 rounded-lg px-3.5 py-3 text-sm animate-fade-in',
      'bg-rose-50 border border-rose-200 text-rose-700',
      'dark:bg-rose-500/[0.08] dark:border-rose-500/30 dark:text-rose-300',
    )}>
      <AlertCircle size={15} className="mt-0.5 shrink-0" />
      <span className="leading-snug">{message}</span>
    </div>
  );
}
