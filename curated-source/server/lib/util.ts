import crypto from 'node:crypto';

export function slugify(input: string) {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export const uniqueSuffix = () => crypto.randomBytes(3).toString('hex');

export const orderReference = () => `CS-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

export const nowIso = () => new Date().toISOString();

/** Flat-rate shipping: domestic when destination matches the listing's origin country. */
export function shippingFor(
  listing: { originCountry: string; shippingDomesticCents: number; shippingInternationalCents: number },
  destinationCountry: string,
) {
  const region = destinationCountry.toUpperCase() === listing.originCountry.toUpperCase() ? 'domestic' : 'international';
  return {
    region: region as 'domestic' | 'international',
    cents: region === 'domestic' ? listing.shippingDomesticCents : listing.shippingInternationalCents,
  };
}
