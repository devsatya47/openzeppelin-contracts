import { mediaUrl } from '../lib/api';
import type { Media } from '../lib/types';

/**
 * Normalises artwork of any aspect ratio or media type into a consistent gallery "wall" frame.
 * The work is contained (never cropped) within a fixed-ratio matte, like a piece hung in a white cube.
 */
export function ArtFrame({
  media,
  alt,
  ratio = '4/5',
  pad = 'p-[9%]',
  full = false,
  className = '',
}: {
  media: Media | null | undefined;
  alt: string;
  ratio?: string;
  pad?: string;
  full?: boolean;
  className?: string;
}) {
  const src = mediaUrl(full ? media?.url : media?.thumbUrl);
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden bg-gradient-to-b from-ink-3 to-ink-2 ${pad} ${className}`}
      style={{ aspectRatio: ratio }}
    >
      {!media ? (
        <span className="font-serif text-lg italic text-faint">No image</span>
      ) : media.kind === 'video' ? (
        <video src={src} muted loop playsInline autoPlay className="max-h-full max-w-full object-contain shadow-[0_20px_40px_-12px_rgba(0,0,0,0.8)]" />
      ) : (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          width={media.width ?? undefined}
          height={media.height ?? undefined}
          className="max-h-full max-w-full object-contain shadow-[0_24px_48px_-16px_rgba(0,0,0,0.9)] transition-transform duration-700 group-hover:scale-[1.03]"
        />
      )}
    </div>
  );
}
