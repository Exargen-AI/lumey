import api from './client';

export async function loginApi(email: string, password: string) {
  const { data } = await api.post('/auth/login', { email, password });
  return data.data;
}

export async function refreshTokenApi() {
  const { data } = await api.post('/auth/refresh');
  return data.data;
}

// Alias used by useInitAuth. Same behavior; clearer intent at the callsite.
export const refreshApi = refreshTokenApi;

export async function logoutApi() {
  const { data } = await api.post('/auth/logout');
  return data.data;
}

export async function getMeApi() {
  const { data } = await api.get('/auth/me');
  return data.data;
}

export async function changePasswordApi(currentPassword: string, newPassword: string) {
  const { data } = await api.put('/auth/change-password', { currentPassword, newPassword });
  return data.data;
}

/**
 * Narrow self-update for the authenticated user. Backend accepts only
 * `name` and `company`; everything else stays admin-only.
 */
export async function updateMeApi(patch: { name?: string; company?: string | null }) {
  const { data } = await api.patch('/auth/me', patch);
  return data.data;
}

/**
 * Upload a profile photo. Three hops, matching the project-document flow:
 *   1. ask the API for a presigned PUT url + key,
 *   2. PUT the bytes STRAIGHT to S3 (raw fetch — different host, no bearer),
 *   3. confirm so the API points the user at it and returns the fresh user.
 */
export async function uploadAvatarApi(file: File) {
  const urlRes = await api.post('/auth/me/avatar/upload-url', {
    contentType: file.type,
    sizeBytes: file.size,
  });
  const { uploadUrl, key } = urlRes.data.data as { uploadUrl: string; key: string };

  const put = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type },
  });
  if (!put.ok) throw new Error('Could not upload the photo to storage.');

  const { data } = await api.put('/auth/me/avatar', { key });
  return data.data.user;
}

export async function removeAvatarApi() {
  const { data } = await api.delete('/auth/me/avatar');
  return data.data.user;
}
