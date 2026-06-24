/**
 * Vitest setup file — runs once before any test.
 *
 * Pulls in jest-dom's custom matchers (`toBeInTheDocument`,
 * `toHaveTextContent`, etc.) and cleans up after every test so the DOM
 * doesn't leak between tests in the same file.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
