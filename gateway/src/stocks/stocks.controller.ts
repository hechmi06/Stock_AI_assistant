import { Controller, Get, Param } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import { EvaluationReportDto } from "./dto/evaluation-report.dto";
import { MarketDataResultDto } from "./dto/market-data-result.dto";
import { TechnicalResultDto } from "./dto/technical-result.dto";
import { StocksService } from "./stocks.service";

@ApiTags("stocks")
@Controller("stocks")
export class StocksController {
  constructor(private readonly stocksService: StocksService) {}

  @ApiOperation({
    summary: "Analyse synthetique d'une action",
    description: "Endpoint compatible avec l'UI existante. Il utilise MarketDataAgent comme premiere source.",
  })
  @ApiParam({ name: "ticker", example: "AAPL", description: "Symbole boursier a analyser" })
  @Get(":ticker/analyze")
  analyzeTicker(@Param("ticker") ticker: string) {
    return this.stocksService.analyzeTicker(ticker);
  }

  @ApiOperation({
    summary: "Validation isolee du MarketDataAgent",
    description: "Retourne prix live, historique, profil entreprise, ratios et resume financier.",
  })
  @ApiParam({ name: "ticker", example: "AAPL", description: "Symbole boursier a collecter" })
  @ApiOkResponse({ type: MarketDataResultDto })
  @Get(":ticker/market-data")
  getMarketData(@Param("ticker") ticker: string) {
    return this.stocksService.getMarketData(ticker);
  }

  @ApiOperation({
    summary: "Analyse technique via TechnicalAgent",
    description:
      "RSI, SMA 20/50, volatilite, tendance, support/resistance, volume, score et signal. Calcule depuis les donnees du MarketDataAgent (aucun appel API externe direct).",
  })
  @ApiParam({ name: "ticker", example: "MSFT", description: "Symbole boursier a analyser" })
  @ApiOkResponse({ type: TechnicalResultDto })
  @Get(":ticker/technical")
  getTechnicalAnalysis(@Param("ticker") ticker: string) {
    return this.stocksService.getTechnicalAnalysis(ticker);
  }

  @ApiOperation({
    summary: "Evaluation qualite du MarketDataAgent",
    description:
      "Calcule les 11 metriques de qualite de collecte (score, grade, passed) pour la page Metriques des agents.",
  })
  @ApiParam({ name: "ticker", example: "AAPL", description: "Symbole boursier a evaluer" })
  @ApiOkResponse({ type: EvaluationReportDto })
  @Get(":ticker/evaluation")
  getAgentEvaluation(@Param("ticker") ticker: string) {
    return this.stocksService.getAgentEvaluation(ticker);
  }

  @ApiOperation({
    summary: "Evaluation qualite du TechnicalAgent",
    description:
      "Calcule les 11 metriques de qualite d'analyse technique (score, grade, passed) pour la page Metriques des agents.",
  })
  @ApiParam({ name: "ticker", example: "MSFT", description: "Symbole boursier a evaluer" })
  @ApiOkResponse({ type: EvaluationReportDto })
  @Get(":ticker/technical/evaluation")
  getTechnicalEvaluation(@Param("ticker") ticker: string) {
    return this.stocksService.getTechnicalEvaluation(ticker);
  }

  @ApiOperation({
    summary: "Donnees du tableau de marche",
    description: "Endpoint utilise par le frontend pour remplir le panier marche.",
  })
  @Get("market/dashboard")
  getMarketDashboard() {
    return this.stocksService.getMarketDashboard();
  }
}
