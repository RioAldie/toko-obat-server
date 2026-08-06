const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = ['Kasir 1', 'Kasir 2', 'Owner'];
  for (const u of users) {
    await prisma.user.upsert({
      where: { username: u },
      update: {},
      create: {
        username: u,
        password: 'password123',
        role: u === 'Owner' ? 'ADMIN' : 'CASHIER'
      }
    });
  }
  console.log('Seed done');
}

main().finally(() => prisma.$disconnect());
