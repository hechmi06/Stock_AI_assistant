import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { UserDataController } from "./user-data.controller";
import { UserDataService } from "./user-data.service";

@Module({
  imports: [AuthModule],
  controllers: [UserDataController],
  providers: [UserDataService],
})
export class UserDataModule {}
