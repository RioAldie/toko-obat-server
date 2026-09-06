import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createProductDto: CreateProductDto) {
    const { userId, ...productData } = createProductDto;

    const existingProduct = await this.prisma.product.findUnique({
      where: { sku: productData.sku },
    });

    if (existingProduct) {
      throw new ConflictException('Product with this SKU already exists');
    }

    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: productData,
        include: {
          category: true,
          unit: true,
        },
      });

      if (productData.stock && productData.stock > 0 && userId) {
        await tx.stockMovement.create({
          data: {
            productId: product.id,
            userId: userId,
            type: 'IN', // MovementType.IN literal for simplicity since we are passing to DB
            quantity: productData.stock,
            reason: 'Initial Stock',
          },
        });
      }

      if (userId) {
        await tx.productPriceHistory.create({
          data: {
            productId: product.id,
            newCostPrice: productData.costPrice || 0,
            newPrice: productData.price,
            userId: userId,
          }
        });
      }

      return product;
    });
  }

  async findAll() {
    return this.prisma.product.findMany({
      include: {
        category: true,
        unit: true,
      },
    });
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        unit: true,
      },
    });
    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }
    return product;
  }

  async update(id: string, updateProductDto: UpdateProductDto) {
    const existingProduct = await this.findOne(id); // ensure exists

    if (updateProductDto.sku) {
      const productWithSku = await this.prisma.product.findUnique({
        where: { sku: updateProductDto.sku },
      });
      if (productWithSku && productWithSku.id !== id) {
        throw new ConflictException('Product with this SKU already exists');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const { userId, ...updateData } = updateProductDto;

      const product = await tx.product.update({
        where: { id },
        data: updateData,
        include: {
          category: true,
          unit: true,
        },
      });

      // Track price changes
      const priceChanged = updateData.price !== undefined && Number(updateData.price) !== Number(existingProduct.price);
      const costPriceChanged = updateData.costPrice !== undefined && Number(updateData.costPrice) !== Number(existingProduct.costPrice);

      if ((priceChanged || costPriceChanged) && userId) {
        await tx.productPriceHistory.create({
          data: {
            productId: product.id,
            oldCostPrice: existingProduct.costPrice,
            newCostPrice: updateData.costPrice !== undefined ? updateData.costPrice : existingProduct.costPrice,
            oldPrice: existingProduct.price,
            newPrice: updateData.price !== undefined ? updateData.price : existingProduct.price,
            userId: userId,
          }
        });
      }

      return product;
    });
  }

  async getPriceHistory(id: string) {
    return this.prisma.productPriceHistory.findMany({
      where: { productId: id },
      include: {
        user: {
          select: { id: true, username: true, role: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async remove(id: string) {
    await this.findOne(id); // ensure exists
    return this.prisma.product.delete({
      where: { id },
    });
  }
}
