import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Page } from '../../components/Layout';
import { OrderRow } from '../../components/OrderRow';
import { Empty, ErrorNote, Field, OrderPill, Spinner, Stat, StatusPill, Tabs } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useCategories } from '../../lib/catalog';
import { date, money, ORDER_STATUS } from '../../lib/format';
import { useApi, useDocumentTitle } from '../../lib/hooks';
import type { Order, OrderStatus, Role } from '../../lib/types';

type Tab = 'overview' | 'vendors' | 'taxonomy' | 'disputes' | 'orders' | 'payouts' | 'users' | 'audit';

type Overview = {
  gmvCents: number;
  commissionCents: number;
  escrowHeldCents: number;
  users: number;
  activeListings: number;
  pendingGalleries: number;
  pendingCategories: number;
  openDisputes: number;
  pendingPayouts: number;
  ordersByStatus: Partial<Record<OrderStatus, number>>;
};

function useAction(reload: () => void) {
  const [error, setError] = useState<unknown>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setError(e);
    }
  };
  return { error, run };
}

function OverviewTab({ data, go }: { data: Overview; go: (t: Tab) => void }) {
  return (
    <div className="space-y-10">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Gross merchandise value" value={money(data.gmvCents)} />
        <Stat label="Commission earned" value={<span className="text-gold">{money(data.commissionCents)}</span>} />
        <Stat label="Currently in escrow" value={money(data.escrowHeldCents)} />
        <Stat label="Active listings" value={data.activeListings} sub={`${data.users} registered users`} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {([
          ['Galleries awaiting approval', data.pendingGalleries, 'vendors'],
          ['Category suggestions', data.pendingCategories, 'taxonomy'],
          ['Open disputes', data.openDisputes, 'disputes'],
          ['Payouts to process', data.pendingPayouts, 'payouts'],
        ] as const).map(([label, n, tab]) => (
          <button key={label} onClick={() => go(tab)} className={`card p-5 text-left transition-colors hover:border-gold/50 ${n ? 'border-gold/40' : ''}`}>
            <div className={`font-serif text-4xl ${n ? 'text-gold' : 'text-faint'}`}>{n}</div>
            <div className="mt-2 text-[10px] uppercase tracking-[0.2em] text-mute">{label} →</div>
          </button>
        ))}
      </div>
      <div className="card p-6">
        <h3 className="mb-5 text-2xl">Orders by escrow stage</h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
          {(Object.keys(ORDER_STATUS) as OrderStatus[]).map((s) => (
            <div key={s} className="border-l border-line pl-3">
              <div className="font-serif text-3xl">{data.ordersByStatus[s] ?? 0}</div>
              <div className="mt-1 text-[9px] uppercase tracking-[0.15em] text-faint">{ORDER_STATUS[s].label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function VendorsTab() {
  const [status, setStatus] = useState('pending');
  const { data, reload } = useApi<{ galleries: any[] }>(`/admin/galleries${status ? `?status=${status}` : ''}`);
  const { error, run } = useAction(reload);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const patch = (id: number, body: object) => run(() => api(`/admin/galleries/${id}`, { method: 'PATCH', body }));
  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-2">
        {['pending', 'approved', 'rejected', 'suspended', ''].map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={`border px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] ${status === s ? 'border-gold text-gold' : 'border-line text-mute'}`}>{s || 'all'}</button>
        ))}
      </div>
      <ErrorNote error={error} />
      {!data ? <Spinner /> : data.galleries.length === 0 ? <Empty title="Nothing to review" /> : (
        <div className="space-y-4">
          {data.galleries.map((g) => (
            <div key={g.id} className="card flex flex-col gap-4 p-5 lg:flex-row lg:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="font-serif text-2xl">{g.name}</h3>
                  <StatusPill status={g.status} />
                  {g.featured && <span className="text-[10px] uppercase tracking-[0.2em] text-gold">★ Featured</span>}
                </div>
                <p className="mt-1 text-sm text-mute">{g.tagline || g.bio?.slice(0, 120)}</p>
                <p className="mt-1 text-xs text-faint">{g.owner.name} · {g.owner.email} · {g.location} · {g.listingCount} listings · applied {date(g.createdAt)}</p>
              </div>
              <div className="flex flex-col gap-2 lg:w-[420px]">
                <input value={notes[g.id] ?? ''} onChange={(e) => setNotes({ ...notes, [g.id]: e.target.value })} placeholder="Note to vendor (optional)" className="field py-2 text-xs" />
                <div className="flex flex-wrap gap-2">
                  {g.status !== 'approved' && <button onClick={() => patch(g.id, { status: 'approved', reviewNote: notes[g.id] })} className="btn-gold btn-sm">Approve</button>}
                  {g.status === 'pending' && <button onClick={() => patch(g.id, { status: 'rejected', reviewNote: notes[g.id] })} className="btn-ghost btn-sm">Reject</button>}
                  {g.status === 'approved' && <button onClick={() => patch(g.id, { status: 'suspended', reviewNote: notes[g.id] })} className="btn-ghost btn-sm">Suspend</button>}
                  {g.status === 'approved' && <button onClick={() => patch(g.id, { featured: !g.featured })} className="btn-outline btn-sm">{g.featured ? 'Unfeature' : 'Feature'}</button>}
                  {g.status === 'approved' && <Link to={`/galleries/${g.slug}`} className="btn-ghost btn-sm">View</Link>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TaxonomyTab() {
  const { data, reload } = useApi<{ categories: any[] }>('/admin/categories');
  const catalog = useCategories();
  const { error, run } = useAction(() => {
    reload();
    catalog.reload();
  });
  const [form, setForm] = useState({ name: '', parentId: '' });
  if (!data) return <Spinner />;
  const pending = data.categories.filter((c) => c.status === 'pending');
  const roots = data.categories.filter((c) => c.parentId == null);
  const nameOf = (id: number) => data.categories.find((c) => c.id === id)?.name;
  const patch = (id: number, body: object) => run(() => api(`/admin/categories/${id}`, { method: 'PATCH', body }));
  return (
    <div className="space-y-12">
      <ErrorNote error={error} />
      <section>
        <h3 className="mb-4 text-2xl">User-suggested categories</h3>
        {pending.length === 0 ? <p className="text-sm text-faint">No suggestions awaiting review.</p> : (
          <div className="space-y-3">
            {pending.map((c) => (
              <div key={c.id} className="card flex flex-wrap items-center gap-4 border-gold/40 p-4">
                <div className="flex-1">
                  <div className="font-serif text-xl">{nameOf(c.parentId)} <span className="text-faint">/</span> <span className="text-gold">{c.name}</span></div>
                  <div className="text-xs text-faint">Suggested by {c.suggestedBy ?? 'unknown'} · {c.listingCount} listing(s) filed here · {date(c.createdAt)}</div>
                </div>
                <button onClick={() => patch(c.id, { status: 'approved' })} className="btn-gold btn-sm">Approve</button>
                <button onClick={() => patch(c.id, { status: 'rejected' })} className="btn-ghost btn-sm">Reject → move to parent</button>
              </div>
            ))}
          </div>
        )}
      </section>
      <div className="grid gap-10 lg:grid-cols-[2fr_1fr]">
        <section>
          <h3 className="mb-4 text-2xl">Taxonomy</h3>
          <div className="grid gap-px border border-line bg-line sm:grid-cols-2">
            {roots.map((r) => (
              <div key={r.id} className="bg-ink p-5 sm:last:odd:col-span-2">
                <div className="flex items-baseline justify-between">
                  <span className="font-serif text-xl">{r.name}</span>
                  <span className="text-xs text-faint">{r.listingCount}</span>
                </div>
                <ul className="mt-3 space-y-1 text-sm">
                  {data.categories.filter((c) => c.parentId === r.id).map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2">
                      <span className={c.status === 'approved' ? 'text-mute' : 'text-faint line-through'}>{c.name}</span>
                      <span className="flex items-center gap-2">
                        {c.status !== 'approved' && <StatusPill status={c.status} />}
                        <span className="text-xs text-faint">{c.listingCount}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
        <form
          className="card h-fit space-y-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => api('/admin/categories', { body: { name: form.name, parentId: form.parentId ? Number(form.parentId) : null } }).then(() => setForm({ name: '', parentId: '' })));
          }}
        >
          <h3 className="text-2xl">Add category</h3>
          <Field label="Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="field" required minLength={2} /></Field>
          <Field label="Parent">
            <select value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })} className="field">
              <option value="">— Root category —</option>
              {roots.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
          <button className="btn-outline btn-sm">Create</button>
        </form>
      </div>
    </div>
  );
}

function DisputesTab() {
  const { data } = useApi<{ disputes: any[] }>('/admin/disputes');
  if (!data) return <Spinner />;
  if (!data.disputes.length) return <Empty title="No disputes" />;
  return (
    <div className="space-y-4">
      {data.disputes.map((d) => (
        <div key={d.id} className={`card p-5 ${d.status === 'open' ? 'border-bad/40' : ''}`}>
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-serif text-xl">{d.order.listing?.title}</span>
            <StatusPill status={d.status} />
            <OrderPill status={d.order.status} />
            <Link to={`/orders/${d.order.id}`} className="btn-outline btn-sm ml-auto">{d.status === 'open' ? 'Review & resolve' : 'View order'}</Link>
          </div>
          <p className="mt-3 text-sm text-bone">“{d.reason}”</p>
          <p className="mt-2 text-xs text-faint">
            {d.order.reference} · {d.gallery} · opened by {d.openedBy} on {date(d.createdAt)} · {money(d.order.totalCents)} frozen in escrow
          </p>
          {d.resolution && <p className="mt-2 border-l border-line pl-3 text-xs text-mute">Resolution: {d.resolution}</p>}
        </div>
      ))}
    </div>
  );
}

function OrdersTab() {
  const [status, setStatus] = useState('');
  const { data } = useApi<{ orders: Order[] }>(`/admin/orders${status ? `?status=${status}` : ''}`);
  return (
    <div>
      <select value={status} onChange={(e) => setStatus(e.target.value)} className="field mb-6 w-auto py-2 text-xs" aria-label="Filter by status">
        <option value="">All statuses</option>
        {(Object.keys(ORDER_STATUS) as OrderStatus[]).map((s) => <option key={s} value={s}>{ORDER_STATUS[s].label}</option>)}
      </select>
      {!data ? <Spinner /> : data.orders.length === 0 ? <Empty title="No orders" /> : <div className="border-t border-line">{data.orders.map((o) => <OrderRow key={o.id} order={o} />)}</div>}
    </div>
  );
}

function PayoutsTab({ canProcess }: { canProcess: boolean }) {
  const { data, reload } = useApi<{ payouts: any[] }>('/admin/payouts');
  const { error, run } = useAction(reload);
  if (!data) return <Spinner />;
  const patch = (id: number, status: string) => run(() => api(`/admin/payouts/${id}`, { method: 'PATCH', body: { status } }));
  return (
    <div>
      {!canProcess && <p className="mb-4 text-sm text-faint">Read-only: only Super-Admins can process payouts.</p>}
      <ErrorNote error={error} />
      {data.payouts.length === 0 ? <Empty title="No payout requests" /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-line text-left text-[10px] uppercase tracking-[0.18em] text-faint">
              <tr><th className="py-3 font-normal">Gallery</th><th className="font-normal">Requested</th><th className="font-normal">Method</th><th className="text-right font-normal">Amount</th><th className="font-normal" /><th /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.payouts.map((p) => (
                <tr key={p.id}>
                  <td className="py-3 font-serif text-base">{p.gallery}</td>
                  <td className="text-mute">{date(p.createdAt)}</td>
                  <td className="capitalize text-faint">{p.method.replace('_', ' ')} · {p.destination}</td>
                  <td className="text-right tabular-nums text-gold">{money(p.amountCents, 'USD', { decimals: true })}</td>
                  <td className="pl-4"><StatusPill status={p.status} /></td>
                  <td className="space-x-2 whitespace-nowrap py-2 text-right">
                    {canProcess && p.status === 'requested' && <button onClick={() => patch(p.id, 'approved')} className="btn-outline btn-sm">Approve</button>}
                    {canProcess && p.status === 'approved' && <button onClick={() => patch(p.id, 'paid')} className="btn-gold btn-sm">Mark paid</button>}
                    {canProcess && ['requested', 'approved'].includes(p.status) && <button onClick={() => patch(p.id, 'rejected')} className="btn-ghost btn-sm">Reject</button>}
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

function UsersTab() {
  const [q, setQ] = useState('');
  const { data, reload } = useApi<{ users: { id: number; name: string; email: string; role: Role; status: string; createdAt: string }[] }>(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  const { error, run } = useAction(reload);
  const { user: me } = useAuth();
  return (
    <div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" className="field mb-6 max-w-sm" />
      <ErrorNote error={error} />
      {!data ? <Spinner /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-line text-left text-[10px] uppercase tracking-[0.18em] text-faint">
              <tr><th className="py-3 font-normal">User</th><th className="font-normal">Joined</th><th className="font-normal">Role</th><th className="font-normal">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.users.map((u) => (
                <tr key={u.id}>
                  <td className="py-3"><div className="text-bone">{u.name}</div><div className="text-xs text-faint">{u.email}</div></td>
                  <td className="text-mute">{date(u.createdAt)}</td>
                  <td>
                    <select value={u.role} disabled={u.id === me?.id} onChange={(e) => run(() => api(`/admin/users/${u.id}`, { method: 'PATCH', body: { role: e.target.value } }))} className="field w-auto py-1.5 text-xs">
                      {['buyer', 'seller', 'subadmin', 'superadmin'].map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td>
                    <button disabled={u.id === me?.id} onClick={() => run(() => api(`/admin/users/${u.id}`, { method: 'PATCH', body: { status: u.status === 'active' ? 'suspended' : 'active' } }))} className="disabled:opacity-40">
                      <StatusPill status={u.status === 'active' ? 'active' : 'suspended'} />
                    </button>
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

function AuditTab() {
  const [entity, setEntity] = useState('');
  const [page, setPage] = useState(1);
  const { data } = useApi<{ logs: any[]; total: number; pageSize: number }>(`/admin/audit?page=${page}${entity ? `&entityType=${entity}` : ''}`);
  const ledger = useApi<{ ledger: any[] }>('/admin/ledger');
  return (
    <div className="grid gap-10 xl:grid-cols-[2fr_1fr]">
      <section>
        <div className="mb-4 flex items-center gap-3">
          <h3 className="text-2xl">Audit trail</h3>
          <select value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }} className="field ml-auto w-auto py-1.5 text-xs" aria-label="Filter entity">
            <option value="">All entities</option>
            {['order', 'gallery', 'listing', 'category', 'payout', 'user', 'question', 'system'].map((e) => <option key={e}>{e}</option>)}
          </select>
        </div>
        {!data ? <Spinner /> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-xs">
                <tbody className="divide-y divide-line border-y border-line">
                  {data.logs.map((l) => (
                    <tr key={l.id} className="align-top">
                      <td className="whitespace-nowrap py-2.5 pr-4 text-faint">{date(l.createdAt, true)}</td>
                      <td className="py-2.5 pr-4"><span className="font-mono text-gold">{l.action}</span></td>
                      <td className="py-2.5 pr-4 text-mute">{l.actor ?? 'system'}{l.actorRole ? <span className="text-faint"> · {l.actorRole}</span> : null}</td>
                      <td className="py-2.5 pr-4 text-faint">{l.entityType}#{l.entityId ?? '—'}</td>
                      <td className="max-w-[260px] truncate py-2.5 font-mono text-faint" title={JSON.stringify(l.metadata)}>{l.metadata ? JSON.stringify(l.metadata) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex items-center gap-4 text-xs text-faint">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="btn-ghost btn-sm">Newer</button>
              <span>Page {page} of {Math.max(1, Math.ceil(data.total / data.pageSize))}</span>
              <button disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)} className="btn-ghost btn-sm">Older</button>
            </div>
          </>
        )}
      </section>
      <section>
        <h3 className="mb-4 text-2xl">Escrow ledger</h3>
        <div className="divide-y divide-line border-y border-line text-xs">
          {ledger.data?.ledger.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-3 py-2.5">
              <div>
                <div className="capitalize text-mute">{t.type}</div>
                <div className="font-mono text-faint">{t.orderReference}</div>
              </div>
              <div className={`tabular-nums ${t.type === 'commission' ? 'text-gold' : t.type === 'refund' ? 'text-warn' : 'text-bone'}`}>{money(t.amountCents, 'USD', { decimals: true })}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default function AdminDashboard() {
  useDocumentTitle('Admin control panel');
  const { user, can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'overview';
  const overview = useApi<Overview>(`/admin/overview?t=${tab}`);
  const go = (t: Tab) => setParams({ tab: t });
  const o = overview.data;

  return (
    <Page className="py-12">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-3">{user?.role === 'superadmin' ? 'Super-Admin' : 'Sub-Admin'} · control panel</div>
          <h1 className="text-5xl">Marketplace administration</h1>
        </div>
      </div>
      <Tabs<Tab>
        value={tab}
        onChange={go}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'vendors', label: 'Vendors', badge: o?.pendingGalleries },
          { id: 'taxonomy', label: 'Taxonomy', badge: o?.pendingCategories },
          { id: 'disputes', label: 'Disputes', badge: o?.openDisputes },
          { id: 'orders', label: 'Orders' },
          { id: 'payouts', label: 'Payouts', badge: can('payout:process') ? o?.pendingPayouts : undefined },
          ...(can('user:manage') ? [{ id: 'users' as Tab, label: 'Users' }] : []),
          { id: 'audit', label: 'Audit & ledger' },
        ]}
      />
      {tab === 'overview' && (o ? <OverviewTab data={o} go={go} /> : <Spinner />)}
      {tab === 'vendors' && <VendorsTab />}
      {tab === 'taxonomy' && <TaxonomyTab />}
      {tab === 'disputes' && <DisputesTab />}
      {tab === 'orders' && <OrdersTab />}
      {tab === 'payouts' && <PayoutsTab canProcess={can('payout:process')} />}
      {tab === 'users' && can('user:manage') && <UsersTab />}
      {tab === 'audit' && <AuditTab />}
    </Page>
  );
}
