import { ApiProperty } from "@nestjs/swagger";

export class PortfolioHoldingDto {
  @ApiProperty({ example: "AAPL" })
  ticker!: string;

  @ApiProperty({ example: 20, minimum: 0.000001 })
  quantity!: number;

  @ApiProperty({ example: 190, minimum: 0 })
  average_cost!: number;
}

export class PortfolioAnalysisRequestDto {
  @ApiProperty({ type: [PortfolioHoldingDto] })
  holdings!: PortfolioHoldingDto[];

  @ApiProperty({ example: 5000, minimum: 0, default: 0 })
  cash!: number;

  @ApiProperty({ example: "USD", default: "USD" })
  base_currency!: string;

  @ApiProperty({ example: "SPY", default: "SPY" })
  benchmark_ticker!: string;

  @ApiProperty({ example: 4, default: 0, description: "Taux annuel en pourcentage" })
  risk_free_rate_percent!: number;
}

class PortfolioTechnicalSnapshotDto {
  @ApiProperty({ enum: ["success", "partial", "failed"] }) status!: string;
  @ApiProperty({ nullable: true, example: 56.4 }) rsi!: number | null;
  @ApiProperty({ nullable: true }) sma_20!: number | null;
  @ApiProperty({ nullable: true }) sma_50!: number | null;
  @ApiProperty({ nullable: true }) volatility!: number | null;
  @ApiProperty({ enum: ["bullish", "bearish", "neutral"] }) trend!: string;
  @ApiProperty({ nullable: true }) support_level!: number | null;
  @ApiProperty({ nullable: true }) resistance_level!: number | null;
  @ApiProperty({ nullable: true }) technical_score!: number | null;
  @ApiProperty({ enum: ["positive", "negative", "neutral"] }) signal!: string;
}

class PortfolioPositionDto {
  @ApiProperty({ example: "AAPL" }) ticker!: string;
  @ApiProperty({ example: "Apple Inc.", nullable: true }) name!: string | null;
  @ApiProperty({ example: "Technology" }) sector!: string;
  @ApiProperty({ example: 20 }) quantity!: number;
  @ApiProperty({ example: 190 }) average_cost!: number;
  @ApiProperty({ example: 213.4, nullable: true }) current_price!: number | null;
  @ApiProperty({ example: 3800 }) cost_basis!: number;
  @ApiProperty({ example: 4268, nullable: true }) market_value!: number | null;
  @ApiProperty({ example: 468, nullable: true }) unrealized_pnl!: number | null;
  @ApiProperty({ example: 12.32, nullable: true }) unrealized_pnl_percent!: number | null;
  @ApiProperty({ example: 1.84, nullable: true }) day_change_percent!: number | null;
  @ApiProperty({ example: 77.08, nullable: true }) day_pnl!: number | null;
  @ApiProperty({ example: 31.4 }) weight!: number;
  @ApiProperty({ example: "USD", nullable: true }) currency!: string | null;
  @ApiProperty({ enum: ["success", "partial", "failed"] }) data_status!: string;
  @ApiProperty({ type: [String] }) sources_used!: string[];
  @ApiProperty({ type: [String] }) warnings!: string[];
  @ApiProperty({ type: PortfolioTechnicalSnapshotDto }) technical!: PortfolioTechnicalSnapshotDto;
}

class PortfolioAllocationDto {
  @ApiProperty({ example: "Technology" }) label!: string;
  @ApiProperty({ example: 4268 }) value!: number;
  @ApiProperty({ example: 31.4 }) weight!: number;
}

class PortfolioSummaryDto {
  @ApiProperty({ example: 13590 }) total_value!: number;
  @ApiProperty({ example: 8590 }) invested_value!: number;
  @ApiProperty({ example: 5000 }) cash!: number;
  @ApiProperty({ example: 8000 }) total_cost!: number;
  @ApiProperty({ example: 590 }) unrealized_pnl!: number;
  @ApiProperty({ example: 7.38, nullable: true }) unrealized_pnl_percent!: number | null;
  @ApiProperty({ example: 83 }) day_pnl!: number;
  @ApiProperty({ example: 0.97, nullable: true }) day_change_percent!: number | null;
}

