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
  category: string | null;
  tags: string[];
  favorite: boolean;
  managedDeployment: boolean;
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

export type ProxyDiagnostics = {
  tlsMode: 'http' | 'auto_https' | 'internal_ca';
  caddyListen: string[];
  port443: {
    available: boolean;
    error: string | null;
  };
  warnings: string[];
  renderedConfig: unknown;
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

export type LocalService = {
  address: string;
  port: number;
  pid: number | null;
  processName: string | null;
  targetUrl: string;
};

export type NaviSettings = {
  tlsMode: 'http' | 'auto_https' | 'internal_ca';
  dashboardAuthRequired: boolean;
  healthCheckIntervalSeconds: number;
};

export type AuditLog = {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  summary: string;
  sourceIp: string | null;
  createdAt: string;
};

export type BackupSnapshot = {
  id: string;
  reason: string;
  createdAt: string;
  payload: {
    exportedAt: string;
    version: number;
    apps: NaviApp[];
    settings: NaviSettings;
  };
};

export type DeployPayload = {
  method: 'docker_run';
  command: string;
  publishMode: 'reverse_proxy' | 'public_domain_reverse_proxy';
  name?: string;
  publicHost: string;
  routeMode: RouteMode;
  publicPath: string | null;
  hostPort?: number | null;
  containerPort?: number | null;
  category: string | null;
  tags: string[];
  favorite: boolean;
  enabled: boolean;
};

export type DeployPlan = {
  containerName: string;
  image: string;
  publishMode: DeployPayload['publishMode'];
  hostPort: number | null;
  containerPort: number;
  protocol: string;
  targetUrl: string;
  appPayload: AppPayload;
  dockerArgs: string[];
  warnings: string[];
};

export type DeployResult = {
  containerId: string;
  plan: DeployPlan;
  app: NaviApp;
  proxySync: ProxySync;
};

export type DeployDoctor = {
  ok: boolean;
  dockerBin: string;
  dockerHost: string | null;
  dockerConfig: string | null;
  platform: string;
  userHelpRequired: boolean;
  checks: Array<{
    id: string;
    label: string;
    status: 'pass' | 'warn' | 'fail';
    detail: string;
  }>;
  requirements: Array<{
    id: string;
    label: string;
    status: 'ready' | 'auto' | 'needs_user' | 'blocked';
    userHelpRequired: boolean;
    detail: string;
    commands: string[];
  }>;
  grantSteps: Array<{
    title: string;
    description: string;
    commands: string[];
  }>;
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
  category: string | null;
  tags: string[];
  favorite: boolean;
};

const tokenKey = 'naviproxy-admin-token';
let memoryToken = '';

function readStoredToken() {
  try {
    const sessionToken = sessionStorage.getItem(tokenKey);

    if (sessionToken) {
      return sessionToken;
    }

    const legacyToken = localStorage.getItem(tokenKey);

    if (legacyToken) {
      sessionStorage.setItem(tokenKey, legacyToken);
      localStorage.removeItem(tokenKey);
      return legacyToken;
    }
  } catch {
    return memoryToken;
  }

  return '';
}

export function getAdminToken() {
  return memoryToken || readStoredToken();
}

export function setAdminToken(token: string) {
  memoryToken = token;

  if (token) {
    try {
      sessionStorage.setItem(tokenKey, token);
      localStorage.removeItem(tokenKey);
    } catch {
      // Keep the token in memory for storage-restricted browsers.
    }
    return;
  }

  try {
    sessionStorage.removeItem(tokenKey);
    localStorage.removeItem(tokenKey);
  } catch {
    // Nothing else to clear when browser storage is unavailable.
  }
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
  runAppStatusCheck: () =>
    request<AppStatus[]>('/api/apps/status/check', {
      method: 'POST'
    }),
  appHealthHistory: (id: string) =>
    request<AppStatus[]>(`/api/apps/${id}/health-history?limit=24`),
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
    request<{
      ok: true;
      proxySync?: ProxySync;
      deployment?: {
        provider: 'docker';
        resourceName: string;
      } | null;
    }>(`/api/apps/${id}`, {
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
  proxyDiagnostics: () =>
    request<ProxyDiagnostics>('/api/proxy/diagnostics'),
  dnsDiagnostic: (host: string) =>
    request<DnsDiagnostic>(`/api/diagnostics/dns?host=${encodeURIComponent(host)}`),
  auditLogs: () => request<AuditLog[]>('/api/audit?limit=20'),
  localServices: () =>
    request<{ scannedAt: string; services: LocalService[] }>(
      '/api/diagnostics/local-services'
    ),
  settings: () => request<NaviSettings>('/api/settings'),
  updateSettings: (payload: Partial<NaviSettings>) =>
    request<NaviSettings>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(payload)
    }),
  backup: () =>
    request<{
      exportedAt: string;
      version: number;
      apps: NaviApp[];
      settings: NaviSettings;
    }>('/api/backup'),
  restoreBackup: (payload: unknown) =>
    request<AppListMutationResult & { settings: NaviSettings }>(
      '/api/backup/restore',
      {
        method: 'POST',
        body: JSON.stringify(payload)
      }
    ),
  backupSnapshots: () => request<BackupSnapshot[]>('/api/backup/snapshots'),
  deployDoctor: (payload?: Partial<DeployPayload>) =>
    payload
      ? request<DeployDoctor>('/api/deploy/doctor', {
          method: 'POST',
          body: JSON.stringify(payload)
        })
      : request<DeployDoctor>('/api/deploy/doctor'),
  previewDeploy: (payload: DeployPayload) =>
    request<DeployPlan>('/api/deploy/preview', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  deployDockerRun: (payload: DeployPayload) =>
    request<DeployResult>('/api/deploy/docker-run', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  syncProxy: () =>
    request<ProxySync>('/api/proxy/sync', {
      method: 'POST'
    })
};
