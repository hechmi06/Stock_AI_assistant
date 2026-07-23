import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import type {
  PortfolioAnalysisRequestDto,
  PortfolioAnalysisResultDto,
  PortfolioCompleteAnalysisResultDto,
  PortfolioRecommendationRequestDto,
  PortfolioRecommendationResultDto,
} from "./dto/portfolio-analysis.dto";

@Injectable()
export class PortfolioService {
  private readonly aiBackendUrl = process.env.AI_BACKEND_URL ?? "http://localhost:8000";

  async analyze(
    request: PortfolioAnalysisRequestDto,
    fresh = false,
  ): Promise<PortfolioAnalysisResultDto> {
    try {
      const response = await fetch(
        `${this.aiBackendUrl}/agents/portfolio/analyze?fresh=${fresh}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        },
      );
      if (!response.ok) {
        throw new Error(`AI backend returned ${response.status}`);
      }
      return (await response.json()) as PortfolioAnalysisResultDto;
    } catch (error) {
      throw new ServiceUnavailableException(
        error instanceof Error
          ? `PortfolioAgent indisponible: ${error.message}`
          : "PortfolioAgent indisponible.",
      );
    }
  }

  async analyzeComplete(
    request: PortfolioAnalysisRequestDto,
    fresh = false,
    withPortfolioSlm = true,
  ): Promise<PortfolioCompleteAnalysisResultDto> {
    try {
      const response = await fetch(
        `${this.aiBackendUrl}/agents/portfolio/full-analysis?fresh=${fresh}&with_portfolio_slm=${withPortfolioSlm}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        },
      );
      if (!response.ok) {
        throw new Error(`AI backend returned ${response.status}`);
      }
      return (await response.json()) as PortfolioCompleteAnalysisResultDto;
    } catch (error) {
      throw new ServiceUnavailableException(
        error instanceof Error
          ? `Analyse complete du portefeuille indisponible: ${error.message}`
          : "Analyse complete du portefeuille indisponible.",
      );
    }
  }

  async recommend(
    request: PortfolioRecommendationRequestDto,
    fresh = false,
    withSlm = true,
  ): Promise<PortfolioRecommendationResultDto> {
    try {
      const response = await fetch(
        `${this.aiBackendUrl}/agents/portfolio/recommend?fresh=${fresh}&with_slm=${withSlm}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        },
      );
      if (!response.ok) {
        throw new Error(`AI backend returned ${response.status}`);
      }
      return (await response.json()) as PortfolioRecommendationResultDto;
    } catch (error) {
      throw new ServiceUnavailableException(
        error instanceof Error
          ? `PortfolioRecommendationAgent indisponible: ${error.message}`
          : "PortfolioRecommendationAgent indisponible.",
      );
    }
  }
}
