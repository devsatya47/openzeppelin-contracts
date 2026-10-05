import { useParams } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import { Page } from '../components/Layout';
import { ListingGrid } from '../components/ListingCard';
import { Empty, Spinner, Stars } from '../components/ui';
import NotFound from './NotFound';
import { mediaUrl } from '../lib/api';
import { date } from '../lib/format';
import { useApi, useDocumentTitle } from '../lib/hooks';
import type { Listing } from '../lib/types';

type Resp = {
  gallery: { id: number; name: string; tagline: string; bio: string; location: string; coverUrl: string | null; rating: number | null; reviewCount: number; createdAt: string };
  listings: Listing[];
  reviews: { id: number; rating: number; body: string; createdAt: string; buyer: string; listing: string }[];
};

export default function GalleryPage() {
  const { slug } = useParams();
  const { data, loading, error } = useApi<Resp>(`/galleries/${slug}`);
  useDocumentTitle(data?.gallery.name);
  if (loading) return <Spinner />;
  if (error || !data) return <NotFound />;
  const g = data.gallery;
  return (
    <>
      <section className="relative -mt-20 flex min-h-[60vh] items-end overflow-hidden">
        {g.coverUrl && <img src={mediaUrl(g.coverUrl)} alt="" className="absolute inset-0 h-full w-full object-cover opacity-50" />}
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/50 to-ink/20" />
        <Page className="relative pb-16 pt-40">
          <div className="eyebrow mb-4 flex items-center gap-2"><MapPin size={12} /> {g.location}</div>
          <h1 className="text-6xl sm:text-7xl">{g.name}</h1>
          <p className="mt-4 font-serif text-2xl italic text-mute">{g.tagline}</p>
          {g.rating && (
            <div className="mt-6 flex items-center gap-3 text-sm text-mute">
              <Stars value={g.rating} /> {g.rating.toFixed(1)} · {g.reviewCount} collector review{g.reviewCount === 1 ? '' : 's'}
            </div>
          )}
        </Page>
      </section>
      <Page className="py-16">
        <div className="grid gap-16 lg:grid-cols-[1fr_2fr]">
          <div>
            <div className="eyebrow mb-4">About the gallery</div>
            <p className="leading-relaxed text-mute">{g.bio}</p>
            {data.reviews.length > 0 && (
              <div className="mt-12">
                <div className="eyebrow mb-4">Collector reviews</div>
                <div className="space-y-6">
                  {data.reviews.map((r) => (
                    <figure key={r.id} className="border-l border-gold/40 pl-4">
                      <Stars value={r.rating} size={11} />
                      <blockquote className="mt-2 font-serif text-lg italic leading-snug">“{r.body}”</blockquote>
                      <figcaption className="mt-2 text-xs text-faint">{r.buyer.split(' ')[0]} · acquired {r.listing} · {date(r.createdAt)}</figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div>
            <div className="eyebrow mb-6">On view · {data.listings.length} works</div>
            {data.listings.length ? <ListingGrid listings={data.listings} cols="sm:grid-cols-2" /> : <Empty title="No works on view">Check back soon.</Empty>}
          </div>
        </div>
      </Page>
    </>
  );
}
