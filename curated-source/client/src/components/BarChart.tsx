import { money } from '../lib/format';

/** Minimal accessible bar chart for monthly sales (no chart library needed). */
export function BarChart({ data }: { data: { month: string; grossCents: number; orders: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.grossCents));
  return (
    <figure>
      <div className="flex h-48 items-end gap-1.5 sm:gap-3" role="img" aria-label="Monthly gross sales for the last 12 months">
        {data.map((d) => {
          const h = (d.grossCents / max) * 100;
          const label = new Date(`${d.month}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
          return (
            <div key={d.month} className="group relative flex h-full flex-1 flex-col justify-end">
              <div
                className={`w-full transition-colors ${d.grossCents ? 'bg-gold/70 group-hover:bg-gold' : 'bg-line'}`}
                style={{ height: `${Math.max(h, d.grossCents ? 3 : 1)}%` }}
              />
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap border border-line bg-ink px-2 py-1 text-[10px] text-bone group-hover:block">
                {label}: {money(d.grossCents)} · {d.orders} order{d.orders === 1 ? '' : 's'}
              </div>
              <div className="mt-2 text-center text-[9px] uppercase tracking-wider text-faint">{label}</div>
            </div>
          );
        })}
      </div>
    </figure>
  );
}
