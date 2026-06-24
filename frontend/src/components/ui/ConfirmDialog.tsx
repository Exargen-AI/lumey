import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';

type Tone = 'danger' | 'warning' | 'brand';

interface ConfirmOptions {
  /** Heading shown in the modal title bar. */
  title: string;
  /** Body text. Plain string or React node. Plain text wraps in a <p>. */
  body?: ReactNode;
  /** Label for the confirm button. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Label for the cancel button. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Visual tone — drives the confirm-button colour. Default: brand. */
  tone?: Tone;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Mount this once near the app root. Provides the confirm dialog used by the
 * useConfirm() hook anywhere below.
 *
 *   <ConfirmProvider>
 *     <App />
 *   </ConfirmProvider>
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  // Single in-flight confirm at a time. The pending promise's resolver is
  // stashed here so the modal buttons can settle it.
  const [state, setState] = useState<{
    open: boolean;
    opts: ConfirmOptions;
    resolve: (v: boolean) => void;
  } | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      setState({ open: true, opts, resolve });
    });
  }, []);

  const handleAnswer = (answer: boolean) => {
    if (!state) return;
    state.resolve(answer);
    setState(null);
  };

  const tone = state?.opts.tone ?? 'brand';
  const variant: 'primary' | 'danger' = tone === 'danger' ? 'danger' : 'primary';

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <Modal
          open={state.open}
          onClose={() => handleAnswer(false)}
          title={state.opts.title}
          accent={tone === 'warning' ? 'warning' : tone === 'danger' ? 'danger' : undefined}
          size="sm"
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => handleAnswer(false)}>
                {state.opts.cancelLabel || 'Cancel'}
              </Button>
              <Button variant={variant} size="sm" onClick={() => handleAnswer(true)} autoFocus>
                {state.opts.confirmLabel || 'Confirm'}
              </Button>
            </>
          }
        >
          {typeof state.opts.body === 'string' ? (
            <p className="text-sm text-gray-600 dark:text-obsidian-muted leading-relaxed">{state.opts.body}</p>
          ) : (
            state.opts.body
          )}
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

/**
 * Returns a `confirm({...}) → Promise<boolean>` function.
 *
 * Replacement for window.confirm — themed, dismissible via Escape or backdrop,
 * danger tone for destructive actions, focus restored to the trigger on close.
 *
 * Examples:
 *   const confirm = useConfirm();
 *   if (await confirm({ title: 'Delete task?', tone: 'danger', confirmLabel: 'Delete' })) {
 *     deleteTask();
 *   }
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return ctx;
}
