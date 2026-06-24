import api from './client';

/**
 * Project Documents — REST client.
 *
 * Upload is a three-step dance the API server only sees the bookends of:
 *   1) presignUpload() — server creates a PENDING row + presigned PUT URL
 *   2) PUT directly to S3 with the file body (NOT via this client)
 *   3) confirmUpload() — server checks S3 and flips PENDING → READY
 *
 * Download is two steps: ask the server for a presigned GET URL, then
 * fetch the URL. The download() helper does both.
 */

export type DocCategory =
  | 'SPEC' | 'DESIGN' | 'CONTRACT' | 'REFERENCE' | 'RUNBOOK' | 'SECURITY' | 'OTHER';

export type DocStatus = 'PENDING' | 'READY' | 'DELETED';

export interface ProjectDocument {
  id: string;
  title: string;
  description: string | null;
  category: DocCategory;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedBy: { id: string; name: string };
}

export interface PresignUploadInput {
  title: string;
  description?: string | null;
  category?: DocCategory;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

export interface PresignUploadResult {
  document: {
    id: string;
    projectId: string;
    title: string;
    description: string | null;
    category: DocCategory;
    filename: string;
    contentType: string;
    sizeBytes: number;
    status: DocStatus;
    uploadedAt: string;
  };
  uploadUrl: string;
  expiresIn: number;
}

export async function presignUpload(
  projectId: string,
  input: PresignUploadInput,
): Promise<PresignUploadResult> {
  const { data } = await api.post(`/projects/${projectId}/documents/presigned-upload`, input);
  return data.data;
}

export async function confirmUpload(projectId: string, docId: string): Promise<ProjectDocument> {
  const { data } = await api.post(`/projects/${projectId}/documents/${docId}/confirm`);
  return data.data;
}

export async function listDocuments(projectId: string): Promise<ProjectDocument[]> {
  const { data } = await api.get(`/projects/${projectId}/documents`);
  return data.data;
}

export async function getDownloadUrl(
  projectId: string,
  docId: string,
): Promise<{ url: string; filename: string; contentType: string; sizeBytes: number; expiresIn: number }> {
  const { data } = await api.get(`/projects/${projectId}/documents/${docId}/download`);
  return data.data;
}

export async function deleteDocument(projectId: string, docId: string): Promise<void> {
  await api.delete(`/projects/${projectId}/documents/${docId}`);
}

/* ─────────────────────────────────────────────────────────────────────────────
   uploadDocument — orchestrates the three-step upload (presign → PUT → confirm).

   `onProgress` reports byte progress on the S3 PUT only (0..100). The presign
   + confirm calls each take ~100ms; the PUT is where time goes for any
   non-tiny file.

   Returns the confirmed READY document so the caller can prepend it to the
   list without a round-trip.
   ───────────────────────────────────────────────────────────────────────── */
export async function uploadDocument(
  projectId: string,
  file: File,
  meta: { title: string; description?: string | null; category?: DocCategory },
  onProgress?: (pct: number) => void,
): Promise<ProjectDocument> {
  // 1) Ask the server to mint a PENDING row + presigned URL
  const presign = await presignUpload(projectId, {
    title:       meta.title,
    description: meta.description ?? null,
    category:    meta.category ?? 'OTHER',
    filename:    file.name,
    contentType: file.type || 'application/octet-stream',
    sizeBytes:   file.size,
  });

  // 2) PUT the bytes directly to S3. We use XHR (not axios/fetch) because
  //    XHR's upload progress events are the most portable way to surface
  //    pct progress; axios' onUploadProgress in the browser is implemented
  //    via the same primitive, but XHR keeps the call out of our axios
  //    interceptor chain (we don't want the Authorization header attached
  //    to an S3 URL — S3 would reject the request).
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', presign.uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`S3 PUT failed: ${xhr.status} ${xhr.statusText}`));
    };
    xhr.onerror = () => reject(new Error('S3 PUT network error'));
    xhr.send(file);
  });

  // 3) Tell the server the upload completed — server head-checks S3 and
  //    flips the row to READY.
  return confirmUpload(projectId, presign.document.id);
}
