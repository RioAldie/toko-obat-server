import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UnitsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createUnitDto: CreateUnitDto) {
    const existingUnit = await this.prisma.unit.findUnique({
      where: { name: createUnitDto.name },
    });

    if (existingUnit) {
      throw new ConflictException('Unit with this name already exists');
    }

    return this.prisma.unit.create({
      data: createUnitDto,
    });
  }

  async findAll() {
    return this.prisma.unit.findMany();
  }

  async findOne(id: string) {
    const unit = await this.prisma.unit.findUnique({
      where: { id },
    });
    if (!unit) {
      throw new NotFoundException(`Unit with ID ${id} not found`);
    }
    return unit;
  }

  async update(id: string, updateUnitDto: UpdateUnitDto) {
    await this.findOne(id); // ensure exists

    if (updateUnitDto.name) {
      const existingUnit = await this.prisma.unit.findUnique({
        where: { name: updateUnitDto.name },
      });
      if (existingUnit && existingUnit.id !== id) {
        throw new ConflictException('Unit with this name already exists');
      }
    }

    return this.prisma.unit.update({
      where: { id },
      data: updateUnitDto,
    });
  }

  async remove(id: string) {
    await this.findOne(id); // ensure exists
    return this.prisma.unit.delete({
      where: { id },
    });
  }
}
