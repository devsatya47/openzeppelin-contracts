/**
 * Stripe payments (marketplace model: "separate charges and transfers").
 *
 *   1. The buyer pays on Stripe's hosted Checkout page. The money lands in the platform's
 *      Stripe balance and the order moves to in_escrow (webhook, or the buyer's return visit).
 *   2. When escrow is released, the gallery's share (price + shipping − commission) is
 *      transferred to the gallery's Stripe Express account, which pays out to its bank.
 *   3. Declines and refunds send the full amount back to the buyer's card.
 *
 * Without STRIPE_SECRET_KEY everything here is switched off and checkout runs in demo mode.
 */
import Stripe from 'stripe';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { config } from '../config';
import { db } from '../db/client';
import { galleries, listings, orderEvents, orders, payouts, users } from '../db/schema';
import { SYSTEM, transitionOrder } from './escrow';
import { badRequest, conflict } from './errors';
import { nowIso } from './util';

type Order = typeof orders.$inferSelect;
type Gallery = typeof galleries.$inferSelect;

/** Minimal surface of the Stripe client we use, so tests can supply a fake. */
export type StripeLike = Pick<Stripe, 'checkout' | 'refunds' | 'transfers' | 'charges' | 'accounts' | 'accountLinks' | 'webhooks'>;

let client: StripeLike | null | undefined;

export function stripe(): StripeLike | null {
  if (client === undefined) client = config.stripe.secretKey ? new Stripe(config.stripe.secretKey) : null;
  return client;
}

/** Replaces the Stripe client (tests). Pass undefined to go back to the configured one. */
export function setStripeClient(c: StripeLike | null | undefined) {
  client = c;
}

export const paymentsEnabled = () => stripe() !== null;

/** Stripe needs a Checkout page to stay open for at least 30 minutes. */
const SESSION_MINUTES = 35;

const siteUrl = (fallback: string) => config.publicUrl || fallback;

/** Opens (or reuses) a Stripe Checkout page for a pending order and returns its address. */
export async function checkoutUrl(order: Order, origin: string): Promise<string> {
  const s = stripe();
  if (!s) throw badRequest('Online payments are not switched on yet');
  if (order.status !== 'pending') throw conflict('This order has already been paid or closed');

  // Never open a second payment page while one is still usable: the buyer could pay twice.
  if (order.stripeSessionId) {
    const existing = await s.checkout.sessions.retrieve(order.stripeSessionId);
    if (existing.status === 'complete') {
      await recordPayment(existing);
      throw conflict('This order has already been paid');
    }
    if (existing.status === 'open' && existing.url) return existing.url;
  }

  const listing = db.select().from(listings).where(eq(listings.id, order.listingId)).get()!;
  const gallery = db.select().from(galleries).where(eq(galleries.id, order.galleryId)).get()!;
  const buyer = db.select({ email: users.email }).from(users).where(eq(users.id, order.buyerId)).get()!;
  const base = siteUrl(origin);
  const currency = order.currency.toLowerCase();
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MINUTES * 60;

  const session = await s.checkout.sessions.create(
    {
      mode: 'payment',
      allowed_payment_method_types: ['card', 'link'], // instant methods only, so the escrow hold starts straight away
      customer_email: buyer.email,
      client_reference_id: String(order.id),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: order.priceCents,
            product_data: { name: `${listing.title} — ${listing.artist}`, description: `Offered by ${gallery.name}. Order ${order.reference}.` },
          },
        },
        ...(order.shippingCents > 0
          ? [
              {
                quantity: 1,
                price_data: {
                  currency,
                  unit_amount: order.shippingCents,
                  product_data: { name: `${order.shippingRegion === 'domestic' ? 'Domestic' : 'International'} insured shipping` },
                },
              },
            ]
          : []),
      ],
      payment_intent_data: {
        transfer_group: order.reference,
        description: `Curated Art order ${order.reference}`,
        metadata: { orderId: String(order.id), reference: order.reference },
      },
      metadata: { orderId: String(order.id), reference: order.reference },
      expires_at: expiresAt,
      success_url: `${base}/orders/${order.id}?paid=1`,
      cancel_url: `${base}/orders/${order.id}`,
    },
    { idempotencyKey: `checkout-${order.id}-${order.stripeSessionId ?? 'first'}` },
  );
  db.update(orders)
    .set({ stripeSessionId: session.id, paymentExpiresAt: new Date(expiresAt * 1000).toISOString(), updatedAt: nowIso() })
    .where(eq(orders.id, order.id))
    .run();
  return session.url!;
}

