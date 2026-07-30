import { ApiProperty } from "@nestjs/swagger";

class BacktestMetricsDto {
  @ApiProperty({ example: 32.4 })
  strategy_return_percent!: number;

  @ApiProperty({ example: 41.8 })
  ticker_buy_hold_return_percent!: number;

  @ApiProperty({ example: 27.1 })
  benchmark_return_percent!: number;

  @ApiProperty({ example: 5.3 })
  excess_return_percent!: number;

  @ApiProperty({ example: 7.8 })
  annualized_return_percent!: number;

  @ApiProperty({ example: 12.6 })
  annualized_volatility_percent!: number;

  @ApiProperty({ example: 0.62, nullable: true })
  sharpe_ratio!: number | null;

  @ApiProperty({ example: 11.7 })
  max_drawdown_percent!: number;

  @ApiProperty({ example: 1.2 })
  average_trade_return_percent!: number;

  @ApiProperty({ example: 58.3, nullable: true })
  directional_accuracy_percent!: number | null;

  @ApiProperty({ example: 61.5, nullable: true })
  invested_win_rate_percent!: number | null;

  @ApiProperty({ example: -0.42, nullable: true })
  mean_return_ci_95_low_percent!: number | null;

  @ApiProperty({ example: 1.18, nullable: true })
  mean_return_ci_95_high_percent!: number | null;
}

class QualificationCheckDto {
  @ApiProperty({ example: "test_excess" })
  name!: string;

  @ApiProperty({ example: true })
  passed!: boolean;

  @ApiProperty({ example: 0.84, nullable: true })
  actual!: number | string | null;

  @ApiProperty({ example: "> 0%" })
  threshold!: string;
}

class BacktestCalibrationBucketDto {
  @ApiProperty({ example: "Positif" })
  label!: string;

  @ApiProperty({ example: 65 })
  score_min!: number;

  @ApiProperty({ example: 100 })
  score_max!: number;

  @ApiProperty({ example: 18 })
  observations!: number;

  @ApiProperty({ example: 1.6, nullable: true })
  average_forward_return_percent!: number | null;

  @ApiProperty({ example: 61.1, nullable: true })
  positive_return_rate_percent!: number | null;
}

class BacktestObservationDto {
  @ApiProperty({ example: "2024-03-01" })
  signal_date!: string;

  @ApiProperty({ example: "2024-04-01" })
  exit_date!: string;

  @ApiProperty({ example: 75 })
  technical_score!: number;

  @ApiProperty({ enum: ["positive", "neutral", "negative"], example: "positive" })
  signal!: "positive" | "neutral" | "negative";

  @ApiProperty({ example: 182.4 })
  entry_price!: number;

  @ApiProperty({ example: 190.2 })
  exit_price!: number;

  @ApiProperty({ example: 4.28 })
  forward_return_percent!: number;

  @ApiProperty({ example: 4.28 })
  strategy_return_percent!: number;

  @ApiProperty({ example: 2.1 })
  benchmark_return_percent!: number;

  @ApiProperty({ example: 14.5 })
  cumulative_strategy_percent!: number;

  @ApiProperty({ example: 12.8 })
  cumulative_ticker_percent!: number;

  @ApiProperty({ example: 9.4 })
  cumulative_benchmark_percent!: number;

  @ApiProperty({
    example: { rsi_momentum: 0.42, price_vs_sma50: 0.18, macd_atr: -0.08 },
    description: "Facteurs directionnels normalises entre -1 et 1.",
  })
  feature_signals!: Record<string, number>;
}

export class BacktestResultDto {
  @ApiProperty({ example: "AAPL" })
  ticker!: string;

  @ApiProperty({ example: "SPY" })
  benchmark!: string;

  @ApiProperty({ enum: ["success", "partial", "failed"], example: "success" })
  status!: "success" | "partial" | "failed";

  @ApiProperty({ example: "walk_forward_long_cash" })
  methodology!: "walk_forward_long_cash";

  @ApiProperty({ example: "5y" })
  period!: string;

