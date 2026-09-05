'use client';

/** Thin fetch wrapper that turns API errors into thrown Errors with the server message. */
export async function api<T = any>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
    body: init.body ? JSON.stringify(init.body) : undefined,
    credentials: 'same-origin',
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const detail = Array.isArray(data?.details)
      ? data.details.map((d: any) => `${d.path?.join('.') ?? ''} ${d.message}`.trim()).join(', ')
      : typeof data?.details === 'string'
        ? data.details
        : '';
    throw new Error([data?.error ?? `request failed (${res.status})`, detail].filter(Boolean).join(' — '));
  }
  return data as T;
}
