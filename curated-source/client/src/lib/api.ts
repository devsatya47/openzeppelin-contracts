const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const TOKEN_KEY = 'cs_token';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

export const tokenStore = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (t: string | null) => {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable */
    }
  },
};

export async function api<T = any>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const token = tokenStore.get();
  const isForm = init.body instanceof FormData;
  const res = await fetch(`${API_BASE}/api${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body && !isForm ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body ? (isForm ? (init.body as FormData) : JSON.stringify(init.body)) : undefined,
    signal: init.signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.details?.[0];
    throw new ApiError(res.status, detail ? `${data.error}: ${detail.path ? detail.path + ' — ' : ''}${detail.message}` : data.error ?? res.statusText, data.details);
  }
  return data as T;
}

/** Upload URLs are relative to the API origin, which may differ from the SPA host. */
export const mediaUrl = (u: string | null | undefined) => (!u ? '' : u.startsWith('/uploads/') ? `${API_BASE}${u}` : u);
