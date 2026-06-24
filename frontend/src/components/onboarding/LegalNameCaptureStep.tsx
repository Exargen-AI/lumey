import { useState } from 'react';
import { ShieldCheck, AlertCircle } from 'lucide-react';
import { validateLegalName } from '@exargen/shared';
import { useSetLegalName } from '@/hooks/useOnboarding';
import { cn } from '@/lib/cn';

interface Props {
  enrollmentId: string;
  onCaptured: () => void;
}

// Renders before the SigningCeremony when `user.legalName` is null. The
// user must type out their full legal name once; the typed value is
// stored on `user.legalName` and used to validate every subsequent
// document signature in this enrollment (and any future re-acks).
//
// We validate format on the client for fast UX, AND on the server for
// the actual gate. See `validateLegalName` in @exargen/shared.
export function LegalNameCaptureStep({ enrollmentId, onCaptured }: Props) {
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const setLegalName = useSetLegalName(enrollmentId);

  const validation = validateLegalName(value);
  const showInlineError = touched && !validation.ok;

  const handleSubmit = async () => {
    setServerError(null);
    if (!validation.ok) {
      setTouched(true);
      return;
    }
    try {
      await setLegalName.mutateAsync(value);
      onCaptured();
    } catch (err: any) {
      setServerError(err?.response?.data?.error?.message || 'Failed to save your legal name. Please try again.');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <ShieldCheck className="text-indigo-500 mt-1 shrink-0" size={28} />
        <div className="flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
            Before you sign
          </p>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Confirm your full legal name
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">
            Each document below will be signed with this exact name. Use the full legal name on
            your government-issued ID — first and last name at minimum, plus middle name(s) if
            they appear on your ID. You will not be able to change this from here once saved
            (an admin can correct it if needed).
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 space-y-3">
        <label className="block">
          <span className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            Full legal name (as it appears on your government ID)
          </span>
          <input
            type="text"
            autoComplete="name"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (serverError) setServerError(null);
            }}
            onBlur={() => setTouched(true)}
            placeholder="e.g. Jane Margaret Smith"
            className={cn(
              'w-full rounded-md border bg-white dark:bg-gray-950 px-3 py-2 text-sm focus:outline-none focus:ring-2',
              showInlineError
                ? 'border-red-300 dark:border-red-700 focus:ring-red-300'
                : 'border-gray-300 dark:border-gray-700 focus:ring-indigo-300',
            )}
          />
          {showInlineError && validation.reason && (
            <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{validation.reason}</p>
          )}
        </label>

        {serverError && (
          <div className="flex items-start gap-2 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{serverError}</span>
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            disabled={!validation.ok || setLegalName.isPending}
            onClick={handleSubmit}
            className={cn(
              'px-5 py-2.5 text-sm font-medium rounded-lg transition',
              validation.ok && !setLegalName.isPending
                ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                : 'bg-gray-200 dark:bg-gray-800 text-gray-500 cursor-not-allowed',
            )}
          >
            {setLegalName.isPending ? 'Saving…' : 'Save and continue to signing'}
          </button>
        </div>
      </div>
    </div>
  );
}
