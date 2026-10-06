import type { Request, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { config } from '../config';
import { db } from '../db/client';
import { users, type Role } from '../db/schema';
import { can, type Permission } from './rbac';
import { forbidden, unauthorized } from './errors';

export type AuthUser = { id: number; email: string; name: string; role: Role };

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 11);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export function signToken(user: { id: number }) {
  return jwt.sign({ sub: String(user.id) }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

/** Resolves the bearer token (if any) into req.user. Never rejects — use requireAuth for that. */
export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret) as jwt.JwtPayload;
    const user = db
      .select({ id: users.id, email: users.email, name: users.name, role: users.role, status: users.status })
      .from(users)
      .where(eq(users.id, Number(payload.sub)))
      .get();
    if (user && user.status === 'active') {
      req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
    }
  } catch {
    // Invalid or expired token: treat as anonymous.
  }
  next();
};

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  next();
};

export const requirePermission =
  (...perms: Permission[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!perms.every((p) => can(req.user!.role, p))) return next(forbidden());
    next();
  };

export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
