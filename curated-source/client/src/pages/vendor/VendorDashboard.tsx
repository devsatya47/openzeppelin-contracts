import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ExternalLink, Plus } from 'lucide-react';
import { BarChart } from '../../components/BarChart';
import { Page } from '../../components/Layout';
import { MediaUploader } from '../../components/MediaUploader';
import { ShareButton } from '../../components/ShareButton';
import { OrderRow } from '../../components/OrderRow';
import { Empty, ErrorNote, Field, Notice, Spinner, Stat, StatusPill, Tabs } from '../../components/ui';
import { api, mediaUrl } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { COUNTRIES, date, money } from '../../lib/format';
import { useApi, useDocumentTitle, usePlatformConfig } from '../../lib/hooks';
import type { Balance, Listing, Media, Order } from '../../lib/types';

type Tab = 'overview' | 'inventory' | 'orders' | 'questions' | 'enquiries' | 'payouts' | 'gallery';

type Analytics = {
  totals: { orders: number; grossCents: number; netCents: number; views: number };
  conversionRate: number;
  monthly: { month: string; grossCents: number; orders: number }[];
  inventory: Record<string, number>;
  topListings: { id: number; title: string; slug: string; views: number; status: string }[];
  balance: Balance;
};

function Overview() {
  const { data } = useApi<Analytics>('/vendor/analytics');
  if (!data) return <Spinner />;
  return (
    <div className="space-y-10">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Gross sales" value={money(data.totals.grossCents)} sub={`${data.totals.orders} acquisitions`} />
        <Stat label="Available to withdraw" value={<span className="text-gold">{money(data.balance.availableCents)}</span>} sub={`${money(data.balance.withdrawnCents)} withdrawn`} />
        <Stat label="Held in escrow" value={money(data.balance.inEscrowCents)} sub="Released on buyer approval" />
        <Stat label="Listing views" value={data.totals.views.toLocaleString()} sub={`${(data.conversionRate * 100).toFixed(2)}% conversion`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="card p-6">
          <div className="mb-6 flex items-center justify-between">
            <h3 className="text-2xl">Sales · last 12 months</h3>
          </div>
          <BarChart data={data.monthly} />
        </div>
        <div className="card p-6">
          <h3 className="mb-5 text-2xl">Inventory</h3>
          <dl className="space-y-3 text-sm">
            {['active', 'reserved', 'sold', 'draft', 'archived'].map((s) => (
              <div key={s} className="flex items-center justify-between border-b border-line pb-2">
                <dt className="capitalize text-mute">{s}</dt>
                <dd className="font-serif text-xl">{data.inventory[s] ?? 0}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      <div className="card p-6">
        <h3 className="mb-5 text-2xl">Most viewed works</h3>
        <ol className="divide-y divide-line">
          {data.topListings.map((l, i) => (
            <li key={l.id} className="flex items-center gap-4 py-3 text-sm">
              <span className="w-6 font-serif text-lg text-gold">{i + 1}</span>
              <Link to={`/listing/${l.slug}`} className="flex-1 truncate hover:text-gold">{l.title}</Link>
              <StatusPill status={l.status} />
              <span className="w-16 text-right tabular-nums text-faint">{l.views} views</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function Inventory() {
  const { data, reload, setData } = useApi<{ listings: Listing[] }>('/vendor/listings');
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState<unknown>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  if (!data) return <Spinner />;
  const all = data.listings;
  const rows = all.filter((l) => filter === 'all' || l.status === filter || (filter === 'hidden' && l.status === 'archived'));
  const canReorder = filter === 'all' && all.length > 1;

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setError(e);
    }
  };

  /** Moves a work and saves the new order (also used on the public gallery page). */
  const reorder = async (from: number, to: number) => {
    if (from === to || to < 0 || to >= all.length) return;
    const next = [...all];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setData({ listings: next });
    setError(null);
    try {
      await api('/vendor/listings/order', { method: 'PUT', body: { ids: next.map((l) => l.id) } });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(e);
      reload();
    }
  };

  const remove = (l: Listing) => {
    if (!window.confirm(`Delete “${l.title}” permanently? This cannot be undone.`)) return;
    act(() => api(`/vendor/listings/${l.id}`, { method: 'DELETE' }));
  };

  const count = (s: string) => (s === 'all' ? all.length : all.filter((l) => l.status === s || (s === 'hidden' && l.status === 'archived')).length);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {['all', 'active', 'hidden', 'reserved', 'sold', 'draft'].map((s) => (
          <button key={s} onClick={() => setFilter(s)} className={`border px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] ${filter === s ? 'border-gold text-gold' : 'border-line text-mute'}`}>
            {s} {count(s)}
          </button>
        ))}
        <Link to="/vendor/listings/new" className="btn-gold btn-sm ml-auto"><Plus size={12} /> New listing</Link>
      </div>
      <p className="mb-4 text-xs text-faint">
        {canReorder
          ? 'Drag works by the ⠿ handle (or use the arrows) to set the order shown on your public gallery page.'
          : filter !== 'all' && 'Switch to “all” to change the order of your works.'}
        {saved && <span className="ml-2 text-ok">Order saved</span>}
      </p>
      <ErrorNote error={error} />
      {rows.length === 0 ? (
        <Empty title="No works here yet" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="border-b border-line text-left text-[10px] uppercase tracking-[0.18em] text-faint">
              <tr><th className="w-16" /><th className="py-3 pr-4 font-normal">Work</th><th className="font-normal">Category</th><th className="font-normal">Price</th><th className="font-normal">Views</th><th className="font-normal">Status</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((l, i) => {
                const locked = ['reserved', 'sold'].includes(l.status);
                const hidden = l.status === 'hidden' || l.status === 'archived';
                return (
                  <tr
                    key={l.id}
                    draggable={canReorder}
                    onDragStart={(e) => {
                      setDragFrom(i);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', String(l.id));
                    }}
                    onDragOver={(e) => {
                      if (dragFrom === null) return;
                      e.preventDefault();
                      setDragOver(i);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragFrom !== null) reorder(dragFrom, i);
                      setDragFrom(null);
                      setDragOver(null);
                    }}
                    onDragEnd={() => {
                      setDragFrom(null);
                      setDragOver(null);
                    }}
                    className={`${dragFrom === i ? 'opacity-40' : ''} ${dragOver === i && dragFrom !== i ? 'outline outline-1 outline-gold' : ''} ${hidden ? 'opacity-60' : ''}`}
                  >
                    <td className="py-3">
                      {canReorder && (
                        <div className="flex items-center gap-1 text-faint">
                          <span className="cursor-grab select-none px-1 text-lg leading-none active:cursor-grabbing" title="Drag to reorder" aria-hidden>⠿</span>
                          <span className="flex flex-col">
                            <button type="button" onClick={() => reorder(i, i - 1)} disabled={i === 0} className="leading-none hover:text-gold disabled:opacity-20" aria-label={`Move ${l.title} up`}>▲</button>
                            <button type="button" onClick={() => reorder(i, i + 1)} disabled={i === rows.length - 1} className="leading-none hover:text-gold disabled:opacity-20" aria-label={`Move ${l.title} down`}>▼</button>
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center bg-ink-3 p-1">{l.cover && <img src={mediaUrl(l.cover.thumbUrl)} alt="" draggable={false} className="max-h-full max-w-full object-contain" />}</div>
                        <div className="min-w-0">
                          <div className="truncate font-serif text-base">{l.title}</div>
                          <div className="truncate text-xs text-faint">{l.artist}</div>
                        </div>
                      </div>
                    </td>
                    <td className="text-mute">{l.category?.name}</td>
                    <td className="tabular-nums text-gold">{l.priceOnRequest ? <span className="text-xs italic">On request</span> : money(l.priceCents)}</td>
                    <td className="tabular-nums text-faint">{l.views}</td>
                    <td><StatusPill status={l.status === 'archived' ? 'hidden' : l.status} /></td>
                    <td className="space-x-3 whitespace-nowrap text-right text-[10px] uppercase tracking-[0.15em]">
                      {!locked && <Link to={`/vendor/listings/${l.id}`} className="text-mute hover:text-gold">Edit</Link>}
                      {l.status === 'active' && <Link to={`/listing/${l.slug}`} className="text-mute hover:text-gold">View</Link>}
                      {l.status === 'active' && (
                        <ShareButton path={`/listing/${l.slug}`} title={`${l.title} by ${l.artist}`} image={l.cover?.url} className="inline-flex items-center gap-1 uppercase text-mute hover:text-gold" />
                      )}
                      {l.status === 'active' && <button onClick={() => act(() => api(`/vendor/listings/${l.id}`, { method: 'PATCH', body: { status: 'hidden' } }))} className="uppercase text-mute hover:text-gold">Hide</button>}
                      {hidden && <button onClick={() => act(() => api(`/vendor/listings/${l.id}`, { method: 'PATCH', body: { status: 'active' } }))} className="uppercase text-gold">Show</button>}
                      {l.status === 'draft' && <button onClick={() => act(() => api(`/vendor/listings/${l.id}`, { method: 'PATCH', body: { status: 'active' } }))} className="uppercase text-gold">Publish</button>}
                      {!locked && <button onClick={() => remove(l)} className="uppercase text-mute hover:text-bad">Delete</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Orders() {
  const { data } = useApi<{ orders: Order[] }>('/vendor/orders');
  if (!data) return <Spinner />;
  const needsAction = data.orders.filter((o) => o.status === 'in_escrow').length;
  return (
    <div>
      {needsAction > 0 && <div className="mb-6"><Notice>{needsAction} order{needsAction > 1 ? 's are' : ' is'} paid and waiting for dispatch.</Notice></div>}
      {data.orders.length === 0 ? <Empty title="No orders yet">When a collector acquires one of your works it will appear here.</Empty> : (
        <div className="border-t border-line">{data.orders.map((o) => <OrderRow key={o.id} order={o} extra={`· ${o.shippingRegion}`} />)}</div>
      )}
    </div>
  );
}

function Questions() {
  const { data, reload } = useApi<{ questions: { id: number; body: string; answer: string | null; createdAt: string; asker: string; listingTitle: string; listingSlug: string }[] }>('/vendor/questions');
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  if (!data) return <Spinner />;
  if (!data.questions.length) return <Empty title="No questions yet" />;
  return (
    <div className="space-y-4">
      {data.questions.map((q) => (
        <div key={q.id} className={`card p-5 ${q.answer ? '' : 'border-gold/40'}`}>
          <div className="mb-2 text-xs text-faint">
            {q.asker} on <Link to={`/listing/${q.listingSlug}`} className="text-gold">{q.listingTitle}</Link> · {date(q.createdAt)}
          </div>
          <p className="text-bone">{q.body}</p>
          {q.answer ? (
            <p className="mt-3 border-l border-gold/40 pl-3 text-sm text-mute">{q.answer}</p>
          ) : (
            <form
              className="mt-4 flex flex-col gap-3 sm:flex-row"
              onSubmit={async (e) => {
                e.preventDefault();
                await api(`/vendor/questions/${q.id}/answer`, { body: { answer: drafts[q.id] } });
                reload();
              }}
            >
              <input value={drafts[q.id] ?? ''} onChange={(e) => setDrafts({ ...drafts, [q.id]: e.target.value })} className="field" placeholder="Write a public answer…" required minLength={2} />
              <button className="btn-outline btn-sm shrink-0">Answer</button>
            </form>
          )}
        </div>
      ))}
    </div>
  );
}

type Enquiry = { id: number; message: string; status: string; createdAt: string; buyerName: string; buyerEmail: string; buyerCountry: string | null; listingTitle: string; listingSlug: string };

function Enquiries({ onChange }: { onChange: () => void }) {
  const { data, reload } = useApi<{ enquiries: Enquiry[]; unread: number }>('/vendor/enquiries');
  const [error, setError] = useState<unknown>(null);
  if (!data) return <Spinner />;
  if (!data.enquiries.length)
    return <Empty title="No price enquiries yet">Collectors can ask for the price on works marked “Price on request”. Their messages appear here.</Empty>;
  const mark = async (id: number, status: string) => {
    setError(null);
    try {
      await api(`/vendor/enquiries/${id}`, { method: 'PATCH', body: { status } });
      reload();
      onChange();
    } catch (e) {
      setError(e);
    }
  };
  return (
    <div className="space-y-4">
      <ErrorNote error={error} />
      {data.enquiries.map((q) => (
        <div key={q.id} className={`card p-5 ${q.status === 'new' ? 'border-gold/40' : ''}`}>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-faint">
            <StatusPill status={q.status} />
            <span>
              {q.buyerName}
              {q.buyerCountry ? ` (${q.buyerCountry})` : ''} about <Link to={`/listing/${q.listingSlug}`} className="text-gold">{q.listingTitle}</Link> · {date(q.createdAt)}
            </span>
          </div>
          <p className="whitespace-pre-line text-bone">{q.message}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <a
              href={`mailto:${q.buyerEmail}?subject=${encodeURIComponent(`Your enquiry about “${q.listingTitle}”`)}`}
              onClick={() => q.status === 'new' && mark(q.id, 'replied')}
              className="btn-gold btn-sm"
            >
              Reply by email
            </a>
            <span className="text-xs text-faint">{q.buyerEmail}</span>
            {q.status !== 'replied' && <button onClick={() => mark(q.id, 'replied')} className="btn-ghost btn-sm">Mark replied</button>}
            {q.status !== 'closed' && <button onClick={() => mark(q.id, 'closed')} className="btn-ghost btn-sm">Close</button>}
          </div>
        </div>
      ))}
    </div>
  );
}

type StripeStatus = { enabled: boolean; connected?: boolean; payoutsEnabled?: boolean; detailsSubmitted?: boolean; requirementsDue?: number };

/** Connects the gallery's bank account through Stripe (identity and bank details are entered on Stripe's own pages). */
function StripePayouts({ approved, onChange }: { approved: boolean; onChange: () => void }) {
  const { data, reload } = useApi<StripeStatus>('/vendor/stripe');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [params] = useSearchParams();
  const returned = params.get('stripe') === 'return';
  if (!data) return <div className="card h-fit p-6"><Spinner /></div>;
  const go = async (path: string) => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api<{ url: string }>(path, { body: {} });
      window.location.assign(url);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <div className="card h-fit space-y-5 p-6">
      <h3 className="text-2xl">Get paid</h3>
      {!approved ? (
        <Notice tone="warn">Payouts unlock once your gallery is approved.</Notice>
      ) : data.payoutsEnabled ? (
        <>
          <Notice tone="ok">Your Stripe account is connected.</Notice>
          <p className="text-sm text-mute">
            When a collector confirms delivery, your share (price and shipping, less our commission) is sent to your Stripe account automatically. Stripe then pays it into your bank.
          </p>
          <button type="button" onClick={() => go('/vendor/stripe/dashboard')} className="btn-outline w-full" disabled={busy}>
            <ExternalLink size={14} /> Open Stripe: payouts &amp; bank details
          </button>
          <button type="button" onClick={() => { reload(); onChange(); }} className="text-xs uppercase tracking-[0.2em] text-faint hover:text-bone">Refresh status</button>
        </>
      ) : (
        <>
          {returned && data.connected && (
            <Notice tone="warn">
              {data.detailsSubmitted
                ? 'Thank you. Stripe is checking your details; this usually takes a few minutes. Refresh this page shortly.'
                : 'Your Stripe sign-up is not finished yet. Continue where you left off.'}
            </Notice>
          )}
          <p className="text-sm text-mute">
            We pay galleries through <strong className="text-bone">Stripe</strong>. Connect your bank account once, on Stripe’s secure pages, and each completed sale is paid to you automatically.
            Stripe will ask for your identity and bank details. Curated Art never sees them.
          </p>
          {!!data.requirementsDue && data.connected && <p className="text-xs text-faint">Stripe needs {data.requirementsDue} more detail{data.requirementsDue === 1 ? '' : 's'} from you.</p>}
          <ErrorNote error={error} />
          <button type="button" onClick={() => go('/vendor/stripe/onboard')} className="btn-gold w-full" disabled={busy}>
            {busy ? 'Opening Stripe…' : data.connected ? 'Continue Stripe sign-up' : 'Connect bank account with Stripe'}
          </button>
          <p className="text-xs text-faint">Sales completed before you connect are kept for you and sent as soon as your account is ready.</p>
        </>
      )}
    </div>
  );
}

function Payouts({ approved }: { approved: boolean }) {
  const { data, reload } = useApi<{ payouts: { id: number; amountCents: number; method: string; destination: string; status: string; createdAt: string; note: string | null }[]; balance: Balance }>('/vendor/payouts');
  const [form, setForm] = useState({ amount: '', method: 'bank_transfer', destination: '' });
  const [error, setError] = useState<unknown>(null);
  const [ok, setOk] = useState(false);
  const { payments } = usePlatformConfig();
  if (!data) return <Spinner />;
  const b = data.balance;
  const stripe = payments === 'stripe';
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <div>
        <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label={stripe ? 'Awaiting transfer' : 'Available'} value={<span className="text-gold">{money(b.availableCents)}</span>} />
          <Stat label="In escrow" value={money(b.inEscrowCents)} />
          <Stat label="Released (lifetime)" value={money(b.releasedCents)} />
          <Stat label={stripe ? 'Paid to you' : 'Withdrawn'} value={money(b.withdrawnCents)} />
        </div>
        <h3 className="mb-4 text-2xl">{stripe ? 'Payments to you' : 'Withdrawal history'}</h3>
        {data.payouts.length === 0 ? <p className="text-sm text-faint">{stripe ? 'Nothing paid yet. Each sale is paid once the collector confirms delivery.' : 'No withdrawals yet.'}</p> : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line border-y border-line">
              {data.payouts.map((p) => (
                <tr key={p.id}>
                  <td className="py-3 text-mute">{date(p.createdAt)}</td>
                  <td className="py-3 text-faint">{p.method === 'stripe' ? p.note ?? 'Stripe transfer' : <span className="capitalize">{p.method.replace('_', ' ')} · {p.destination}</span>}</td>
                  <td className="py-3 text-right tabular-nums">{money(p.amountCents, 'USD', { decimals: true })}</td>
                  <td className="py-3 pl-4 text-right"><StatusPill status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {stripe ? <StripePayouts approved={approved} onChange={reload} /> : (
      <form
        className="card h-fit space-y-5 p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setOk(false);
          try {
            await api('/vendor/payouts', { body: { amountCents: Math.round(Number(form.amount) * 100), method: form.method, destination: form.destination } });
            setForm({ ...form, amount: '' });
            setOk(true);
            reload();
          } catch (err) {
            setError(err);
          }
        }}
      >
        <h3 className="text-2xl">Request a payout</h3>
        {!approved && <Notice tone="warn">Payouts unlock once your gallery is approved.</Notice>}
        <Field label="Amount (USD)" hint={`Up to ${money(b.availableCents, 'USD', { decimals: true })}`}>
          <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="field" inputMode="decimal" required />
        </Field>
        <Field label="Method">
          <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} className="field">
            <option value="bank_transfer">Bank transfer</option>
            <option value="wire">International wire</option>
            <option value="paypal">PayPal</option>
          </select>
        </Field>
        <Field label="Destination" hint="IBAN, account number or PayPal email">
          <input value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} className="field" required minLength={4} />
        </Field>
        <ErrorNote error={error} />
        {ok && <Notice tone="ok">Payout requested. Our finance team will process it shortly.</Notice>}
        <button className="btn-gold w-full" disabled={!approved || b.availableCents < 1000}>Request withdrawal</button>
      </form>
      )}
    </div>
  );
}

function GallerySettings() {
  const { data, reload } = useApi<{ gallery: { name: string; tagline: string; bio: string; location: string; country: string; coverUrl: string | null; bannerListingId: number | null; status: string; reviewNote: string | null; slug: string } }>('/vendor/gallery');
  const works = useApi<{ listings: Listing[] }>('/vendor/listings');
  const [banner, setBanner] = useState<number | null | undefined>(undefined);
  const [form, setForm] = useState<any>(null);
  const [cover, setCover] = useState<Media[] | null>(null);
  const [msg, setMsg] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  if (!data) return <Spinner />;
  const g = form ?? data.gallery;
  const coverMedia = cover ?? (data.gallery.coverUrl ? [{ kind: 'image' as const, url: data.gallery.coverUrl, thumbUrl: data.gallery.coverUrl, width: null, height: null }] : []);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...g, [k]: e.target.value });
  const bannerId = banner === undefined ? data.gallery.bannerListingId : banner;
  const candidates = (works.data?.listings ?? []).filter((l) => l.cover?.kind !== 'video' && l.cover && ['active', 'reserved', 'sold'].includes(l.status));
  return (
    <form
      className="grid max-w-4xl gap-5 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setMsg(null);
        try {
          await api('/vendor/gallery', { method: 'PATCH', body: { name: g.name, tagline: g.tagline, bio: g.bio, location: g.location, country: g.country, bannerListingId: bannerId, ...(coverMedia[0] ? { coverUrl: coverMedia[0].url } : {}) } });
          setSaved(true);
          reload();
        } catch (err) {
          setMsg(err);
        }
      }}
    >
      <div className="sm:col-span-2">
        {data.gallery.status === 'approved' ? (
          <Notice tone="ok">Your gallery is live at <Link to={`/galleries/${data.gallery.slug}`} className="underline">/galleries/{data.gallery.slug}</Link></Notice>
        ) : (
          <Notice tone="warn">Status: {data.gallery.status}. {data.gallery.reviewNote ?? 'Our team is reviewing your gallery.'}</Notice>
        )}
      </div>
      <Field label="Gallery name"><input value={g.name} onChange={set('name')} className="field" required /></Field>
      <Field label="Location"><input value={g.location} onChange={set('location')} className="field" /></Field>
      <div className="sm:col-span-2"><Field label="Tagline"><input value={g.tagline} onChange={set('tagline')} className="field" maxLength={140} /></Field></div>
      <div className="sm:col-span-2"><Field label="About"><textarea value={g.bio} onChange={set('bio')} rows={5} className="field" /></Field></div>
      <Field label="Ships from">
        <select value={g.country} onChange={set('country')} className="field">{COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
      </Field>
      <div className="sm:col-span-2">
        <span className="label">Banner on your gallery page</span>
        <p className="mb-3 text-xs text-faint">Feature one of your works across the top of your public gallery page, or use an uploaded cover image instead. Only works on view can be featured.</p>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-6">
          <button
            type="button"
            onClick={() => setBanner(null)}
            aria-pressed={bannerId === null}
            className={`flex aspect-square flex-col items-center justify-center gap-1 border p-2 text-center text-[10px] uppercase tracking-[0.15em] ${bannerId === null ? 'border-gold text-gold' : 'border-line text-mute hover:border-gold/50'}`}
          >
            {coverMedia[0] ? <img src={mediaUrl(coverMedia[0].thumbUrl)} alt="" className="max-h-[60%] max-w-full object-contain" /> : null}
            Uploaded cover
          </button>
          {candidates.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setBanner(l.id)}
              aria-pressed={bannerId === l.id}
              title={l.title}
              className={`relative flex aspect-square items-center justify-center border bg-ink-3 p-1 ${bannerId === l.id ? 'border-gold ring-1 ring-gold' : 'border-line hover:border-gold/50'}`}
            >
              <img src={mediaUrl(l.cover!.thumbUrl)} alt={l.title} className="max-h-full max-w-full object-contain" />
              {bannerId === l.id && <span className="absolute bottom-1 left-1 bg-gold px-1.5 text-[9px] uppercase tracking-[0.15em] text-ink">Banner</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="sm:col-span-2">
        <span className="label">Uploaded cover image</span>
        <MediaUploader value={coverMedia} onChange={(m) => setCover(m.slice(-1))} />
      </div>
      <div className="sm:col-span-2 space-y-3">
        <ErrorNote error={msg} />
        {saved && <Notice tone="ok">Gallery profile saved.</Notice>}
        <button className="btn-gold">Save profile</button>
      </div>
    </form>
  );
}

export default function VendorDashboard() {
  useDocumentTitle('Vendor portal');
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'overview';
  const questions = useApi<{ unanswered: number }>('/vendor/questions');
  const orders = useApi<{ orders: Order[] }>('/vendor/orders');
  const enquiries = useApi<{ unread: number }>('/vendor/enquiries');
  const gallery = user?.gallery;

  return (
    <Page className="py-12">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-3">Vendor portal</div>
          <h1 className="text-5xl">{gallery?.name}</h1>
        </div>
        <div className="flex items-center gap-3">
          {gallery && <StatusPill status={gallery.status} />}
          {gallery?.status === 'approved' && (
            <Link to={`/galleries/${gallery.slug}`} className="btn-ghost"><ExternalLink size={14} /> View my gallery page</Link>
          )}
          {gallery?.status === 'approved' && <ShareButton path={`/galleries/${gallery.slug}`} title={gallery.name} label="Share gallery" className="btn-ghost" />}
          <Link to="/vendor/listings/new" className="btn-gold"><Plus size={14} /> List a work</Link>
        </div>
      </div>
      {gallery?.status === 'pending' && (
        <div className="mb-8"><Notice tone="warn">Your gallery is pending approval. You can prepare listings now — they’ll go live when an administrator approves your gallery.</Notice></div>
      )}
      <Tabs<Tab>
        value={tab}
        onChange={(t) => setParams({ tab: t })}
        tabs={[
          { id: 'overview', label: 'Analytics' },
          { id: 'inventory', label: 'Inventory' },
          { id: 'orders', label: 'Orders', badge: orders.data?.orders.filter((o) => o.status === 'in_escrow').length },
          { id: 'questions', label: 'Q&A', badge: questions.data?.unanswered },
          { id: 'enquiries', label: 'Price enquiries', badge: enquiries.data?.unread },
          { id: 'payouts', label: 'Payouts' },
          { id: 'gallery', label: 'Gallery profile' },
        ]}
      />
      {tab === 'overview' && <Overview />}
      {tab === 'inventory' && <Inventory />}
      {tab === 'orders' && <Orders />}
      {tab === 'questions' && <Questions />}
      {tab === 'enquiries' && <Enquiries onChange={enquiries.reload} />}
      {tab === 'payouts' && <Payouts approved={gallery?.status === 'approved'} />}
      {tab === 'gallery' && <GallerySettings />}
    </Page>
  );
}
