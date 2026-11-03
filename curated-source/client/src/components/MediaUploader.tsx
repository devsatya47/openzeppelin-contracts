import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ImagePlus, Star, X } from 'lucide-react';
import { api, mediaUrl } from '../lib/api';
import type { Media } from '../lib/types';
import { ErrorNote } from './ui';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/avif,image/gif,image/tiff,video/mp4,video/webm,video/quicktime';

/** Drag-and-drop uploader. Files are uploaded immediately; the server returns masters plus generated thumbnails. */
export function MediaUploader({ value, onChange }: { value: Media[]; onChange: (m: Media[]) => void }) {
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);
  const input = useRef<HTMLInputElement>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const latest = useRef(value);
  latest.current = value;

  const upload = async (files: FileList | File[]) => {
    const list = [...files].slice(0, 12 - value.length);
    if (!list.length) return;
    setError(null);
    const previews = list.map((f) => URL.createObjectURL(f));
    setUploading((u) => [...u, ...previews]);
    try {
      const fd = new FormData();
      list.forEach((f) => fd.append('files', f));
      const r = await api<{ media: Media[] }>('/vendor/uploads', { body: fd });
      onChange([...latest.current, ...r.media]);
    } catch (err) {
      setError(err);
    } finally {
      setUploading((u) => u.filter((p) => !previews.includes(p)));
      previews.forEach(URL.revokeObjectURL);
    }
  };

  /** Moves the image at `from` to position `to` (drag and drop). */
  const moveTo = (from: number, to: number) => {
    if (from === to) return;
    const next = [...value];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    onChange(next);
  };

  const move = (i: number, d: number) => {
    const next = [...value];
    const [m] = next.splice(i, 1);
    next.splice(Math.max(0, Math.min(next.length, i + d)), 0, m);
    onChange(next);
  };

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          upload(e.dataTransfer.files);
        }}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
        role="button"
        tabIndex={0}
        className={`flex cursor-pointer flex-col items-center justify-center border border-dashed px-6 py-12 text-center transition-colors ${
          drag ? 'border-gold bg-gold/5' : 'border-line hover:border-mute'
        }`}
      >
        <ImagePlus size={28} strokeWidth={1} className="text-gold" />
        <p className="mt-4 font-serif text-xl">Drop images or video here</p>
        <p className="mt-1 text-xs text-faint">JPEG, PNG, WebP, AVIF, MP4 · up to 25 MB each · thumbnails generated automatically</p>
        <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
      </div>
      <ErrorNote error={error} />
      {(value.length > 0 || uploading.length > 0) && (
        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {value.map((m, i) => (
            <div
              key={m.url}
              draggable
              onDragStart={(e) => {
                setDragFrom(i);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(i)); // required by Firefox
              }}
              onDragOver={(e) => {
                if (dragFrom === null) return; // files from the desktop are handled by the drop zone
                e.preventDefault();
                e.stopPropagation();
                setDragOver(i);
              }}
              onDrop={(e) => {
                if (dragFrom === null) return;
                e.preventDefault();
                e.stopPropagation();
                moveTo(dragFrom, i);
                setDragFrom(null);
                setDragOver(null);
              }}
              onDragEnd={() => {
                setDragFrom(null);
                setDragOver(null);
              }}
              title="Drag to reorder. The first image is the cover."
              className={`group relative aspect-square cursor-grab border bg-ink-3 p-2 active:cursor-grabbing ${i === 0 ? 'border-gold' : 'border-line'} ${
                dragOver === i && dragFrom !== i ? 'ring-2 ring-gold' : ''
              } ${dragFrom === i ? 'opacity-40' : ''}`}
            >
              {m.kind === 'video' ? (
                <video src={mediaUrl(m.url)} muted draggable={false} className="pointer-events-none h-full w-full object-contain" />
              ) : (
                <img src={mediaUrl(m.thumbUrl)} alt="" draggable={false} className="pointer-events-none h-full w-full object-contain" />
              )}
              {i === 0 && <span className="absolute left-1 top-1 bg-gold px-1.5 py-0.5 text-[8px] uppercase tracking-wider text-ink">Cover</span>}
              <span className="absolute right-1 top-1 bg-ink/80 px-1.5 py-0.5 text-[8px] tabular-nums text-mute">{i + 1}</span>
              <div className="absolute inset-x-0 bottom-0 flex justify-between bg-ink/85 p-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="p-1 text-mute hover:text-gold disabled:opacity-30" aria-label="Move earlier"><ArrowLeft size={12} /></button>
                <button type="button" onClick={() => move(i, -i)} disabled={i === 0} className="p-1 text-mute hover:text-gold disabled:opacity-30" aria-label="Make cover"><Star size={12} /></button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === value.length - 1} className="p-1 text-mute hover:text-gold disabled:opacity-30" aria-label="Move later"><ArrowRight size={12} /></button>
                <button type="button" onClick={() => onChange(value.filter((_, k) => k !== i))} className="p-1 text-mute hover:text-bad" aria-label="Remove"><X size={12} /></button>
              </div>
            </div>
          ))}
          {uploading.map((p) => (
            <div key={p} className="relative aspect-square border border-line bg-ink-3 p-2">
              <img src={p} alt="" className="h-full w-full object-contain opacity-30" />
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="h-5 w-5 animate-spin rounded-full border border-gold/30 border-t-gold" />
              </span>
            </div>
          ))}
        </div>
      )}
      {value.length > 1 && <p className="mt-2 text-xs text-faint">Drag the images to change their order. The first image is the cover shown in the catalogue.</p>}
    </div>
  );
}
