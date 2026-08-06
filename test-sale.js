const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv/config');

async function test() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  const user = await prisma.user.findFirst();
  const product = await prisma.product.findFirst();

  if (!user || !product) {
    console.log('Missing user or product');
    process.exit(1);
  }

  const payload = {
    userId: user.id,
    items: [
      {
        productId: product.id,
        quantity: 2
      }
    ]
  };

  const response = await fetch('http://localhost:3001/sales', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  console.log(JSON.stringify(data, null, 2));

  await prisma.$disconnect();
}
test();
