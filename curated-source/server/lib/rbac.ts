import type { Role } from '../db/schema';

/**
 * Permission matrix. Roles are hierarchical in practice (seller ⊃ buyer, superadmin ⊃ subadmin)
 * but permissions are listed explicitly so each grant is auditable in one place.
 */
export const PERMISSIONS = {
  'order:create': ['buyer', 'seller', 'subadmin', 'superadmin'],
  'question:ask': ['buyer', 'seller', 'subadmin', 'superadmin'],
  'review:create': ['buyer', 'seller', 'subadmin', 'superadmin'],
  'gallery:apply': ['buyer', 'seller'],
  'listing:manage': ['seller'],
  'payout:request': ['seller'],
  'category:suggest': ['seller', 'subadmin', 'superadmin'],
  'admin:access': ['subadmin', 'superadmin'],
  'vendor:moderate': ['subadmin', 'superadmin'],
  'taxonomy:moderate': ['subadmin', 'superadmin'],
  'dispute:resolve': ['subadmin', 'superadmin'],
  'order:read_all': ['subadmin', 'superadmin'],
  'listing:moderate': ['subadmin', 'superadmin'],
  'audit:read': ['subadmin', 'superadmin'],
  'payout:process': ['superadmin'],
  'user:manage': ['superadmin'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | undefined, permission: Permission): boolean {
  return !!role && (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export function permissionsFor(role: Role): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(role, p));
}
