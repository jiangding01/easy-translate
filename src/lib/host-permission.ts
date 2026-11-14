import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';

// Optional host permissions of custom endpoints, for extension pages.

/**
 * Grant state of each optional host permission pattern; undefined until known.
 * Follows grants and removals made anywhere.
 */
export function useHostPermissions(
  patterns: readonly string[],
): Readonly<Record<string, boolean>> | undefined {
  const key = [...new Set(patterns)].sort().join('\n');
  const [grants, setGrants] = useState<Record<string, boolean>>();
  useEffect(() => {
    setGrants(undefined);
    const list = key ? key.split('\n') : [];
    let live = true;
    const check = () => {
      void Promise.all(
        list.map((pattern) =>
          browser.permissions.contains({ origins: [pattern] }).catch(() => false),
        ),
      ).then((values) => {
        if (live)
          setGrants(
            Object.fromEntries(list.map((pattern, index) => [pattern, values[index] === true])),
          );
      });
    };
    check();
    browser.permissions.onAdded.addListener(check);
    browser.permissions.onRemoved.addListener(check);
    return () => {
      live = false;
      browser.permissions.onAdded.removeListener(check);
      browser.permissions.onRemoved.removeListener(check);
    };
  }, [key]);
  return grants;
}

/** Whether one pattern is granted: undefined while unknown or when no pattern is needed. */
export function useHostPermission(pattern: string | undefined): boolean | undefined {
  const grants = useHostPermissions(pattern ? [pattern] : []);
  return pattern ? grants?.[pattern] : undefined;
}

/** Must run inside a click handler, before any other await (browser requirement). */
export function requestHostPermission(pattern: string): Promise<boolean> {
  return browser.permissions.request({ origins: [pattern] }).catch(() => false);
}
