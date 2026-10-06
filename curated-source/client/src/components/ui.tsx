import { useEffect, type ReactNode } from 'react';
import { Star, X } from 'lucide-react';
import { ORDER_STATUS } from '../lib/format';
import type { OrderStatus } from '../lib/types';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-24 text-mute" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border border-gold/30 border-t-gold" />
      <span className="text-xs uppercase tracking-[0.25em]">{label}</span>
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad" role="alert">
      {error instanceof Error ? error.message : String(error)}
    </div>
  );
}

export function Notice({ children, tone = 'gold' }: { children: ReactNode; tone?: 'gold' | 'ok' | 'warn' }) {
  const cls = { gold: 'border-gold/40 bg-gold/5 text-gold', ok: 'border-ok/40 bg-ok/10 text-ok', warn: 'border-warn/40 bg-warn/10 text-warn' }[tone];
  return <div className={`border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center border border-dashed border-line px-6 py-20 text-center">
      <div className="gold-rule mb-6" />
      <h3 className="text-2xl">{title}</h3>
      {children && <div className="mt-3 max-w-md text-sm text-mute">{children}</div>}
    </div>
  );
}

const TONES = {
  gold: 'border-gold/50 text-gold',
  ok: 'border-ok/50 text-ok',
  warn: 'border-warn/50 text-warn',
  bad: 'border-bad/50 text-bad',
  mute: 'border-line text-mute',
};

export function Pill({ tone = 'mute', children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <span className={`inline-block border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] whitespace-nowrap ${TONES[tone]}`}>{children}</span>;
}

export function OrderPill({ status }: { status: OrderStatus }) {
  const s = ORDER_STATUS[status];
  return <Pill tone={s.tone}>{s.label}</Pill>;
}

const GENERIC_TONE: Record<string, keyof typeof TONES> = {
  approved: 'ok', active: 'ok', paid: 'ok', open: 'bad',
  pending: 'warn', requested: 'warn', reserved: 'gold', draft: 'mute',
  rejected: 'bad', suspended: 'bad', sold: 'gold', archived: 'mute',
  resolved_release: 'ok', resolved_refund: 'warn',
};
export function StatusPill({ status }: { status: string }) {
  return <Pill tone={GENERIC_TONE[status] ?? 'mute'}>{status.replace(/_/g, ' ')}</Pill>;
}

export function Stars({ value, size = 14, onChange }: { value: number; size?: number; onChange?: (v: number) => void }) {
  return (
    <div className="flex gap-0.5" aria-label={`${value.toFixed(1)} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(i)}
          className={onChange ? 'cursor-pointer' : 'cursor-default'}
          aria-label={onChange ? `${i} stars` : undefined}
        >
          <Star size={size} strokeWidth={1.2} className={i <= Math.round(value) ? 'fill-gold text-gold' : 'text-faint'} />
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="card w-full max-w-lg animate-fade-up p-6 sm:p-8" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal aria-label={title}>
        <div className="mb-6 flex items-start justify-between gap-4">
          <h3 className="text-2xl">{title}</h3>
          <button onClick={onClose} className="text-mute hover:text-bone" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-faint">{hint}</span>}
    </label>
  );
}

export function SectionHeading({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return (
    <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <div className="eyebrow mb-3">{eyebrow}</div>}
        <h2 className="text-4xl sm:text-5xl">{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card p-5">
      <div className="text-[10px] uppercase tracking-[0.22em] text-mute">{label}</div>
      <div className="mt-3 font-serif text-3xl text-bone">{value}</div>
      {sub && <div className="mt-1 text-xs text-faint">{sub}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; badge?: number }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="-mx-4 mb-8 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`relative shrink-0 px-4 py-3 text-[11px] uppercase tracking-[0.2em] transition-colors ${
            value === t.id ? 'text-gold' : 'text-mute hover:text-bone'
          }`}
        >
          {t.label}
          {!!t.badge && <span className="ml-2 rounded-full bg-gold px-1.5 py-0.5 text-[9px] text-ink">{t.badge}</span>}
          {value === t.id && <span className="absolute inset-x-0 -bottom-px h-px bg-gold" />}
        </button>
      ))}
    </div>
  );
}
