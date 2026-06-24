import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { getLead, updateLeadStatus, type Lead } from '@/api/leads';
import {
  ArrowLeft,
  Mail,
  Phone,
  Building2,
  Globe,
  Calendar,
  Tag,
  Inbox,
  CheckCircle2,
  XCircle,
  RotateCcw,
} from 'lucide-react';

const STATUS_STYLES: Record<Lead['status'], string> = {
  NEW: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
  CONTACTED: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200',
  CLOSED: 'bg-gray-100 text-gray-700 ring-1 ring-gray-200',
};

export function LeadDetailPage() {
  const { leadId } = useParams<{ leadId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const fromProjectId = (location.state as { fromProjectId?: string } | null)?.fromProjectId;

  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (!leadId) return;
    setLoading(true);
    void getLead(leadId)
      .then((data) => setLead(data))
      .catch(() => setLead(null))
      .finally(() => setLoading(false));
  }, [leadId]);

  const onSetStatus = async (status: 'NEW' | 'CONTACTED' | 'CLOSED') => {
    if (!lead) return;
    setUpdating(true);
    try {
      const updated = await updateLeadStatus(lead.id, status);
      setLead(updated);
    } finally {
      setUpdating(false);
    }
  };

  const handleBack = () => {
    // Prefer the leads list for the project we came from. Fall back to
    // browser history, and finally the CMS hub.
    if (fromProjectId) {
      navigate(`/cms/projects/${fromProjectId}/leads`);
    } else if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/cms', { state: { selectProjectId: lead?.projectId } });
    }
  };

  if (loading) {
    return <div className="p-6 text-gray-500 text-sm">Loading…</div>;
  }

  if (!lead) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <button
          onClick={handleBack}
          className="mb-4 inline-flex items-center text-brand-600 hover:text-brand-800 text-sm"
        >
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </button>
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-12 text-center text-gray-500">
          Lead not found.
        </div>
      </div>
    );
  }

  const displayName = lead.name || lead.email || 'Lead';
  const initials = (displayName || 'L')
    .split(/\s+/)
    .map((p) => p.charAt(0))
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <button
        onClick={handleBack}
        className="mb-4 inline-flex items-center text-brand-600 hover:text-brand-800 text-sm"
      >
        <ArrowLeft className="w-4 h-4 mr-1" /> Back to leads
      </button>

      {/* Header card */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-6 flex flex-wrap items-start gap-5">
          <div className="w-14 h-14 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-lg font-semibold shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-semibold text-gray-900 truncate">{displayName}</h1>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[lead.status]}`}>
                {lead.status}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-1 flex items-center gap-3 flex-wrap">
              <span className="inline-flex items-center gap-1">
                <Tag className="w-3.5 h-3.5" />
                {lead.formType}
              </span>
              <span className="inline-flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                {new Date(lead.createdAt).toLocaleString()}
              </span>
              {lead.website && (
                <span className="inline-flex items-center gap-1">
                  <Inbox className="w-3.5 h-3.5" />
                  {lead.website}
                </span>
              )}
            </p>
          </div>

          {/* Status action buttons */}
          <div className="flex flex-wrap gap-2">
            {lead.status !== 'NEW' && (
              <button
                onClick={() => onSetStatus('NEW')}
                disabled={updating}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
              >
                <RotateCcw className="w-4 h-4" /> Reopen
              </button>
            )}
            {lead.status !== 'CONTACTED' && (
              <button
                onClick={() => onSetStatus('CONTACTED')}
                disabled={updating}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" /> Mark Contacted
              </button>
            )}
            {lead.status !== 'CLOSED' && (
              <button
                onClick={() => onSetStatus('CLOSED')}
                disabled={updating}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-white bg-gray-600 hover:bg-gray-700 disabled:opacity-50"
              >
                <XCircle className="w-4 h-4" /> Close
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Contact details */}
        <div className="md:col-span-1 bg-white border border-gray-200 rounded-xl shadow-sm p-5">
          <h2 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-3">
            Contact
          </h2>
          <dl className="space-y-3 text-sm">
            <Field icon={<Mail className="w-4 h-4" />} label="Email" value={lead.email} copyable />
            <Field icon={<Phone className="w-4 h-4" />} label="Phone" value={lead.phone} copyable />
            <Field icon={<Building2 className="w-4 h-4" />} label="Company" value={lead.company} />
            <Field
              icon={<Globe className="w-4 h-4" />}
              label="Source page"
              value={lead.sourcePage}
              href={lead.sourcePage ?? undefined}
            />
          </dl>
        </div>

        {/* Message + metadata */}
        <div className="md:col-span-2 space-y-5">
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
            <h2 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-3">
              Message
            </h2>
            {lead.message ? (
              <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                {lead.message}
              </p>
            ) : (
              <p className="text-sm text-gray-400 italic">No message provided.</p>
            )}
          </div>

          {lead.metadata && Object.keys(lead.metadata).length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
              <h2 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-3">
                Metadata
              </h2>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                {Object.entries(lead.metadata).map(([k, v]) => (
                  <div key={k} className="flex flex-col">
                    <dt className="text-xs text-gray-500">{k}</dt>
                    <dd className="text-gray-800 font-mono text-xs break-all">
                      {v === null || v === undefined || v === '' ? '—' : String(v)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  icon,
  label,
  value,
  href,
  copyable,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string | null;
  href?: string;
  copyable?: boolean;
}) {
  const has = value && value.trim().length > 0;
  return (
    <div className="flex items-start gap-2">
      <div className="text-gray-400 mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <dt className="text-xs text-gray-500">{label}</dt>
        <dd className="text-sm text-gray-800 break-all">
          {has ? (
            href ? (
              <a className="text-brand-600 hover:underline" href={href} target="_blank" rel="noreferrer">
                {value}
              </a>
            ) : copyable ? (
              <button
                onClick={() => navigator.clipboard.writeText(value!)}
                className="hover:underline text-left"
                title="Click to copy"
              >
                {value}
              </button>
            ) : (
              value
            )
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </dd>
      </div>
    </div>
  );
}

export default LeadDetailPage;
