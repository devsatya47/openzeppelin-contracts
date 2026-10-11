/**
 * Carriers a gallery can choose when dispatching, with the public page where buyers can follow
 * the parcel. Shared by the API (validation, links in order data) and the web app (dispatch form).
 */
export type Carrier = { id: string; name: string; hint: string; trackUrl?: (n: string) => string };

export const CARRIERS: Carrier[] = [
  { id: 'dhl', name: 'DHL Express', hint: '10-digit waybill number', trackUrl: (n) => `https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=${n}` },
  { id: 'fedex', name: 'FedEx', hint: '12, 15 or 20 digits', trackUrl: (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}` },
  { id: 'ups', name: 'UPS', hint: 'Usually starts with 1Z', trackUrl: (n) => `https://www.ups.com/track?tracknum=${n}` },
  { id: 'usps', name: 'USPS', hint: '20–22 digits', trackUrl: (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}` },
  { id: 'royalmail', name: 'Royal Mail', hint: 'e.g. AB123456789GB', trackUrl: (n) => `https://www.royalmail.com/track-your-item#/tracking-results/${n}` },
  { id: 'parcelforce', name: 'Parcelforce Worldwide', hint: 'e.g. AB1234567', trackUrl: (n) => `https://www.parcelforce.com/track-trace?trackNumber=${n}` },
  { id: 'other', name: 'Other carrier', hint: 'As printed on the shipping label' },
];

/** Tracking numbers are letters, digits and dashes; spaces from copy-paste are removed. */
export const normalizeTracking = (n: string) => n.replace(/\s+/g, '').toUpperCase();
export const TRACKING_PATTERN = /^[A-Z0-9-]{6,40}$/;

/** Finds the carrier for a stored carrier name (also matches older free-text names such as "FedEx International Priority"). */
export function findCarrier(name: string | null | undefined): Carrier | undefined {
  if (!name) return undefined;
  const n = name.toLowerCase().replace(/\s+/g, '');
  return CARRIERS.find((c) => c.id !== 'other' && (n.includes(c.id) || n.includes(c.name.toLowerCase().replace(/\s+/g, ''))));
}

export function trackingUrl(carrierName: string | null | undefined, trackingNumber: string | null | undefined) {
  if (!trackingNumber) return null;
  const c = findCarrier(carrierName);
  return c?.trackUrl ? c.trackUrl(encodeURIComponent(normalizeTracking(trackingNumber))) : null;
}
