import React, { useEffect, useState } from 'react';
import { authService } from '../services/authService';

/**
 * Authenticated file URLs.
 *
 * `/uploads/:filename` used to be served by `express.static` with no auth, so
 * the app could point an <img src> or an <a href> straight at it. That route
 * now requires a bearer token (see backend/src/routes/files.ts), and a plain
 * browser request for an image or a link click carries no Authorization
 * header — so those requests come back 401 and images render broken.
 *
 * The fix is to fetch the file with the header attached and wrap the response
 * in an object URL, which <img> and <a> can both consume normally.
 *
 * The token is deliberately NOT put in the query string. URLs end up in server
 * logs, browser history and Referer headers, and a JWT leaked that way is a
 * live credential for the whole API, not just the one file.
 */

/** Build the API path for a stored file. */
export function fileUrl(filePath: string): string {
  return `/uploads/${filePath}`;
}

/**
 * Fetch a stored file with auth and return a blob URL for it.
 *
 * Returns null while loading or on failure, so callers can render a
 * placeholder. The object URL is revoked on unmount / when the path changes,
 * otherwise every preview leaks a blob for the lifetime of the tab.
 */
export function useAuthedFileUrl(filePath: string | null | undefined): {
  url: string | null;
  loading: boolean;
  error: string | null;
} {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!filePath) {
      setUrl(null);
      setError(null);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    setLoading(true);
    setError(null);

    (async () => {
      try {
        const token = authService.getToken();
        const res = await fetch(fileUrl(filePath), {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (!res.ok) {
          // 404 covers both "no such file" and "not yours" — the backend
          // deliberately doesn't distinguish, so neither do we.
          throw new Error(
            res.status === 401
              ? 'Not signed in.'
              : res.status === 404
                ? 'File not found.'
                : `Could not load file (${res.status}).`,
          );
        }

        const blob = await res.blob();
        if (cancelled) return;

        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load file.');
        setUrl(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [filePath]);

  return { url, loading, error };
}

/**
 * Open a stored file in a new tab, with auth.
 *
 * Used where the app previously had `<a href="/uploads/...' target="_blank">`.
 * The window is opened synchronously BEFORE the await: browsers block
 * window.open() called after an async gap because it is no longer attributable
 * to the user's click.
 */
export async function openAuthedFile(filePath: string): Promise<void> {
  const tab = window.open('', '_blank');

  try {
    const token = authService.getToken();
    const res = await fetch(fileUrl(filePath), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Could not load file (${res.status}).`);

    const objectUrl = URL.createObjectURL(await res.blob());
    if (tab) {
      tab.location.href = objectUrl;
      // Give the tab time to load before releasing the blob.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } else {
      // Popup blocked — fall back to downloading in the current tab.
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filePath;
      a.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    }
  } catch (err) {
    tab?.close();
    alert(err instanceof Error ? err.message : 'Could not open file.');
  }
}

/**
 * <img> for a stored file, with auth.
 *
 * A component rather than a bare hook call because thumbnail strips render
 * these in a loop, and hooks cannot be called inside one.
 */
export function AuthedImage({
  filePath,
  alt,
  style,
  fallback = null,
}: {
  filePath: string;
  alt?: string;
  style?: React.CSSProperties;
  fallback?: React.ReactNode;
}): React.ReactElement | null {
  const { url, loading, error } = useAuthedFileUrl(filePath);

  if (loading) {
    return <div style={{ ...style, background: '#f0f0f5' }} title="Loading…" />;
  }
  if (error || !url) {
    return <>{fallback}</>;
  }
  return <img src={url} alt={alt} style={style} />;
}