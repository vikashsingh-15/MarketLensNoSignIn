import { Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { applyTheme, getInitialTheme, toggleTheme, type Theme } from '../utils/theme';

export function ThemeToggle({ label = false, className = '' }: { label?: boolean; className?: string }) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const toggle = () => { setTheme(toggleTheme()); };
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      className={`theme-toggle${label ? ' with-label' : ''}${className ? ` ${className}` : ''}`}
      onClick={toggle}
      title={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {dark ? <Sun size={16}/> : <Moon size={16}/>}
      {label && <span>{dark ? 'Light mode' : 'Dark mode'}</span>}
    </button>
  );
}

// Ensures the theme attribute is applied before first paint even if React mounts late.
applyTheme(getInitialTheme());
