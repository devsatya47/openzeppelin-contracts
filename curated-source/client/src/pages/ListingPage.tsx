import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Award, BadgeCheck, Eye, MessageSquare, ShieldCheck, Truck } from 'lucide-react';
import { Page } from '../components/Layout';
import { ListingGrid } from '../components/ListingCard';
import { MediaGallery } from '../components/MediaGallery';
import { ShareButton } from '../components/ShareButton';
import { ErrorNote, SectionHeading, Spinner, Stars } from '../components/ui';
import NotFound from './NotFound';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { COUNTRIES, countryName, date, dims, listingPrice, money } from '../lib/format';
import { useApi, useDocumentTitle, usePlatformConfig } from '../lib/hooks';
import type { Listing, ListingDetail, Question } from '../lib/types';

type Resp = { listing: ListingDetail; questions: Question[]; related: Listing[] };

function ShippingCalculator({ listing }: { listing: ListingDetail }) {
  const { user } = useAuth();
  const [country, setCountry] = useState(user?.country ?? 'US');
  const domestic = country === listing.originCountry;
  const ship = domestic ? listing.shippingDomesticCents : listing.shippingInternationalCents;
  return (
    <div className="border border-line p-5">
      <div className="mb-4 flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-mute">
        <Truck size={14} strokeWidth={1.4} className="text-gold" /> Shipping calculator
      </div>
      <select value={country} onChange={(e) => setCountry(e.target.value)} className="field py-2.5" aria-label="Destination country">
        {COUNTRIES.map(([c, n]) => (
          <option key={c} value={c}>{n}</option>
        ))}
      </select>
      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between text-mute">
          <dt>{domestic ? 'Domestic' : 'International'} flat rate</dt>
          <dd className="tabular-nums text-bone">{ship === 0 ? 'Complimentary' : money(ship, listing.currency)}</dd>
        </div>
        {!listing.priceOnRequest && (
          <div className="flex justify-between border-t border-line pt-2">
            <dt className="text-mute">Total to {countryName(country)}</dt>
            <dd className="tabular-nums text-gold">{money(listing.priceCents + ship, listing.currency)}</dd>
          </div>
        )}
      </dl>
      <p className="mt-3 text-xs text-faint">
        Ships from {countryName(listing.originCountry)} · domestic {money(listing.shippingDomesticCents)} · international {money(listing.shippingInternationalCents)}. Fully insured fine-art handling.
      </p>
    </div>
  );
}

/** Private purchase enquiry, sent to the gallery's Enquiries inbox with the collector's contact details. */
function EnquiryForm({ listing }: { listing: ListingDetail }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <div className="border border-ok/40 bg-ok/10 p-5 text-sm text-ok">
        Thank you. {listing.gallery.name} has your enquiry and will reply to you by email.
      </div>
    );
  }
  if (!open) {
    return (
      <div className="space-y-3">
        <button onClick={() => setOpen(true)} className="btn-gold w-full py-4 text-sm">Enquire about this work</button>
        <p className="text-xs text-faint">
          {listing.priceOnRequest ? 'The price of this work is available on request.' : 'This work is available by private enquiry.'} The gallery replies to you directly by email.
        </p>
      </div>
    );
  }
  if (!user) {
    return (
      <div className="border border-line p-5 text-sm text-mute">
        Please <Link to={`/login?next=/listing/${listing.slug}`} className="text-gold hover:underline">sign in</Link> or{' '}
        <Link to={`/register?next=/listing/${listing.slug}`} className="text-gold hover:underline">create an account</Link> so the gallery can reply to you.
      </div>
    );
  }
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api(`/listings/${listing.id}/enquiries`, { body: { message } });
          setSent(true);
        } catch (err) {
          setError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={4}
        className="field"
        minLength={10}
        required
        placeholder={listing.priceOnRequest ? 'Hello, could you share the price and availability of this work?' : 'Hello, I would like to acquire this work.'}
      />
      <p className="text-xs text-faint">The gallery will see your name and email ({user.email}) to reply.</p>
      <ErrorNote error={error} />
      <button className="btn-gold w-full" disabled={busy}>{busy ? 'Sending…' : 'Send enquiry'}</button>
    </form>
  );
}

