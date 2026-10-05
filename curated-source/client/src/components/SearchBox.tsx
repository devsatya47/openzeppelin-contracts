import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { api, mediaUrl } from '../lib/api';
import { money } from '../lib/format';
import { useClickOutside, useDebounced } from '../lib/hooks';

type Result = { type: 'listing' | 'artist' | 'gallery' | 'category'; label: string; sublabel: string; slug: string; thumbUrl?: string | null; priceCents?: number };

export function SearchBox({ onNavigate, autoFocus = false }: { onNavigate?: () => void; autoFocus?: boolean }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [active, setActive] = useState(-1);
  const debounced = useDebounced(q.trim(), 180);
  const navigate = useNavigate();
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));

  useEffect(() => {
    if (!debounced) return setResults([]);
    const ctrl = new AbortController();
    api<{ results: Result[] }>(`/search/suggest?q=${encodeURIComponent(debounced)}`, { signal: ctrl.signal })
      .then((r) => {
        setResults(r.results);
        setActive(-1);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [debounced]);

  const go = (r?: Result) => {
    setOpen(false);
    setQ('');
    onNavigate?.();
    if (!r) return navigate(`/gallery?q=${encodeURIComponent(q.trim())}`);
    const to = {
      listing: `/listing/${r.slug}`,
      artist: `/gallery?q=${encodeURIComponent(r.slug)}`,
      gallery: `/galleries/${r.slug}`,
      category: `/gallery?category=${r.slug}`,
    }[r.type];
    navigate(to);
  };

  return (
    <div ref={ref} className="relative w-full">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) go(active >= 0 ? results[active] : undefined);
        }}
        className="flex items-center gap-2 border-b border-line focus-within:border-gold/60"
      >
        <Search size={15} strokeWidth={1.4} className="text-mute" />
        <input
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, -1));
            } else if (e.key === 'Escape') setOpen(false);
          }}
          placeholder="Search works, artists, galleries"
          aria-label="Search"
          aria-autocomplete="list"
          aria-expanded={open && results.length > 0}
          className="w-full bg-transparent py-2 text-sm text-bone placeholder:text-faint focus:outline-none"
        />
      </form>
      {open && debounced && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[70vh] min-w-[300px] overflow-y-auto border border-line bg-ink-2/95 shadow-2xl backdrop-blur" role="listbox">
          {results.length === 0 ? (
            <div className="px-4 py-5 text-sm text-mute">No matches for “{debounced}”</div>
          ) : (
            results.map((r, i) => (
              <button
                key={`${r.type}-${r.slug}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(r)}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${i === active ? 'bg-ink-4' : ''}`}
              >
                {r.type === 'listing' ? (
                  <img src={mediaUrl(r.thumbUrl)} alt="" className="h-10 w-10 bg-ink-3 object-contain" />
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center border border-line text-[9px] uppercase tracking-wider text-gold">{r.type.slice(0, 3)}</span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-bone">{r.label}</span>
                  <span className="block truncate text-xs text-faint">{r.sublabel}</span>
                </span>
                {r.priceCents != null && <span className="text-xs text-gold">{money(r.priceCents)}</span>}
              </button>
            ))
          )}
          <button onClick={() => go()} className="block w-full border-t border-line px-4 py-3 text-left text-[11px] uppercase tracking-[0.2em] text-gold hover:bg-ink-3">
            See all results →
          </button>
        </div>
      )}
    </div>
  );
}
