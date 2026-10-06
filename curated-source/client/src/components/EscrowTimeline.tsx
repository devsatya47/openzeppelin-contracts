import { Check } from 'lucide-react';
import { ESCROW_STAGES, ORDER_STATUS } from '../lib/format';
import type { OrderStatus } from '../lib/types';

/** Horizontal tracker for the five escrow stages: Pending → In Escrow → Dispatched → Delivered → Released. */
export function EscrowTimeline({ status, history }: { status: OrderStatus; history?: OrderStatus[] }) {
  const off = ['cancelled', 'refunded', 'disputed'].includes(status);
  // For off-path states, show progress up to the furthest stage actually reached.
  const reached = off
    ? Math.max(0, ...(history ?? []).map((s) => ESCROW_STAGES.indexOf(s)))
    : ESCROW_STAGES.indexOf(status);
  return (
    <div>
      <ol className="grid grid-cols-5">
        {ESCROW_STAGES.map((s, i) => {
          const done = i < reached || (i === reached && (status === 'released' || off));
          const current = i === reached && !off && status !== 'released';
          return (
            <li key={s} className="relative flex flex-col items-center text-center">
              {i > 0 && <span className={`absolute right-1/2 top-[11px] h-px w-full ${i <= reached ? 'bg-gold' : 'bg-line'}`} />}
              <span
                className={`relative z-10 flex h-6 w-6 items-center justify-center rounded-full border text-[10px] ${
                  done ? 'border-gold bg-gold text-ink' : current ? 'border-gold bg-ink text-gold ring-4 ring-gold/15' : 'border-line bg-ink text-faint'
                }`}
              >
                {done ? <Check size={12} strokeWidth={2.5} /> : i + 1}
              </span>
              <span className={`mt-3 text-[9px] uppercase tracking-[0.15em] sm:text-[10px] ${done || current ? 'text-bone' : 'text-faint'}`}>{ORDER_STATUS[s].label.replace(' Payment', '')}</span>
            </li>
          );
        })}
      </ol>
      {off && (
        <p className={`mt-5 text-center text-xs uppercase tracking-[0.2em] ${status === 'disputed' ? 'text-bad' : 'text-warn'}`}>
          {status === 'disputed' ? 'Escrow frozen — dispute under specialist review' : `Order ${ORDER_STATUS[status].label.toLowerCase()}`}
        </p>
      )}
    </div>
  );
}
