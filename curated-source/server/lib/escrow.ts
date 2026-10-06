import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client';
import {
  disputes,
  escrowTransactions,
  galleries,
  listings,
  orderEvents,
  orders,
  payouts,
  type OrderStatus,
} from '../db/schema';
import type { AuthUser } from './auth';
import { can } from './rbac';
import { badRequest, forbidden, notFound } from './errors';
import { nowIso } from './util';

export type OrderAction =
  | 'pay'
  | 'cancel'
  | 'dispatch'
  | 'confirm_delivery'
  | 'release'
  | 'dispute'
  | 'decline'
  | 'resolve_release'
  | 'resolve_refund';

type Actor = 'buyer' | 'seller' | 'admin';

/** Escrow state machine: action → allowed source states, target state, and who may trigger it. */
export const TRANSITIONS: Record<OrderAction, { from: OrderStatus[]; to: OrderStatus; actors: Actor[] }> = {
  pay: { from: ['pending'], to: 'in_escrow', actors: ['buyer'] },
  cancel: { from: ['pending'], to: 'cancelled', actors: ['buyer', 'admin'] },
  decline: { from: ['in_escrow'], to: 'refunded', actors: ['seller', 'admin'] },
  dispatch: { from: ['in_escrow'], to: 'dispatched', actors: ['seller'] },
  confirm_delivery: { from: ['dispatched'], to: 'delivered', actors: ['buyer', 'admin'] },
  release: { from: ['delivered'], to: 'released', actors: ['buyer', 'admin'] },
  dispute: { from: ['in_escrow', 'dispatched', 'delivered'], to: 'disputed', actors: ['buyer', 'seller'] },
  resolve_release: { from: ['disputed'], to: 'released', actors: ['admin'] },
  resolve_refund: { from: ['disputed'], to: 'refunded', actors: ['admin'] },
};

type Order = typeof orders.$inferSelect;

export function actorsFor(user: AuthUser, order: Order): Actor[] {
  const actors: Actor[] = [];
  if (order.buyerId === user.id) actors.push('buyer');
  const gallery = db.select({ ownerId: galleries.ownerId }).from(galleries).where(eq(galleries.id, order.galleryId)).get();
  if (gallery?.ownerId === user.id) actors.push('seller');
  if (can(user.role, 'dispute:resolve')) actors.push('admin');
  return actors;
}

export function availableActions(user: AuthUser, order: Order): OrderAction[] {
  const actors = actorsFor(user, order);
  return (Object.keys(TRANSITIONS) as OrderAction[]).filter((a) => {
    const t = TRANSITIONS[a];
    return t.from.includes(order.status) && t.actors.some((x) => actors.includes(x));
  });
}

export type TransitionInput = { note?: string; carrier?: string; trackingNumber?: string; reason?: string };

