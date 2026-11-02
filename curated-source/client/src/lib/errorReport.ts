import { apiUrl } from './api';

let sent = 0;

/** Sends a crash report to the server log (visible in Render's Logs tab). At most 5 per page load. */
export function reportError(error: unknown, where: string) {
  if (sent >= 5) return;
  sent++;
  const e = error instanceof Error ? error : new Error(String(error));
  try {
    void fetch(apiUrl('/client-errors'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: e.message, stack: e.stack?.slice(0, 2000), where, url: window.location.href }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* reporting must never throw */
  }
}

/** A code file from a previous deploy could not be loaded (the user's tab is older than the site). */
export const isChunkLoadError = (error: unknown) =>
  /dynamically imported module|Importing a module script failed|Failed to fetch dynamically|Loading chunk|Unable to preload/i.test(
    error instanceof Error ? error.message : String(error),
  );