  @ApiProperty({ example: 20 })
  horizon_days!: number;

  @ApiProperty({ example: 60 })
  min_history!: number;

  @ApiProperty({ example: 5 })
  transaction_cost_bps!: number;

  @ApiProperty({ example: 5 })
  slippage_bps!: number;

  @ApiProperty({ example: "2021-08-20", nullable: true })
  period_start!: string | null;

  @ApiProperty({ example: "2026-07-29", nullable: true })
  period_end!: string | null;

  @ApiProperty({ example: 1250 })
  history_points!: number;

  @ApiProperty({ example: 59 })
  evaluation_count!: number;

  @ApiProperty({ example: { positive: 25, neutral: 30, negative: 4 } })
  signal_counts!: Record<string, number>;

  @ApiProperty({ enum: ["low", "medium", "high"], example: "high" })
  reliability_level!: "low" | "medium" | "high";

  @ApiProperty({ enum: ["validated", "recalibrate", "not_validated", "insufficient"] })
  verdict!: "validated" | "recalibrate" | "not_validated" | "insufficient";

  @ApiProperty({ example: true })
  lookahead_guard!: boolean;

  @ApiProperty({ type: [QualificationCheckDto] })
  qualification_checks!: QualificationCheckDto[];

  @ApiProperty({ type: BacktestMetricsDto })
  metrics!: BacktestMetricsDto;

  @ApiProperty({ type: [BacktestCalibrationBucketDto] })
  calibration!: BacktestCalibrationBucketDto[];

  @ApiProperty({ type: [BacktestObservationDto] })
  observations!: BacktestObservationDto[];

  @ApiProperty({ type: [String], example: ["fundamental", "news", "rag", "risk", "synthesis", "slm"] })
  excluded_components!: string[];

  @ApiProperty({ type: [String] })
  warnings!: string[];

  @ApiProperty({ type: [String] })
  errors!: string[];
}

class CalibrationSplitMetricsDto {
  @ApiProperty({ example: 186 })
  observations!: number;

  @ApiProperty({ example: 74 })
  invested_trades!: number;

  @ApiProperty({ example: 0.42 })
  average_strategy_return_percent!: number;

  @ApiProperty({ example: 0.31 })
  average_benchmark_return_percent!: number;

  @ApiProperty({ example: 0.11 })
  average_excess_return_percent!: number;

  @ApiProperty({ example: 0.72, nullable: true })
  annualized_sharpe_ratio!: number | null;

  @ApiProperty({ example: 54.1, nullable: true })
  win_rate_percent!: number | null;

  @ApiProperty({ example: -0.08, nullable: true })
  mean_return_ci_95_low_percent!: number | null;

  @ApiProperty({ example: 0.3, nullable: true })
  mean_return_ci_95_high_percent!: number | null;
}

class TechnicalFeatureDiagnosticDto {
  @ApiProperty({ example: "price_vs_ema200" })
  name!: string;

  @ApiProperty({ example: "Prix vs EMA 200" })
  label!: string;

  @ApiProperty({ example: 0.08, nullable: true })
  train_information_coefficient!: number | null;

  @ApiProperty({ example: 0.05, nullable: true })
  validation_information_coefficient!: number | null;

  @ApiProperty({ example: 0.03, nullable: true })
  test_information_coefficient!: number | null;

  @ApiProperty({ example: 84.2 })
  train_coverage_percent!: number;

  @ApiProperty({ example: true })
  selected!: boolean;

  @ApiProperty({ example: null, nullable: true })
  rejection_reason!: string | null;

  @ApiProperty({ example: 0.31 })
  weight!: number;
}

class TechnicalFeatureModelDto {
  @ApiProperty({ enum: ["candidate", "rejected", "insufficient"] })
  status!: "candidate" | "rejected" | "insufficient";

  @ApiProperty({ example: false })
  production_eligible!: boolean;

  @ApiProperty({ type: [String], example: ["price_vs_sma50", "macd_atr"] })
  selected_features!: string[];

