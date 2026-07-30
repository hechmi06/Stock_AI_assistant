import { Controller, Get } from "@nestjs/common";
import { DatabaseService } from "./database/database.service";

@Controller("health")
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  getHealth() {
    return {
      service: "gateway",
      status: this.database.isAvailable() ? "ok" : "degraded",
      database: this.database.isAvailable() ? "connected" : "unavailable",
      databaseDriver: this.database.getDriver(),
      timestamp: new Date().toISOString(),
    };
  }
}
