import { useState } from 'react';
import { Check, Link2, Mail, Share2 } from 'lucide-react';
import { useClickOutside } from '../lib/hooks';

type Props = {
  /** Site path to share, e.g. /listing/some-work. */
  path: string;
  title: string;
  text?: string;
  /** Absolute or site-relative image, used by Pinterest. */
  image?: string | null;
  label?: string;
  className?: string;
};

const absolute = (u: string) => (u.startsWith('http') ? u : `${window.location.origin}${u}`);

/**
 * Share a listing or gallery. Phones get the native share sheet (WhatsApp, Instagram, Messages…);
 * desktops get a menu with copy-link and the main social networks.
 */
export function ShareButton({ path, title, text, image, label = 'Share', className = 'btn-ghost btn-sm' }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));
  const url = absolute(path);
  const message = text ? `${title} — ${text}` : title;

  const share = async () => {
    const touch = window.matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.share) {
      try {
        await navigator.share({ title, text: message, url });
        return;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return; // user closed the sheet
      }
    }
    setOpen((o) => !o);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt('Copy this link', url);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const enc = encodeURIComponent;
  const links = [
    ['WhatsApp', `https://wa.me/?text=${enc(`${message} ${url}`)}`],
    ['Facebook', `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`],
    ['X (Twitter)', `https://twitter.com/intent/tweet?text=${enc(message)}&url=${enc(url)}`],
    ...(image ? [['Pinterest', `https://pinterest.com/pin/create/button/?url=${enc(url)}&media=${enc(absolute(image))}&description=${enc(message)}`]] : []),
  ];

  return (
    <div ref={ref} className="relative inline-block">
      <button type="button" onClick={share} className={className} aria-expanded={open} aria-haspopup="menu">
        <Share2 size={12} /> {label}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-2 w-56 border border-line bg-ink-2 py-2 text-left shadow-2xl">
          <button role="menuitem" type="button" onClick={copy} className="flex w-full items-center gap-2 px-4 py-2 text-sm text-mute hover:bg-ink-3 hover:text-bone">
            {copied ? <Check size={14} className="text-ok" /> : <Link2 size={14} />} {copied ? 'Link copied' : 'Copy link'}
          </button>
          {links.map(([name, href]) => (
            <a key={name} role="menuitem" href={href} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)} className="block px-4 py-2 text-sm text-mute hover:bg-ink-3 hover:text-bone">
              {name}
            </a>
          ))}
          <a role="menuitem" href={`mailto:?subject=${enc(title)}&body=${enc(`${message}\n\n${url}`)}`} className="flex items-center gap-2 px-4 py-2 text-sm text-mute hover:bg-ink-3 hover:text-bone">
            <Mail size={14} /> Email
          </a>
        </div>
      )}
    </div>
  );
}