class PortfolioRiskDto {
  @ApiProperty({ example: 36 }) concentration_score!: number;
  @ApiProperty({ enum: ["low", "medium", "high"] }) concentration_level!: string;
  @ApiProperty({ example: 64 }) diversification_score!: number;
  @ApiProperty({ enum: ["low", "medium", "high"] }) diversification_level!: string;
  @ApiProperty({ example: "AAPL", nullable: true }) largest_position_ticker!: string | null;
  @ApiProperty({ example: 49.69 }) largest_position_weight!: number;
  @ApiProperty({ example: 100 }) top_three_weight!: number;
  @ApiProperty({ example: 2.78 }) effective_holdings!: number;
  @ApiProperty({ example: 100 }) data_confidence_score!: number;
  @ApiProperty({ enum: ["low", "medium", "high"] }) data_confidence_level!: string;
}

class PortfolioPerformanceDto {
  @ApiProperty({ example: "SPY" }) benchmark_ticker!: string;
  @ApiProperty({ example: 124 }) observation_count!: number;
  @ApiProperty({ nullable: true }) period_start!: string | null;
  @ApiProperty({ nullable: true }) period_end!: string | null;
  @ApiProperty({ nullable: true }) cumulative_return_percent!: number | null;
  @ApiProperty({ nullable: true }) annualized_return_percent!: number | null;
  @ApiProperty({ nullable: true }) annualized_volatility_percent!: number | null;
  @ApiProperty({ nullable: true }) benchmark_cumulative_return_percent!: number | null;
  @ApiProperty({ nullable: true }) benchmark_annualized_return_percent!: number | null;
  @ApiProperty({ nullable: true }) benchmark_annualized_volatility_percent!: number | null;
  @ApiProperty({ nullable: true }) beta!: number | null;
  @ApiProperty({ nullable: true }) sharpe_ratio!: number | null;
  @ApiProperty({ nullable: true }) treynor_ratio_percent!: number | null;
  @ApiProperty({ nullable: true }) jensen_alpha_percent!: number | null;
  @ApiProperty({ nullable: true }) max_drawdown_percent!: number | null;
  @ApiProperty({ nullable: true }) average_correlation!: number | null;
}

class PortfolioTechnicalSummaryDto {
  @ApiProperty({ nullable: true }) weighted_score!: number | null;
  @ApiProperty() bullish_positions!: number;
  @ApiProperty() neutral_positions!: number;
  @ApiProperty() bearish_positions!: number;
  @ApiProperty() overbought_positions!: number;
  @ApiProperty() oversold_positions!: number;
}

class PortfolioCorrelationDto {
  @ApiProperty({ example: "AAPL" }) ticker_a!: string;
  @ApiProperty({ example: "MSFT" }) ticker_b!: string;
  @ApiProperty({ example: 0.63 }) correlation!: number;
}

class PortfolioHoldingAnalysisDto {
  @ApiProperty({ example: "AAPL" }) ticker!: string;
  @ApiProperty({ enum: ["success", "partial", "failed"] }) status!: string;
  @ApiProperty({ example: 72 }) global_score!: number;
  @ApiProperty({ example: "a_surveiller" }) recommendation!: string;
  @ApiProperty({ example: 84 }) confidence_score!: number;
  @ApiProperty({ example: 31 }) risk_score!: number;
  @ApiProperty({ enum: ["low", "medium", "high"] }) risk_level!: string;
  @ApiProperty() technical_score!: number;
  @ApiProperty() fundamental_score!: number;
  @ApiProperty() news_score!: number;
  @ApiProperty() summary!: string;
  @ApiProperty({ type: [String] }) key_risks!: string[];
  @ApiProperty({ type: [String] }) sources!: string[];
}

class PortfolioSynthesisScoresDto {
  @ApiProperty() individual_quality!: number;
  @ApiProperty() diversification!: number;
  @ApiProperty() risk_adjusted_performance!: number;
  @ApiProperty() technical_alignment!: number;
  @ApiProperty() data_quality!: number;
}

class PortfolioPositionAssessmentDto {
  @ApiProperty() ticker!: string;
  @ApiProperty() current_weight!: number;
  @ApiProperty() target_weight!: number;
  @ApiProperty({ nullable: true }) global_score!: number | null;
  @ApiProperty() confidence_score!: number;
  @ApiProperty({ enum: ["low", "medium", "high"] }) risk_level!: string;
  @ApiProperty({ example: "reduire" }) decision!: string;
  @ApiProperty() rationale!: string;
}

class PortfolioRebalancingItemDto {
  @ApiProperty() label!: string;
  @ApiProperty() current_weight!: number;
  @ApiProperty() target_weight!: number;
  @ApiProperty() change_percent!: number;
  @ApiProperty() action!: string;
  @ApiProperty() rationale!: string;
}

class PortfolioSlmSummaryDto {
  @ApiProperty() provider!: string;
  @ApiProperty() model!: string;
  @ApiProperty() summary!: string;
  @ApiProperty() data_quality!: string;
  @ApiProperty({ type: [String] }) key_points!: string[];
  @ApiProperty({ type: [String] }) warnings!: string[];
}

