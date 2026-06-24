/**
 * Application-wide z-index scale.
 *
 * The previous codebase sprinkled `z-10`, `z-40`, `z-50` ad-hoc and the
 * notification panel collided with the sticky activity-feed header
 * because both ended up on z-50 with no documented intent. Centralizing
 * the scale here:
 *
 *   - prevents new components silently picking the same number as a
 *     modal and ending up "underneath" it
 *   - documents the expected stacking order so designers and engineers
 *     can argue on the same axis
 *   - is intentionally sparse — you don't need 100 layers; you need
 *     six clearly-named ones
 *
 * Usage in JSX:
 *   <div style={{ zIndex: Z.popover }}>…</div>
 *
 * Usage in Tailwind (the values map 1:1 to existing utility classes
 * `z-10`, `z-30`, `z-40`, `z-50`, `z-60`):
 *   <div className="z-popover">  ← if you wire this into tailwind
 *
 * For now, prefer the `Z` constant for inline styles in new popovers
 * so the choice is greppable. Existing `z-NN` Tailwind classes can
 * stay; just keep them within the documented bands.
 */
export const Z = {
  /** Sticky table headers, today-line markers, intra-card overlays. */
  sticky: 10,

  /** Page-level chrome that should sit above content but below floating UI. */
  header: 20,

  /** App sidebar — fixed-positioned, always visible. Below popovers so a
   *  dropdown launched from the sidebar can render OVER the sidebar. */
  sidebar: 30,

  /** Floating-action chrome (BulkActionBar). Sits over content but below
   *  popovers so a popover triggered from the bar can layer above it. */
  toolbar: 40,

  /** Dropdowns, notification panels, command palette tooltips. Anything
   *  anchored to a trigger and dismissable by click-outside. Below modals
   *  so an open dropdown doesn't punch through a confirmation dialog. */
  popover: 45,

  /** Full-blocking dialogs — Modal, TaskDetailModal slide-over, sprint
   *  retro dialog, confidentiality gate. */
  modal: 50,

  /** Toasts and ephemeral confirmations — the loudest UI; should sit on
   *  top of even an open modal so a save-failure toast is visible. */
  toast: 60,
} as const;

export type ZLayer = keyof typeof Z;
