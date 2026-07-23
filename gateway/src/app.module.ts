import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { HealthController } from "./health.controller";
import { PortfolioController } from "./portfolio/portfolio.controller";
import { PortfolioService } from "./portfolio/portfolio.service";
import { StocksController } from "./stocks/stocks.controller";
import { StocksService } from "./stocks/stocks.service";

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [HealthController, StocksController, PortfolioController],
  providers: [StocksService, PortfolioService],
})
export class AppModule {}
