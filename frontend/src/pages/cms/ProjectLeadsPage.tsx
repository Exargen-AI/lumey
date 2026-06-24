import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { listLeads, updateLeadStatus, type Lead } from '@/api/leads';
import { useContentProject } from '../../hooks/useCms';
import { Inbox, Eye, CheckCircle2, XCircle, ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';

const PAGE_SIZE = 10;

type StatusFilter = 'all' | 'NEW' | 'CONTACTED' | 'CLOSED';

const STATUS_STYLES: Record<Lead['status'], string> = {
  NEW: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
  CONTACTED: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200',
  CLOSED: 'bg-gray-100 text-gray-700 ring-1 ring-gray-200',
};

export default function ProjectLeadsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { data: project } = useContentProject(projectId!);

  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    listLeads(projectId, page, PAGE_SIZE, statusFilter === 'all' ? undefined : statusFilter)
      .then((res) => {
        setLeads(res.items || []);
        setTotal(res.total || 0);
      })
      .catch((e) => setError(e?.response?.data?.error || 'Failed to load leads'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, page, statusFilter]);

  // Reset to page 1 whenever the filter changes — otherwise you can land on
  // page 3 of "NEW" and silently see nothing.
  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  const onSetStatus = async (id: string, status: 'CONTACTED' | 'CLOSED' | 'NEW') => {
    setBusyId(id);
    try {
      await updateLeadStatus(id, status);
      reload();
    } finally {
      setBusyId(null);
    }
  };

  // Server-side filtered list — the API returns only matching rows for the
  // current page, so `leads` is already the displayable set.
  const filtered = leads;

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Back goes to this project's overview (CmsPage selected-project view). */}
      <button
        onClick={() => navigate('/cms', { state: { selectProjectId: projectId } })}
        className="mb-4 inline-flex items-center text-brand-600 hover:text-brand-800 text-sm"
      >
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back to {project?.name ?? 'project'}
      </button>

      <div className="flex flex-wrap justify-between items-start gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Inbox className="w-6 h-6 text-brand-600" /> Leads
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Form submissions for <strong className="text-gray-700">{project?.name ?? '…'}</strong>
            <span className="text-gray-400"> · {total} total</span>
          </p>
        </div>

        {/* Status filter pills — quicker than a dropdown */}
        <div className="flex flex-wrap gap-1 bg-white border border-gray-200 rounded-lg p-1">
          {(['all', 'NEW', 'CONTACTED', 'CLOSED'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={
                'px-3 py-1.5 rounded-md text-xs font-medium transition ' +
                (statusFilter === s
                  ? 'bg-brand-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100')
              }
            >
              {s === 'all' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 rounded border border-red-200 bg-red-50 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-gray-500 text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-12 text-center">
          <Inbox className="w-10 h-10 mx-auto text-gray-300 mb-2" />
          <p className="text-gray-500 text-sm">
            {statusFilter === 'all'
              ? 'No leads yet. Submit a form from your website to see it here.'
              : `No ${statusFilter.toLowerCase()} leads.`}
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Created</th>
                <th className="px-4 py-3 font-semibold">Form</th>
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Email</th>
                <th className="px-4 py-3 font-semibold">Phone</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((l) => (
                <tr key={l.id} className="hover:bg-gray-50/60">
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    {new Date(l.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded-md bg-gray-100 text-gray-700 text-xs font-mono">
                      {l.formType}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">{l.name ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{l.email ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{l.phone ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[l.status]}`}>
                      {l.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => navigate(`/leads/${l.id}`, { state: { fromProjectId: projectId } })}
                        title="View details"
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-brand-700 hover:bg-brand-50 border border-transparent hover:border-brand-200"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        View
                      </button>
                      {l.status !== 'CONTACTED' && (
                        <button
                          disabled={busyId === l.id}
                          onClick={() => onSetStatus(l.id, 'CONTACTED')}
                          title="Mark as contacted"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-amber-700 hover:bg-amber-50 border border-transparent hover:border-amber-200 disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Contacted
                        </button>
                      )}
                      {l.status !== 'CLOSED' && (
                        <button
                          disabled={busyId === l.id}
                          onClick={() => onSetStatus(l.id, 'CLOSED')}
                          title="Close lead"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-gray-700 hover:bg-gray-100 border border-transparent hover:border-gray-200 disabled:opacity-50"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          Close
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination footer */}
          {pageCount > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/50 text-sm">
              <span className="text-gray-600">
                Showing <strong>{rangeStart}</strong>–<strong>{rangeEnd}</strong> of{' '}
                <strong>{total}</strong>
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1 || loading}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-gray-700 hover:bg-white border border-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Prev
                </button>
                <span className="px-3 text-xs text-gray-600">
                  Page <strong>{page}</strong> of <strong>{pageCount}</strong>
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={page >= pageCount || loading}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-gray-700 hover:bg-white border border-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
