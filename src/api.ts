const jsonHeaders = (userId: string) => ({
  "Content-Type": "application/json",
  "x-user-id": userId,
});

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function api<T>(path: string, userId: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      "x-user-id": userId,
      ...(options.body instanceof FormData ? {} : jsonHeaders(userId)),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(body.error?.message || `请求失败（HTTP ${response.status}）`, response.status);
  }
  return body as T;
}

export async function downloadAttachment(id: string, name: string, userId: string) {
  const response = await fetch(`/api/attachments/${id}/download`, { headers: { "x-user-id": userId } });
  if (!response.ok) throw new ApiError("附件下载失败", response.status);
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}
