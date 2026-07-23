import { Body, Controller, Post, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import {
  PortfolioAnalysisRequestDto,
  PortfolioAnalysisResultDto,
  PortfolioCompleteAnalysisResultDto,
  PortfolioRecommendationRequestDto,
  PortfolioRecommendationResultDto,
} from "./dto/portfolio-analysis.dto";
import { PortfolioService } from "./portfolio.service";

@ApiTags("portfolio")
@Controller("portfolio")
export class PortfolioController {
  constructor(private readonly portfolioService: PortfolioService) {}

  @ApiOperation({
    summary: "Valoriser et analyser un portefeuille",
    description:
      "Valorisation long-only via MarketDataAgent, P&L, allocations, concentration, diversification et confiance des donnees.",
  })
  @ApiQuery({ name: "fresh", required: false, type: Boolean })
  @ApiOkResponse({ type: PortfolioAnalysisResultDto })
  @Post("analyze")
  analyze(
    @Body() request: PortfolioAnalysisRequestDto,
    @Query("fresh") fresh?: string,
  ) {
    return this.portfolioService.analyze(request, fresh === "true");
  }

  @ApiOperation({
    summary: "Executer l'analyse multi-agents complete du portefeuille",
    description:
      "Analyse chaque action avec le workflow existant, puis utilise un PortfolioSynthesisAgent et un SLM independants.",
  })
  @ApiQuery({ name: "fresh", required: false, type: Boolean })
  @ApiQuery({ name: "withPortfolioSlm", required: false, type: Boolean })
  @ApiOkResponse({ type: PortfolioCompleteAnalysisResultDto })
  @Post("full-analysis")
  analyzeComplete(
    @Body() request: PortfolioAnalysisRequestDto,
    @Query("fresh") fresh?: string,
    @Query("withPortfolioSlm") withPortfolioSlm?: string,
  ) {
    return this.portfolioService.analyzeComplete(
      request,
      fresh === "true",
      withPortfolioSlm !== "false",
    );
  }

  @ApiOperation({
    summary: "Generer une recommandation de portefeuille detaillee",
    description:
      "Selectionne des entreprises selon le profil, compose une allocation contrainte et la valide avec les agents specialises.",
  })
  @ApiQuery({ name: "fresh", required: false, type: Boolean })
  @ApiQuery({ name: "withSlm", required: false, type: Boolean })
  @ApiOkResponse({ type: PortfolioRecommendationResultDto })
  @Post("recommend")
  recommend(
    @Body() request: PortfolioRecommendationRequestDto,
    @Query("fresh") fresh?: string,
    @Query("withSlm") withSlm?: string,
  ) {
    return this.portfolioService.recommend(
      request,
      fresh === "true",
      withSlm !== "false",
    );
  }
}
