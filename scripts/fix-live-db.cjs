/* One-shot live DB fix (scratch, not part of the app) */
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
}
loadEnv(path.join(root, '.env'));
loadEnv(path.join(root, 'apps', 'backend', '.env'));

const { PrismaClient } = require(path.join(root, 'node_modules', '@prisma', 'client'));

async function main() {
  const prisma = new PrismaClient();

  const beforeBranches = await prisma.branch.findMany({ orderBy: { code: 'asc' } });
  const beforeLibraries = await prisma.library.findMany({ orderBy: { code: 'asc' } });
  console.log('=== BEFORE ===');
  for (const b of beforeLibraries) console.log(`library  ${b.code.padEnd(12)} ${b.name.padEnd(20)} active=${b.isActive}`);
  for (const b of beforeBranches) console.log(`branch   ${b.code.padEnd(12)} ${b.name.padEnd(20)} active=${b.isActive} library=${b.libraryId}`);

  const deactivateBranches = await prisma.branch.updateMany({
    where: { OR: [{ code: 'WEST' }, { code: 'RESEARCH' }, { code: 'apha-labs-yvu4l-main' }] },
    data: { isActive: false },
  });
  console.log(`\ndeactivated ${deactivateBranches.count} branch(es): WEST, RESEARCH, apha-labs main`);

  const apha = await prisma.library.findFirst({ where: { code: { startsWith: 'apha' } } });
  if (apha) {
    await prisma.library.update({ where: { id: apha.id }, data: { isActive: false } });
    console.log(`deactivated library ${apha.code} (${apha.name})`);
  }

  const nullUsers = await prisma.user.findMany({ where: { libraryId: null }, include: { primaryBranch: true } });
  for (const user of nullUsers) {
    if (user.primaryBranch) {
      await prisma.user.update({
        where: { id: user.id },
        data: { libraryId: user.primaryBranch.libraryId },
      });
      console.log(`backfilled ${user.email} -> library ${user.primaryBranch.libraryId}`);
    } else {
      console.log(`skipped ${user.email} (no primaryBranch)`);
    }
  }

  const afterBranches = await prisma.branch.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } });
  const afterLibraries = await prisma.library.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } });
  console.log('\n=== AFTER (active only) ===');
  for (const b of afterLibraries) console.log(`library  ${b.code}  ${b.name}  active=${b.isActive}`);
  for (const b of afterBranches) console.log(`branch   ${b.code}  ${b.name}  active=${b.isActive}  library=${b.libraryId}`);

  const remainingNull = await prisma.user.count({ where: { libraryId: null } });
  console.log(`\nusers still with libraryId null: ${remainingNull}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});