class PortfolioSynthesisResultDto {
  @ApiProperty({ enum: ["success", "partial", "failed"] }) status!: string;
  @ApiProperty({ enum: ["robuste", "coherent", "a_reequilibrer", "fragile", "donnees_insuffisantes"] }) verdict!: string;
  @ApiProperty() global_score!: number;
  @ApiProperty({ description: "Disponibilite, completude et couverture des sources." })
  data_confidence_score!: number;
  @ApiProperty({ description: "Support statistique et completude des metriques calculees." })
  model_confidence_score!: number;
  @ApiProperty({ description: "Confiance finale utilisee pour autoriser le verdict." })
  decision_confidence_score!: number;
  @ApiProperty() confidence_score!: number;
  @ApiProperty({ enum: ["low", "medium", "high"] }) confidence_level!: string;
  @ApiProperty({ type: PortfolioSynthesisScoresDto }) scores!: PortfolioSynthesisScoresDto;
  @ApiProperty({ type: Object }) weights!: Record<string, number>;
  @ApiProperty() summary!: string;
  @ApiProperty({ type: [String] }) strengths!: string[];
  @ApiProperty({ type: [String] }) weaknesses!: string[];
  @ApiProperty({ type: [PortfolioPositionAssessmentDto] }) position_assessments!: PortfolioPositionAssessmentDto[];
  @ApiProperty({ type: [PortfolioRebalancingItemDto] }) rebalancing_plan!: PortfolioRebalancingItemDto[];
  @ApiProperty() analyzed_positions!: number;
  @ApiProperty() requested_positions!: number;
  @ApiProperty({ type: [String] }) warnings!: string[];
  @ApiProperty({ type: [String] }) errors!: string[];
  @ApiProperty({ type: PortfolioSlmSummaryDto, nullable: true }) slm_summary!: PortfolioSlmSummaryDto | null;
}

export class PortfolioAnalysisResultDto {
  @ApiProperty({ enum: ["success", "partial", "failed"] }) status!: string;
  @ApiProperty({ example: "2026-07-20T12:00:00Z" }) generated_at!: string;
  @ApiProperty({ example: "USD" }) base_currency!: string;
  @ApiProperty({ type: [PortfolioPositionDto] }) positions!: PortfolioPositionDto[];
  @ApiProperty({ type: PortfolioSummaryDto }) summary!: PortfolioSummaryDto;
  @ApiProperty({ type: [PortfolioAllocationDto] }) allocation_by_holding!: PortfolioAllocationDto[];
  @ApiProperty({ type: [PortfolioAllocationDto] }) allocation_by_sector!: PortfolioAllocationDto[];
  @ApiProperty({ type: PortfolioRiskDto }) risk!: PortfolioRiskDto;
  @ApiProperty({ type: PortfolioPerformanceDto }) performance!: PortfolioPerformanceDto;
  @ApiProperty({ type: PortfolioTechnicalSummaryDto }) technical_summary!: PortfolioTechnicalSummaryDto;
  @ApiProperty({ type: [PortfolioCorrelationDto] }) correlations!: PortfolioCorrelationDto[];
  @ApiProperty({ type: [String] }) sources_used!: string[];
  @ApiProperty({ type: [String] }) warnings!: string[];
  @ApiProperty({ type: [String] }) errors!: string[];
}

export class PortfolioCompleteAnalysisResultDto {
  @ApiProperty({ enum: ["success", "partial", "failed"] }) status!: string;
  @ApiProperty() generated_at!: string;
  @ApiProperty({ example: "portfolio_multi_agent" }) workflow!: string;
  @ApiProperty({ type: PortfolioAnalysisResultDto }) portfolio!: PortfolioAnalysisResultDto;
  @ApiProperty({ type: [PortfolioHoldingAnalysisDto] }) individual_analyses!: PortfolioHoldingAnalysisDto[];
  @ApiProperty({ type: PortfolioSynthesisResultDto }) synthesis!: PortfolioSynthesisResultDto;
}

