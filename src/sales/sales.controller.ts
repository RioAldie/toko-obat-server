import { Controller, Get, Post, Body, Param, Put, UseGuards, Req } from '@nestjs/common';
import { SalesService } from './sales.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { AuthGuard } from '../auth/auth.guard';

@Controller('sales')
@UseGuards(AuthGuard)
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Post()
  create(@Req() req, @Body() createSaleDto: CreateSaleDto) {
    if (req.user && req.user.sub) {
      createSaleDto.userId = req.user.sub;
    }
    return this.salesService.createSale(createSaleDto);
  }

  @Get()
  findAll() {
    return this.salesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.salesService.findOne(id);
  }

  @Put(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.salesService.cancelSale(id);
  }
}
