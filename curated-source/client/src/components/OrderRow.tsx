import { Link } from 'react-router-dom';
import { mediaUrl } from '../lib/api';
import { date, money } from '../lib/format';
import type { Order } from '../lib/types';
import { OrderPill } from './ui';

export function OrderRow({ order, extra }: { order: Order; extra?: React.ReactNode }) {
  return (
    <Link to={`/orders/${order.id}`} className="flex items-center gap-4 border-b border-line py-4 transition-colors hover:bg-ink-2 sm:gap-6 sm:px-4">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center bg-ink-3 p-1.5">
        {order.listing?.cover && <img src={mediaUrl(order.listing.cover.thumbUrl)} alt="" className="max-h-full max-w-full object-contain" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-serif text-lg">{order.listing?.title}</div>
        <div className="truncate text-xs text-faint">
          {order.reference} · {date(order.createdAt)} {extra}
        </div>
      </div>
      <div className="hidden text-right text-sm tabular-nums text-gold sm:block">{money(order.totalCents, order.currency)}</div>
      <OrderPill status={order.status} />
    </Link>
  );
}
