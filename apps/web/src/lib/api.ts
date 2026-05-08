export type RouteMode = 'subdomain' | 'subpath';
export type IconType = 'url' | 'emoji' | 'builtin';

export type NaviApp = {
  id: string;
  name: string;
  slug: string;
  iconType: IconType;
  iconValue: string | null;
  targetUrl: string;
  routeMode: RouteMode;
  publicHost: string;
  publicPath: string | null;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type AppPayload = {
  name: string;
  iconType: IconType;
  iconValue: string | null;
  targetUrl: string;
  routeMode: RouteMode;
  publicHost: string;
  publicPath: string | null;
  enabled: boolean;
  sortOrder: number;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);

  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    ...init,
    headers
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export const api = {
  listApps: () => request<NaviApp[]>('/api/apps'),
  createApp: (payload: AppPayload) =>
    request<NaviApp>('/api/apps', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  updateApp: (id: string, payload: AppPayload) =>
    request<NaviApp>(`/api/apps/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    }),
  deleteApp: (id: string) =>
    request<{ ok: true }>(`/api/apps/${id}`, {
      method: 'DELETE'
    }),
  syncProxy: () =>
    request<{ status: 'success' | 'skipped'; hash: string }>('/api/proxy/sync', {
      method: 'POST'
    })
};
