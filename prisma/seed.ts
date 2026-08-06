import 'dotenv/config';
import { PrismaClient, Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Seeding database...');

  // 1. Create a User
  const adminUser = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      password: 'password123', // In real app, this should be hashed
      role: Role.ADMIN,
      isActive: true,
    },
  });
  console.log(`User created: ${adminUser.username}`);

  // Categories
  const categoriesData = [
    { name: 'Herbisida', description: 'Pembasmi gulma' },
    { name: 'Insektisida', description: 'Pembasmi serangga' },
    { name: 'Fungisida', description: 'Pembasmi jamur' },
    { name: 'Pupuk', description: 'Pupuk tanaman' },
  ];

  const categoryMap: Record<string, string> = {};
  for (const cat of categoriesData) {
    const c = await prisma.category.upsert({
      where: { name: cat.name },
      update: {},
      create: cat,
    });
    categoryMap[cat.name] = c.id;
  }
  console.log(`Categories created: ${categoriesData.length}`);

  // Units
  const unitsData = [
    { name: 'Liter', description: 'Volume' },
    { name: 'Kg', description: 'Berat' },
    { name: 'Botol', description: 'Kemasan Botol' },
    { name: 'Sachet', description: 'Kemasan Sachet' },
  ];

  const unitMap: Record<string, string> = {};
  for (const u of unitsData) {
    const unit = await prisma.unit.upsert({
      where: { name: u.name },
      update: {},
      create: u,
    });
    unitMap[u.name] = unit.id;
  }
  console.log(`Units created: ${unitsData.length}`);

  // Generate 50 products
  const productsToCreate: any[] = [];
  const prefixes = ['Gramoxone', 'Roundup', 'Decis', 'Curacron', 'Antracol', 'Dithane', 'NPK', 'Urea', 'SP36', 'Furadan'];
  
  for (let i = 1; i <= 50; i++) {
    const prefix = prefixes[i % prefixes.length];
    let catName = 'Pupuk';
    if (['Gramoxone', 'Roundup'].includes(prefix)) catName = 'Herbisida';
    else if (['Decis', 'Curacron', 'Furadan'].includes(prefix)) catName = 'Insektisida';
    else if (['Antracol', 'Dithane'].includes(prefix)) catName = 'Fungisida';

    const unitName = ['Pupuk', 'Fungisida'].includes(catName) ? (i % 2 === 0 ? 'Kg' : 'Sachet') : (i % 2 === 0 ? 'Liter' : 'Botol');
    
    productsToCreate.push({
      sku: `PROD-${catName.substring(0,3).toUpperCase()}-${String(i).padStart(3, '0')}`,
      name: `${prefix} ${i * 10} Extra`,
      description: `Produk pertanian berkualitas ${prefix}`,
      price: 25000 + (i * 1500),
      stock: 50 + (i * 5),
      categoryId: categoryMap[catName],
      unitId: unitMap[unitName],
    });
  }

  const createdProducts = await prisma.product.createMany({
    data: productsToCreate,
    skipDuplicates: true,
  });

  console.log(`Products created/skipped: 50 (inserted: ${createdProducts.count})`);

  console.log('Seeding finished.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