function QA({ listing, questions, onAsked }: { listing: ListingDetail; questions: Question[]; onAsked: () => void }) {
  const { user } = useAuth();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/listings/${listing.id}/questions`, { body: { body } });
      setBody('');
      onAsked();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <div className="eyebrow mb-3">Ask the gallery</div>
      <h2 className="text-4xl">Questions & answers</h2>
      <p className="mt-2 text-sm text-mute">Ask {listing.gallery.name} directly about condition, framing, provenance or logistics.</p>
      {user ? (
        !listing.isOwner && (
          <form onSubmit={submit} className="mt-6 space-y-3">
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} className="field" placeholder="e.g. Is the work framed? Could you share a condition report?" minLength={5} required />
            <ErrorNote error={error} />
            <button className="btn-outline btn-sm" disabled={busy || body.trim().length < 5}>
              <MessageSquare size={12} /> Send question
            </button>
          </form>
        )
      ) : (
        <p className="mt-6 text-sm text-mute">
          <Link to={`/login?next=/listing/${listing.slug}`} className="text-gold underline-offset-4 hover:underline">Sign in</Link> to ask a question.
        </p>
      )}
      <div className="mt-8 divide-y divide-line border-y border-line">
        {questions.length === 0 && <p className="py-6 text-sm text-faint">No questions yet.</p>}
        {questions.map((q) => (
          <div key={q.id} className="py-6">
            <p className="text-bone">
              <span className="mr-2 font-serif text-lg text-gold">Q.</span>
              {q.body}
            </p>
            <p className="mt-1 text-xs text-faint">{q.asker} · {date(q.createdAt)}</p>
            {q.answer ? (
              <p className="mt-3 border-l border-gold/40 pl-4 text-sm leading-relaxed text-mute">
                <span className="mr-2 font-serif text-lg text-gold">A.</span>
                {q.answer}
              </p>
            ) : (
              <p className="mt-3 text-xs italic text-faint">Awaiting the gallery’s reply</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ListingPage() {
  const { slug } = useParams();
  const { data, error, loading, reload } = useApi<Resp>(`/listings/${slug}`);
  const platform = usePlatformConfig();
  const { user } = useAuth();
  const navigate = useNavigate();
  useDocumentTitle(data ? `${data.listing.title} by ${data.listing.artist}` : undefined);

  if (loading && !data) return <Spinner />;
  if (error && (error as any).status === 404) return <NotFound />;
  if (error || !data) return <Page className="py-20"><ErrorNote error={error} /></Page>;
  const l = data.listing;
  const d = dims(l.widthCm, l.heightCm, l.depthCm);
  const enquiryOnly = l.priceOnRequest || l.priceCents > platform.maxPriceCents;
  const available = l.status === 'active' && !enquiryOnly;

  const acquire = () => {
    if (!user) return navigate(`/login?next=/checkout/${l.id}`);
    navigate(`/checkout/${l.id}`);
  };

  return (
    <>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_480px]">
        <MediaGallery media={l.media} alt={`${l.title} by ${l.artist}`} />
        <div className="border-line lg:border-l">
          <div className="space-y-8 p-6 sm:p-10 lg:sticky lg:top-20">
            <nav className="flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.2em] text-faint" aria-label="Breadcrumb">
              {l.categoryPath.map((c, i) => (
                <span key={c.id} className="flex gap-2">
                  {i > 0 && <span>/</span>}
                  <Link to={`/gallery?category=${c.slug}`} className="hover:text-gold">{c.name}</Link>
                </span>
              ))}
            </nav>
            <div>
              <Link to={`/gallery?q=${encodeURIComponent(l.artist)}`} className="eyebrow hover:text-gold-bright">{l.artist}</Link>
              <h1 className="mt-3 text-4xl leading-tight sm:text-5xl">
                <span className="italic">{l.title}</span>
                {l.year && <span className="text-mute">, {l.year}</span>}
              </h1>
              <dl className="mt-5 space-y-1.5 text-sm text-mute">
                <div>{l.medium}</div>
                {d && <div>{d.cm} <span className="text-faint">({d.in})</span></div>}
                <div>{l.edition}</div>
              </dl>
            </div>

            <div className="flex items-end justify-between gap-4 border-y border-line py-6">
              <div>
                <div className="text-[10px] uppercase tracking-[0.22em] text-faint">Price</div>
                <div className={`mt-1 font-serif tabular-nums text-gold ${l.priceOnRequest ? 'text-3xl italic' : 'text-4xl'}`}>{listingPrice(l)}</div>
              </div>
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1.5 text-xs text-faint"><Eye size={13} /> {l.views}</span>
                <ShareButton path={`/listing/${l.slug}`} title={`${l.title} by ${l.artist}`} text={`${listingPrice(l)} on Curated Art`} image={l.media[0]?.url} />
              </div>
            </div>

            {l.isOwner ? (
              <Link to={`/vendor/listings/${l.id}`} className="btn-outline w-full">Edit this listing</Link>
            ) : enquiryOnly && l.status === 'active' ? (
              <EnquiryForm listing={l} />
            ) : (
              <button onClick={acquire} disabled={!available} className="btn-gold w-full py-4 text-sm">
                {available ? 'Acquire Piece' : l.status === 'reserved' ? 'Reserved' : 'Acquired'}
              </button>
            )}

            <div className="flex gap-4 border border-gold/30 bg-gold/[0.04] p-5">
              <ShieldCheck size={28} strokeWidth={1.1} className="shrink-0 text-gold" />
              <div>
                <div className="text-sm text-bone">Escrow Guarantee</div>
                <p className="mt-1 text-xs leading-relaxed text-mute">
                  Your payment is held securely by Curated Art and only released to the gallery after you confirm the work has arrived as described.
                </p>
              </div>
            </div>

            <ShippingCalculator listing={l} />

            <Link to={`/galleries/${l.gallery.slug}`} className="group flex items-center justify-between border border-line p-5 hover:border-gold/40">
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-faint">Offered by</div>
                <div className="mt-1 font-serif text-2xl group-hover:text-gold">{l.gallery.name}</div>
                <div className="text-xs text-mute">{l.gallery.location}</div>
              </div>
              {l.gallery.rating && (
                <div className="text-right">
                  <Stars value={l.gallery.rating} size={12} />
                  <div className="mt-1 text-xs text-faint">{l.gallery.reviewCount} reviews</div>
                </div>
              )}
            </Link>
          </div>
        </div>
      </div>

      <Page className="py-24">
        <div className="grid gap-16 lg:grid-cols-2">
          <div className="space-y-14">
            <section>
              <div className="eyebrow mb-3">About the work</div>
              <p className="whitespace-pre-line font-serif text-2xl leading-relaxed text-bone/90">{l.description}</p>
            </section>
            <section>
              <div className="eyebrow mb-5">Authenticity & provenance</div>
              <div className="grid gap-px border border-line bg-line sm:grid-cols-3">
                {[
                  [BadgeCheck, 'Certificate', l.certificateOfAuthenticity ? 'Certificate of authenticity included' : 'Documentation available on request'],
                  [Award, 'Edition', l.edition],
                  [Truck, 'Ships from', countryName(l.originCountry)],
                ].map(([Icon, k, v]: any) => (
                  <div key={k} className="bg-ink p-5">
                    <Icon size={18} strokeWidth={1.2} className="text-gold" />
                    <div className="mt-3 text-[10px] uppercase tracking-[0.2em] text-faint">{k}</div>
                    <div className="mt-1 text-sm text-bone">{v}</div>
                  </div>
                ))}
              </div>
              {l.provenance && (
                <div className="mt-6">
                  <h3 className="text-[11px] uppercase tracking-[0.2em] text-mute">Provenance</h3>
                  <p className="mt-2 text-sm leading-relaxed text-mute">{l.provenance}</p>
                </div>
              )}
            </section>
          </div>
          <QA listing={l} questions={data.questions} onAsked={reload} />
        </div>
      </Page>

      {data.related.length > 0 && (
        <Page>
          <SectionHeading eyebrow="You may also consider" title="Related works" />
          <ListingGrid listings={data.related} />
        </Page>
      )}
    </>
  );
}
