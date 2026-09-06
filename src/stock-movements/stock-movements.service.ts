import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStockMovementDto } from './dto/create-stock-movement.dto';
import { MovementType } from '@prisma/client';

@Injectable()
export class StockMovementsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createStockMovementDto: CreateStockMovementDto) {
    const { productId, userId, type, quantity, reason } = createStockMovementDto;

    return this.prisma.$transaction(async (prisma) => {
      const product = await prisma.product.findUnique({
        where: { id: productId },
      });

      if (!product) {
        throw new NotFoundException(`Product with ID ${productId} not found`);
      }

      let newStock = product.stock;
      const absoluteQuantity = Math.abs(quantity);

      if (type === MovementType.IN) {
        newStock += absoluteQuantity;
      } else if (type === MovementType.OUT) {
        if (product.stock < absoluteQuantity) {
          throw new BadRequestException('Insufficient stock');
        }
        newStock -= absoluteQuantity;
      } else if (type === MovementType.ADJUSTMENT) {
        newStock += quantity;
        if (newStock < 0) {
          throw new BadRequestException('Stock cannot be negative after adjustment');
        }
      }

      await prisma.product.update({
        where: { id: productId },
        data: { stock: newStock },
      });

      const movement = await prisma.stockMovement.create({
        data: {
          productId,
          userId,
          type,
          quantity,
          reason,
        },
        include: {
          product: true,
          user: {
            select: {
              id: true,
              username: true,
            }
          }
        }
      });

      return movement;
    });
  }

  findAll() {
    return this.prisma.stockMovement.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        product: true,
        user: {
          select: { id: true, username: true }
        }
      }
    });
  }

  async findOne(id: string) {
    const movement = await this.prisma.stockMovement.findUnique({
      where: { id },
      include: {
        product: true,
        user: {
          select: { id: true, username: true }
        }
      }
    });

    if (!movement) {
      throw new NotFoundException(`Stock movement with ID ${id} not found`);
    }

    return movement;
  }
}
