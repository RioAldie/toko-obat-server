import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  console.log(await prisma.productPriceHistory.findMany({
    include: { user: true }
  }));
}
main().catch(console.error).finally(() => prisma.$disconnect());
