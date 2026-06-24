/**
 * Pulse Agent — Windows Service registration.
 *
 * Wraps node-windows to install/uninstall the agent as a managed
 * Service running under LocalSystem. Run during the installer; users
 * never invoke this directly.
 *
 *   pulse-agent-svc install        # register + start
 *   pulse-agent-svc uninstall      # stop + deregister
 *
 * node-windows writes its own wrapper .exe that the SCM controls — our
 * pkg-built agent .exe becomes the payload it launches.
 */

import { Service } from 'node-windows';
import * as path from 'path';
import * as fs from 'fs';

const SERVICE_NAME = 'ExargenPulseAgent';
const SERVICE_DESCRIPTION =
  'Exargen Command Center — device health + productivity telemetry agent. Reports to the Command Center server every 5/60 min.';

function resolveScriptPath(): string {
  // Two cases:
  //   1. Running from source (pulse-agent-svc start) — resolve to dist/index.js
  //   2. Running from packaged .exe — process.execPath IS the agent;
  //      node-windows wraps it directly.
  if (process.pkg) {
    return process.execPath;
  }
  const compiled = path.resolve(__dirname, 'index.js');
  if (!fs.existsSync(compiled)) {
    throw new Error(`Expected compiled entry at ${compiled} — run \`npm run build\` first.`);
  }
  return compiled;
}

function build(): Service {
  return new Service({
    name: SERVICE_NAME,
    description: SERVICE_DESCRIPTION,
    script: resolveScriptPath(),
    nodeOptions: ['--enable-source-maps'],
    // Restart on crash with a generous delay so we don't tight-loop
    // when something's permanently broken (e.g., revoked API key).
    wait: 2,
    grow: 0.5,
    maxRetries: 40,
  });
}

function install() {
  const svc = build();
  svc.on('install', () => {
    console.log(`[pulse-agent] Service installed: ${SERVICE_NAME}`);
    svc.start();
  });
  svc.on('alreadyinstalled', () => {
    console.log('[pulse-agent] Service already installed; starting…');
    svc.start();
  });
  svc.on('error', (err: unknown) => {
    console.error('[pulse-agent] Install error:', err);
    process.exit(1);
  });
  svc.install();
}

function uninstall() {
  const svc = build();
  svc.on('uninstall', () => {
    console.log(`[pulse-agent] Service uninstalled: ${SERVICE_NAME}`);
    process.exit(0);
  });
  svc.on('error', (err: unknown) => {
    console.error('[pulse-agent] Uninstall error:', err);
    process.exit(1);
  });
  svc.uninstall();
}

if (process.argv.includes('--uninstall')) {
  uninstall();
} else {
  install();
}