  @ApiProperty({ example: { price_vs_sma50: 0.62, macd_atr: 0.38 } })
  weights!: Record<string, number>;

  @ApiProperty({ example: 60 })
  selected_threshold!: number;

  @ApiProperty({ type: CalibrationSplitMetricsDto })
  train!: CalibrationSplitMetricsDto;

  @ApiProperty({ type: CalibrationSplitMetricsDto })
  validation!: CalibrationSplitMetricsDto;

  @ApiProperty({ type: CalibrationSplitMetricsDto })
  test!: CalibrationSplitMetricsDto;

  @ApiProperty({ type: CalibrationSplitMetricsDto })
  baseline_test!: CalibrationSplitMetricsDto;

  @ApiProperty({ example: 0.12 })
  test_excess_uplift_percent!: number;

  @ApiProperty({ type: [TechnicalFeatureDiagnosticDto] })
  diagnostics!: TechnicalFeatureDiagnosticDto[];

  @ApiProperty({ type: [QualificationCheckDto] })
  checks!: QualificationCheckDto[];

  @ApiProperty({ type: [String] })
  notes!: string[];
}

class CalibrationHorizonResultDto {
  @ApiProperty({ example: 20 })
  horizon_days!: number;

  @ApiProperty({ example: 70 })
  selected_threshold!: number;

  @ApiProperty({ type: CalibrationSplitMetricsDto })
  train!: CalibrationSplitMetricsDto;

  @ApiProperty({ type: CalibrationSplitMetricsDto })
  validation!: CalibrationSplitMetricsDto;

  @ApiProperty({ type: CalibrationSplitMetricsDto })
  test!: CalibrationSplitMetricsDto;

  @ApiProperty({ enum: ["validated", "promising", "not_validated", "insufficient"] })
  verdict!: "validated" | "promising" | "not_validated" | "insufficient";

  @ApiProperty({ type: [QualificationCheckDto] })
  checks!: QualificationCheckDto[];

  @ApiProperty({ type: TechnicalFeatureModelDto })
  feature_model!: TechnicalFeatureModelDto;
}

class CalibrationTickerCoverageDto {
  @ApiProperty({ example: "AAPL" })
  ticker!: string;

  @ApiProperty({ enum: ["success", "partial", "failed"] })
  status!: "success" | "partial" | "failed";

  @ApiProperty({ example: { "5": 240, "20": 62, "60": 20 } })
  observations_by_horizon!: Record<string, number>;

  @ApiProperty({ nullable: true })
  error!: string | null;
}

export class TechnicalCalibrationResultDto {
  @ApiProperty({ enum: ["success", "partial", "failed"] })
  status!: "success" | "partial" | "failed";

  @ApiProperty({ example: "SPY" })
  benchmark!: string;

  @ApiProperty({ example: "5y" })
  period!: string;

  @ApiProperty({ type: [String] })
  tickers_requested!: string[];

  @ApiProperty({ type: [String] })
  tickers_completed!: string[];

  @ApiProperty({ type: [Number], example: [5, 20, 60] })
  horizons!: number[];

  @ApiProperty({ example: 5 })
  transaction_cost_bps!: number;

  @ApiProperty({ example: 5 })
  slippage_bps!: number;

  @ApiProperty({ example: { train: 0.6, validation: 0.2, test: 0.2 } })
  split!: Record<string, number>;

  @ApiProperty({ example: "chronological_train_validation_test" })
  methodology!: "chronological_train_validation_test";

  @ApiProperty({ enum: ["validated", "promising", "not_validated", "insufficient"] })
  overall_verdict!: "validated" | "promising" | "not_validated" | "insufficient";

  @ApiProperty({ type: [CalibrationHorizonResultDto] })
  horizon_results!: CalibrationHorizonResultDto[];

  @ApiProperty({ type: [CalibrationTickerCoverageDto] })
  coverage!: CalibrationTickerCoverageDto[];

  @ApiProperty({ type: [String] })
  warnings!: string[];

  @ApiProperty({ type: [String] })
  errors!: string[];
}
