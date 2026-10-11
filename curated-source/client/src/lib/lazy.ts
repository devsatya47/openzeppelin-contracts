import { lazy, type ComponentType } from 'react';

const RELOAD_KEY = 'cs_chunk_reload';

/**
 * lazy() that survives redeploys. A tab opened before a deploy still references the previous
 * build's code files, which no longer exist; when loading one fails, reload the page once so the
 * browser fetches the new build instead of rendering a blank screen.
 */
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const mod = await load();
      try {
        sessionStorage.removeItem(RELOAD_KEY);
      } catch {
        /* storage unavailable */
      }
      return mod;
    } catch (err) {
      let alreadyReloaded = false;
      try {
        alreadyReloaded = sessionStorage.getItem(RELOAD_KEY) === '1';
        if (!alreadyReloaded) sessionStorage.setItem(RELOAD_KEY, '1');
      } catch {
        /* storage unavailable: reload anyway, at worst once per navigation */
      }
      if (!alreadyReloaded) {
        window.location.reload();
        return new Promise<never>(() => {}); // keep the spinner up while the page reloads
      }
      throw err;
    }
  });
}
