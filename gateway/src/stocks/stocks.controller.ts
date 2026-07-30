import { Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from "@nestjs/swagger";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { EvaluationReportDto } from "./dto/evaluation-report.dto";
import { BacktestResultDto, TechnicalCalibrationResultDto } from "./dto/backtest-result.dto";
import { HistoricalReplayResultDto } from "./dto/historical-replay.dto";
import { MarketDataResultDto } from "./dto/market-data-result.dto";
import { NewsResultDto } from "./dto/news-result.dto";
import { PointInTimeQueryResultDto, PointInTimeSummaryDto } from "./dto/point-in-time.dto";
import { RagIngestResultDto, RagResultDto } from "./dto/rag-result.dto";
import { RiskResultDto } from "./dto/risk-result.dto";
import { SocialMediaResultDto } from "./dto/social-media-result.dto";
import { TechnicalResultDto } from "./dto/technical-result.dto";
import { OrchestratedAnalysisDto, SynthesisResultDto } from "./dto/synthesis-result.dto";
import { StocksService } from "./stocks.service";

@ApiTags("stocks")
@ApiCookieAuth("stock_ai_session")
@UseGuards(SessionAuthGuard)
@Controller("stocks")
export class StocksController {
  constructor(private readonly stocksService: StocksService) {}

  @ApiOperation({
    summary: "Donnees du tableau de marche (pagination + recherche)",
    description: "Liste paginee des actions US avec cotations Twelve Data. Parametres : page, limit (max 100), search.",
  })
  @Get("market/dashboard")
  getMarketDashboard(
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("search") search?: string,
  ) {
    return this.stocksService.getMarketDashboard({
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
      search: search ?? "",
    });
  }

  @ApiOperation({
    summary: "Recherche dans l'univers US",
    description: "Symboles US (Finnhub/FMP) sans cotation — utile pour l'autocompletion.",
  })
  @Get("us")
  searchUsStocks(
    @Query("search") search?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.stocksService.searchUsStocks({
      search: search ?? "",
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    });
  }

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
    summary: "Validation isolee du SynthesisAgent",
    description: "Calcule la synthese deterministe sans executer le workflow LangGraph.",
  })
  @ApiParam({ name: "ticker", example: "MSFT" })
  @ApiOkResponse({ type: SynthesisResultDto })
  @Get(":ticker/synthesis")
  getSynthesis(@Param("ticker") ticker: string, @Query("fresh") fresh?: string) {
    return this.stocksService.getSynthesis(ticker, fresh === "true");
  }

  @ApiOperation({
    summary: "Evaluation qualite du SynthesisAgent",
    description:
      "Calcule les 12 metriques de qualite de la synthese (couverture, purete du score, coherence de la recommandation) pour la page Metriques des agents.",
  })
  @ApiParam({ name: "ticker", example: "MSFT", description: "Symbole boursier a evaluer" })
  @ApiOkResponse({ type: EvaluationReportDto })
  @Get(":ticker/synthesis/evaluation")
  getSynthesisEvaluation(@Param("ticker") ticker: string) {
    return this.stocksService.getSynthesisEvaluation(ticker);
  }

  @ApiOperation({
    summary: "Analyse boursiere multi-agents complete",
    description:
      "Workflow LangGraph : MarketData et RAG, puis Technical et News (filtrees par le profil entreprise), puis Risk et Synthesis.",
  })
  @ApiParam({ name: "ticker", example: "MSFT" })
  @ApiQuery({ name: "fresh", required: false, type: Boolean })
  @ApiOkResponse({ type: OrchestratedAnalysisDto })
  @Get(":ticker/full-analysis")
  getFullAnalysis(@Param("ticker") ticker: string, @Query("fresh") fresh?: string) {
    return this.stocksService.getFullAnalysis(ticker, fresh === "true");
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
    summary: "Backtest walk-forward du TechnicalAgent",
    description:
      "Rejoue les signaux techniques sans fuite de donnees, en strategie long/cash, puis compare rendement, Sharpe et drawdown au benchmark.",
  })
  @ApiParam({ name: "ticker", example: "AAPL" })
  @ApiQuery({ name: "benchmark", required: false, example: "SPY" })
  @ApiQuery({ name: "period", required: false, enum: ["2y", "5y", "10y"], example: "5y" })
  @ApiQuery({ name: "horizonDays", required: false, type: Number, example: 20 })
  @ApiQuery({ name: "minHistory", required: false, type: Number, example: 60 })
  @ApiQuery({ name: "transactionCostBps", required: false, type: Number, example: 5 })
  @ApiQuery({ name: "slippageBps", required: false, type: Number, example: 5 })
  @ApiOkResponse({ type: BacktestResultDto })
  @Get(":ticker/backtest")
  getBacktest(
    @Param("ticker") ticker: string,
    @Query("benchmark") benchmark?: string,
    @Query("period") period?: string,
    @Query("horizonDays") horizonDays?: string,
    @Query("minHistory") minHistory?: string,
    @Query("transactionCostBps") transactionCostBps?: string,
    @Query("slippageBps") slippageBps?: string,
  ) {
    return this.stocksService.getBacktest(ticker, {
      benchmark: benchmark ?? "SPY",
      period: period ?? "5y",
      horizonDays: horizonDays ? Number(horizonDays) : 20,
      minHistory: minHistory ? Number(minHistory) : 60,
      transactionCostBps: transactionCostBps ? Number(transactionCostBps) : 5,
      slippageBps: slippageBps ? Number(slippageBps) : 5,
    });
  }

  @ApiOperation({
    summary: "Calibration multi-actions du TechnicalAgent",
    description:
      "Optimise le seuil sur train (60%), le fige, puis mesure validation (20%) et test hors echantillon (20%) sur plusieurs titres et horizons.",
  })
  @ApiQuery({ name: "tickers", required: false, example: "AAPL,MSFT,NVDA,GOOGL,AMZN,META,TSLA,JPM,JNJ,XOM,UNH,PG,HD,CAT,COST" })
  @ApiQuery({ name: "benchmark", required: false, example: "SPY" })
  @ApiQuery({ name: "period", required: false, enum: ["2y", "5y", "10y"], example: "5y" })
  @ApiQuery({ name: "horizons", required: false, example: "5,20,60" })
  @ApiQuery({ name: "transactionCostBps", required: false, type: Number, example: 5 })
  @ApiQuery({ name: "slippageBps", required: false, type: Number, example: 5 })
  @ApiOkResponse({ type: TechnicalCalibrationResultDto })
  @Get("backtesting/calibration")
  getTechnicalCalibration(
    @Query("tickers") tickers?: string,
    @Query("benchmark") benchmark?: string,
    @Query("period") period?: string,
    @Query("horizons") horizons?: string,
    @Query("transactionCostBps") transactionCostBps?: string,
    @Query("slippageBps") slippageBps?: string,
  ) {
    return this.stocksService.getTechnicalCalibration({
      tickers,
      benchmark: benchmark ?? "SPY",
      period: period ?? "5y",
      horizons: horizons ?? "5,20,60",
      transactionCostBps: transactionCostBps ? Number(transactionCostBps) : 5,
      slippageBps: slippageBps ? Number(slippageBps) : 5,
    });
  }

  @ApiOperation({
    summary: "Journal point-in-time d'une action",
    description:
      "Retourne uniquement les evenements disponibles a la date asOf. observedOnly exclut les donnees reconstruites a posteriori.",
  })
  @ApiParam({ name: "ticker", example: "MSFT" })
  @ApiQuery({ name: "component", required: false, example: "fundamental" })
  @ApiQuery({ name: "eventType", required: false, example: "financial_statement" })
  @ApiQuery({ name: "asOf", required: false, example: "2025-07-30T12:00:00Z" })
  @ApiQuery({ name: "observedOnly", required: false, type: Boolean, example: true })
  @ApiQuery({ name: "limit", required: false, type: Number, example: 100 })
  @ApiOkResponse({ type: PointInTimeQueryResultDto })
  @Get(":ticker/timeline")
  getPointInTimeEvents(
    @Param("ticker") ticker: string,
    @Query("component") component?: string,
    @Query("eventType") eventType?: string,
    @Query("asOf") asOf?: string,
    @Query("observedOnly") observedOnly?: string,
    @Query("limit") limit?: string,
  ) {
    return this.stocksService.getPointInTimeEvents(ticker, {
      component,
      eventType,
      asOf,
      observedOnly: observedOnly === "true",
      limit: limit ? Number(limit) : 100,
    });
  }

  @ApiOperation({
    summary: "Couverture de l'archive point-in-time",
    description: "Compte les evenements par composant, type et mode de connaissance.",
  })
  @ApiParam({ name: "ticker", example: "MSFT" })
  @ApiOkResponse({ type: PointInTimeSummaryDto })
  @Get(":ticker/timeline/summary")
  getPointInTimeSummary(@Param("ticker") ticker: string) {
    return this.stocksService.getPointInTimeSummary(ticker);
  }

  @ApiOperation({
    summary: "Replay historique multi-agents",
    description:
      "Recalcule Technical, Risk et Synthesis sans appel externe depuis les donnees disponibles a asOf. Le mode strict exclut les prix reconstruits.",
  })
  @ApiParam({ name: "ticker", example: "MSFT" })
  @ApiQuery({ name: "asOf", required: true, example: "2025-07-30T12:00:00Z" })
  @ApiQuery({
    name: "allowReconstructedPrices",
    required: false,
    type: Boolean,
    example: false,
  })
  @ApiOkResponse({ type: HistoricalReplayResultDto })
  @Get(":ticker/replay")
  replayHistoricalAnalysis(
    @Param("ticker") ticker: string,
    @Query("asOf") asOf: string,
    @Query("allowReconstructedPrices") allowReconstructedPrices?: string,
  ) {
    return this.stocksService.replayHistoricalAnalysis(
      ticker,
      asOf,
      allowReconstructedPrices === "true",
    );
  }

  @ApiOperation({
    summary: "Actualites + sentiment via NewsAgent",
    description:
      "Agrege les news FMP + Yahoo RSS, deduplique, puis analyse le sentiment global et par article via le SLM Nebius.",
  })
  @ApiParam({ name: "ticker", example: "AAPL", description: "Symbole boursier" })
  @ApiOkResponse({ type: NewsResultDto })
  @Get(":ticker/news")
  getNews(@Param("ticker") ticker: string) {
    return this.stocksService.getNews(ticker);
  }

  @ApiOperation({
    summary: "Signal social independant via Reddit",
    description:
      "Collecte et resume les publications sociales publiques. Cet endpoint est volontairement exclu de NewsAgent, RiskAgent, SynthesisAgent et du pipeline LangGraph.",
  })
  @ApiParam({ name: "ticker", example: "AAPL", description: "Symbole boursier" })
  @ApiQuery({ name: "fresh", required: false, type: Boolean })
  @ApiQuery({ name: "withSlm", required: false, type: Boolean })
  @ApiOkResponse({ type: SocialMediaResultDto })
  @Get(":ticker/social-media")
  getSocialMedia(
    @Param("ticker") ticker: string,
    @Query("fresh") fresh?: string,
    @Query("withSlm") withSlm?: string,
  ) {
    return this.stocksService.getSocialMedia(
      ticker,
      fresh === "true",
      withSlm !== "false",
    );
  }

  @ApiOperation({
    summary: "Diagnostic de risque via RiskAgent",
    description:
      "Combine MarketDataAgent, TechnicalAgent et NewsAgent pour produire un score de risque, un niveau global et des risques justifies par des preuves.",
  })
  @ApiParam({ name: "ticker", example: "MSFT", description: "Symbole boursier" })
  @ApiOkResponse({ type: RiskResultDto })
  @Get(":ticker/risk")
  getRisk(@Param("ticker") ticker: string) {
    return this.stocksService.getRisk(ticker);
  }

  @ApiOperation({
    summary: "Evaluation qualite du RiskAgent",
    description:
      "Calcule les 12 metriques de coherence du diagnostic de risque (score, grade, passed) pour la page Metriques des agents.",
  })
  @ApiParam({ name: "ticker", example: "MSFT", description: "Symbole boursier a evaluer" })
  @ApiOkResponse({ type: EvaluationReportDto })
  @Get(":ticker/risk/evaluation")
  getRiskEvaluation(@Param("ticker") ticker: string) {
    return this.stocksService.getRiskEvaluation(ticker);
  }

  @ApiOperation({
    summary: "RAGAgent : indexer les documents SEC (10-K/10-Q)",
    description:
      "Telecharge les derniers depots SEC EDGAR du ticker, les decoupe et les indexe dans la base vectorielle. A lancer avant d'interroger.",
  })
  @ApiParam({ name: "ticker", example: "MSFT", description: "Symbole boursier" })
  @ApiQuery({ name: "limit", required: false, example: 2, description: "Nombre de depots a indexer (defaut 2)" })
  @ApiOkResponse({ type: RagIngestResultDto })
  @Post(":ticker/rag/ingest")
  ingestRag(@Param("ticker") ticker: string, @Query("limit") limit?: string) {
    return this.stocksService.ingestRag(ticker, limit ? Number(limit) : 2);
  }

  @ApiOperation({
    summary: "RAGAgent : interroger les documents financiers",
    description:
      "Recherche semantique dans les depots SEC indexes et renvoie une reponse sourcee (citations [1], [2]) avec les passages.",
  })
  @ApiParam({ name: "ticker", example: "MSFT", description: "Symbole boursier" })
  @ApiQuery({ name: "q", required: true, example: "Quels sont les principaux facteurs de risque ?" })
  @ApiOkResponse({ type: RagResultDto })
  @Get(":ticker/rag/query")
  queryRag(@Param("ticker") ticker: string, @Query("q") q: string) {
    return this.stocksService.queryRag(ticker, q ?? "");
  }

  @ApiOperation({
    summary: "Evaluation qualite du RAGAgent",
    description:
      "Ingere si besoin puis evalue une requete standard (corpus, pertinence, ancrage, tracabilite) pour la page Metriques des agents.",
  })
  @ApiParam({ name: "ticker", example: "MSFT", description: "Symbole boursier a evaluer" })
  @ApiOkResponse({ type: EvaluationReportDto })
  @Get(":ticker/rag/evaluation")
  getRagEvaluation(@Param("ticker") ticker: string) {
    return this.stocksService.getRagEvaluation(ticker);
  }

  @ApiOperation({
    summary: "Evaluation qualite du NewsAgent",
    description:
      "Calcule les 11 metriques de qualite des actualites (score, grade, passed) pour la page Metriques des agents.",
  })
  @ApiParam({ name: "ticker", example: "AAPL", description: "Symbole boursier a evaluer" })
  @ApiOkResponse({ type: EvaluationReportDto })
  @Get(":ticker/news/evaluation")
  getNewsEvaluation(@Param("ticker") ticker: string) {
    return this.stocksService.getNewsEvaluation(ticker);
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
}
