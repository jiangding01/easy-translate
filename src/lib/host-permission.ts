import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';

// Optional host permissions of custom endpoints, for extension pages.

/**
 * Whether the optional host permission `pattern` is granted: undefined while
 * unknown or when no pattern is needed. Follows grants made anywhere.
 */
export function useHostPermission(pattern: string | undefined): boolean | undefined {
  const [granted, setGranted] = useState<boolean>();
  useEffect(() => {
    setGranted(undefined);
    if (!pattern) return;
    let live = true;
    const check = () => {
      browser.permissions
        .contains({ origins: [pattern] })
        .then((value) => live && setGranted(value))
        .catch(() => live && setGranted(false));
    };
    check();
    browser.permissions.onAdded.addListener(check);
    browser.permissions.onRemoved.addListener(check);
    return () => {
      live = false;
      browser.permissions.onAdded.removeListener(check);
      browser.permissions.onRemoved.removeListener(check);
    };
  }, [pattern]);
  return granted;
}

/** Must run inside a click handler, before any other await (browser requirement). */
export function requestHostPermission(pattern: string): Promise<boolean> {
  return browser.permissions.request({ origins: [pattern] }).catch(() => false);
}

export function removeHostPermission(pattern: string): Promise<boolean> {
  return browser.permissions.remove({ origins: [pattern] }).catch(() => false);
}
