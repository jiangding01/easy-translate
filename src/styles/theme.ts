import { useEffect } from 'react';
import type { Theme } from '@/lib/config/types';

export const THEME_ATTRIBUTE = 'data-et-theme';

/** 'system' clears the attribute so tokens.css follows prefers-color-scheme. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  if (theme === 'system') root.removeAttribute(THEME_ATTRIBUTE);
  else root.setAttribute(THEME_ATTRIBUTE, theme);
}

/** Applies the configured theme to <html>; undefined (still loading) leaves it as-is. */
export function useTheme(theme: Theme | undefined): void {
  useEffect(() => {
    if (theme) applyTheme(theme);
  }, [theme]);
}
