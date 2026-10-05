import type { Request } from 'express';
import { db } from '../db/client';
import { auditLogs } from '../db/schema';

export function audit(
  req: Request | null,
  action: string,
  entityType: string,
  entityId: number | null,
  metadata?: Record<string, unknown>,
) {
  db.insert(auditLogs)
    .values({
      actorId: req?.user?.id ?? null,
      action,
      entityType,
      entityId,
      metadata: metadata ?? null,
      ip: req?.ip ?? null,
    })
    .run();
}
