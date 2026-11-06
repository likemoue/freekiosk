export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

const CSRF = { 'X-Requested-With': 'freekiosk-manager' };

async function parseError(response: Response): Promise<ApiError> {
  // Cloudflare's challenge page, which fetch cannot pass: the request never reached this server
  if (response.headers.get('cf-mitigated')) {
    return new ApiError('Cloudflare đã chặn yêu cầu này trước khi tới máy chủ. Nếu bạn đang đăng nhập, có thể mật khẩu vừa nhập nằm trong danh sách mật khẩu đã bị lộ.', response.status);
  }
  let message = `Lỗi máy chủ (HTTP ${response.status})`;
  let code: string | undefined;
  try {
    const body = await response.json();
    const raw = body.message ?? body.error;
    if (Array.isArray(raw)) message = raw.join('. ');
    else if (typeof raw === 'string') message = raw;
    code = body.code;
  } catch {
    // A proxy in front answered with HTML: the status is all there is to say
  }
  return new ApiError(message, response.status, code);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { ...CSRF, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Không kết nối được máy chủ', 0);
  }
  if (!response.ok) throw await parseError(response);
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T = any>(path: string) => request<T>('GET', path),
  post: <T = any>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  put: <T = any>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T = any>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T = any>(path: string) => request<T>('DELETE', path),
};

// Small enough for every proxy on the way, Cloudflare's 100 MB limit included
const PART_SIZE = 20 * 1024 * 1024;
const PART_RETRIES = 4;

/** Sends a file in parts and returns the id of the finished upload */
export async function uploadFile(file: File, purpose: 'media' | 'apk' | 'usb_tool', onProgress?: (fraction: number) => void): Promise<string> {
  const { id } = await api.post<{ id: string }>('/api/admin/uploads', { fileName: file.name, sizeBytes: file.size, purpose });
  let offset = 0;
  let failures = 0;
  while (offset < file.size) {
    const part = file.slice(offset, offset + PART_SIZE);
    try {
      const response = await fetch(`/api/admin/uploads/${id}/part?offset=${offset}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { ...CSRF, 'Content-Type': 'application/octet-stream' },
        body: part,
      });
      if (!response.ok) throw await parseError(response);
      const { received } = (await response.json()) as { received: number };
      offset = received;
      failures = 0;
      onProgress?.(offset / file.size);
    } catch (error) {
      failures += 1;
      if (failures > PART_RETRIES) throw error;
      await new Promise((done) => setTimeout(done, 1000 * failures));
    }
  }
  return id;
}
