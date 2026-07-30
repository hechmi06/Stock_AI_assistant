import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  app.enableCors({
    origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173",
    credentials: true,
  });
  app.setGlobalPrefix("api");

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Stock AI Assistant API")
    .setDescription("Gateway API pour tester les agents d'analyse boursiere.")
    .setVersion("0.1.0")
    .addTag("stocks", "Analyse boursiere et donnees marche")
    .addTag("portfolio", "Valorisation et analyse de portefeuille")
    .addTag("auth", "Comptes et sessions utilisateur")
    .addTag("education", "Assistant pedagogique des notions boursieres")
    .addTag("user-data", "Historiques et donnees du compte")
    .addCookieAuth("stock_ai_session", {
      type: "apiKey",
      in: "cookie",
      name: "stock_ai_session",
    })
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("api/docs", app, swaggerDocument);

  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3000);
}

void bootstrap();