/** Applies an escrow transition atomically, writing the order event and ledger entries. */
export function transitionOrder(user: AuthUser, orderId: number, action: OrderAction, input: TransitionInput = {}) {
  return db.transaction((tx) => {
    const order = tx.select().from(orders).where(eq(orders.id, orderId)).get();
    if (!order) throw notFound('Order not found');
    const t = TRANSITIONS[action];
    if (!t) throw badRequest('Unknown action');
    const actors = actorsFor(user, order);
    if (!t.actors.some((a) => actors.includes(a))) throw forbidden();
    if (!t.from.includes(order.status)) {
      throw badRequest(`Cannot ${action.replace('_', ' ')} an order that is ${order.status.replace('_', ' ')}`);
    }

    const ref = `${order.reference}-${action.toUpperCase()}`;
    const net = order.totalCents - order.commissionCents;
    const patch: Partial<Order> = { status: t.to, updatedAt: nowIso() };
    let note = input.note ?? null;

    switch (action) {
      case 'pay':
        // Payment gateway capture would happen here; funds are held by the platform.
        tx.insert(escrowTransactions).values({ orderId, type: 'hold', amountCents: order.totalCents, reference: ref }).run();
        tx.update(listings).set({ status: 'sold' }).where(eq(listings.id, order.listingId)).run();
        note ??= 'Payment received and secured in escrow';
        break;
      case 'cancel':
        tx.update(listings).set({ status: 'active' }).where(eq(listings.id, order.listingId)).run();
        note ??= 'Order cancelled before payment';
        break;
      case 'dispatch':
        if (!input.carrier || !input.trackingNumber) throw badRequest('Carrier and tracking number are required');
        patch.carrier = input.carrier;
        patch.trackingNumber = input.trackingNumber;
        note ??= `Dispatched via ${input.carrier} (${input.trackingNumber})`;
        break;
      case 'confirm_delivery':
        note ??= 'Delivery confirmed — inspection window open';
        break;
      case 'release':
      case 'resolve_release':
        tx.insert(escrowTransactions).values({ orderId, type: 'release', amountCents: net, reference: ref }).run();
        tx.insert(escrowTransactions)
          .values({ orderId, type: 'commission', amountCents: order.commissionCents, reference: `${ref}-FEE` })
          .run();
        note ??= 'Escrow released to gallery';
        break;
      case 'decline':
      case 'resolve_refund':
        tx.insert(escrowTransactions).values({ orderId, type: 'refund', amountCents: order.totalCents, reference: ref }).run();
        tx.update(listings).set({ status: 'active' }).where(eq(listings.id, order.listingId)).run();
        note ??= 'Escrow refunded to buyer';
        break;
      case 'dispute': {
        if (!input.reason || input.reason.trim().length < 10) throw badRequest('Please describe the issue (min 10 characters)');
        tx.insert(disputes)
          .values({ orderId, openedById: user.id, reason: input.reason.trim(), previousStatus: order.status })
          .run();
        note = input.reason.trim();
        break;
      }
    }

    if (action === 'resolve_release' || action === 'resolve_refund') {
      tx.update(disputes)
        .set({
          status: action === 'resolve_release' ? 'resolved_release' : 'resolved_refund',
          resolution: input.note ?? null,
          resolvedById: user.id,
          resolvedAt: nowIso(),
        })
        .where(and(eq(disputes.orderId, orderId), eq(disputes.status, 'open')))
        .run();
    }

    tx.update(orders).set(patch).where(eq(orders.id, orderId)).run();
    tx.insert(orderEvents).values({ orderId, status: t.to, note, actorId: user.id }).run();
    return { ...order, ...patch } as Order;
  });
}

/** Gallery balance: released escrow (net of commission) minus payouts not rejected. */
export function galleryBalance(galleryId: number) {
  const released =
    db
      .select({ total: sql<number>`coalesce(sum(${escrowTransactions.amountCents}), 0)` })
      .from(escrowTransactions)
      .innerJoin(orders, eq(orders.id, escrowTransactions.orderId))
      .where(and(eq(orders.galleryId, galleryId), eq(escrowTransactions.type, 'release')))
      .get()?.total ?? 0;
  const pendingEscrow =
    db
      .select({ total: sql<number>`coalesce(sum(${orders.totalCents} - ${orders.commissionCents}), 0)` })
      .from(orders)
      .where(and(eq(orders.galleryId, galleryId), inArray(orders.status, ['in_escrow', 'dispatched', 'delivered', 'disputed'])))
      .get()?.total ?? 0;
  const paidOut =
    db
      .select({ total: sql<number>`coalesce(sum(${payouts.amountCents}), 0)` })
      .from(payouts)
      .where(and(eq(payouts.galleryId, galleryId), inArray(payouts.status, ['requested', 'approved', 'paid'])))
      .get()?.total ?? 0;
  return { releasedCents: released, inEscrowCents: pendingEscrow, withdrawnCents: paidOut, availableCents: released - paidOut };
}
