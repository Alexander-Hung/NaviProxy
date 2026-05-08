import {
  Download,
  Plus,
  RefreshCw,
  Save,
  Search,
  Server,
  Shield,
  Upload,
  X
} from 'lucide-react';
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { AuditLogPanel, BackupSnapshotsPanel } from '../components/AdminPanels';
import { AppCard } from '../components/AppCard';
import { RouteModeWarning } from '../components/RouteModeWarning';
import {
  api,
  getAdminToken,
  setAdminToken,
  type AppPayload,
  type AppStatus,
  type AuditLog,
  type BackupSnapshot,
  type DnsDiagnostic,
  type LocalService,
  type NaviSettings,
  type NaviApp,
  type ProxyDiagnostics,
  type ProxyHistoryItem,
  type ProxySync,
  type RouteMode
} from '../lib/api';

type Props = {
  onBack: () => void;
};

const initialForm: AppPayload = {
  name: '',
  iconType: 'builtin',
  iconValue: null,
  targetUrl: 'http://192.168.1.20:8080',
  routeMode: 'subdomain',
  publicHost: 'app.lab.home',
  publicPath: null,
  enabled: true,
  sortOrder: 0,
  category: null,
  tags: [],
  favorite: false
};

export function Admin({ onBack }: Props) {
  const [apps, setApps] = useState<NaviApp[]>([]);
  const [statuses, setStatuses] = useState<Record<string, AppStatus>>({});
  const [healthHistory, setHealthHistory] = useState<AppStatus[]>([]);
  const [history, setHistory] = useState<ProxyHistoryItem[]>([]);
  const [form, setForm] = useState<AppPayload>(initialForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [tokenInput, setTokenInput] = useState(getAdminToken());
  const [dnsHost, setDnsHost] = useState('');
  const [dnsResult, setDnsResult] = useState<DnsDiagnostic | null>(null);
  const [localServices, setLocalServices] = useState<LocalService[]>([]);
  const [serviceSearch, setServiceSearch] = useState('');
  const [serviceScope, setServiceScope] = useState<'all' | 'public' | 'loopback'>('all');
  const [showSystemServices, setShowSystemServices] = useState(false);
  const [ignoredServices, setIgnoredServices] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('naviproxy-ignored-services') ?? '[]');
    } catch {
      return [];
    }
  });
  const [settings, setSettings] = useState<NaviSettings | null>(null);
  const [proxyDiagnostics, setProxyDiagnostics] = useState<ProxyDiagnostics | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [backupSnapshots, setBackupSnapshots] = useState<BackupSnapshot[]>([]);
  const [detailAppId, setDetailAppId] = useState<string | null>(null);
  const [detailHistory, setDetailHistory] = useState<AppStatus[]>([]);
  const [appSearch, setAppSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [scanningServices, setScanningServices] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    const [
      health,
      nextApps,
      nextStatuses,
      nextSettings,
      nextProxyDiagnostics,
      nextAuditLogs,
      nextBackupSnapshots
    ] = await Promise.all([
      api.health().catch(() => null),
      api.listApps().catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        return [];
      }),
      api.appStatuses().catch(() => []),
      api.settings().catch(() => null),
      api.proxyDiagnostics().catch(() => null),
      api.auditLogs().catch(() => []),
      api.backupSnapshots().catch(() => [])
    ]);

    setAuthRequired(Boolean(health?.authRequired));
    setSettings(nextSettings);
    setProxyDiagnostics(nextProxyDiagnostics);
    setAuditLogs(nextAuditLogs);
    setBackupSnapshots(nextBackupSnapshots);
    setApps(nextApps);
    setStatuses(
      Object.fromEntries(nextStatuses.map((status) => [status.id, status]))
    );

    await loadHistory();
  }

  async function loadHistory() {
    try {
      setHistory(await api.proxyHistory());
    } catch {
      setHistory([]);
    }
  }

  useEffect(() => {
    void load().catch((err) =>
      setError(err instanceof Error ? err.message : String(err))
    );
  }, []);

  const sortedApps = useMemo(
    () =>
      [...apps]
        .filter((app) => {
          const query = appSearch.trim().toLowerCase();
          const text = [
            app.name,
            app.publicHost,
            app.targetUrl,
            app.category ?? '',
            ...app.tags
          ]
            .join(' ')
            .toLowerCase();

          return (
            (!query || text.includes(query)) &&
            (!categoryFilter || app.category === categoryFilter) &&
            (!favoriteOnly || app.favorite)
          );
        })
        .sort((left, right) => {
          if (left.favorite !== right.favorite) {
            return left.favorite ? -1 : 1;
          }

          return left.sortOrder - right.sortOrder;
        }),
    [appSearch, apps, categoryFilter, favoriteOnly]
  );
  const allSortedApps = useMemo(
    () => [...apps].sort((left, right) => left.sortOrder - right.sortOrder),
    [apps]
  );
  const categories = useMemo(
    () =>
      [...new Set(apps.map((app) => app.category).filter(Boolean) as string[])]
        .sort((left, right) => left.localeCompare(right)),
    [apps]
  );
  const detailApp = useMemo(
    () => apps.find((app) => app.id === detailAppId) ?? null,
    [apps, detailAppId]
  );
  const filteredLocalServices = useMemo(() => {
    const query = serviceSearch.trim().toLowerCase();
    const ignored = new Set(ignoredServices);

    return localServices.filter((service) => {
      const text = [
        service.processName ?? '',
        service.address,
        service.port,
        service.targetUrl,
        knownServiceName(service.port) ?? ''
      ]
        .join(' ')
        .toLowerCase();
      const matchesScope =
        serviceScope === 'all' ||
        (serviceScope === 'public' &&
          (service.address === '*' ||
            service.address === '0.0.0.0' ||
            service.address === '::')) ||
        (serviceScope === 'loopback' &&
          (service.address === '127.0.0.1' ||
            service.address === '::1' ||
            service.address === 'localhost'));

      return (
        !ignored.has(serviceKey(service)) &&
        (showSystemServices || !isDefaultHiddenService(service)) &&
        matchesScope &&
        (!query || text.includes(query))
      );
    });
  }, [
    ignoredServices,
    localServices,
    serviceScope,
    serviceSearch,
    showSystemServices
  ]);

  function proxySyncMessage(sync?: ProxySync) {
    if (!sync) {
      return 'Saved.';
    }

    if (sync.status === 'success') {
      return 'Saved and Caddy configuration synced.';
    }

    if (sync.status === 'skipped') {
      return 'Saved. Caddy sync is disabled in the API environment.';
    }

    return `Saved, but Caddy sync failed: ${sync.errorMessage ?? 'Unknown error'}`;
  }

  function saveToken() {
    setAdminToken(tokenInput.trim());
    setMessage(tokenInput.trim() ? 'Admin token saved for this tab.' : 'Admin token cleared.');
    setError(null);
    void load();
  }

  function knownServiceName(port: number) {
    const names: Record<number, string> = {
      80: 'HTTP',
      443: 'HTTPS',
      3000: 'Node app',
      32400: 'Plex',
      5173: 'Vite app',
      5174: 'Vite app',
      8080: 'Web UI',
      8096: 'Jellyfin',
      8123: 'Home Assistant',
      9000: 'Portainer'
    };

    return names[port] ?? null;
  }

  function serviceKey(service: LocalService) {
    return `${service.address}:${service.port}:${service.pid ?? 'unknown'}`;
  }

  function isDefaultHiddenService(service: LocalService) {
    const currentPort = Number(window.location.port);
    const processName = (service.processName ?? '').toLowerCase();
    const toolPorts = new Set([
      3001,
      5173,
      5174,
      ...(Number.isFinite(currentPort) && currentPort > 0 ? [currentPort] : [])
    ]);
    const toolProcesses = [
      'code helper',
      'cursor',
      'electron',
      'figma_agent',
      'rapportd',
      'sharingd',
      'controlcenter',
      'coreservicesuiagent',
      'identityservicesd',
      'universalaccessd',
      'antigravity'
    ];

    return (
      (toolPorts.has(service.port) && processName.includes('node')) ||
      toolProcesses.some((name) => processName.includes(name))
    );
  }

  function serviceName(service: LocalService) {
    const known = knownServiceName(service.port);

    if (known) {
      return known;
    }

    return service.processName
      ? `${service.processName} ${service.port}`
      : `Port ${service.port}`;
  }

  function serviceHost(service: LocalService) {
    const base = (service.processName || `port-${service.port}`)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);

    return `${base || `port-${service.port}`}.lab.home`;
  }

  function ignoreService(service: LocalService) {
    const next = [...new Set([...ignoredServices, serviceKey(service)])];
    setIgnoredServices(next);
    localStorage.setItem('naviproxy-ignored-services', JSON.stringify(next));
  }

  function update<K extends keyof AppPayload>(key: K, value: AppPayload[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setRouteMode(mode: RouteMode) {
    setForm((current) => ({
      ...current,
      routeMode: mode,
      publicPath: mode === 'subpath' ? current.publicPath ?? '/app' : null
    }));
  }

  function resetForm() {
    setEditingId(null);
    setForm(initialForm);
    setError(null);
    setMessage(null);
    setHealthHistory([]);
  }

  function editApp(app: NaviApp) {
    setEditingId(app.id);
    setForm({
      name: app.name,
      iconType: app.iconType,
      iconValue: app.iconValue,
      targetUrl: app.targetUrl,
      routeMode: app.routeMode,
      publicHost: app.publicHost,
      publicPath: app.publicPath,
      enabled: app.enabled,
      sortOrder: app.sortOrder,
      category: app.category,
      tags: app.tags,
      favorite: app.favorite
    });
    setError(null);
    setMessage(null);
    void api
      .appHealthHistory(app.id)
      .then(setHealthHistory)
      .catch(() => setHealthHistory([]));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openDetails(app: NaviApp) {
    setDetailAppId(app.id);
    setDetailHistory([]);
    void api
      .appHealthHistory(app.id)
      .then(setDetailHistory)
      .catch(() => setDetailHistory([]));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      if (editingId) {
        const result = await api.updateApp(editingId, form);
        setMessage(proxySyncMessage(result.proxySync));
      } else {
        const result = await api.createApp({
          ...form,
          sortOrder: apps.length
        });
        setMessage(proxySyncMessage(result.proxySync));
      }

      setEditingId(null);
      setForm(initialForm);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function deleteApp(app: NaviApp) {
    if (!window.confirm(`Delete ${app.name}?`)) {
      return;
    }

    setError(null);
    setMessage(null);

    try {
      const result = await api.deleteApp(app.id);
      setMessage(proxySyncMessage(result.proxySync));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function syncProxy() {
    setSyncing(true);
    setError(null);
    setMessage(null);

    try {
      const result = await api.syncProxy();
      setMessage(
        result.status === 'success'
          ? 'Caddy configuration synced.'
          : result.status === 'skipped'
            ? 'Caddy sync skipped because it is disabled in the API environment.'
            : `Caddy sync failed: ${result.errorMessage ?? 'Unknown error'}`
      );
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }

  async function moveApp(app: NaviApp, direction: -1 | 1) {
    const index = allSortedApps.findIndex((item) => item.id === app.id);
    const target = index + direction;

    if (target < 0 || target >= allSortedApps.length) {
      return;
    }

    const ids = allSortedApps.map((item) => item.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];

    try {
      const result = await api.reorderApps(ids);
      setApps(result.apps);
      setMessage(proxySyncMessage(result.proxySync));
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function exportApps() {
    try {
      const data = await api.exportApps();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json'
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `naviproxy-apps-${data.exportedAt.slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setMessage('Apps exported.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function importApps(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    if (!window.confirm('Importing will replace all configured apps. Continue?')) {
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { apps?: unknown[] } | unknown[];
      const importedApps = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.apps)
          ? parsed.apps
          : [];

      if (importedApps.length === 0) {
        throw new Error('Import file does not contain apps.');
      }

      const result = await api.importApps(importedApps);
      setApps(result.apps);
      setMessage(proxySyncMessage(result.proxySync));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function exportBackup() {
    try {
      const data = await api.backup();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json'
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `naviproxy-backup-${data.exportedAt.slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setMessage('Backup exported.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function restoreBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    if (!window.confirm('Restoring a backup will replace apps and settings. Continue?')) {
      return;
    }

    try {
      const result = await api.restoreBackup(JSON.parse(await file.text()));
      setApps(result.apps);
      setSettings(result.settings);
      setMessage(`${proxySyncMessage(result.proxySync)} A pre-restore snapshot was saved.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function runDnsDiagnostic() {
    setDnsResult(null);
    setError(null);

    try {
      setDnsResult(await api.dnsDiagnostic(dnsHost.trim()));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function scanLocalServices() {
    setScanningServices(true);
    setError(null);

    try {
      const result = await api.localServices();
      setLocalServices(result.services);
      setMessage(`Found ${result.services.length} listening local ports.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanningServices(false);
    }
  }

  function useLocalService(service: LocalService) {
    setEditingId(null);
    setForm({
      ...initialForm,
      name: serviceName(service),
      targetUrl: service.targetUrl,
      publicHost: serviceHost(service),
      category: service.processName ? 'Local' : null,
      sortOrder: apps.length
    });
    setMessage(`Prepared ${service.targetUrl}. Review the host name and save it.`);
    setError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function saveSettings(patch: Partial<NaviSettings>) {
    try {
      const next = await api.updateSettings(patch);
      setSettings(next);
      setProxyDiagnostics(await api.proxyDiagnostics().catch(() => null));
      setAuditLogs(await api.auditLogs().catch(() => []));
      setMessage('Settings saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="grid gap-6 pb-20 lg:grid-cols-[minmax(0,420px),1fr] sm:pb-0">
      <section>
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase text-spruce dark:text-[#86d8c6]">
              Admin
            </p>
            <h1 className="mt-2 text-2xl font-bold tracking-normal">Services</h1>
            {editingId ? (
              <p className="mt-1 text-sm text-black/55 dark:text-[#b8c7c1]">
                Editing existing app
              </p>
            ) : null}
          </div>
          <button
            className="h-10 rounded border border-black/10 bg-white px-3 text-sm font-semibold text-black/65 transition hover:text-black dark:border-white/15 dark:bg-[#18211e] dark:text-[#d7e4df] dark:hover:border-[#8fe0ce]/40 dark:hover:text-white"
            onClick={onBack}
          >
            Dashboard
          </button>
        </div>

        {authRequired ? (
          <div className="mb-4 rounded border border-amber/30 bg-amber/10 p-3 dark:border-amber/40 dark:bg-amber/15">
            <label className="label" htmlFor="adminToken">
              Admin token
            </label>
            <div className="flex gap-2">
              <input
                id="adminToken"
                className="field"
                type="password"
                value={tokenInput}
                onChange={(event) => setTokenInput(event.target.value)}
                placeholder="Required for admin actions"
              />
              <button
                className="grid h-11 w-11 shrink-0 place-items-center rounded bg-ink text-white transition hover:bg-spruce dark:bg-[#dff3ec] dark:text-[#0f1714]"
                type="button"
                onClick={saveToken}
                title="Save token"
                aria-label="Save token"
              >
                <Shield size={18} />
              </button>
            </div>
          </div>
        ) : null}

        <form className="panel p-4" onSubmit={submit}>
          <div className="grid gap-4">
            <div>
              <label className="label" htmlFor="name">
                App name
              </label>
              <input
                id="name"
                className="field"
                value={form.name}
                onChange={(event) => update('name', event.target.value)}
                placeholder="Jellyfin"
                required
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-[120px,minmax(0,1fr)]">
              <div>
                <label className="label" htmlFor="iconType">
                  Icon
                </label>
                <select
                  id="iconType"
                  className="field"
                  value={form.iconType}
                  onChange={(event) =>
                    update('iconType', event.target.value as AppPayload['iconType'])
                  }
                >
                  <option value="emoji">Emoji</option>
                  <option value="url">URL</option>
                  <option value="builtin">Built in</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="iconValue">
                  Icon value
                </label>
                <input
                  id="iconValue"
                  className="field"
                  value={form.iconValue ?? ''}
                  onChange={(event) => update('iconValue', event.target.value || null)}
                  placeholder="Emoji, built-in name, or https://..."
                />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="targetUrl">
                LAN target URL
              </label>
              <input
                id="targetUrl"
                className="field"
                value={form.targetUrl}
                onChange={(event) => update('targetUrl', event.target.value)}
                placeholder="http://192.168.1.20:8096"
                required
              />
            </div>

            <div>
              <span className="label">Access mode</span>
              <div className="grid grid-cols-2 gap-2 rounded border border-black/10 bg-[#f1f5f3] p-1 dark:border-white/15 dark:bg-[#18211e]">
                {(['subdomain', 'subpath'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`h-10 rounded text-sm font-semibold transition ${
                      form.routeMode === mode
                        ? 'bg-white text-spruce shadow-sm dark:bg-[#24312d] dark:text-[#f4fbf8]'
                        : 'text-black/55 hover:text-black dark:text-[#b8c7c1] dark:hover:text-[#f4fbf8]'
                    }`}
                    onClick={() => setRouteMode(mode)}
                  >
                    {mode === 'subdomain' ? 'Subdomain' : 'Subpath'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="label" htmlFor="publicHost">
                Public host
              </label>
              <input
                id="publicHost"
                className="field"
                value={form.publicHost}
                onChange={(event) => update('publicHost', event.target.value)}
                placeholder="jellyfin.lab.home"
                required
              />
              {form.routeMode === 'subdomain' ? (
                <p className="mt-2 text-xs leading-5 text-black/50 dark:text-[#a9bbb4]">
                  Use app-first names like homebridge.lab.home, and point either
                  that host or *.lab.home to the NaviProxy machine in local DNS.
                </p>
              ) : null}
            </div>

            {form.routeMode === 'subpath' ? (
              <>
                <div>
                  <label className="label" htmlFor="publicPath">
                    Public path
                  </label>
                  <input
                    id="publicPath"
                    className="field"
                    value={form.publicPath ?? ''}
                    onChange={(event) =>
                      update('publicPath', event.target.value || null)
                    }
                    placeholder="/jellyfin"
                    required
                  />
                </div>
                <RouteModeWarning />
              </>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="category">
                  Category
                </label>
                <input
                  id="category"
                  className="field"
                  value={form.category ?? ''}
                  onChange={(event) => update('category', event.target.value || null)}
                  placeholder="Media"
                />
              </div>
              <div>
                <label className="label" htmlFor="tags">
                  Tags
                </label>
                <input
                  id="tags"
                  className="field"
                  value={form.tags.join(', ')}
                  onChange={(event) =>
                    update(
                      'tags',
                      event.target.value
                        .split(',')
                        .map((tag) => tag.trim())
                        .filter(Boolean)
                    )
                  }
                  placeholder="nas, video"
                />
              </div>
            </div>

            <label className="flex items-center gap-3 text-sm font-medium text-black/70 dark:text-[#d7e4df]">
              <input
                type="checkbox"
                className="h-4 w-4 accent-spruce"
                checked={form.favorite}
                onChange={(event) => update('favorite', event.target.checked)}
              />
              Favorite
            </label>

            <label className="flex items-center gap-3 text-sm font-medium text-black/70 dark:text-[#d7e4df]">
              <input
                type="checkbox"
                className="h-4 w-4 accent-spruce"
                checked={form.enabled}
                onChange={(event) => update('enabled', event.target.checked)}
              />
              Enabled on dashboard and proxy
            </label>
          </div>

          {error ? (
            <div className="mt-4 rounded border border-coral/30 bg-coral/10 p-3 text-sm text-coral">
              {error}
            </div>
          ) : null}
          {message ? (
            <div className="mt-4 rounded border border-spruce/25 bg-spruce/10 p-3 text-sm text-spruce dark:border-[#8fe0ce]/25 dark:bg-[#8fe0ce]/10 dark:text-[#9be8d7]">
              {message}
            </div>
          ) : null}

          <button
            className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded bg-spruce px-4 text-sm font-semibold text-white transition hover:bg-[#11564a] disabled:cursor-not-allowed disabled:opacity-60"
            type="submit"
            disabled={saving}
          >
            <Save size={18} />
            {saving ? 'Saving...' : editingId ? 'Update app' : 'Save app'}
          </button>

          {editingId ? (
            <button
              className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded border border-black/10 bg-white px-4 text-sm font-semibold text-black/65 transition hover:text-black dark:border-white/15 dark:bg-[#18211e] dark:text-[#d7e4df] dark:hover:border-[#8fe0ce]/40 dark:hover:text-white"
              type="button"
              onClick={resetForm}
            >
              <X size={18} />
              Cancel editing
            </button>
          ) : (
            <button
              className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded border border-black/10 bg-white px-4 text-sm font-semibold text-black/65 transition hover:text-black dark:border-white/15 dark:bg-[#18211e] dark:text-[#d7e4df] dark:hover:border-[#8fe0ce]/40 dark:hover:text-white"
              type="button"
              onClick={resetForm}
            >
              <Plus size={18} />
              New app
            </button>
          )}
        </form>

        {healthHistory.length > 0 ? (
          <section className="panel mt-4 p-4">
            <h3 className="mb-3 text-sm font-semibold">Health history</h3>
            <div className="space-y-2">
              {healthHistory.slice(0, 8).map((item) => (
                <div
                  key={`${item.checkedAt}-${item.statusCode ?? 'error'}`}
                  className="flex items-center justify-between gap-3 rounded border border-black/10 p-2 text-xs dark:border-white/15"
                >
                  <span
                    className={
                      item.ok
                        ? 'font-semibold text-spruce dark:text-[#9be8d7]'
                        : 'font-semibold text-coral dark:text-[#ff9b8c]'
                    }
                  >
                    {item.ok ? item.statusCode ?? 'OK' : item.error ?? 'Offline'}
                  </span>
                  <span className="text-black/45 dark:text-[#9fb0aa]">
                    {item.responseTimeMs}ms · {new Date(item.checkedAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </section>

      <section>
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase text-black/45 dark:text-[#a9bbb4]">
              Current apps
            </p>
            <h2 className="mt-2 text-2xl font-bold tracking-normal">
              {apps.length} configured
            </h2>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <button
              className="inline-flex h-10 items-center gap-2 rounded border border-black/10 bg-white px-3 text-sm font-semibold text-black/65 transition hover:text-black disabled:opacity-60 dark:border-white/15 dark:bg-[#18211e] dark:text-[#d7e4df] dark:hover:border-[#8fe0ce]/40 dark:hover:text-white"
              onClick={() => void exportApps()}
              title="Export apps"
              aria-label="Export apps"
            >
              <Download size={16} />
              Apps JSON
            </button>
            <label
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded border border-black/10 bg-white px-3 text-sm font-semibold text-black/65 transition hover:text-black dark:border-white/15 dark:bg-[#18211e] dark:text-[#d7e4df] dark:hover:border-[#8fe0ce]/40 dark:hover:text-white"
              title="Import apps"
              aria-label="Import apps"
            >
              <Upload size={16} />
              Import Apps
              <input
                className="sr-only"
                type="file"
                accept="application/json,.json"
                onChange={(event) => void importApps(event)}
              />
            </label>
            <button
              className="inline-flex h-10 items-center gap-2 rounded border border-spruce/20 bg-spruce/10 px-3 text-sm font-semibold text-spruce transition hover:border-spruce/40 dark:border-[#8fe0ce]/25 dark:bg-[#8fe0ce]/10 dark:text-[#9be8d7]"
              onClick={() => void exportBackup()}
              title="Export full backup"
              aria-label="Export full backup"
            >
              <Download size={16} />
              Full Backup
            </button>
            <label
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded border border-amber/30 bg-amber/10 px-3 text-sm font-semibold text-amber transition hover:border-amber/50"
              title="Restore backup"
              aria-label="Restore backup"
            >
              <Upload size={16} />
              Restore
              <input
                className="sr-only"
                type="file"
                accept="application/json,.json"
                onChange={(event) => void restoreBackup(event)}
              />
            </label>
            <button
              className="inline-flex h-10 items-center gap-2 rounded border border-black/10 bg-white px-3 text-sm font-semibold text-black/65 transition hover:text-black disabled:opacity-60 dark:border-white/15 dark:bg-[#18211e] dark:text-[#d7e4df] dark:hover:border-[#8fe0ce]/40 dark:hover:text-white"
              onClick={() => void syncProxy()}
              disabled={syncing}
            >
              <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
              Sync
            </button>
          </div>
        </div>

        <div className="mb-4 grid gap-3 rounded border border-black/10 bg-white p-3 dark:border-white/15 dark:bg-[#141d1a] md:grid-cols-[minmax(0,1fr),180px,auto]">
          <input
            className="field"
            value={appSearch}
            onChange={(event) => setAppSearch(event.target.value)}
            placeholder="Search apps, hosts, tags"
          />
          <select
            className="field"
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
          <label className="flex h-11 items-center gap-2 text-sm font-medium text-black/70 dark:text-[#d7e4df]">
            <input
              type="checkbox"
              className="h-4 w-4 accent-spruce"
              checked={favoriteOnly}
              onChange={(event) => setFavoriteOnly(event.target.checked)}
            />
            Favorites
          </label>
        </div>

        {apps.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {sortedApps.map((app, index) => (
              <AppCard
                key={app.id}
                app={app}
                status={statuses[app.id]}
                onEdit={editApp}
                onDelete={deleteApp}
                onDetails={openDetails}
                onMoveUp={index > 0 ? (item) => void moveApp(item, -1) : undefined}
                onMoveDown={
                  index < sortedApps.length - 1
                    ? (item) => void moveApp(item, 1)
                    : undefined
                }
              />
            ))}
          </div>
        ) : (
          <div className="rounded border border-dashed border-black/20 bg-white p-8 text-center text-sm text-black/55 dark:border-white/20 dark:bg-[#141d1a] dark:text-[#b8c7c1]">
            No services have been configured.
          </div>
        )}

        {detailApp ? (
          <section className="panel mt-4 p-4">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase text-black/45 dark:text-[#a9bbb4]">
                  App details
                </p>
                <h3 className="mt-1 text-xl font-semibold">{detailApp.name}</h3>
              </div>
              <button
                className="grid h-9 w-9 place-items-center rounded text-black/45 transition hover:bg-black/5 hover:text-black dark:text-[#a9bbb4] dark:hover:bg-white/10 dark:hover:text-white"
                onClick={() => setDetailAppId(null)}
                title="Close details"
                aria-label="Close details"
              >
                <X size={17} />
              </button>
            </div>
            <div className="grid gap-3 text-sm md:grid-cols-2">
              <div className="rounded border border-black/10 p-3 dark:border-white/15">
                <div className="label">Public route</div>
                <div className="break-all font-medium">
                  {detailApp.routeMode === 'subdomain'
                    ? detailApp.publicHost
                    : `${detailApp.publicHost}${detailApp.publicPath}`}
                </div>
              </div>
              <div className="rounded border border-black/10 p-3 dark:border-white/15">
                <div className="label">Target</div>
                <div className="break-all font-medium">{detailApp.targetUrl}</div>
              </div>
              <div className="rounded border border-black/10 p-3 dark:border-white/15">
                <div className="label">Metadata</div>
                <div className="text-black/60 dark:text-[#b8c7c1]">
                  {detailApp.category ?? 'No category'}
                  {detailApp.tags.length > 0 ? ` · ${detailApp.tags.join(', ')}` : ''}
                </div>
              </div>
              <div className="rounded border border-black/10 p-3 dark:border-white/15">
                <div className="label">Latest health</div>
                <div
                  className={
                    statuses[detailApp.id]?.ok
                      ? 'font-semibold text-spruce dark:text-[#9be8d7]'
                      : 'font-semibold text-coral dark:text-[#ff9b8c]'
                  }
                >
                  {statuses[detailApp.id]
                    ? statuses[detailApp.id].ok
                      ? `${statuses[detailApp.id].statusCode ?? 'OK'} in ${
                          statuses[detailApp.id].responseTimeMs
                        }ms`
                      : statuses[detailApp.id].error ?? 'Offline'
                    : 'Not checked yet'}
                </div>
              </div>
            </div>
            {detailHistory.length > 0 ? (
              <div className="mt-4 grid gap-2 md:grid-cols-2">
                {detailHistory.slice(0, 6).map((item) => (
                  <div
                    key={`${item.checkedAt}-${item.statusCode ?? 'error'}`}
                    className="flex items-center justify-between gap-3 rounded border border-black/10 p-2 text-xs dark:border-white/15"
                  >
                    <span
                      className={
                        item.ok
                          ? 'font-semibold text-spruce dark:text-[#9be8d7]'
                          : 'font-semibold text-coral dark:text-[#ff9b8c]'
                      }
                    >
                      {item.ok ? item.statusCode ?? 'OK' : item.error ?? 'Offline'}
                    </span>
                    <span className="text-black/45 dark:text-[#9fb0aa]">
                      {item.responseTimeMs}ms · {new Date(item.checkedAt).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <section className="panel p-4 lg:col-span-2">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">Local host services</h3>
                <p className="mt-1 text-xs text-black/50 dark:text-[#a9bbb4]">
                  Listening TCP ports on this machine
                </p>
              </div>
              <button
                className="inline-flex h-9 items-center gap-2 rounded bg-ink px-3 text-sm font-semibold text-white transition hover:bg-spruce disabled:opacity-60 dark:bg-[#dff3ec] dark:text-[#0f1714]"
                onClick={() => void scanLocalServices()}
                disabled={scanningServices}
              >
                <Server size={16} />
                {scanningServices ? 'Scanning...' : 'Scan'}
              </button>
            </div>

            <div className="mb-3 grid gap-2 md:grid-cols-[minmax(0,1fr),160px,auto,auto]">
              <input
                className="field"
                value={serviceSearch}
                onChange={(event) => setServiceSearch(event.target.value)}
                placeholder="Search process or port"
              />
              <select
                className="field"
                value={serviceScope}
                onChange={(event) =>
                  setServiceScope(event.target.value as typeof serviceScope)
                }
              >
                <option value="all">All scopes</option>
                <option value="public">Public bind</option>
                <option value="loopback">Loopback</option>
              </select>
              <label className="flex h-11 items-center gap-2 whitespace-nowrap text-sm font-medium text-black/70 dark:text-[#d7e4df]">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-spruce"
                  checked={showSystemServices}
                  onChange={(event) => setShowSystemServices(event.target.checked)}
                />
                Show system/dev
              </label>
              <button
                className="h-11 rounded border border-black/10 bg-white px-3 text-sm font-semibold text-black/65 transition hover:text-black dark:border-white/15 dark:bg-[#18211e] dark:text-[#d7e4df] dark:hover:border-[#8fe0ce]/40 dark:hover:text-white"
                onClick={() => {
                  setIgnoredServices([]);
                  localStorage.removeItem('naviproxy-ignored-services');
                }}
              >
                Reset hidden
              </button>
            </div>

            {filteredLocalServices.length > 0 ? (
              <div className="max-h-[320px] overflow-auto rounded border border-black/10 dark:border-white/15">
                {filteredLocalServices.map((service) => (
                  <div
                    key={`${service.address}:${service.port}:${service.pid ?? 'unknown'}`}
                    className="grid gap-3 border-b border-black/10 p-3 text-sm last:border-b-0 dark:border-white/15 md:grid-cols-[minmax(0,1fr),auto]"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">
                          {knownServiceName(service.port) ?? service.processName ?? 'Unknown process'}
                        </span>
                        <span className="rounded bg-black/5 px-2 py-0.5 text-xs text-black/55 dark:bg-white/10 dark:text-[#b8c7c1]">
                          {service.address}:{service.port}
                        </span>
                        {service.pid ? (
                          <span className="text-xs text-black/45 dark:text-[#9fb0aa]">
                            PID {service.pid}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 truncate text-xs text-black/50 dark:text-[#a9bbb4]">
                        {service.targetUrl}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="h-9 rounded border border-black/10 bg-white px-3 text-sm font-semibold text-black/65 transition hover:text-black dark:border-white/15 dark:bg-[#18211e] dark:text-[#d7e4df] dark:hover:border-[#8fe0ce]/40 dark:hover:text-white"
                        onClick={() => ignoreService(service)}
                      >
                        Hide
                      </button>
                      <button
                        className="h-9 rounded bg-spruce px-3 text-sm font-semibold text-white transition hover:bg-[#11564a]"
                        onClick={() => useLocalService(service)}
                      >
                        Use
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded border border-dashed border-black/20 p-4 text-sm text-black/55 dark:border-white/20 dark:text-[#b8c7c1]">
                Scan to find software listening on local ports.
              </div>
            )}
          </section>

          <section className="panel p-4">
            <h3 className="mb-3 text-sm font-semibold">Gateway settings</h3>
            <div className="grid gap-3">
              <div>
                <label className="label" htmlFor="tlsMode">
                  TLS mode
                </label>
                <select
                  id="tlsMode"
                  className="field"
                  value={settings?.tlsMode ?? 'http'}
                  onChange={(event) =>
                    void saveSettings({
                      tlsMode: event.target.value as NaviSettings['tlsMode']
                    })
                  }
                >
                  <option value="http">HTTP only</option>
                  <option value="auto_https">Caddy auto HTTPS</option>
                  <option value="internal_ca">Caddy internal CA</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="healthInterval">
                  Health interval seconds
                </label>
                <input
                  id="healthInterval"
                  className="field"
                  type="number"
                  min={0}
                  max={86400}
                  step={30}
                  value={settings?.healthCheckIntervalSeconds ?? 0}
                  onChange={(event) =>
                    void saveSettings({
                      healthCheckIntervalSeconds: Number(event.target.value)
                    })
                  }
                />
              </div>
              <label className="flex items-center gap-3 text-sm font-medium text-black/70 dark:text-[#d7e4df]">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-spruce"
                  checked={settings?.dashboardAuthRequired ?? false}
                  onChange={(event) =>
                    void saveSettings({
                      dashboardAuthRequired: event.target.checked
                    })
                  }
                />
                Require token for dashboard list
              </label>
              {proxyDiagnostics ? (
                <div className="rounded border border-black/10 p-3 text-xs text-black/60 dark:border-white/15 dark:text-[#b8c7c1]">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-black/70 dark:text-[#d7e4df]">
                      Port 443
                    </span>
                    <span
                      className={
                        proxyDiagnostics.port443.available
                          ? 'font-semibold text-spruce dark:text-[#9be8d7]'
                          : 'font-semibold text-coral dark:text-[#ff9b8c]'
                      }
                    >
                      {proxyDiagnostics.port443.available ? 'available' : 'blocked'}
                    </span>
                  </div>
                  <div className="mt-2">
                    Listen: {proxyDiagnostics.caddyListen.join(', ') || 'none'}
                  </div>
                  {proxyDiagnostics.warnings.length > 0 ? (
                    <div className="mt-2 space-y-1 text-amber">
                      {proxyDiagnostics.warnings.map((warning) => (
                        <div key={warning}>{warning}</div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>

          <section className="panel p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">DNS diagnostic</h3>
              <button
                className="grid h-9 w-9 place-items-center rounded bg-ink text-white transition hover:bg-spruce dark:bg-[#dff3ec] dark:text-[#0f1714]"
                onClick={() => void runDnsDiagnostic()}
                title="Check DNS"
                aria-label="Check DNS"
                disabled={!dnsHost.trim()}
              >
                <Search size={16} />
              </button>
            </div>
            <input
              className="field"
              value={dnsHost}
              onChange={(event) => setDnsHost(event.target.value)}
              placeholder="jellyfin.lab.home"
            />
            {dnsResult ? (
              <div className="mt-3 space-y-2 text-xs text-black/60 dark:text-[#b8c7c1]">
                <div>Resolved: {dnsResult.addresses.join(', ') || 'none'}</div>
                <div>Local: {dnsResult.localAddresses.join(', ') || 'none'}</div>
                <div
                  className={
                    dnsResult.matchesLocalAddress
                      ? 'font-semibold text-spruce dark:text-[#9be8d7]'
                      : 'font-semibold text-coral dark:text-[#ff9b8c]'
                  }
                >
                  {dnsResult.matchesLocalAddress
                    ? 'Host points to this machine.'
                    : 'Host does not resolve to this machine.'}
                </div>
              </div>
            ) : null}
          </section>

          <section className="panel p-4">
            <h3 className="mb-3 text-sm font-semibold">Sync history</h3>
            {history.length > 0 ? (
              <div className="space-y-2">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="rounded border border-black/10 p-2 text-xs dark:border-white/15"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={
                          item.status === 'success'
                            ? 'font-semibold text-spruce dark:text-[#9be8d7]'
                            : item.status === 'failed'
                              ? 'font-semibold text-coral dark:text-[#ff9b8c]'
                              : 'font-semibold text-amber'
                        }
                      >
                        {item.status}
                      </span>
                      <span className="text-black/45 dark:text-[#9fb0aa]">
                        {new Date(item.createdAt).toLocaleString()}
                      </span>
                    </div>
                    {item.errorMessage ? (
                      <div className="mt-1 truncate text-coral dark:text-[#ff9b8c]">
                        {item.errorMessage}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-black/55 dark:text-[#b8c7c1]">
                No sync history available.
              </div>
            )}
          </section>

          <AuditLogPanel auditLogs={auditLogs} />

          <BackupSnapshotsPanel backupSnapshots={backupSnapshots} />
        </div>
      </section>
    </div>
  );
}
