import { useState } from 'react';
import { ShieldCheck, AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useMyAcknowledgment, useAcknowledgeProject } from '@/hooks/useProjectAcknowledgment';
import { useAuthStore } from '@/stores/authStore';
import { Button, Modal, Input, Field } from '@/components/ui';
import { cn } from '@/lib/cn';

interface Props {
  projectId: string;
  /** Where to send the user if they refuse — defaults to their dashboard. */
  refuseRedirect?: string;
  /** Project name shown in the modal header. */
  projectName?: string;
  children: React.ReactNode;
}

/**
 * Gates a project page behind a confidentiality acknowledgment modal.
 *
 * Behavior:
 *   - Loading the ack status: renders a small skeleton, doesn't render children yet.
 *   - User has already acknowledged: renders children unchanged.
 *   - Not yet acknowledged: shows a hard interstitial Modal. Children stay
 *     mounted but obscured (avoids layout pop on close).
 *
 * The modal cannot be dismissed without either acknowledging or explicitly
 * declining (which redirects away). This is intentional — silently dismissing
 * would defeat the legal evidence purpose.
 */
export function ProjectAcknowledgmentGate({ projectId, refuseRedirect, projectName, children }: Props) {
  const user = useAuthStore((s) => s.user);
  // Founder/owner bypass. The acknowledgment exists to record that staff,
  // contractors, and clients have agreed to Lumey's confidentiality
  // terms BEFORE seeing internal project material. The SUPER_ADMIN IS
  // the company — asking them to "agree" to confidentiality with
  // themselves is a UX bug and a circular legal artifact (their consent
  // is implicit in being the owner). Render children directly with no
  // server roundtrip.
  const isOwner = user?.role === 'SUPER_ADMIN';

  // Hooks must run unconditionally (Rules of Hooks), but the query is
  // disabled for SUPER_ADMIN via the `enabled` flag — no wasted GET.
  const { data, isLoading } = useMyAcknowledgment(projectId, !isOwner);
  const ackMutation = useAcknowledgeProject(projectId);
  const navigate = useNavigate();
  const [agreed, setAgreed] = useState(false);
  const [signatureName, setSignatureName] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (isOwner) {
    return <>{children}</>;
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-8 rounded w-1/3" />
        <div className="skeleton h-32 rounded-xl" />
      </div>
    );
  }

  if (data?.acknowledged) {
    return <>{children}</>;
  }

  const handleSubmit = async () => {
    setError(null);
    if (!agreed) {
      setError('Please confirm you have read and agree to the terms.');
      return;
    }
    if (signatureName.trim().toLowerCase() !== (user?.name || '').trim().toLowerCase()) {
      setError(`Please type your full name exactly: "${user?.name}"`);
      return;
    }
    try {
      await ackMutation.mutateAsync();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || 'Failed to record acknowledgment. Please try again.');
    }
  };

  const handleDecline = () => {
    navigate(refuseRedirect || '/');
  };

  return (
    <>
      {/* Children stay mounted but obscured to avoid layout pop on close */}
      <div className="pointer-events-none select-none opacity-30 blur-sm">
        {children}
      </div>

      <Modal
        open
        onClose={handleDecline}
        modal // Don't close on Escape/backdrop — must explicitly accept or decline
        hideClose
        accent="brand"
        title="Confidentiality Acknowledgment"
        subtitle={projectName ? `For: ${projectName}` : undefined}
        size="lg"
        footer={
          <>
            <button
              type="button"
              onClick={handleDecline}
              className="text-sm text-gray-500 dark:text-obsidian-muted hover:text-gray-700 dark:hover:text-obsidian-fg px-3 py-2 transition-colors mr-auto"
            >
              Decline and exit
            </button>
            <Button
              variant="primary"
              size="md"
              loading={ackMutation.isPending}
              onClick={handleSubmit}
              leadingIcon={<ShieldCheck size={15} />}
            >
              {ackMutation.isPending ? 'Recording…' : 'I Agree & Acknowledge'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600 dark:text-obsidian-muted mb-4 leading-relaxed">
          Before continuing, please read and agree to the following terms. Your acceptance is recorded with a timestamp, IP address, and browser information for legal audit purposes.
        </p>

        <div className={cn(
          'rounded-lg p-4 max-h-64 overflow-y-auto',
          'bg-gray-50 border border-gray-200 dark:bg-obsidian-sunken dark:border-obsidian-border',
        )}>
          <pre className="whitespace-pre-wrap font-sans text-[13px] text-gray-700 dark:text-obsidian-fg leading-relaxed">
            {data?.text || 'Loading…'}
          </pre>
        </div>

        <div className="mt-5 space-y-4">
          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded text-brand-600 accent-brand-600 shrink-0"
            />
            <span className="text-[13px] text-gray-700 dark:text-obsidian-fg select-none leading-relaxed">
              I have read and understand the terms above. I agree to be bound by them and acknowledge that violation may result in disciplinary, civil, or criminal action.
            </span>
          </label>

          <Field label="Type your full name to sign">
            <Input
              type="text"
              value={signatureName}
              onChange={(e) => setSignatureName(e.target.value)}
              placeholder={user?.name || 'Your full name'}
            />
          </Field>

          {error && (
            <div className={cn(
              'flex items-start gap-2.5 rounded-lg px-3.5 py-3 text-sm animate-fade-in',
              'bg-rose-50 border border-rose-200 text-rose-700',
              'dark:bg-rose-500/[0.08] dark:border-rose-500/30 dark:text-rose-300',
            )}>
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <span className="leading-snug">{error}</span>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
