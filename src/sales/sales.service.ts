import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { Prisma, MovementType } from '@prisma/client';

@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService) {}

  async createSale(createSaleDto: CreateSaleDto) {
    const { userId, items, buyerName, note } = createSaleDto;

    // Collect all product IDs in a single list
    const productIds = items
      .map(i => i.productId)
      .filter((id): id is string => Boolean(id));

    return this.prisma.$transaction(async (tx) => {
      // 1. Verify user
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) {
        throw new NotFoundException(`User with ID ${userId} not found`);
      }

      // 2. Fetch all needed products in ONE single query (avoids WAN latency timeouts)
      const products = productIds.length > 0
        ? await tx.product.findMany({ where: { id: { in: productIds } } })
        : [];
      const productMap = new Map(products.map(p => [p.id, p]));

      for (const id of productIds) {
        if (!productMap.has(id)) {
          throw new NotFoundException(`Product with ID ${id} not found`);
        }
      }

      let totalAmount = 0;
      const saleDetailsData: Prisma.SaleDetailCreateManyInput[] = [];
      const stockMovementsData: Prisma.StockMovementCreateManyInput[] = [];
      const stockUpdates: { id: string; newStock: number }[] = [];

      // Generate invoice number
      const date = new Date();
      const invoiceNumber = `INV-${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;

      // Create sale record first to get its ID for sale details
      const sale = await tx.sale.create({
        data: {
          invoiceNumber,
          userId,
          buyerName,
          note,
          totalAmount: 0, // We will update this later
        }
      });

      // 3. Process each item in memory
      for (const item of items) {
        let price = 0;
        let productName: string | null = null;

        if (item.productId) {
          const product = productMap.get(item.productId)!;
          const roundedQuantity = Math.round(item.quantity);
          if (product.stock < roundedQuantity) {
            throw new BadRequestException(`Insufficient stock for product ${product.name}`);
          }
          price = Number(product.price);
          product.stock -= roundedQuantity;

          stockUpdates.push({
            id: product.id,
            newStock: product.stock,
          });

          stockMovementsData.push({
            productId: product.id,
            userId: userId,
            type: MovementType.OUT,
            quantity: roundedQuantity,
            reason: `Sale ${invoiceNumber}`,
          });
        } else if (item.productName && item.price !== undefined) {
          price = Number(item.price);
          productName = item.productName;
        } else {
          throw new BadRequestException('Item must have either a valid productId or productName with price');
        }

        const subtotal = Math.round(price * item.quantity * 100) / 100;
        totalAmount += subtotal;

        // Prepare sale detail
        saleDetailsData.push({
          saleId: sale.id,
          productId: item.productId || null,
          productName: productName,
          quantity: item.quantity,
          price: price,
          subtotal: subtotal,
        });
      }

      // 4. Batch update products in parallel
      if (stockUpdates.length > 0) {
        await Promise.all(
          stockUpdates.map(u =>
            tx.product.update({
              where: { id: u.id },
              data: { stock: u.newStock },
            })
          )
        );
      }

      // 5. Bulk create stock movements and sale details
      if (stockMovementsData.length > 0) {
        await tx.stockMovement.createMany({ data: stockMovementsData });
      }

      await tx.saleDetail.createMany({ data: saleDetailsData });

      // 6. Update total amount on sale
      const updatedSale = await tx.sale.update({
        where: { id: sale.id },
        data: { totalAmount: Math.round(totalAmount * 100) / 100 },
        include: {
          saleDetails: {
            include: {
              product: {
                include: {
                  unit: true
                }
              }
            }
          }
        }
      });

      return updatedSale;
    }, {
      maxWait: 10000,
      timeout: 30000,
    });
  }

  async findAll() {
    return this.prisma.sale.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, username: true } },
        saleDetails: { select: { quantity: true } },
        _count: { select: { saleDetails: true } }
      }
    });
  }

  async findOne(id: string) {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, username: true } },
        saleDetails: {
          include: {
            product: { 
              select: { 
                id: true, 
                name: true, 
                sku: true,
                unit: { select: { id: true, name: true } }
              } 
            }
          }
        }
      }
    });

    if (!sale) {
      throw new NotFoundException(`Sale with ID ${id} not found`);
    }

    return sale;
  }

  async cancelSale(id: string) {
    const sale = await this.prisma.sale.findUnique({ 
      where: { id },
      include: { saleDetails: true }
    });
    if (!sale) {
      throw new NotFoundException(`Sale with ID ${id} not found`);
    }

    if (sale.status === 'CANCELED') {
      throw new BadRequestException(`Sale with ID ${id} is already canceled`);
    }

    return this.prisma.$transaction(async (tx) => {
      const productIds = sale.saleDetails
        .map(d => d.productId)
        .filter((pid): pid is string => Boolean(pid));

      const products = productIds.length > 0
        ? await tx.product.findMany({ where: { id: { in: productIds } } })
        : [];
      const productMap = new Map(products.map(p => [p.id, p]));

      const stockMovementsData: Prisma.StockMovementCreateManyInput[] = [];
      const stockUpdates: { id: string; newStock: number }[] = [];

      for (const detail of sale.saleDetails) {
        if (detail.productId && productMap.has(detail.productId)) {
          const product = productMap.get(detail.productId)!;
          const roundedQuantity = Math.round(Number(detail.quantity));
          product.stock += roundedQuantity;

          stockUpdates.push({
            id: product.id,
            newStock: product.stock
          });

          stockMovementsData.push({
            productId: product.id,
            userId: sale.userId,
            type: MovementType.IN,
            quantity: roundedQuantity,
            reason: `Canceled Sale ${sale.invoiceNumber}`
          });
        }
      }

      if (stockUpdates.length > 0) {
        await Promise.all(
          stockUpdates.map(u =>
            tx.product.update({
              where: { id: u.id },
              data: { stock: u.newStock }
            })
          )
        );
      }

      if (stockMovementsData.length > 0) {
        await tx.stockMovement.createMany({ data: stockMovementsData });
      }

      return tx.sale.update({
        where: { id },
        data: { status: 'CANCELED' }
      });
    }, {
      maxWait: 10000,
      timeout: 30000,
    });
  }

  async deleteSale(id: string) {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: { saleDetails: true }
    });

    if (!sale) {
      throw new NotFoundException(`Sale with ID ${id} not found`);
    }

    return this.prisma.$transaction(async (tx) => {
      // If the sale was NOT canceled, restore stock to products
      if (sale.status !== 'CANCELED') {
        const productIds = sale.saleDetails
          .map(d => d.productId)
          .filter((pid): pid is string => Boolean(pid));

        const products = productIds.length > 0
          ? await tx.product.findMany({ where: { id: { in: productIds } } })
          : [];
        const productMap = new Map(products.map(p => [p.id, p]));

        const stockMovementsData: Prisma.StockMovementCreateManyInput[] = [];
        const stockUpdates: { id: string; newStock: number }[] = [];

        for (const detail of sale.saleDetails) {
          if (detail.productId && productMap.has(detail.productId)) {
            const product = productMap.get(detail.productId)!;
            const roundedQuantity = Math.round(Number(detail.quantity));
            product.stock += roundedQuantity;

            stockUpdates.push({
              id: product.id,
              newStock: product.stock
            });

            stockMovementsData.push({
              productId: product.id,
              userId: sale.userId,
              type: MovementType.IN,
              quantity: roundedQuantity,
              reason: `Deleted Sale ${sale.invoiceNumber}`
            });
          }
        }

        if (stockUpdates.length > 0) {
          await Promise.all(
            stockUpdates.map(u =>
              tx.product.update({
                where: { id: u.id },
                data: { stock: u.newStock }
              })
            )
          );
        }

        if (stockMovementsData.length > 0) {
          await tx.stockMovement.createMany({ data: stockMovementsData });
        }
      }

      await tx.saleDetail.deleteMany({
        where: { saleId: id }
      });

      return tx.sale.delete({
        where: { id }
      });
    }, {
      maxWait: 10000,
      timeout: 30000,
    });
  }
}
