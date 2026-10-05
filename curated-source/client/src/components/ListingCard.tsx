import { Link } from 'react-router-dom';
import { ArtFrame } from './ArtFrame';
import { money } from '../lib/format';
import type { Listing } from '../lib/types';

export function ListingCard({ listing, priority = false }: { listing: Listing; priority?: boolean }) {
  return (
    <Link to={`/listing/${listing.slug}`} className="group block animate-fade-up" data-priority={priority || undefined}>
      <div className="relative border border-transparent transition-colors duration-500 group-hover:border-gold/30">
        <ArtFrame media={listing.cover} alt={`${listing.title} by ${listing.artist}`} />
        {listing.status === 'reserved' && (
          <span className="absolute left-3 top-3 bg-ink/80 px-2 py-1 text-[9px] uppercase tracking-[0.2em] text-gold backdrop-blur">Reserved</span>
        )}
        {listing.status === 'sold' && (
          <span className="absolute left-3 top-3 bg-ink/80 px-2 py-1 text-[9px] uppercase tracking-[0.2em] text-mute backdrop-blur">Sold</span>
        )}
      </div>
      <div className="mt-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate font-serif text-xl leading-tight text-bone transition-colors group-hover:text-gold">{listing.title}</h3>
          <p className="mt-1 truncate text-sm text-mute">
            {listing.artist}
            {listing.year ? `, ${listing.year}` : ''}
          </p>
          {listing.gallery && <p className="mt-1 truncate text-[11px] uppercase tracking-[0.18em] text-faint">{listing.gallery.name}</p>}
        </div>
        <div className="shrink-0 pt-1 text-sm tabular-nums text-gold">{money(listing.priceCents, listing.currency)}</div>
      </div>
    </Link>
  );
}

export function ListingGrid({ listings, cols = 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' }: { listings: Listing[]; cols?: string }) {
  return (
    <div className={`grid grid-cols-1 gap-x-8 gap-y-14 ${cols}`}>
      {listings.map((l, i) => (
        <ListingCard key={l.id} listing={l} priority={i < 4} />
      ))}
    </div>
  );
}
