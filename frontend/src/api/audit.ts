import api from './client';

/**
 * Download the audit-log export as a CSV file. Fetches through the authed axios
 * client (the endpoint is bearer-gated, so a plain link can't carry the token),
 * then triggers a browser download.
 */
export async function downloadAuditCsv(): Promise<void> {
  const res = await api.get('/audit/export', { params: { format: 'csv' }, responseType: 'blob' });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lumey-audit-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
