import { useEffect, useState } from 'react';

/**
 * Reactive viewport size hook. Returns `isMobile=true` below Tailwind's
 * `lg:` breakpoint (1024px) — every mobile-shell decision in the
 * codebase pivots on this boundary so the swap-points and the
 * `lg:` Tailwind utilities stay in lockstep.
 *
 * Uses `matchMedia` rather than a resize listener so we only re-render
 * on the boundary crossing, not on every pixel change. Server-side
 * defaults to false (i.e. desktop) — there's no SSR in this app, but
 * the guard keeps the initial mount cheap.
 */

const MOBILE_QUERY = '(max-width: 1023px)';

export function useViewport(): { isMobile: boolean } {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !('matchMedia' in window)) return false;
    return window.matchMedia(MOBILE_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !('matchMedia' in window)) return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    // Older Safari uses addListener; the modern one uses addEventListener.
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
    };
  }, []);

  return { isMobile };
}
