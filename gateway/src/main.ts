import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173",
  });
  app.setGlobalPrefix("api");
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3000);
}

void bootstrap();
