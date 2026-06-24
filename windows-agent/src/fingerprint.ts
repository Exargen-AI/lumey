/**
 * Hardware fingerprint — sha-256 of (machine UUID + primary MAC + OS install id).
 *
 * Stable across agent reinstall on the same physical machine. Lets the
 * backend recognise re-enrollment ("same laptop, fresh installer") vs.
 * a genuinely new device.
 *
 * Best-effort: each source may be missing on a given machine. We fall
 * back to a less stable composite rather than erroring — backend treats
 * fingerprint as opaque, so degraded inputs still work, they just lose
 * the re-enrollment recognition property.
 */

import { createHash } from 'crypto';
import { execSync } from 'child_process';
import * as os from 'os';

function safeExec(cmd: string): string {
  try {
    // Wave 11 — `windowsHide: true` suppresses the brief conhost
    // flash. The fingerprint commands run only at first enroll, so the
    // flash was a one-off, but consistency with `collectors.ts:runPs`
    // matters: a single overlooked execSync spawn is enough to make
    // the agent feel "noisy" to the user.
    return execSync(cmd, { encoding: 'utf8', timeout: 5_000, windowsHide: true }).trim();
  } catch {
    return '';
  }
}

function readMachineGuidWindows(): string {
  // The MachineGuid is stable across boots; reset only by reinstalling
  // Windows.
  const out = safeExec(
    'reg query HKLM\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid',
  );
  const m = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-f-]+)/i);
  return m?.[1] ?? '';
}

function readBiosUuidWindows(): string {
  // `wmic` was deprecated in Windows 10 21H1 and REMOVED entirely from
  // Windows 11 24H2 (and recent 23H2 builds). We use PowerShell's
  // Get-CimInstance instead — same data source under the hood (WMI),
  // present on every supported Windows version.
  const out = safeExec(
    'powershell.exe -NoProfile -NonInteractive -Command "(Get-CimInstance Win32_ComputerSystemProduct).UUID"',
  );
  return out.trim();
}

function readPrimaryMac(): string {
  const interfaces = os.networkInterfaces();
  for (const list of Object.values(interfaces)) {
    if (!list) continue;
    for (const iface of list) {
      if (iface.mac && iface.mac !== '00:00:00:00:00:00' && !iface.internal) {
        return iface.mac;
      }
    }
  }
  return '';
}

export function computeFingerprint(): string {
  const parts: string[] = [];
  if (process.platform === 'win32') {
    parts.push(readMachineGuidWindows());
    parts.push(readBiosUuidWindows());
  }
  parts.push(readPrimaryMac());
  parts.push(os.hostname());
  parts.push(os.platform());
  parts.push(os.arch());
  // sha-256 of the concatenation. If most inputs are empty we still get
  // *something*, but with much weaker stability properties — that's a
  // dev/non-Windows fallback only.
  return createHash('sha256').update(parts.join('::')).digest('hex');
}
