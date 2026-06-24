/**
 * 2026-05-23 PR #147 audit: this is the test that should have existed
 * BEFORE the kanban silent-rollback bug was possible.
 *
 * The kanban (and every other mutating surface) relies on this helper to
 * turn a rejected mutation into a string the user can read. If the
 * extractor returns "" or the fallback when the server DID include a
 * useful message, the user gets a useless toast — which is functionally
 * the same as the silent-rollback we're fixing. These tests lock down
 * the contract so the next change to this file can't quietly regress
 * any consumer.
 *
 * Backend's error contract (see backend/src/middleware/errorHandler) is
 *     { success: false, error: { code: '…', message: '…' } }
 * wrapped by axios as `err.response.data.{...above...}`.
 */

import { describe, it, expect } from 'vitest';
import { extractApiErrorMessage } from './apiErrorMessage';

describe('extractApiErrorMessage', () => {
  it('pulls the server message out of an axios-shaped rejection (the common case)', () => {
    const err = {
      response: {
        status: 400,
        data: {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Cannot mark this task Done — 3 acceptance criteria are still unchecked.',
          },
        },
      },
      message: 'Request failed with status code 400',
    };
    expect(extractApiErrorMessage(err)).toBe(
      'Cannot mark this task Done — 3 acceptance criteria are still unchecked.',
    );
  });

  it('prefers nested error.message over the axios-level message (server reason beats HTTP description)', () => {
    const err = {
      response: { data: { error: { message: 'You do not have permission to transition tasks to Done.' } } },
      message: 'Request failed with status code 403',
    };
    expect(extractApiErrorMessage(err)).toBe(
      'You do not have permission to transition tasks to Done.',
    );
  });

  it('falls back to top-level data.message if the contract is the legacy shallow shape', () => {
    const err = {
      response: { data: { message: 'Validation failed' } },
    };
    expect(extractApiErrorMessage(err)).toBe('Validation failed');
  });

  it('uses Error.message for plain network-level failures (no axios response present)', () => {
    const err = new Error('Network Error');
    expect(extractApiErrorMessage(err)).toBe('Network Error');
  });

  it('tolerates plain objects thrown with a message field', () => {
    const err = { message: 'Something broke' };
    expect(extractApiErrorMessage(err)).toBe('Something broke');
  });

  it('returns the fallback when nothing useful is present (null, undefined, opaque shapes)', () => {
    expect(extractApiErrorMessage(null)).toBe('Something went wrong.');
    expect(extractApiErrorMessage(undefined)).toBe('Something went wrong.');
    expect(extractApiErrorMessage({})).toBe('Something went wrong.');
    expect(extractApiErrorMessage({ response: {} })).toBe('Something went wrong.');
    expect(extractApiErrorMessage({ response: { data: {} } })).toBe('Something went wrong.');
    expect(extractApiErrorMessage({ response: { data: { error: {} } } })).toBe('Something went wrong.');
  });

  it('returns the caller-supplied fallback when provided, not the default', () => {
    expect(extractApiErrorMessage(null, 'Could not move that task.')).toBe(
      'Could not move that task.',
    );
    expect(extractApiErrorMessage({}, 'Move failed')).toBe('Move failed');
  });

  it('ignores empty-string server messages (so an empty contract field does not eclipse the fallback)', () => {
    const err = {
      response: { data: { error: { message: '' } } },
      message: 'Request failed',
    };
    // Empty server message should fall through to err.message (Error-like).
    expect(extractApiErrorMessage(err, 'Move failed')).toBe('Request failed');
  });

  it('ignores non-string server messages (defensive against contract drift)', () => {
    const err = {
      response: { data: { error: { message: { obj: 'not a string' } } } },
    };
    expect(extractApiErrorMessage(err, 'Move failed')).toBe('Move failed');
  });

  it('handles the exact error shape moveTask hits when the backend rejects an illegal transition', () => {
    // From task.service.ts assertLegalTransition — verbatim string.
    const err = {
      response: {
        status: 400,
        data: {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Cannot move task from BACKLOG to DONE. Move it through an intermediate status first.',
          },
        },
      },
    };
    expect(extractApiErrorMessage(err, 'Could not move that task.')).toBe(
      'Cannot move task from BACKLOG to DONE. Move it through an intermediate status first.',
    );
  });

  it('handles the agent-Done-gate ForbiddenError shape (verbatim string from backend)', () => {
    const err = {
      response: {
        status: 403,
        data: {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Agents may not transition tasks to Done — request a human reviewer.',
          },
        },
      },
    };
    expect(extractApiErrorMessage(err, 'Could not move that task.')).toBe(
      'Agents may not transition tasks to Done — request a human reviewer.',
    );
  });
});
