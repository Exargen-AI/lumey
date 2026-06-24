/**
 * 2026-05-23 — Phase 2 of the FE coverage campaign. Component-level test
 * for the toast that surfaces kanban move-rejection errors.
 *
 * This is the surface that would have caught the original silent-rollback
 * bug (PR #147) if it had existed. The test asserts the user-visible
 * contract:
 *
 *   - Null state renders nothing (no leftover DOM when no error).
 *   - Server message is rendered verbatim (so users see "AC unchecked",
 *     not a generic "something went wrong").
 *   - "Open task →" button appears ONLY when both taskId and onOpenTask
 *     are provided (bulk-move errors and read-only boards don't get it).
 *   - Clicking "Open task →" fires onOpenTask with the task id AND
 *     dismisses the toast.
 *   - The ✕ button always dismisses.
 *   - Accessibility: role="status" + aria-live="polite" so screen
 *     readers announce without stealing focus.
 *
 * Why a component test (not just a unit test of the helpers): the
 * silent-rollback bug was a wiring bug between `useMoveTask` and the
 * toast render. A unit test of the helper can't catch "did the JSX
 * actually mount the button when expected." This test can.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MoveErrorToast } from './MoveErrorToast';

describe('MoveErrorToast', () => {
  it('renders nothing when error is null (no leftover DOM)', () => {
    const { container } = render(
      <MoveErrorToast error={null} onDismiss={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the server error message verbatim (no truncation, no rewriting)', () => {
    render(
      <MoveErrorToast
        error={{
          message:
            'Cannot mark this task Done — 2 acceptance criteria are still unchecked.',
        }}
        onDismiss={() => {}}
      />,
    );
    expect(
      screen.getByText(
        'Cannot mark this task Done — 2 acceptance criteria are still unchecked.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Move failed:')).toBeInTheDocument();
  });

  it('uses role="status" and aria-live="polite" so screen readers announce without stealing focus', () => {
    render(
      <MoveErrorToast error={{ message: 'Something' }} onDismiss={() => {}} />,
    );
    const toast = screen.getByRole('status');
    expect(toast).toHaveAttribute('aria-live', 'polite');
  });

  it('always renders the ✕ dismiss button — even when no taskId is present', () => {
    render(
      <MoveErrorToast error={{ message: 'bulk failure' }} onDismiss={() => {}} />,
    );
    expect(screen.getByLabelText('Dismiss error')).toBeInTheDocument();
  });

  it('fires onDismiss when the ✕ button is clicked', () => {
    const onDismiss = vi.fn();
    render(
      <MoveErrorToast
        error={{ message: 'Permission denied' }}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByLabelText('Dismiss error'));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  describe('Open task button visibility', () => {
    it('DOES NOT render the button when no taskId is provided (bulk-move case)', () => {
      render(
        <MoveErrorToast
          error={{ message: 'Several rows failed' }}
          onDismiss={() => {}}
          onOpenTask={() => {}}
        />,
      );
      expect(screen.queryByText(/open task/i)).not.toBeInTheDocument();
    });

    it('DOES NOT render the button when onOpenTask is omitted (read-only board case)', () => {
      render(
        <MoveErrorToast
          error={{ message: 'AC blocked', taskId: 'task-1', taskTitle: 'UX revamp' }}
          onDismiss={() => {}}
          // onOpenTask deliberately omitted — client portal / read-only mode
        />,
      );
      expect(screen.queryByText(/open task/i)).not.toBeInTheDocument();
    });

    it('renders the button when BOTH taskId AND onOpenTask are provided', () => {
      render(
        <MoveErrorToast
          error={{ message: 'AC blocked', taskId: 'task-1', taskTitle: 'UX revamp' }}
          onDismiss={() => {}}
          onOpenTask={() => {}}
        />,
      );
      expect(screen.getByText(/open task/i)).toBeInTheDocument();
    });
  });

  describe('Open task button behaviour', () => {
    it('fires onOpenTask with the failed task id when clicked', () => {
      const onOpenTask = vi.fn();
      render(
        <MoveErrorToast
          error={{ message: 'AC blocked', taskId: 'task-42', taskTitle: 'UX revamp' }}
          onDismiss={() => {}}
          onOpenTask={onOpenTask}
        />,
      );
      fireEvent.click(screen.getByText(/open task/i));
      expect(onOpenTask).toHaveBeenCalledWith('task-42');
    });

    it('ALSO fires onDismiss after opening (so the toast goes away)', () => {
      const onDismiss = vi.fn();
      const onOpenTask = vi.fn();
      render(
        <MoveErrorToast
          error={{ message: 'AC blocked', taskId: 'task-42' }}
          onDismiss={onDismiss}
          onOpenTask={onOpenTask}
        />,
      );
      fireEvent.click(screen.getByText(/open task/i));
      expect(onDismiss).toHaveBeenCalledOnce();
    });

    it('uses the task title in the button tooltip when provided (otherwise "Open task")', () => {
      const { rerender } = render(
        <MoveErrorToast
          error={{ message: 'X', taskId: 't1', taskTitle: 'UX revamp' }}
          onDismiss={() => {}}
          onOpenTask={() => {}}
        />,
      );
      // The tooltip is the button's title attribute.
      expect(screen.getByText(/open task/i)).toHaveAttribute(
        'title',
        'Open "UX revamp"',
      );

      rerender(
        <MoveErrorToast
          error={{ message: 'X', taskId: 't1' /* no title */ }}
          onDismiss={() => {}}
          onOpenTask={() => {}}
        />,
      );
      expect(screen.getByText(/open task/i)).toHaveAttribute('title', 'Open task');
    });

    it('captures the task id before dismissing so the order is open→dismiss (not dismiss→open)', () => {
      // Regression test: previously the inline implementation called
      // setMoveError(null) FIRST then called onTaskClick. Under fast
      // React batching that could clear error.taskId before the click
      // handler resolved on some setups. The extracted component
      // captures `id` from the closure first to be safe.
      const events: string[] = [];
      render(
        <MoveErrorToast
          error={{ message: 'X', taskId: 't1' }}
          onDismiss={() => events.push('dismiss')}
          onOpenTask={(id) => events.push(`open:${id}`)}
        />,
      );
      fireEvent.click(screen.getByText(/open task/i));
      expect(events).toEqual(['open:t1', 'dismiss']);
    });
  });
});
