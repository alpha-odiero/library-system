/**
 * Idempotent reference-data seeder.
 *
 * Seeds the permission registry and system roles straight from
 * `@lms/shared`, so the registry has exactly one definition. Re-running is safe:
 * every write is an upsert keyed on the natural identifier.
 */

import { PERMISSIONS, ROLES } from '@lms/shared';
import { prisma } from '../../src/config/database.js';
import { logger } from '../../src/config/logger.js';

export async function seedPermissionsAndRoles(): Promise<void> {
  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: permission.code },
      update: {
        resource: permission.resource,
        action: permission.action,
        description: permission.description,
      },
      create: {
        code: permission.code,
        resource: permission.resource,
        action: permission.action,
        description: permission.description,
      },
    });
  }
  logger.info({ count: PERMISSIONS.length }, 'Permissions synced');

  for (const role of ROLES) {
    const record = await prisma.role.upsert({
      where: { code: role.code },
      update: {
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        rank: role.rank,
      },
      create: {
        code: role.code,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        rank: role.rank,
      },
    });

    // Grants are replaced wholesale so a permission removed from the registry
    // is actually revoked in the database, rather than lingering forever.
    const desired = await prisma.permission.findMany({
      where: { code: { in: [...role.permissions] } },
      select: { id: true },
    });

    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: record.id } }),
      prisma.rolePermission.createMany({
        data: desired.map((permission) => ({ roleId: record.id, permissionId: permission.id })),
        skipDuplicates: true,
      }),
    ]);

    logger.info({ role: role.code, permissions: desired.length }, 'Role grants synced');
  }
}