export class PortfolioRecommendationRequestDto {
  @ApiProperty({ example: 25000, minimum: 1 }) budget!: number;
  @ApiProperty({ enum: ["conservative", "moderate", "dynamic"], default: "moderate" }) risk_profile!: string;
  @ApiProperty({ enum: ["preservation", "balanced", "growth"], default: "balanced" }) objective!: string;
  @ApiProperty({ example: 5, minimum: 1, maximum: 30 }) horizon_years!: number;
  @ApiProperty({ example: 5, minimum: 3, maximum: 8 }) max_positions!: number;
  @ApiProperty({ nullable: true, required: false, minimum: 0, maximum: 50 }) cash_reserve_percent!: number | null;
  @ApiProperty({ example: "SPY", default: "SPY" }) benchmark_ticker!: string;
  @ApiProperty({ example: 4, default: 0 }) risk_free_rate_percent!: number;
  @ApiProperty({ example: "USD", default: "USD" }) base_currency!: string;
  @ApiProperty({ type: [String], required: false, example: ["TSLA"] }) excluded_tickers!: string[];
}

class RecommendationCandidateScoreDto {
  @ApiProperty() ticker!: string;
  @ApiProperty({ nullable: true }) name!: string | null;
  @ApiProperty() sector!: string;
  @ApiProperty() status!: string;
  @ApiProperty() total_score!: number;
  @ApiProperty() potential_score!: number;
  @ApiProperty() fundamental_score!: number;
  @ApiProperty() technical_score!: number;
  @ApiProperty() stability_score!: number;
  @ApiProperty() momentum_score!: number;
  @ApiProperty() data_quality_score!: number;
  @ApiProperty() value_score!: number;
  @ApiProperty() growth_score!: number;
  @ApiProperty({ nullable: true }) potential_label!: string | null;
  @ApiProperty({ nullable: true }) current_price!: number | null;
  @ApiProperty({ nullable: true }) volatility!: number | null;
  @ApiProperty() quality_gate_passed!: boolean;
  @ApiProperty({ type: [String] }) quality_issues!: string[];
  @ApiProperty({ type: [String] }) reasons!: string[];
  @ApiProperty({ nullable: true }) rejection_reason!: string | null;
}

class RecommendationValidationRecordDto {
  @ApiProperty() round!: number;
  @ApiProperty() ticker!: string;
  @ApiProperty({ enum: ["accepted", "rejected"] }) decision!: string;
  @ApiProperty({
    enum: ["favorable", "a_surveiller", "prudence", "defavorable", "donnees_insuffisantes"],
  })
  recommendation!: string;
  @ApiProperty() global_score!: number;
  @ApiProperty() confidence_score!: number;
  @ApiProperty({ enum: ["low", "medium", "high"] }) risk_level!: string;
  @ApiProperty({ type: [String] }) reasons!: string[];
}

class RecommendedAllocationDto {
  @ApiProperty() ticker!: string;
  @ApiProperty({ nullable: true }) name!: string | null;
  @ApiProperty() sector!: string;
  @ApiProperty() weight!: number;
  @ApiProperty() amount!: number;
  @ApiProperty() quantity!: number;
  @ApiProperty() reference_price!: number;
  @ApiProperty() screening_score!: number;
  @ApiProperty() role!: string;
  @ApiProperty({ type: [String] }) reasons!: string[];
}

export class PortfolioRecommendationResultDto {
  @ApiProperty({ enum: ["success", "partial", "failed"] }) status!: string;
  @ApiProperty() generated_at!: string;
  @ApiProperty({ example: "portfolio_recommendation" }) workflow!: string;
  @ApiProperty({ example: "2.0" }) methodology_version!: string;
  @ApiProperty({ type: PortfolioRecommendationRequestDto }) profile!: PortfolioRecommendationRequestDto;
  @ApiProperty({ type: [String] }) universe!: string[];
  @ApiProperty({ type: [RecommendationCandidateScoreDto] }) candidates!: RecommendationCandidateScoreDto[];
  @ApiProperty({ type: [RecommendedAllocationDto] }) allocations!: RecommendedAllocationDto[];
  @ApiProperty() cash_amount!: number;
  @ApiProperty() cash_weight!: number;
  @ApiProperty() summary!: string;
  @ApiProperty({ type: [String] }) selection_method!: string[];
  @ApiProperty({ type: [String] }) strengths!: string[];
  @ApiProperty({ type: [String] }) risks!: string[];
  @ApiProperty() validation_rounds!: number;
  @ApiProperty({ type: [RecommendationValidationRecordDto] })
  validation_records!: RecommendationValidationRecordDto[];
  @ApiProperty({ type: PortfolioCompleteAnalysisResultDto, nullable: true }) portfolio_analysis!: PortfolioCompleteAnalysisResultDto | null;
  @ApiProperty({ type: [String] }) warnings!: string[];
  @ApiProperty({ type: [String] }) errors!: string[];
  @ApiProperty({ type: PortfolioSlmSummaryDto, nullable: true }) slm_summary!: PortfolioSlmSummaryDto | null;
}
