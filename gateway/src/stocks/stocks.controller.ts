import { Controller, Get, Param } from "@nestjs/common";
import { StocksService } from "./stocks.service";

@Controller("stocks")
export class StocksController {
  constructor(private readonly stocksService: StocksService) {}

  @Get(":ticker/analyze")
  analyzeTicker(@Param("ticker") ticker: string) {
    return this.stocksService.analyzeTicker(ticker);
  }

  @Get("market/dashboard")
  getMarketDashboard() {
    return this.stocksService.getMarketDashboard();
  }
}
