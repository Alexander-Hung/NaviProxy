import { Moon, Sun } from 'lucide-react';

type Props = {
  theme: 'light' | 'dark';
  onChange: (theme: 'light' | 'dark') => void;
};

export function ThemeToggle({ theme, onChange }: Props) {
  const dark = theme === 'dark';

  return (
    <button
      className="grid h-10 w-10 place-items-center rounded border border-black/10 bg-white text-black/70 transition hover:text-black dark:border-white/10 dark:bg-white/5 dark:text-white/70 dark:hover:text-white"
      onClick={() => onChange(dark ? 'light' : 'dark')}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
