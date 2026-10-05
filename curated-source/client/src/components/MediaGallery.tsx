import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Maximize2, X } from 'lucide-react';
import { mediaUrl } from '../lib/api';
import type { Media } from '../lib/types';

function MediaView({ m, alt, className }: { m: Media; alt: string; className: string }) {
  return m.kind === 'video' ? (
    <video src={mediaUrl(m.url)} controls playsInline className={className} />
  ) : (
    <img src={mediaUrl(m.url)} alt={alt} className={className} />
  );
}

export function MediaGallery({ media, alt }: { media: Media[]; alt: string }) {
  const [i, setI] = useState(0);
  const [zoom, setZoom] = useState(false);
  const m = media[i];
  const step = (d: number) => setI((x) => (x + d + media.length) % media.length);

  useEffect(() => {
    if (!zoom) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoom(false);
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', h);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', h);
      document.body.style.overflow = '';
    };
  });

  if (!m) return <div className="flex aspect-[4/5] items-center justify-center bg-ink-2 text-faint">No media</div>;

  return (
    <div>
      <div className="group relative flex h-[62vh] min-h-[380px] items-center justify-center bg-[radial-gradient(ellipse_at_center,#232323_0%,#141414_70%)] p-6 sm:h-[78vh] sm:p-14">
        <MediaView m={m} alt={alt} className="max-h-full max-w-full object-contain shadow-[0_40px_80px_-20px_rgba(0,0,0,0.95)]" />
        {m.kind === 'image' && (
          <button onClick={() => setZoom(true)} className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center border border-line bg-ink/70 text-mute opacity-0 transition-opacity hover:text-gold group-hover:opacity-100" aria-label="View full screen">
            <Maximize2 size={16} strokeWidth={1.4} />
          </button>
        )}
        {media.length > 1 && (
          <>
            <button onClick={() => step(-1)} className="absolute left-3 top-1/2 -translate-y-1/2 p-2 text-mute hover:text-gold" aria-label="Previous image"><ChevronLeft size={28} strokeWidth={1} /></button>
            <button onClick={() => step(1)} className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-mute hover:text-gold" aria-label="Next image"><ChevronRight size={28} strokeWidth={1} /></button>
          </>
        )}
      </div>
      {media.length > 1 && (
        <div className="mt-3 flex gap-3 overflow-x-auto">
          {media.map((x, k) => (
            <button key={x.url} onClick={() => setI(k)} className={`h-20 w-20 shrink-0 border bg-ink-2 p-1.5 transition-colors ${k === i ? 'border-gold' : 'border-line hover:border-mute'}`} aria-label={`View image ${k + 1}`}>
              {x.kind === 'video' ? <video src={mediaUrl(x.url)} muted className="h-full w-full object-contain" /> : <img src={mediaUrl(x.thumbUrl)} alt="" className="h-full w-full object-contain" />}
            </button>
          ))}
        </div>
      )}
      {zoom && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black" onClick={() => setZoom(false)}>
          <MediaView m={m} alt={alt} className="max-h-screen max-w-full object-contain" />
          <button className="absolute right-6 top-6 text-mute hover:text-bone" aria-label="Close"><X size={26} strokeWidth={1.2} /></button>
          <div className="absolute bottom-6 text-xs uppercase tracking-[0.2em] text-faint">{i + 1} / {media.length}</div>
        </div>
      )}
    </div>
  );
}