/** Applies a completed Checkout page to its order. Safe to call more than once. */
export async function recordPayment(session: Stripe.Checkout.Session) {
  if (session.payment_status !== 'paid') return null;
  const orderId = Number(session.metadata?.orderId ?? session.client_reference_id);
  const order = db.select().from(orders).where(eq(orders.id, orderId)).get();
  if (!order) return null;
  const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null;
  if (order.stripePaymentIntentId && order.status !== 'pending') return order; // already recorded

  let chargeId: string | null = null;
  if (paymentIntentId) {
    const charges = await stripe()!.charges.list({ payment_intent: paymentIntentId, limit: 1 });
    chargeId = charges.data[0]?.id ?? null;
  }
  db.update(orders)
    .set({ stripeSessionId: session.id, stripePaymentIntentId: paymentIntentId, stripeChargeId: chargeId })
    .where(eq(orders.id, order.id))
    .run();

  if (order.status === 'pending') {
    return transitionOrder(SYSTEM, order.id, 'pay', { note: 'Payment received by card and secured in escrow' });
  }
  // The reservation ended before the payment arrived (rare): give the money straight back.
  if (paymentIntentId) {
    const refund = await stripe()!.refunds.create(
      { payment_intent: paymentIntentId, metadata: { orderId: String(order.id), reason: 'reservation_expired' } },
      { idempotencyKey: `refund-late-${order.id}` },
    );
    db.update(orders).set({ stripeRefundId: refund.id, updatedAt: nowIso() }).where(eq(orders.id, order.id)).run();
    db.insert(orderEvents)
      .values({ orderId: order.id, status: order.status, note: 'Payment arrived after the reservation ended and was refunded in full' })
      .run();
  }
  return order;
}

/** Checks Stripe directly, for when the buyer returns before the webhook arrives. */
export async function syncPayment(order: Order) {
  const s = stripe();
  if (!s || !order.stripeSessionId || order.status !== 'pending') return;
  const session = await s.checkout.sessions.retrieve(order.stripeSessionId);
  if (session.status === 'complete') await recordPayment(session);
}

/**
 * Before a pending order is cancelled, closes its Stripe payment page.
 * Throws if the buyer has in fact already paid (the order is updated to in_escrow instead).
 */
export async function closeCheckout(order: Order) {
  const s = stripe();
  if (!s || !order.stripeSessionId) return;
  const session = await s.checkout.sessions.retrieve(order.stripeSessionId);
  if (session.status === 'complete') {
    await recordPayment(session);
    throw conflict('This order has already been paid. Ask the gallery to decline it if you need a refund.');
  }
  if (session.status === 'open') await s.checkout.sessions.expire(session.id);
}

/** Refunds the buyer in full. Call before the escrow refund transition. */
export async function refundPayment(order: Order) {
  const s = stripe();
  if (!s || !order.stripePaymentIntentId || order.stripeRefundId) return;
  const refund = await s.refunds.create(
    { payment_intent: order.stripePaymentIntentId, metadata: { orderId: String(order.id), reference: order.reference } },
    { idempotencyKey: `refund-${order.id}` },
  );
  db.update(orders).set({ stripeRefundId: refund.id }).where(eq(orders.id, order.id)).run();
}

/** Amount owed to the gallery for an order: price plus shipping, less the platform commission. */
const galleryShare = (o: Order) => o.totalCents - o.commissionCents;

/**
 * Sends the gallery's share of a released order to its Stripe account.
 * Leaves it for later (settlePendingTransfers) if the gallery hasn't finished Stripe sign-up yet.
 */
export async function transferToGallery(orderId: number) {
  const s = stripe();
  const order = db.select().from(orders).where(eq(orders.id, orderId)).get();
  if (!s || !order || order.status !== 'released' || !order.stripeChargeId || order.stripeTransferId) return null;
  const gallery = db.select().from(galleries).where(eq(galleries.id, order.galleryId)).get()!;
  if (!gallery.stripeAccountId) return null;
  if (!gallery.stripePayoutsEnabled) {
    // The gallery may have finished Stripe sign-up since we last looked.
    const account = await s.accounts.retrieve(gallery.stripeAccountId);
    if (!(account.capabilities?.transfers === 'active' && account.payouts_enabled)) return null;
    db.update(galleries).set({ stripePayoutsEnabled: true }).where(eq(galleries.id, gallery.id)).run();
  }

  // The platform's balance may be in another currency (e.g. GBP for a USD sale): send the
  // gallery's share in the currency the payment actually settled in, at the rate Stripe used.
  const charge = await s.charges.retrieve(order.stripeChargeId, { expand: ['balance_transaction'] });
  const bt = charge.balance_transaction as Stripe.BalanceTransaction | null;
  const share = galleryShare(order);
  const currency = bt?.currency ?? order.currency.toLowerCase();
  const amount = bt?.exchange_rate ? Math.floor(share * bt.exchange_rate) : share;

  const transfer = await s.transfers.create(
    {
      amount,
      currency,
      destination: gallery.stripeAccountId,
      source_transaction: order.stripeChargeId,
      transfer_group: order.reference,
      description: `Curated Art order ${order.reference}`,
      metadata: { orderId: String(order.id), reference: order.reference },
    },
    { idempotencyKey: `transfer-${order.id}` },
  );
  db.transaction((tx) => {
    tx.update(orders).set({ stripeTransferId: transfer.id, updatedAt: nowIso() }).where(eq(orders.id, order.id)).run();
    // Recorded as a completed payout, so the gallery's balance in the portal stays accurate.
    tx.insert(payouts)
      .values({
        galleryId: gallery.id,
        amountCents: share,
        method: 'stripe',
        destination: gallery.stripeAccountId!,
        status: 'paid',
        note: `Order ${order.reference} · Stripe transfer ${transfer.id}`,
        processedAt: nowIso(),
      })
      .run();
  });
  return transfer;
}

