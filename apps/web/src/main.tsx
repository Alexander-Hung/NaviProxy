import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { LayoutDashboard, Settings } from 'lucide-react';
import { Admin } from './pages/Admin';
import { Dashboard } from './pages/Dashboard';
import { ThemeToggle } from './components/ThemeToggle';
import './styles.css';

type Page = 'dashboard' | 'admin';

function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return localStorage.getItem('naviproxy-theme') === 'dark' ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('naviproxy-theme', theme);
  }, [theme]);

  const tabs = useMemo(
    () => [
      { id: 'dashboard' as const, label: 'Dashboard', icon: LayoutDashboard },
      { id: 'admin' as const, label: 'Admin', icon: Settings }
    ],
    []
  );

  return (
    <div className="min-h-screen bg-[#f7faf9] text-ink transition-colors dark:bg-[#0f1714] dark:text-[#edf5f2]">
      <header className="sticky top-0 z-20 border-b border-black/10 bg-white/90 backdrop-blur dark:border-white/15 dark:bg-[#0f1714]/95">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <button
            className="flex items-center gap-3 text-left"
            onClick={() => setPage('dashboard')}
          >
            <span className="grid h-10 w-10 place-items-center rounded bg-white shadow-sm ring-1 ring-black/10 dark:bg-[#dff3ec] dark:ring-white/15">
              <img
                src="https://assets.alexander-hung.com/base/icon.svg"
                alt=""
                className="h-6 w-6"
                width="24"
                height="24"
              />
            </span>
            <span>
              <span className="block text-base font-semibold leading-tight">NaviProxy</span>
              <span className="block text-xs text-black/55 dark:text-[#b8c7c1]">
                Homelab gateway
              </span>
            </span>
          </button>

          <div className="flex items-center gap-2">
            <nav className="hidden rounded border border-black/10 bg-[#f1f5f3] p-1 dark:border-white/15 dark:bg-[#18211e] sm:flex">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const active = tab.id === page;

                return (
                  <button
                    key={tab.id}
                    className={`flex h-9 items-center gap-2 rounded px-3 text-sm font-medium transition ${
                      active
                        ? 'bg-white text-spruce shadow-sm dark:bg-[#24312d] dark:text-[#f4fbf8]'
                        : 'text-black/60 hover:text-black dark:text-[#b8c7c1] dark:hover:text-[#f4fbf8]'
                    }`}
                    onClick={() => setPage(tab.id)}
                  >
                    <Icon size={16} />
                    {tab.label}
                  </button>
                );
              })}
            </nav>
            <ThemeToggle theme={theme} onChange={setTheme} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {page === 'dashboard' ? (
          <Dashboard onOpenAdmin={() => setPage('admin')} />
        ) : (
          <Admin onBack={() => setPage('dashboard')} />
        )}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-black/10 bg-white p-2 dark:border-white/15 dark:bg-[#111916] sm:hidden">
        <div className="grid grid-cols-2 gap-2">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = tab.id === page;

            return (
              <button
                key={tab.id}
                className={`flex h-11 items-center justify-center gap-2 rounded text-sm font-medium ${
                  active
                    ? 'bg-spruce text-white dark:bg-[#8fe0ce] dark:text-[#0f1714]'
                    : 'bg-transparent text-black/65 dark:text-[#b8c7c1]'
                }`}
                onClick={() => setPage(tab.id)}
              >
                <Icon size={17} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
