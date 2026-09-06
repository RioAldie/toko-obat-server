import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { MovementType } from '@prisma/client';

export class CreateStockMovementDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsEnum(MovementType)
  @IsNotEmpty()
  type: MovementType;

  @IsInt()
  quantity: number;

  @IsString()
  @IsOptional()
  reason?: string;
}
