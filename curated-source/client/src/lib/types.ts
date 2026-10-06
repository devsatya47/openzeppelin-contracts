export type Role = 'buyer' | 'seller' | 'subadmin' | 'superadmin';

export type User = {
  id: number;
  email: string;
  name: string;
  role: Role;
  country: string;
  permissions: string[];
  gallery: { id: number; name: string; slug: string; status: GalleryStatus } | null;
};

export type GalleryStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export type Media = { id?: number; kind: 'image' | 'video'; url: string; thumbUrl: string; width: number | null; height: number | null };

export type ListingStatus = 'draft' | 'active' | 'reserved' | 'sold' | 'archived';

export type Listing = {
  id: number;
  slug: string;
  title: string;
  artist: string;
  year: number | null;
  medium: string;
  description: string;
  widthCm: number | null;
  heightCm: number | null;
  depthCm: number | null;
  priceCents: number;
  currency: string;
  shippingDomesticCents: number;
  shippingInternationalCents: number;
  originCountry: string;
  provenance: string;
  edition: string;
  certificateOfAuthenticity: boolean;
  status: ListingStatus;
  featured: boolean;
  views: number;
  categoryId: number;
  galleryId: number;
  createdAt: string;
  cover: Media | null;
  gallery: { id: number; name: string; slug: string; location?: string } | null;
  category: { id: number; name: string; slug: string } | null;
};

export type ListingDetail = Listing & {
  media: Media[];
  categoryPath: { id: number; name: string; slug: string }[];
  gallery: { id: number; name: string; slug: string; tagline: string; location: string; rating: number | null; reviewCount: number };
  isOwner: boolean;
};

export type Category = { id: number; name: string; slug: string; description?: string; count?: number; children: Category[] };

export type GallerySummary = {
  id: number;
  name: string;
  slug: string;
  tagline: string;
  location: string;
  coverUrl: string | null;
  featured: boolean;
  listingCount: number;
  rating: number | null;
};

export type OrderStatus = 'pending' | 'in_escrow' | 'dispatched' | 'delivered' | 'released' | 'disputed' | 'refunded' | 'cancelled';

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

export type ShippingAddress = { fullName: string; line1: string; line2?: string; city: string; region?: string; postalCode: string; country: string };

export type Order = {
  id: number;
  reference: string;
  buyerId: number;
  listingId: number;
  galleryId: number;
  priceCents: number;
  shippingCents: number;
  totalCents: number;
  commissionCents: number;
  currency: string;
  shippingRegion: 'domestic' | 'international';
  shippingAddress: ShippingAddress;
  status: OrderStatus;
  carrier: string | null;
  trackingNumber: string | null;
  createdAt: string;
  updatedAt: string;
  listing: Listing | null;
};

export type OrderDetail = Order & {
  gallery: { id: number; name: string; slug: string };
  buyer: { id: number; name: string; email: string };
  events: { id: number; status: OrderStatus; note: string | null; createdAt: string; actor: string | null }[];
  ledger: { id: number; type: 'hold' | 'release' | 'refund' | 'commission'; amountCents: number; reference: string; createdAt: string }[];
  dispute: { id: number; reason: string; status: string; resolution: string | null; createdAt: string } | null;
  review: { rating: number; body: string } | null;
  roles: ('buyer' | 'seller' | 'admin')[];
  actions: OrderAction[];
  canReview: boolean;
};

export type Balance = { releasedCents: number; inEscrowCents: number; withdrawnCents: number; availableCents: number };

export type Question = { id: number; body: string; answer: string | null; answeredAt?: string | null; createdAt: string; asker: string };
