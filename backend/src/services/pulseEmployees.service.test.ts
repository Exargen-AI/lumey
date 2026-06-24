/**
 * Pulse — derivePresence regression tests (2026-05-29).
 *
 * Pure-function tests for the heart of the Employees-tab view: given a
 * device's most-recent lastSeenAt + powerState, what's the employee's
 * presence right now? This is the basis of the green/amber/gray dot on
 * every employee row.
 *
 * NOTE: even though `derivePresence` is pure, importing it from
 * `./pulseEmployees.service` drags in `../config/database`, which loads
 * `../config/env` at module init and calls `process.exit(1)` when
 * DATABASE_URL / JWT secrets are unset (true on CI's unit-test job).
 * Importing the shared `prismaMock` first intercepts the `database`
 * import and breaks the chain before env.ts is touched. Same trick the
 * rest of the service test suite uses.
 */

import '../test/prismaMock';
import { describe, it, expect } from 'vitest';
import { derivePresence } from './pulseEmployees.service';

const NOW = Date.now();
const minutes = (m: number) => m * 60 * 1000;

describe('derivePresence', () => {
  it('OFFLINE when lastSeenAt is null', () => {
    expect(derivePresence({ lastSeenAt: null, powerState: null })).toBe('OFFLINE');
  });

  it('OFFLINE when last seen > 30 min ago, regardless of powerState', () => {
    const old = new Date(NOW - minutes(45));
    expect(derivePresence({ lastSeenAt: old, powerState: 'ON' })).toBe('OFFLINE');
    expect(derivePresence({ lastSeenAt: old, powerState: 'IDLE' })).toBe('OFFLINE');
    expect(derivePresence({ lastSeenAt: old, powerState: 'LOCKED' })).toBe('OFFLINE');
  });

  it('LOCKED when last seen recent and powerState=LOCKED', () => {
    const recent = new Date(NOW - minutes(2));
    expect(derivePresence({ lastSeenAt: recent, powerState: 'LOCKED' })).toBe('LOCKED');
  });

  it('AWAY when powerState=IDLE and last seen recent', () => {
    const recent = new Date(NOW - minutes(2));
    expect(derivePresence({ lastSeenAt: recent, powerState: 'IDLE' })).toBe('AWAY');
  });

  it('ONLINE when powerState=ON and last seen within 5 min', () => {
    const recent = new Date(NOW - minutes(2));
    expect(derivePresence({ lastSeenAt: recent, powerState: 'ON' })).toBe('ONLINE');
  });

  it('AWAY when powerState=ON but heartbeat is stale (5–30 min)', () => {
    const stale = new Date(NOW - minutes(20));
    // User hasn't actively touched the laptop in a while — even though
    // the OS still reports ON, treat as AWAY.
    expect(derivePresence({ lastSeenAt: stale, powerState: 'ON' })).toBe('AWAY');
  });

  it('AWAY (not OFFLINE) at the 5-min boundary', () => {
    const fiveMin = new Date(NOW - minutes(5) - 1);
    expect(derivePresence({ lastSeenAt: fiveMin, powerState: 'ON' })).toBe('AWAY');
  });

  it('OFFLINE at the 30-min boundary', () => {
    const thirtyMin = new Date(NOW - minutes(30) - 1);
    expect(derivePresence({ lastSeenAt: thirtyMin, powerState: 'ON' })).toBe('OFFLINE');
  });
});
