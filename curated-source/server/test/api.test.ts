import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import sharp from 'sharp';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'curated-test-'));
process.env.DATABASE_PATH = path.join(tmp, 'test.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.MAX_FAILED_LOGINS = '5';
process.env.MAX_FAILED_LOGINS_PER_IP = '1000';
process.env.GOOGLE_CLIENT_ID = 'test-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

const { db } = await import('../db/client');
const { runMigrations } = await import('../db/migrate');
const { createApp } = await import('../app');
const { users, categories } = await import('../db/schema');
const { hashPassword } = await import('../lib/auth');
const { setOAuthHttp } = await import('../routes/oauth');
const { setStripeClient } = await import('../lib/payments');
const { default: Stripe } = await import('stripe');

let server: Server;
let base = '';

async function api(method: string, url: string, body?: unknown, token?: string) {
  const isForm = body instanceof FormData;
  const res = await fetch(base + '/api' + url, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body && !isForm ? { 'content-type': 'application/json' } : {}) },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  return { status: res.status, body: (await res.json()) as any };
}

const login = async (email: string) => (await api('POST', '/auth/login', { email, password: 'Password#1' })).body.token as string;

before(async () => {
  runMigrations(db);
  const pw = await hashPassword('Password#1');
  db.insert(users).values([
    { email: 'admin@t.io', name: 'Admin', role: 'superadmin', passwordHash: pw },
    { email: 'mod@t.io', name: 'Mod', role: 'subadmin', passwordHash: pw },
  ]).run();
  const root = db.insert(categories).values({ name: 'Painting', slug: 'painting' }).returning().get();
  db.insert(categories).values({ name: 'Oil', slug: 'oil', parentId: root.id }).run();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('full marketplace lifecycle: onboarding → listing → escrow → payout', async () => {
  // Seller onboarding
  const reg = await api('POST', '/auth/register', { name: 'Sam Seller', email: 'seller@t.io', password: 'Password#1', country: 'FR' });
  assert.equal(reg.status, 201);
  let sellerToken = reg.body.token;
  assert.equal((await api('GET', '/vendor/listings', undefined, sellerToken)).status, 403, 'buyers cannot manage listings');
  const apply = await api('POST', '/vendor/apply', { name: 'Test Gallery', country: 'FR', acceptTerms: true }, sellerToken);
  assert.equal(apply.status, 201);
  sellerToken = await login('seller@t.io');

  // Upload with automatic thumbnail generation
  const png = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#D4AF37' } }).png().toBuffer();
  const form = new FormData();
  form.append('files', new Blob([png], { type: 'image/png' }), 'art.png');
  const up = await api('POST', '/vendor/uploads', form, sellerToken);
  assert.equal(up.status, 201);
  assert.equal(up.body.media[0].width, 2400);
  assert.ok(fs.existsSync(path.join(process.env.UPLOAD_DIR!, path.basename(up.body.media[0].thumbUrl))));

  // Listing with a user-suggested category
  const cats = (await api('GET', '/categories')).body.categories;
  const created = await api(
    'POST',
    '/vendor/listings',
    {
      title: 'Gold Field',
      artist: 'A. Painter',
      medium: 'Oil on canvas',
      priceCents: 100_000,
      shippingDomesticCents: 5_000,
      shippingInternationalCents: 20_000,
      suggestedCategory: { parentId: cats[0].id, name: 'Encaustic' },
      media: up.body.media,
    },
    sellerToken,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const listing = created.body.listing;

  // Not public until the gallery is approved
  assert.equal((await api('GET', `/listings/${listing.slug}`)).status, 404);
  const modToken = await login('mod@t.io');
  const pending = (await api('GET', '/admin/galleries?status=pending', undefined, modToken)).body.galleries;
  assert.equal((await api('PATCH', `/admin/galleries/${pending[0].id}`, { status: 'approved' }, modToken)).status, 200);
  assert.equal((await api('GET', `/listings/${listing.slug}`)).status, 200);
  assert.equal((await api('GET', '/listings?category=painting')).body.total, 1, 'pending subcategory rolls up into its parent');

  // Taxonomy moderation
  const adminCats = (await api('GET', '/admin/categories', undefined, modToken)).body.categories;
  const suggestion = adminCats.find((c: any) => c.status === 'pending');
  assert.equal(suggestion.name, 'Encaustic');
  assert.equal((await api('PATCH', `/admin/categories/${suggestion.id}`, { status: 'approved' }, modToken)).body.category.slug, 'encaustic');

  // Search autocomplete
  assert.ok((await api('GET', '/search/suggest?q=gold')).body.results.some((r: any) => r.type === 'listing'));

  // Buyer checkout (international shipping, FR origin → US)
  const buyerToken = (await api('POST', '/auth/register', { name: 'Bea Buyer', email: 'buyer@t.io', password: 'Password#1', country: 'US' })).body.token;
  const quote = await api('GET', `/listings/${listing.id}/shipping?country=US`);
  assert.deepEqual([quote.body.region, quote.body.shippingCents], ['international', 20_000]);
  const address = { fullName: 'Bea Buyer', line1: '1 Main St', city: 'Boston', postalCode: '02110', country: 'US' };
  assert.equal((await api('POST', '/orders', { listingId: listing.id, shippingAddress: address }, buyerToken)).status, 400, 'terms must be accepted');
  const order = (await api('POST', '/orders', { listingId: listing.id, shippingAddress: address, acceptTerms: true }, buyerToken)).body.order;
  assert.equal(order.status, 'pending');
  assert.equal(order.totalCents, 120_000);
  assert.equal((await api('POST', '/orders', { listingId: listing.id, shippingAddress: address, acceptTerms: true }, buyerToken)).status, 409, 'reserved listing cannot be bought twice');

  const act = (a: string, token: string, body?: object) => api('POST', `/orders/${order.id}/actions/${a}`, body ?? {}, token);
  assert.equal((await act('dispatch', sellerToken, { carrier: 'DHL', trackingNumber: 'X' })).status, 400, 'cannot dispatch before payment');
  assert.equal((await act('pay', sellerToken)).status, 403, 'seller cannot pay for buyer');
  assert.equal((await act('pay', buyerToken)).body.order.status, 'in_escrow');
  assert.equal((await act('dispatch', sellerToken, { carrier: 'DHL Express', trackingNumber: 'x1' })).status, 400, 'implausible tracking number');
  assert.equal((await act('dispatch', sellerToken, { carrier: 'DHL Express', trackingNumber: '12 3456 7890' })).body.order.status, 'dispatched');
  const shipped = (await api('GET', `/orders/${order.id}`, undefined, buyerToken)).body.order;
  assert.equal(shipped.trackingNumber, '1234567890', 'spaces are stripped');
  assert.match(shipped.trackingUrl, /dhl\.com.*tracking-id=1234567890/, 'buyer gets a DHL tracking link');
  assert.equal((await act('confirm_delivery', buyerToken)).body.order.status, 'delivered');

  // Dispute → admin resolves in seller's favour
  assert.equal((await act('dispute', buyerToken, { reason: 'Frame corner is chipped on arrival' })).body.order.status, 'disputed');
  assert.equal((await act('resolve_release', buyerToken)).status, 403);
  assert.equal((await act('resolve_release', modToken, { note: 'Damage pre-existing per condition report' })).body.order.status, 'released');

  const detail = (await api('GET', `/orders/${order.id}`, undefined, buyerToken)).body.order;
  assert.deepEqual(detail.ledger.map((t: any) => t.type), ['hold', 'release', 'commission']);
  assert.equal(detail.ledger[1].amountCents + detail.ledger[2].amountCents, 120_000);
  assert.equal(detail.canReview, true);
  assert.equal((await api('POST', `/orders/${order.id}/review`, { rating: 5, body: 'Superb' }, buyerToken)).status, 201);

  // Payouts: balance-limited; only super-admin can process
  const bal = (await api('GET', '/vendor/payouts', undefined, sellerToken)).body.balance;
  assert.equal(bal.availableCents, 120_000 - 15_000, '15% commission on the $1,000 price, none on shipping');
  assert.equal((await api('POST', '/vendor/payouts', { amountCents: bal.availableCents + 1, method: 'wire', destination: 'FR76 0000' }, sellerToken)).status, 400);
  const payout = (await api('POST', '/vendor/payouts', { amountCents: 50_000, method: 'wire', destination: 'FR76 0000' }, sellerToken)).body.payout;
  assert.equal((await api('PATCH', `/admin/payouts/${payout.id}`, { status: 'approved' }, modToken)).status, 403);
  const adminToken = await login('admin@t.io');
  assert.equal((await api('PATCH', `/admin/payouts/${payout.id}`, { status: 'approved' }, adminToken)).status, 200);
  assert.equal((await api('PATCH', `/admin/payouts/${payout.id}`, { status: 'paid' }, adminToken)).body.balance.availableCents, 55_000);

  // Audit trail captured the sensitive actions
  const logs = (await api('GET', '/admin/audit', undefined, modToken)).body.logs.map((l: any) => l.action);
  const accepted = (await api('GET', '/admin/audit?action=order.create', undefined, modToken)).body.logs[0].metadata.acceptedPolicies;
  assert.ok(accepted, 'policy version recorded with the order');
  for (const a of ['gallery.approved', 'category.approved', 'order.pay', 'order.resolve_release', 'payout.paid']) assert.ok(logs.includes(a), a);
});

test('price cap: listings and linked purchases stay under the AML threshold', async () => {
  const seller = await login('seller@t.io');
  const buyer = await login('buyer@t.io');
  const cats = (await api('GET', '/categories')).body.categories;
  const media = (await api('GET', '/vendor/listings', undefined, seller)).body.listings[0].cover;
  const base = { artist: 'A. Painter', medium: 'Oil', shippingDomesticCents: 0, shippingInternationalCents: 0, categoryId: cats[0].id, media: [media] };
  const create = (title: string, priceCents: number) => api('POST', '/vendor/listings', { ...base, title, priceCents }, seller);

  assert.equal((await create('Too Dear', 1_000_001)).status, 400, 'listing above $10,000 is rejected');
  const a = (await create('Study A', 600_000)).body.listing;
  const b = (await create('Study B', 500_000)).body.listing;
  const address = { fullName: 'Bea Buyer', line1: '1 Main St', city: 'Boston', postalCode: '02110', country: 'US' };
  const order = (id: number) => api('POST', '/orders', { listingId: id, shippingAddress: address, acceptTerms: true }, buyer);

  assert.equal((await order(a.id)).status, 201);
  const linked = await order(b.id);
  assert.equal(linked.status, 400, 'second purchase from the same gallery would exceed the 90-day limit');
  assert.match(linked.body.error, /90 days/);
});

test('account security: password and email changes, session revocation, lockout', async () => {
  const oldToken = await login('buyer@t.io');
  assert.equal((await api('POST', '/auth/change-password', { currentPassword: 'wrong', newPassword: 'NewPassword#2' }, oldToken)).status, 400);
  const changed = await api('POST', '/auth/change-password', { currentPassword: 'Password#1', newPassword: 'NewPassword#2' }, oldToken);
  assert.equal(changed.status, 200);
  assert.equal((await api('GET', '/auth/me', undefined, oldToken)).status, 401, 'old sessions are signed out');
  assert.equal((await api('GET', '/auth/me', undefined, changed.body.token)).status, 200, 'the current session keeps working');

  const moved = await api('POST', '/auth/change-email', { currentPassword: 'NewPassword#2', newEmail: 'bea@t.io' }, changed.body.token);
  assert.equal(moved.body.user.email, 'bea@t.io');
  assert.equal((await api('POST', '/auth/change-email', { currentPassword: 'NewPassword#2', newEmail: 'admin@t.io' }, changed.body.token)).status, 409);

  // Staff need 12+ character passwords.
  const mod = await login('mod@t.io');
  assert.equal((await api('POST', '/auth/change-password', { currentPassword: 'Password#1', newPassword: 'Short#12' }, mod)).status, 400);

  // Lockout after MAX_FAILED_LOGINS (5 in tests): even the right password is refused until unlocked.
  for (let i = 0; i < 4; i++) assert.equal((await api('POST', '/auth/login', { email: 'bea@t.io', password: 'nope' })).status, 401);
  assert.equal((await api('POST', '/auth/login', { email: 'bea@t.io', password: 'nope' })).status, 423);
  assert.equal((await api('POST', '/auth/login', { email: 'bea@t.io', password: 'NewPassword#2' })).status, 423);
  const admin = await login('admin@t.io');
  const listed = (await api('GET', '/admin/users?q=bea', undefined, admin)).body.users[0];
  assert.ok(listed.lockedUntil, 'admins can see the lock');
  assert.equal((await api('PATCH', `/admin/users/${listed.id}`, { unlock: true }, admin)).status, 200);
  assert.equal((await api('POST', '/auth/login', { email: 'bea@t.io', password: 'NewPassword#2' })).status, 200);
});

test('gallery controls: order, hide, delete, price on request, enquiries, banner', async () => {
  const seller = await login('seller@t.io');
  const cats = (await api('GET', '/categories')).body.categories;
  const media = (await api('GET', '/vendor/listings', undefined, seller)).body.listings[0].cover;
  const make = async (title: string, extra: object = {}) =>
    (await api('POST', '/vendor/listings', { title, artist: 'A. Painter', medium: 'Oil', priceCents: 200_000, shippingDomesticCents: 0, shippingInternationalCents: 0, categoryId: cats[0].id, media: [media], ...extra }, seller)).body.listing;
  const a = await make('Order A');
  const b = await make('Order B');
  const por = await make('Secret Price', { priceOnRequest: true, priceCents: 0 });
  const slug = (await api('GET', '/vendor/gallery', undefined, seller)).body.gallery.slug;
  const publicTitles = async () => (await api('GET', `/galleries/${slug}`)).body.listings.map((l: any) => l.title);

  // New works go first; a saved order is used on the public gallery page.
  assert.deepEqual((await publicTitles()).slice(0, 3), ['Secret Price', 'Order B', 'Order A']);
  const ids = (await api('GET', '/vendor/listings', undefined, seller)).body.listings.map((l: any) => l.id);
  const reordered = [a.id, ...ids.filter((id: number) => id !== a.id)];
  assert.equal((await api('PUT', '/vendor/listings/order', { ids: reordered }, seller)).status, 200);
  assert.equal((await publicTitles())[0], 'Order A');
  assert.equal((await api('PUT', '/vendor/listings/order', { ids: [999_999] }, seller)).status, 400, 'only own listings');

  // Hide / show
  await api('PATCH', `/vendor/listings/${b.id}`, { status: 'hidden' }, seller);
  assert.ok(!(await publicTitles()).includes('Order B'));
  assert.equal((await api('GET', `/listings/${b.slug}`)).status, 404, 'hidden works are not public');
  await api('PATCH', `/vendor/listings/${b.id}`, { status: 'active' }, seller);
  assert.ok((await publicTitles()).includes('Order B'));

  // Price on request: no public price, no checkout, private enquiries
  assert.equal((await api('POST', '/vendor/listings', { title: 'No price', artist: 'A', medium: 'Oil', priceCents: 0, shippingDomesticCents: 0, shippingInternationalCents: 0, categoryId: cats[0].id, media: [media] }, seller)).status, 400);
  const pub = (await api('GET', `/listings/${por.slug}`)).body.listing;
  assert.equal(pub.priceOnRequest, true);
  assert.equal(pub.priceCents, 0);
  const buyer = (await api('POST', '/auth/register', { name: 'Ena Quiry', email: 'ena@t.io', password: 'Password#1' })).body.token;
  const address = { fullName: 'Ena', line1: '1 St', city: 'Leeds', postalCode: 'LS1', country: 'GB' };
  assert.equal((await api('POST', '/orders', { listingId: por.id, shippingAddress: address, acceptTerms: true }, buyer)).status, 400);
  assert.equal((await api('POST', `/listings/${a.id}/enquiries`, { message: 'Is this still available?' }, buyer)).status, 400, 'priced works are bought online');
  assert.equal((await api('POST', `/listings/${por.id}/enquiries`, { message: 'Could you share the price please?' }, buyer)).status, 201);
  const inbox = (await api('GET', '/vendor/enquiries', undefined, seller)).body;
  assert.equal(inbox.unread, 1);
  assert.equal(inbox.enquiries[0].buyerEmail, 'ena@t.io');
  assert.equal((await api('PATCH', `/vendor/enquiries/${inbox.enquiries[0].id}`, { status: 'replied' }, seller)).status, 200);

  // Banner: one of the gallery's own works
  assert.equal((await api('PATCH', '/vendor/gallery', { bannerListingId: a.id }, seller)).status, 200);
  const g = (await api('GET', `/galleries/${slug}`)).body.gallery;
  assert.equal(g.bannerWork.slug, a.slug);
  assert.ok(g.bannerUrl.startsWith('/uploads/'));

  // Delete: works with orders are kept; others are removed and leave the banner
  const sold = (await api('GET', '/vendor/listings', undefined, seller)).body.listings.find((l: any) => l.title === 'Gold Field');
  assert.equal((await api('DELETE', `/vendor/listings/${sold.id}`, undefined, seller)).status, 409);
  assert.equal((await api('DELETE', `/vendor/listings/${a.id}`, undefined, seller)).status, 200);
  assert.equal((await api('GET', `/listings/${a.slug}`)).status, 404);
  assert.equal((await api('GET', `/galleries/${slug}`)).body.gallery.bannerWork, null);
});

/** In-memory stand-in for the Stripe API: records calls, returns plausible objects. */
function fakeStripe() {
  const sessions = new Map<string, any>();
  const calls = { sessions: [] as any[], refunds: [] as any[], transfers: [] as any[], accounts: [] as any[], expired: [] as string[] };
  const account = { active: false };
  let n = 0;
  const fake: any = {
    checkout: {
      sessions: {
        create: async (p: any) => {
          const id = `cs_${++n}`;
          const s = { id, url: `https://checkout.stripe.test/${id}`, status: 'open', payment_status: 'unpaid', payment_intent: null, metadata: p.metadata, client_reference_id: p.client_reference_id };
          sessions.set(id, s);
          calls.sessions.push(p);
          return s;
        },
        retrieve: async (id: string) => sessions.get(id),
        expire: async (id: string) => {
          calls.expired.push(id);
          return Object.assign(sessions.get(id), { status: 'expired' });
        },
      },
    },
    charges: {
      list: async (p: any) => ({ data: [{ id: `ch_${p.payment_intent}` }] }),
      retrieve: async (id: string) => ({ id, balance_transaction: { currency: 'gbp', exchange_rate: 0.8 } }),
    },
    refunds: { create: async (p: any) => (calls.refunds.push(p), { id: `re_${++n}` }) },
    transfers: { create: async (p: any) => (calls.transfers.push(p), { id: `tr_${++n}` }) },
    accounts: {
      create: async (p: any) => (calls.accounts.push(p), { id: 'acct_gallery' }),
      retrieve: async () => ({
        capabilities: { transfers: account.active ? 'active' : 'inactive' },
        payouts_enabled: account.active,
        details_submitted: account.active,
        requirements: { currently_due: account.active ? [] : ['external_account'] },
      }),
      createLoginLink: async () => ({ url: 'https://connect.stripe.test/express' }),
    },
    accountLinks: { create: async () => ({ url: 'https://connect.stripe.test/onboarding' }) },
    webhooks: new Stripe('sk_test_unused').webhooks,
  };
  /** Marks a Checkout page as paid, as if the buyer had completed it. */
  const pay = (id: string) => Object.assign(sessions.get(id), { status: 'complete', payment_status: 'paid', payment_intent: `pi_${id}` });
  return { fake, calls, account, pay, sessions };
}

test('Stripe payments: checkout, webhook, escrow, refund, cancel, gallery payouts', async () => {
  const { fake, calls, account, pay } = fakeStripe();
  setStripeClient(fake);
  try {
    assert.equal((await api('GET', '/config')).body.payments, 'stripe');
    const seller = await login('seller@t.io');
    const buyer = (await api('POST', '/auth/register', { name: 'Cleo Collector', email: 'cleo@t.io', password: 'Password#1', country: 'US' })).body.token;
    const cats = (await api('GET', '/categories')).body.categories;
    const media = (await api('GET', '/vendor/listings', undefined, seller)).body.listings[0].cover;
    let n = 0;
    const newListing = async () =>
      (await api('POST', '/vendor/listings', { title: `Stripe Study ${++n}`, artist: 'A. Painter', medium: 'Oil', priceCents: 300_000, shippingDomesticCents: 0, shippingInternationalCents: 20_000, categoryId: cats[0].id, media: [media] }, seller)).body.listing;
    const address = { fullName: 'Bea Buyer', line1: '1 Main St', city: 'Boston', postalCode: '02110', country: 'US' };
    const place = async () => {
      const listing = await newListing();
      const r = await api('POST', '/orders', { listingId: listing.id, shippingAddress: address, acceptTerms: true }, buyer);
      assert.equal(r.status, 201, JSON.stringify(r.body));
      return r.body.order;
    };
    const act = (id: number, a: string, token: string, body?: object) => api('POST', `/orders/${id}/actions/${a}`, body ?? {}, token);
    const status = async (id: number) => (await api('GET', `/orders/${id}`, undefined, buyer)).body.order;

    // 1. Checkout: the demo "pay" button is refused; the buyer gets Stripe's page, reused if opened twice.
    const o1 = await place();
    assert.equal((await act(o1.id, 'pay', buyer)).status, 400);
    assert.equal((await api('POST', `/orders/${o1.id}/checkout`, {}, seller)).status, 404, 'only the buyer can pay');
    const url = (await api('POST', `/orders/${o1.id}/checkout`, {}, buyer)).body.url;
    assert.match(url, /checkout\.stripe\.test/);
    assert.equal((await api('POST', `/orders/${o1.id}/checkout`, {}, buyer)).body.url, url, 'no second payment page');
    const params = calls.sessions[0];
    assert.deepEqual(params.line_items.map((l: any) => l.price_data.unit_amount), [300_000, 20_000]);
    assert.equal(params.payment_intent_data.transfer_group, o1.reference);

    // 2. Stripe's signed webhook confirms the payment; repeats are harmless; forged calls are refused.
    const sessionId = url.split('/').pop();
    const session = pay(sessionId);
    const payload = JSON.stringify({ id: 'evt_1', object: 'event', type: 'checkout.session.completed', data: { object: session } });
    const hook = (sig: string) => fetch(base + '/api/stripe/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': sig }, body: payload });
    assert.equal((await hook('t=1,v1=forged')).status, 400);
    const sig = fake.webhooks.generateTestHeaderString({ payload, secret: 'whsec_test' });
    assert.equal((await hook(sig)).status, 200);
    assert.equal((await hook(sig)).status, 200);
    const paid = await status(o1.id);
    assert.equal(paid.status, 'in_escrow');
    assert.equal(paid.ledger.filter((t: any) => t.type === 'hold').length, 1);
    assert.equal(paid.stripeChargeId, `ch_pi_${sessionId}`);

    // 3. Gallery connects Stripe (cross-border: FR gallery, GB platform → recipient agreement).
    assert.deepEqual((await api('GET', '/vendor/stripe', undefined, seller)).body, { enabled: true, connected: false, payoutsEnabled: false, detailsSubmitted: false });
    assert.match((await api('POST', '/vendor/stripe/onboard', {}, seller)).body.url, /onboarding/);
    assert.equal(calls.accounts[0].country, 'FR');
    assert.equal(calls.accounts[0].tos_acceptance.service_agreement, 'recipient');
    assert.equal((await api('POST', '/vendor/payouts', { amountCents: 5_000, method: 'wire', destination: 'FR76 0000' }, seller)).status, 400, 'no manual withdrawals');

    // 4. Released before the gallery finished sign-up: the transfer waits, then goes once Stripe enables it.
    await act(o1.id, 'dispatch', seller, { carrier: 'DHL Express', trackingNumber: '1234567890' });
    await act(o1.id, 'confirm_delivery', buyer);
    assert.equal((await act(o1.id, 'release', buyer)).body.order.status, 'released');
    assert.equal(calls.transfers.length, 0);
    account.active = true;
    assert.equal((await api('GET', '/vendor/stripe', undefined, seller)).body.payoutsEnabled, true);
    assert.equal(calls.transfers.length, 1);
    const share = 320_000 - 45_000;
    assert.deepEqual(
      [calls.transfers[0].amount, calls.transfers[0].currency, calls.transfers[0].destination, calls.transfers[0].source_transaction],
      [Math.floor(share * 0.8), 'gbp', 'acct_gallery', `ch_pi_${sessionId}`],
    );
    const stripePayout = (await api('GET', '/vendor/payouts', undefined, seller)).body.payouts.find((p: any) => p.method === 'stripe');
    assert.deepEqual([stripePayout.amountCents, stripePayout.status], [share, 'paid']);
    await api('GET', '/vendor/stripe', undefined, seller);
    assert.equal(calls.transfers.length, 1, 'never paid twice');

    // 5. Paid (confirmed when the buyer returns, no webhook), then declined: refunded to the card.
    const o2 = await place();
    pay((await api('POST', `/orders/${o2.id}/checkout`, {}, buyer)).body.url.split('/').pop());
    assert.equal((await api('POST', `/orders/${o2.id}/payment/sync`, {}, buyer)).body.status, 'in_escrow');
    assert.equal((await act(o2.id, 'decline', seller)).body.order.status, 'refunded');
    assert.equal(calls.refunds.length, 1);
    assert.equal(calls.refunds[0].payment_intent, (await status(o2.id)).stripePaymentIntentId);

    // 6. Cancelled before paying: Stripe's page is closed so it can no longer take money.
    const o3 = await place();
    const s3 = (await api('POST', `/orders/${o3.id}/checkout`, {}, buyer)).body.url.split('/').pop();
    assert.equal((await act(o3.id, 'cancel', buyer)).body.order.status, 'cancelled');
    assert.deepEqual(calls.expired, [s3]);

    // 7. Cancel after paying (webhook not yet arrived) is refused, and the payment is recorded instead.
    const o4 = await place();
    pay((await api('POST', `/orders/${o4.id}/checkout`, {}, buyer)).body.url.split('/').pop());
    assert.equal((await act(o4.id, 'cancel', buyer)).status, 409);
    assert.equal((await status(o4.id)).status, 'in_escrow');
    await act(o4.id, 'decline', seller);
  } finally {
    setStripeClient(null);
  }
});

test('Google sign-in: sign up, sign in again, link by email, staff refused, state checked', async () => {
  // Play Google's part: every authorization code maps to a Google profile.
  const profiles: Record<string, object> = {
    newbie: { sub: 'g-1', email: 'Newbie@Gmail.com', email_verified: true, name: 'New Collector' },
    seller: { sub: 'g-2', email: 'seller@t.io', email_verified: true, name: 'Sam' },
    staff: { sub: 'g-3', email: 'admin@t.io', email_verified: true, name: 'Admin' },
  };
  setOAuthHttp((async (url: string, init?: RequestInit) => {
    const reply = (body: object) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
      const code = new URLSearchParams(String(init?.body)).get('code')!;
      return reply({ access_token: `at-${code}` });
    }
    const code = String((init?.headers as Record<string, string>).authorization).replace('Bearer at-', '');
    return reply(profiles[code]);
  }) as typeof fetch);

  const signIn = async (code: string, opts: { tamper?: boolean } = {}) => {
    const start = await fetch(`${base}/api/auth/oauth/google/start?next=/vendor`, { redirect: 'manual' });
    const google = new URL(start.headers.get('location')!);
    assert.equal(google.host, 'accounts.google.com');
    assert.equal(google.searchParams.get('redirect_uri'), `${base}/api/auth/oauth/google/callback`);
    const cookie = start.headers.get('set-cookie')!.split(';')[0];
    const state = opts.tamper ? 'forged' : google.searchParams.get('state')!;
    const cb = await fetch(`${base}/api/auth/oauth/google/callback?code=${code}&state=${state}`, { redirect: 'manual', headers: { cookie } });
    const location = cb.headers.get('location')!;
    const fragment = new URLSearchParams(location.split('#')[1] ?? '');
    return { location, token: fragment.get('token'), next: fragment.get('next') };
  };

  assert.deepEqual((await api('GET', '/config')).body.oauthProviders, ['google']);

  const first = await signIn('newbie');
  assert.ok(first.location.startsWith('/auth/complete#'), first.location);
  assert.equal(first.next, '/vendor');
  const me = (await api('GET', '/auth/me', undefined, first.token!)).body.user;
  assert.equal(me.email, 'newbie@gmail.com');
  assert.equal(me.passwordSet, false);
  assert.equal(me.connected.google, true);
  assert.equal((await signIn('newbie')).token ? 'ok' : 'missing', 'ok', 'returning user signs straight in');

  // Google-only users choose a first password without knowing a current one.
  assert.equal((await api('POST', '/auth/change-password', { newPassword: 'Gallery-Lover-9' }, first.token!)).status, 200);
  assert.equal((await api('POST', '/auth/login', { email: 'newbie@gmail.com', password: 'Gallery-Lover-9' })).status, 200);

  const linked = await signIn('seller');
  assert.equal((await api('GET', '/auth/me', undefined, linked.token!)).body.user.role, 'seller', 'existing account is linked by email');

  const staff = await signIn('staff');
  assert.match(decodeURIComponent(staff.location), /Admin accounts must sign in with email and password/);
  const forged = await signIn('newbie', { tamper: true });
  assert.match(decodeURIComponent(forged.location), /session expired/);

  // Visitors on another host name (e.g. without www) are first sent to PUBLIC_URL.
  const { config } = await import('../config');
  config.publicUrl = 'https://www.example-art.shop';
  const hop = await fetch(`${base}/api/auth/oauth/google/start?next=/gallery`, { redirect: 'manual' });
  assert.equal(hop.headers.get('location'), 'https://www.example-art.shop/api/auth/oauth/google/start?next=/gallery');
  config.publicUrl = '';
});

test('RBAC guards', async () => {
  const buyer = (await api('POST', '/auth/login', { email: 'bea@t.io', password: 'NewPassword#2' })).body.token;
  assert.equal((await api('GET', '/admin/overview')).status, 401);
  assert.equal((await api('GET', '/admin/overview', undefined, buyer)).status, 403);
  const mod = await login('mod@t.io');
  assert.equal((await api('GET', '/admin/users', undefined, mod)).status, 403, 'sub-admins cannot manage users');
  const admin = await login('admin@t.io');
  assert.equal((await api('GET', '/admin/users', undefined, admin)).status, 200);
});
