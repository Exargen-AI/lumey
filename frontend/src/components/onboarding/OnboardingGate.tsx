import { Outlet } from 'react-router-dom';

// Login flow is intentionally NOT gated by mandatory onboarding. Users sign in,
// land on their dashboard, and discover their pending compliance courses via
// the dedicated `/confidentiality` page (linked from the sidebar with a
// pending-dot when an enrollment is outstanding).
//
// The data model still tracks pending enrollments and stamps full-text
// snapshots on every signature for legal-defensibility — only the
// "you can't use the platform until this is signed" hard-gate has been
// removed. This component is preserved as a passthrough so the
// `<Route element={<OnboardingGate />}>` wrapping in App.tsx keeps working
// without a structural rewrite, and so we can re-enable the gate later by
// putting the original branching logic back here if policy changes.
export function OnboardingGate() {
  return <Outlet />;
}
