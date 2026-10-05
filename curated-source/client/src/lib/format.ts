import type { OrderStatus } from './types';

export const money = (cents: number, currency = 'USD', opts: { decimals?: boolean } = {}) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: opts.decimals ? 2 : 0,
    minimumFractionDigits: opts.decimals ? 2 : 0,
  }).format(cents / 100);

export const date = (iso: string, withTime = false) =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });

export const dims = (w: number | null, h: number | null, d: number | null) => {
  if (!w && !h) return null;
  const cm = [w, h, d].filter(Boolean).join(' × ');
  const inch = [w, h, d].filter(Boolean).map((v) => (v! / 2.54).toFixed(1)).join(' × ');
  return { cm: `${cm} cm`, in: `${inch} in` };
};

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: 'gold' | 'ok' | 'warn' | 'bad' | 'mute' }> = {
  pending: { label: 'Pending Payment', tone: 'mute' },
  in_escrow: { label: 'In Escrow', tone: 'gold' },
  dispatched: { label: 'Dispatched', tone: 'gold' },
  delivered: { label: 'Delivered', tone: 'ok' },
  released: { label: 'Released', tone: 'ok' },
  disputed: { label: 'Disputed', tone: 'bad' },
  refunded: { label: 'Refunded', tone: 'warn' },
  cancelled: { label: 'Cancelled', tone: 'mute' },
};

export const ESCROW_STAGES: OrderStatus[] = ['pending', 'in_escrow', 'dispatched', 'delivered', 'released'];

export const COUNTRIES: [string, string][] = [
  ['US', 'United States'], ['GB', 'United Kingdom'], ['FR', 'France'], ['DE', 'Germany'], ['IT', 'Italy'], ['ES', 'Spain'],
  ['DK', 'Denmark'], ['SE', 'Sweden'], ['NL', 'Netherlands'], ['CH', 'Switzerland'], ['BE', 'Belgium'], ['AT', 'Austria'],
  ['CA', 'Canada'], ['AU', 'Australia'], ['JP', 'Japan'], ['SG', 'Singapore'], ['HK', 'Hong Kong'], ['AE', 'United Arab Emirates'],
  ['IN', 'India'], ['BR', 'Brazil'], ['MX', 'Mexico'], ['KR', 'South Korea'], ['CN', 'China'], ['ZA', 'South Africa'],
];
export const countryName = (code: string) => COUNTRIES.find(([c]) => c === code)?.[1] ?? code;
