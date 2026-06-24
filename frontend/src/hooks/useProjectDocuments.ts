import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as docsApi from '@/api/projectDocuments';

const KEY = (projectId: string) => ['project-documents', projectId];

export function useProjectDocuments(projectId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: KEY(projectId),
    queryFn: () => docsApi.listDocuments(projectId),
    enabled: options?.enabled ?? !!projectId,
  });
}

/**
 * Upload mutation. Returns the freshly-READY doc on success and prepends
 * it to the cached list — no round-trip required for the optimistic add.
 */
export function useUploadDocument(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      file: File;
      title: string;
      description?: string | null;
      category?: docsApi.DocCategory;
      onProgress?: (pct: number) => void;
    }) =>
      docsApi.uploadDocument(
        projectId,
        args.file,
        { title: args.title, description: args.description, category: args.category },
        args.onProgress,
      ),
    onSuccess: (newDoc) => {
      // Prepend to cached list rather than refetching — keeps the upload
      // animation feeling instant.
      qc.setQueryData<docsApi.ProjectDocument[] | undefined>(KEY(projectId), (prev) =>
        prev ? [newDoc, ...prev] : [newDoc],
      );
    },
  });
}

export function useDeleteDocument(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (docId: string) => docsApi.deleteDocument(projectId, docId),
    onMutate: async (docId) => {
      // Optimistic removal — delete is irreversible (well, soft-irreversible)
      // and the user expects the row to disappear immediately.
      await qc.cancelQueries({ queryKey: KEY(projectId) });
      const prev = qc.getQueryData<docsApi.ProjectDocument[]>(KEY(projectId));
      qc.setQueryData<docsApi.ProjectDocument[] | undefined>(KEY(projectId), (cur) =>
        cur?.filter((d) => d.id !== docId),
      );
      return { prev };
    },
    onError: (_err, _docId, ctx) => {
      // Roll back on error
      if (ctx?.prev) qc.setQueryData(KEY(projectId), ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: KEY(projectId) });
    },
  });
}

/**
 * Download a single document by asking the server for a presigned URL,
 * then navigating to it. We don't fetch the bytes ourselves — letting
 * the browser handle the URL gives us proper download UX (progress in
 * the download tray, resume on flaky connections) for free.
 */
export async function downloadDocument(projectId: string, docId: string) {
  const { url } = await docsApi.getDownloadUrl(projectId, docId);
  // `download` attribute is hint-only; the actual filename comes from the
  // Content-Disposition header the presigned URL sets server-side.
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
