import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

interface Options {
  /**
   * If the user already completed the gate previously (e.g. resumed enrollment),
   * the gate starts in the passed state and stays there.
   */
  initialPassed?: boolean;
  /**
   * Pixels of slack at the bottom — some browsers report off-by-1px at the
   * extreme bottom of a scroll container. Default 16.
   */
  slackPx?: number;
  /**
   * Fired once, the first time the gate flips to passed (whether from an
   * actual scroll-to-bottom or because the content fits without scrolling).
   * NOT fired if the gate was constructed already-passed via `initialPassed`.
   */
  onFirstPass?: () => void;
}

interface Result<T extends HTMLElement> {
  /** Attach to the scrollable container. */
  ref: React.RefObject<T>;
  /** True once the user has scrolled to the bottom OR the content fits. */
  passed: boolean;
  /** Wire to the container's onScroll. */
  onScroll: () => void;
}

/**
 * Anti-skim scroll gate.
 *
 * Why this exists: the original implementation had two bugs that trapped users
 * after Module 1.
 *   1. Stale closure: `useEffect(() => { ... if (!scrolledToBottom) ... }, [module.id])`
 *      reads `scrolledToBottom` from the closure of the render that ran the
 *      effect. When the parent swapped the module without remounting, that
 *      closure still saw the previous module's `true` and skipped the
 *      auto-unlock.
 *   2. One-shot: the auto-unlock only ran on `module.id` change. If the
 *      container or content resized later (image load, window resize, browser
 *      zoom), it never re-evaluated.
 *
 * This hook fixes both by:
 *   - Reading state via setState callbacks, never via closure.
 *   - Re-evaluating on every container/content resize via ResizeObserver.
 *   - Re-evaluating on window resize as a fallback (older Safari, zoom).
 */
export function useScrollToBottomGate<T extends HTMLElement = HTMLDivElement>(
  options: Options = {},
): Result<T> {
  const { initialPassed = false, slackPx = 16, onFirstPass } = options;

  const ref = useRef<T>(null);
  const [passed, setPassed] = useState<boolean>(initialPassed);

  // Latest onFirstPass without re-binding observers when the parent re-renders.
  const onFirstPassRef = useRef(onFirstPass);
  useEffect(() => {
    onFirstPassRef.current = onFirstPass;
  }, [onFirstPass]);

  const markPassed = useCallback(() => {
    setPassed((prev) => {
      if (prev) return prev;
      // Schedule the side-effect outside the setState updater to avoid
      // double-firing under React Strict Mode.
      queueMicrotask(() => onFirstPassRef.current?.());
      return true;
    });
  }, []);

  const evaluate = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Two ways to pass: content fits without scrolling, OR user is at the bottom.
    const fits = el.scrollHeight <= el.clientHeight + 4;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - slackPx;
    if (fits || atBottom) markPassed();
  }, [markPassed, slackPx]);

  // Layout effect so we evaluate before the browser paints — prevents the
  // "Scroll to the end" warning from flashing on short modules.
  useLayoutEffect(() => {
    if (initialPassed) return;
    evaluate();
  }, [initialPassed, evaluate]);

  // ResizeObserver covers: container resize (window resize, sidebar toggle,
  // browser zoom), and content resize (images loading, dynamic blocks, fonts).
  useEffect(() => {
    if (initialPassed) return;
    const el = ref.current;
    if (!el) return;
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => evaluate());
    ro.observe(el);
    // Also observe the inner content so we catch changes that don't change
    // the container's box (e.g. image loads inside a fixed-height container).
    Array.from(el.children).forEach((child) => {
      if (child instanceof Element) ro.observe(child);
    });
    return () => ro.disconnect();
  }, [initialPassed, evaluate]);

  // Window resize fallback (covers cases ResizeObserver can miss, like zoom
  // changes on some browsers, or layout shifts triggered by viewport changes).
  useEffect(() => {
    if (initialPassed) return;
    const handler = () => evaluate();
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [initialPassed, evaluate]);

  return { ref, passed, onScroll: evaluate };
}
