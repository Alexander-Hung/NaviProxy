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

export type ProxySync = {
  status: 'success' | 'skipped' | 'failed';
  hash: string | null;
  errorMessage?: string;
};

export type AppMutationResult = {
  app: NaviApp;
  proxySync: ProxySync;
};

export type AppListMutationResult = {
  apps: NaviApp[];
  proxySync: ProxySync;
};

export type AppStatus = {
  id: string;
  ok: boolean;
  statusCode: number | null;
  responseTimeMs: number;
  checkedAt: string;
  error: string | null;
};

export type ProxyHistoryItem = {
  id: string;
  caddyConfigHash: string;
  status: ProxySync['status'];
  errorMessage: string | null;
  createdAt: string;
};

export type HealthInfo = {
  ok: boolean;
  name: string;
  authRequired: boolean;
};

export type DnsDiagnostic = {
  host: string;
  addresses: string[];
  localAddresses: string[];
  matchesLocalAddress: boolean;
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

const tokenKey = 'naviproxy-admin-token';

export function getAdminToken() {
  return localStorage.getItem(tokenKey) ?? '';
}

export function setAdminToken(token: string) {
  if (token) {
    localStorage.setItem(tokenKey, token);
    return;
  }

  localStorage.removeItem(tokenKey);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const token = getAdminToken();

  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (token && !headers.has('X-NaviProxy-Token')) {
    headers.set('X-NaviProxy-Token', token);
  }

  const response = await fetch(path, {
    ...init,
    headers
  });

  if (!response.ok) {
    const detail = await response.text();

    try {
      const parsed = JSON.parse(detail) as {
        message?: string;
        issues?: { path?: Array<string | number>; message: string }[];
      };
      const issueText = parsed.issues
        ?.map((issue) =>
          issue.path?.length
            ? `${issue.path.join('.')}: ${issue.message}`
            : issue.message
        )
        .join('; ');

      throw new Error(issueText || parsed.message || `Request failed with ${response.status}`);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(detail || `Request failed with ${response.status}`);
      }

      throw error;
    }
  }

  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<HealthInfo>('/api/health'),
  listApps: () => request<NaviApp[]>('/api/apps'),
  appStatuses: () => request<AppStatus[]>('/api/apps/status'),
  createApp: (payload: AppPayload) =>
    request<AppMutationResult>('/api/apps', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  updateApp: (id: string, payload: AppPayload) =>
    request<AppMutationResult>(`/api/apps/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    }),
  deleteApp: (id: string) =>
    request<{ ok: true; proxySync?: ProxySync }>(`/api/apps/${id}`, {
      method: 'DELETE'
    }),
  reorderApps: (ids: string[]) =>
    request<AppListMutationResult>('/api/apps/reorder', {
      method: 'PATCH',
      body: JSON.stringify({ ids })
    }),
  exportApps: () =>
    request<{ exportedAt: string; apps: NaviApp[] }>('/api/apps/export'),
  importApps: (apps: unknown[]) =>
    request<AppListMutationResult>('/api/apps/import', {
      method: 'POST',
      body: JSON.stringify({ mode: 'replace', apps })
    }),
  proxyHistory: () => request<ProxyHistoryItem[]>('/api/proxy/history?limit=8'),
  dnsDiagnostic: (host: string) =>
    request<DnsDiagnostic>(`/api/diagnostics/dns?host=${encodeURIComponent(host)}`),
  syncProxy: () =>
    request<ProxySync>('/api/proxy/sync', {
      method: 'POST'
    })
};
