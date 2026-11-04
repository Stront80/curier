export const API_URL = '/api';

export const telegram = (window as any).Telegram?.WebApp;

export const money = (n: number) =>
  new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 0
  }).format(n) + ' ₽';

export async function api<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST';
    token?: string;
    body?: unknown;
  } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined
      ? undefined
      : JSON.stringify(options.body)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error ?? `Request failed (${response.status})`);
  }

  return data as T;
}
