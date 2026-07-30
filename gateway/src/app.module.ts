import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./auth/auth.module";
import { DatabaseModule } from "./database/database.module";
import { EducationModule } from "./education/education.module";
import { HealthController } from "./health.controller";
import { PortfolioController } from "./portfolio/portfolio.controller";
import { PortfolioService } from "./portfolio/portfolio.service";
import { StocksController } from "./stocks/stocks.controller";
import { StocksService } from "./stocks/stocks.service";
import { UserDataModule } from "./user-data/user-data.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AuthModule,
    EducationModule,
    UserDataModule,
  ],
  controllers: [HealthController, StocksController, PortfolioController],
  providers: [StocksService, PortfolioService],
})
export class AppModule {}
