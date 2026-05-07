import { RefreshCw, Save } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { AppCard } from '../components/AppCard';
import { RouteModeWarning } from '../components/RouteModeWarning';
import { api, type AppPayload, type NaviApp, type RouteMode } from '../lib/api';

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
  sortOrder: 0
};

export function Admin({ onBack }: Props) {
  const [apps, setApps] = useState<NaviApp[]>([]);
  const [form, setForm] = useState<AppPayload>(initialForm);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    setApps(await api.listApps());
  }

  useEffect(() => {
    void load().catch((err) =>
      setError(err instanceof Error ? err.message : String(err))
    );
  }, []);

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

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      await api.createApp(form);
      setMessage('App saved and proxy configuration queued.');
      setForm(initialForm);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function deleteApp(id: string) {
    setError(null);
    setMessage(null);

    try {
      await api.deleteApp(id);
      setMessage('App deleted.');
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
          : 'Caddy sync skipped because it is disabled in the API environment.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
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
          </div>
          <button
            className="h-10 rounded border border-black/10 bg-white px-3 text-sm font-semibold text-black/65 transition hover:text-black dark:border-white/10 dark:bg-white/5 dark:text-white/65 dark:hover:text-white"
            onClick={onBack}
          >
            Dashboard
          </button>
        </div>

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

            <div className="grid grid-cols-[120px,1fr] gap-3">
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
              <div className="grid grid-cols-2 gap-2 rounded border border-black/10 bg-[#f1f5f3] p-1 dark:border-white/10 dark:bg-white/5">
                {(['subdomain', 'subpath'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`h-10 rounded text-sm font-semibold transition ${
                      form.routeMode === mode
                        ? 'bg-white text-spruce shadow-sm dark:bg-white/12 dark:text-white'
                        : 'text-black/55 hover:text-black dark:text-white/55 dark:hover:text-white'
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

            <label className="flex items-center gap-3 text-sm font-medium text-black/70 dark:text-white/70">
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
            <div className="mt-4 rounded border border-spruce/25 bg-spruce/10 p-3 text-sm text-spruce dark:text-[#8fe0ce]">
              {message}
            </div>
          ) : null}

          <button
            className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded bg-spruce px-4 text-sm font-semibold text-white transition hover:bg-[#11564a] disabled:cursor-not-allowed disabled:opacity-60"
            type="submit"
            disabled={saving}
          >
            <Save size={18} />
            {saving ? 'Saving...' : 'Save app'}
          </button>
        </form>
      </section>

      <section>
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase text-black/45 dark:text-white/45">
              Current apps
            </p>
            <h2 className="mt-2 text-2xl font-bold tracking-normal">
              {apps.length} configured
            </h2>
          </div>
          <button
            className="inline-flex h-10 items-center gap-2 rounded border border-black/10 bg-white px-3 text-sm font-semibold text-black/65 transition hover:text-black disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-white/65 dark:hover:text-white"
            onClick={() => void syncProxy()}
            disabled={syncing}
          >
            <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
            Sync
          </button>
        </div>

        {apps.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {apps.map((app) => (
              <AppCard key={app.id} app={app} onDelete={deleteApp} />
            ))}
          </div>
        ) : (
          <div className="rounded border border-dashed border-black/20 bg-white p-8 text-center text-sm text-black/55 dark:border-white/15 dark:bg-white/[0.04] dark:text-white/55">
            No services have been configured.
          </div>
        )}
      </section>
    </div>
  );
}