/** Sends every released-but-unpaid sale of a gallery (e.g. once it finishes Stripe sign-up). */
export async function settlePendingTransfers(galleryId: number) {
  const due = db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.galleryId, galleryId), eq(orders.status, 'released'), isNotNull(orders.stripeChargeId), isNull(orders.stripeTransferId)))
    .all();
  let sent = 0;
  for (const o of due) {
    try {
      if (await transferToGallery(o.id)) sent++;
    } catch (err) {
      console.error(`Stripe transfer for order ${o.id} failed`, err);
    }
  }
  return sent;
}

// ---------- Gallery Stripe accounts (Connect Express) ----------

/** Refreshes whether a gallery's Stripe account can receive money. */
export async function refreshGalleryAccount(gallery: Gallery) {
  const s = stripe();
  if (!s || !gallery.stripeAccountId) return { connected: false, payoutsEnabled: false, detailsSubmitted: false };
  const account = await s.accounts.retrieve(gallery.stripeAccountId);
  const enabled = account.capabilities?.transfers === 'active' && !!account.payouts_enabled;
  if (enabled !== gallery.stripePayoutsEnabled) {
    db.update(galleries).set({ stripePayoutsEnabled: enabled }).where(eq(galleries.id, gallery.id)).run();
  }
  if (enabled && !gallery.stripePayoutsEnabled) await settlePendingTransfers(gallery.id);
  return {
    connected: true,
    payoutsEnabled: enabled,
    detailsSubmitted: !!account.details_submitted,
    requirementsDue: account.requirements?.currently_due?.length ?? 0,
  };
}

/** Creates the gallery's Stripe account if needed and returns a Stripe-hosted sign-up link. */
export async function onboardingUrl(gallery: Gallery, ownerEmail: string, origin: string) {
  const s = stripe();
  if (!s) throw badRequest('Online payments are not switched on yet');
  const base = siteUrl(origin);
  let accountId = gallery.stripeAccountId;
  if (!accountId) {
    const crossBorder = gallery.country !== config.stripe.platformCountry;
    const account = await s.accounts.create(
      {
        type: 'express',
        country: gallery.country,
        email: ownerEmail,
        business_profile: { name: gallery.name, url: `${base}/galleries/${gallery.slug}`, mcc: '5971' }, // 5971: art dealers & galleries
        capabilities: { transfers: { requested: true } },
        // Galleries outside the platform's country receive transfers only.
        ...(crossBorder ? { tos_acceptance: { service_agreement: 'recipient' as const } } : {}),
        metadata: { galleryId: String(gallery.id) },
      },
      { idempotencyKey: `account-${gallery.id}` },
    );
    accountId = account.id;
    db.update(galleries).set({ stripeAccountId: accountId }).where(eq(galleries.id, gallery.id)).run();
  }
  const link = await s.accountLinks.create({
    account: accountId,
    type: 'account_onboarding',
    refresh_url: `${base}/vendor?tab=payouts&stripe=refresh`,
    return_url: `${base}/vendor?tab=payouts&stripe=return`,
  });
  return link.url;
}

/** One-time link to the gallery's Stripe Express dashboard (payout schedule, bank details). */
export async function dashboardUrl(gallery: Gallery) {
  const s = stripe();
  if (!s || !gallery.stripeAccountId) throw badRequest('Connect your Stripe account first');
  const link = await s.accounts.createLoginLink(gallery.stripeAccountId);
  return link.url;
}

/** Handles a verified webhook event. */
export async function handleStripeEvent(event: Stripe.Event) {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      await recordPayment(event.data.object);
      break;
    case 'account.updated': {
      const account = event.data.object;
      const gallery = db.select().from(galleries).where(eq(galleries.stripeAccountId, account.id)).get();
      if (gallery) await refreshGalleryAccount(gallery);
      break;
    }
    default:
      break;
  }
}
