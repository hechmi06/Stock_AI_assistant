import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { HealthController } from "./health.controller";
import { StocksController } from "./stocks/stocks.controller";
import { StocksService } from "./stocks/stocks.service";

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [HealthController, StocksController],
  providers: [StocksService],
})
export class AppModule {}
