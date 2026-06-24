import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Can } from './Can';
import { useAuthStore } from '@/stores/authStore';

/**
 * Phase 0 of the baseline hardening plan: proves the frontend test
 * runner can render React components + drive Zustand store state +
 * assert DOM contents.
 *
 * `Can` is the permission-gating primitive used throughout the app —
 * Phase 4 elevates this test file to the 95% coverage target since
 * `Can` is a security primitive. For now, the four cases below cover
 * the four code paths (no gate, single permission, any-of, all-of).
 */
function seedPermissions(perms: string[]) {
  // Push a minimal-but-valid auth state into the real store. No mocks —
  // testing the real wiring is the point.
  useAuthStore.setState({
    user: { id: 'u1', name: 'Test', email: 't@x.in', role: 'ADMIN' } as any,
    accessToken: 'fake',
    permissions: perms,
    pendingMandatoryEnrollments: [],
    isAuthenticated: true,
    isLoading: false,
  });
}

describe('<Can />', () => {
  beforeEach(() => {
    // Reset store between tests — RTL's cleanup() handles the DOM,
    // but Zustand state is shared module state.
    useAuthStore.setState({ permissions: [] });
  });

  it('renders children when no gate is provided', () => {
    render(<Can><span>visible</span></Can>);
    expect(screen.getByText('visible')).toBeInTheDocument();
  });

  it('renders children when the user has the required single permission', () => {
    seedPermissions(['task.edit_any']);
    render(<Can permission="task.edit_any"><span>visible</span></Can>);
    expect(screen.getByText('visible')).toBeInTheDocument();
  });

  it('renders fallback when the user lacks the required single permission', () => {
    seedPermissions(['task.view']);
    render(
      <Can permission="task.edit_any" fallback={<span>locked</span>}>
        <span>visible</span>
      </Can>,
    );
    expect(screen.queryByText('visible')).not.toBeInTheDocument();
    expect(screen.getByText('locked')).toBeInTheDocument();
  });

  it('renders children when ANY of the listed permissions match (default)', () => {
    seedPermissions(['task.edit_own']);
    render(
      <Can permissions={['task.edit_any', 'task.edit_own']}>
        <span>visible</span>
      </Can>,
    );
    expect(screen.getByText('visible')).toBeInTheDocument();
  });

  it('renders fallback when ALL is required but only some match', () => {
    seedPermissions(['task.edit_own']);
    render(
      <Can
        permissions={['task.edit_any', 'task.edit_own']}
        requireAllPermissions
        fallback={<span>locked</span>}
      >
        <span>visible</span>
      </Can>,
    );
    expect(screen.getByText('locked')).toBeInTheDocument();
  });
});
