import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { BarChart } from '../../components/BarChart';
import { Page } from '../../components/Layout';
import { MediaUploader } from '../../components/MediaUploader';
import { OrderRow } from '../../components/OrderRow';
import { Empty, ErrorNote, Field, Notice, Spinner, Stat, StatusPill, Tabs } from '../../components/ui';
import { api, mediaUrl } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { COUNTRIES, date, money } from '../../lib/format';
import { useApi, useDocumentTitle } from '../../lib/hooks';
import type { Balance, Listing, Media, Order } from '../../lib/types';

type Tab = 'overview' | 'inventory' | 'orders' | 'questions' | 'payouts' | 'gallery';

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
  const { data, reload } = useApi<{ listings: Listing[] }>('/vendor/listings');
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState<unknown>(null);
  if (!data) return <Spinner />;
  const rows = data.listings.filter((l) => filter === 'all' || l.status === filter);
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setError(e);
    }
  };
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {['all', 'active', 'reserved', 'sold', 'draft', 'archived'].map((s) => (
          <button key={s} onClick={() => setFilter(s)} className={`border px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] ${filter === s ? 'border-gold text-gold' : 'border-line text-mute'}`}>
            {s} {s === 'all' ? data.listings.length : data.listings.filter((l) => l.status === s).length}
          </button>
        ))}
        <Link to="/vendor/listings/new" className="btn-gold btn-sm ml-auto"><Plus size={12} /> New listing</Link>
      </div>
      <ErrorNote error={error} />
      {rows.length === 0 ? (
        <Empty title="No works here yet" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-line text-left text-[10px] uppercase tracking-[0.18em] text-faint">
              <tr><th className="py-3 pr-4 font-normal">Work</th><th className="font-normal">Category</th><th className="font-normal">Price</th><th className="font-normal">Views</th><th className="font-normal">Status</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((l) => (
                <tr key={l.id}>
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center bg-ink-3 p-1">{l.cover && <img src={mediaUrl(l.cover.thumbUrl)} alt="" className="max-h-full max-w-full object-contain" />}</div>
                      <div className="min-w-0">
                        <div className="truncate font-serif text-base">{l.title}</div>
                        <div className="truncate text-xs text-faint">{l.artist}</div>
                      </div>
                    </div>
                  </td>
                  <td className="text-mute">{l.category?.name}</td>
                  <td className="tabular-nums text-gold">{money(l.priceCents)}</td>
                  <td className="tabular-nums text-faint">{l.views}</td>
                  <td><StatusPill status={l.status} /></td>
                  <td className="space-x-3 whitespace-nowrap text-right text-[10px] uppercase tracking-[0.15em]">
                    {['active', 'draft', 'archived'].includes(l.status) && <Link to={`/vendor/listings/${l.id}`} className="text-mute hover:text-gold">Edit</Link>}
                    {l.status === 'active' && <Link to={`/listing/${l.slug}`} className="text-mute hover:text-gold">View</Link>}
                    {l.status === 'active' && <button onClick={() => act(() => api(`/vendor/listings/${l.id}`, { method: 'DELETE' }))} className="uppercase text-mute hover:text-bad">Archive</button>}
                    {['draft', 'archived'].includes(l.status) && <button onClick={() => act(() => api(`/vendor/listings/${l.id}`, { method: 'PATCH', body: { status: 'active' } }))} className="uppercase text-gold">Publish</button>}
                  </td>
                </tr>
              ))}
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

function Payouts({ approved }: { approved: boolean }) {
  const { data, reload } = useApi<{ payouts: { id: number; amountCents: number; method: string; destination: string; status: string; createdAt: string; note: string | null }[]; balance: Balance }>('/vendor/payouts');
  const [form, setForm] = useState({ amount: '', method: 'bank_transfer', destination: '' });
  const [error, setError] = useState<unknown>(null);
  const [ok, setOk] = useState(false);
  if (!data) return <Spinner />;
  const b = data.balance;
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <div>
        <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Available" value={<span className="text-gold">{money(b.availableCents)}</span>} />
          <Stat label="In escrow" value={money(b.inEscrowCents)} />
          <Stat label="Released (lifetime)" value={money(b.releasedCents)} />
          <Stat label="Withdrawn" value={money(b.withdrawnCents)} />
        </div>
        <h3 className="mb-4 text-2xl">Withdrawal history</h3>
        {data.payouts.length === 0 ? <p className="text-sm text-faint">No withdrawals yet.</p> : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line border-y border-line">
              {data.payouts.map((p) => (
                <tr key={p.id}>
                  <td className="py-3 text-mute">{date(p.createdAt)}</td>
                  <td className="py-3 capitalize text-faint">{p.method.replace('_', ' ')} · {p.destination}</td>
                  <td className="py-3 text-right tabular-nums">{money(p.amountCents, 'USD', { decimals: true })}</td>
                  <td className="py-3 pl-4 text-right"><StatusPill status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
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
    </div>
  );
}

function GallerySettings() {
  const { data, reload } = useApi<{ gallery: { name: string; tagline: string; bio: string; location: string; country: string; coverUrl: string | null; status: string; reviewNote: string | null; slug: string } }>('/vendor/gallery');
  const [form, setForm] = useState<any>(null);
  const [cover, setCover] = useState<Media[] | null>(null);
  const [msg, setMsg] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  if (!data) return <Spinner />;
  const g = form ?? data.gallery;
  const coverMedia = cover ?? (data.gallery.coverUrl ? [{ kind: 'image' as const, url: data.gallery.coverUrl, thumbUrl: data.gallery.coverUrl, width: null, height: null }] : []);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...g, [k]: e.target.value });
  return (
    <form
      className="grid max-w-4xl gap-5 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setMsg(null);
        try {
          await api('/vendor/gallery', { method: 'PATCH', body: { name: g.name, tagline: g.tagline, bio: g.bio, location: g.location, country: g.country, ...(coverMedia[0] ? { coverUrl: coverMedia[0].url } : {}) } });
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
        <span className="label">Cover image</span>
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
          { id: 'payouts', label: 'Payouts' },
          { id: 'gallery', label: 'Gallery profile' },
        ]}
      />
      {tab === 'overview' && <Overview />}
      {tab === 'inventory' && <Inventory />}
      {tab === 'orders' && <Orders />}
      {tab === 'questions' && <Questions />}
      {tab === 'payouts' && <Payouts approved={gallery?.status === 'approved'} />}
      {tab === 'gallery' && <GallerySettings />}
    </Page>
  );
}
