/**
 * Seed script — bootstrap RBAC roles, permissions, and demo users.
 *
 * Run with:
 *   npx prisma db seed
 *   OR
 *   npx tsx prisma/seed.ts
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { ROLES, ROLE_PERMISSION_MATRIX, PERMISSION_META } from '../src/modules/rbac/permissions.js';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding RBAC data…');

  // ── 1. Permissions + Roles + matrix (idempotent) ───────────────────────────
  // Wrap in a single transaction so all-or-nothing on first run.
  await prisma.$transaction(async (tx) => {
    // Upsert all permissions
    for (const meta of PERMISSION_META) {
      await tx.permission.upsert({
        where: { key: meta.key },
        update: { resource: meta.resource, action: meta.action, description: meta.description },
        create: { key: meta.key, resource: meta.resource, action: meta.action, description: meta.description },
      });
    }

    // Upsert system roles
    const roleDisplayNames: Record<string, string> = {
      L1:          'L1 – Data Entry',
      L2:          'L2 – View Only',
      L3:          'L3 – Edit / Delete',
      ADMIN:       'Admin',
      SUPER_ADMIN: 'Super Admin',
    };

    for (const [key, name] of Object.entries(roleDisplayNames)) {
      await tx.role.upsert({
        where: { key },
        update: { name, isSystem: true },
        create: { key, name, isSystem: true },
      });
    }

    // Populate role-permission matrix
    for (const [roleKey, permKeys] of Object.entries(ROLE_PERMISSION_MATRIX)) {
      const role = await tx.role.findUniqueOrThrow({ where: { key: roleKey } });
      for (const permKey of permKeys) {
        const permission = await tx.permission.findUniqueOrThrow({ where: { key: permKey } });
        await tx.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
          update: {},
          create: { roleId: role.id, permissionId: permission.id },
        });
      }
    }
  });

  console.log(`  ✔ ${PERMISSION_META.length} permissions, 5 roles, and matrix seeded`);

  // ── 2. Demo company + branch ──────────────────────────────────────────────
  let company = await prisma.company.findFirst({ where: { name: 'Demo Logistics Co.' } });
  if (!company) {
    company = await prisma.company.create({ data: { name: 'Demo Logistics Co.' } });
    console.log(`  ✔ Demo company created: ${company.id}`);
  }

  let branch = await prisma.branch.findFirst({ where: { companyId: company.id, name: 'Head Office' } });
  if (!branch) {
    branch = await prisma.branch.create({ data: { name: 'Head Office', companyId: company.id } });
    console.log(`  ✔ Demo branch created: ${branch.id}`);
  }

  // ── 3. Demo admin user (admin@demo.com / Admin@1234) ─────────────────────
  const adminEmail = 'admin@demo.com';
  let adminUser = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!adminUser) {
    const hash = await bcrypt.hash('Admin@1234', 12);
    adminUser = await prisma.user.create({
      data: { email: adminEmail, passwordHash: hash, name: 'Demo Admin', companyId: company.id },
    });
    console.log(`  ✔ Admin user created: ${adminUser.id} (admin@demo.com / Admin@1234)`);
  }

  const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: ROLES.ADMIN } });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: adminUser.id, roleId: adminRole.id } },
    update: {},
    create: { userId: adminUser.id, roleId: adminRole.id },
  });
  await prisma.userBranchAccess.upsert({
    where: { userId_branchId: { userId: adminUser.id, branchId: branch.id } },
    update: {},
    create: { userId: adminUser.id, branchId: branch.id },
  });
  await prisma.userSourceAccess.upsert({
    where: { userId_source: { userId: adminUser.id, source: 'INTERNAL' } },
    update: {},
    create: { userId: adminUser.id, source: 'INTERNAL' },
  });

  // ── 4. Demo super-admin user (superadmin@demo.com / Super@1234) ───────────
  const superEmail = 'superadmin@demo.com';
  let superUser = await prisma.user.findUnique({ where: { email: superEmail } });
  if (!superUser) {
    const hash = await bcrypt.hash('Super@1234', 12);
    superUser = await prisma.user.create({
      data: { email: superEmail, passwordHash: hash, name: 'Super Admin', companyId: company.id },
    });
    console.log(`  ✔ Super admin user created: ${superUser.id} (superadmin@demo.com / Super@1234)`);
  }

  const superRole = await prisma.role.findUniqueOrThrow({ where: { key: ROLES.SUPER_ADMIN } });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: superUser.id, roleId: superRole.id } },
    update: {},
    create: { userId: superUser.id, roleId: superRole.id },
  });

  console.log('🎉 Seeding complete.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
