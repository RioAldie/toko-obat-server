import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { Prisma, MovementType } from '@prisma/client';

@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService) {}

  async createSale(createSaleDto: CreateSaleDto) {
    const { userId, items, buyerName, note } = createSaleDto;

    return this.prisma.$transaction(async (tx) => {
      // 1. Verify user
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) {
        throw new NotFoundException(`User with ID ${userId} not found`);
      }

      let totalAmount = 0;
      const saleDetailsData: Prisma.SaleDetailCreateManyInput[] = [];

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

      // 2. Process each item
      for (const item of items) {
        let price = 0;
        let productName: string | null = null;

        if (item.productId) {
          const product = await tx.product.findUnique({ where: { id: item.productId } });
          if (!product) {
            throw new NotFoundException(`Product with ID ${item.productId} not found`);
          }
          const roundedQuantity = Math.round(item.quantity);
          if (product.stock < roundedQuantity) {
            throw new BadRequestException(`Insufficient stock for product ${product.name}`);
          }
          price = Number(product.price);

          await tx.product.update({
            where: { id: product.id },
            data: { stock: product.stock - roundedQuantity },
          });

          await tx.stockMovement.create({
            data: {
              productId: product.id,
              userId: userId,
              type: MovementType.OUT,
              quantity: roundedQuantity,
              reason: `Sale ${invoiceNumber}`,
            },
          });
        } else if (item.productName && item.price !== undefined) {
          price = Number(item.price);
          productName = item.productName;
        } else {
          throw new BadRequestException('Item must have either a valid productId or productName with price');
        }

        const subtotal = price * item.quantity;
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

      // Bulk create sale details
      await tx.saleDetail.createMany({ data: saleDetailsData });

      // Update total amount on sale
      const updatedSale = await tx.sale.update({
        where: { id: sale.id },
        data: { totalAmount },
        include: {
          saleDetails: {
            include: {
              product: true
            }
          }
        }
      });

      return updatedSale;
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
            product: { select: { id: true, name: true, sku: true } }
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
      for (const detail of sale.saleDetails) {
        if (detail.productId) {
          const product = await tx.product.findUnique({ where: { id: detail.productId } });
          if (product) {
            const roundedQuantity = Math.round(Number(detail.quantity));
            await tx.product.update({
              where: { id: product.id },
              data: { stock: product.stock + roundedQuantity }
            });

            await tx.stockMovement.create({
              data: {
                productId: product.id,
                userId: sale.userId,
                type: MovementType.IN,
                quantity: roundedQuantity,
                reason: `Canceled Sale ${sale.invoiceNumber}`
              }
            });
          }
        }
      }

      return tx.sale.update({
        where: { id },
        data: { status: 'CANCELED' }
      });
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
        for (const detail of sale.saleDetails) {
          if (detail.productId) {
            const product = await tx.product.findUnique({ where: { id: detail.productId } });
            if (product) {
              const roundedQuantity = Math.round(Number(detail.quantity));
              await tx.product.update({
                where: { id: product.id },
                data: { stock: product.stock + roundedQuantity }
              });

              await tx.stockMovement.create({
                data: {
                  productId: product.id,
                  userId: sale.userId,
                  type: MovementType.IN,
                  quantity: roundedQuantity,
                  reason: `Deleted Sale ${sale.invoiceNumber}`
                }
              });
            }
          }
        }
      }

      await tx.saleDetail.deleteMany({
        where: { saleId: id }
      });

      return tx.sale.delete({
        where: { id }
      });
    });
  }
}
