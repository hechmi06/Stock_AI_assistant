import { ApiProperty } from "@nestjs/swagger";

class MovingAveragesDto {
  @ApiProperty({ example: 386.2, nullable: true })
  sma_20!: number | null;

  @ApiProperty({ example: 371.8, nullable: true })
  sma_50!: number | null;

  @ApiProperty({ example: 384.6, nullable: true })
  ema_20!: number | null;

  @ApiProperty({ example: 372.4, nullable: true })
  ema_50!: number | null;

  @ApiProperty({ example: 341.8, nullable: true })
  ema_200!: number | null;
}

class MacdIndicatorDto {
  @ApiProperty({ example: 2.14, nullable: true })
  macd!: number | null;

  @ApiProperty({ example: 1.82, nullable: true })
  signal!: number | null;

  @ApiProperty({ example: 0.32, nullable: true })
  histogram!: number | null;
}

class BollingerBandsDto {
  @ApiProperty({ example: 405.2, nullable: true })
  upper!: number | null;

  @ApiProperty({ example: 386.1, nullable: true })
  middle!: number | null;

  @ApiProperty({ example: 367.0, nullable: true })
  lower!: number | null;

  @ApiProperty({ example: 72.4, nullable: true })
  position_percent!: number | null;
}

class TechnicalSlmSummaryDto {
  @ApiProperty({ example: "nebius" })
  provider!: string;

  @ApiProperty({ example: "Qwen/Qwen3-30B-A3B-Instruct-2507" })
  model!: string;

  @ApiProperty({ example: "Les indicateurs sont coherents : tendance haussiere confirmee par le volume." })
  summary!: string;

  @ApiProperty({ example: "bon" })
  data_quality!: string;

  @ApiProperty({ example: ["RSI en zone saine", "Prix au-dessus des moyennes mobiles"], type: [String] })
  key_points!: string[];

  @ApiProperty({ example: ["Volatilite elevee sur 20 seances"], type: [String] })
  warnings!: string[];
}

class VolumeAnalysisDto {
  @ApiProperty({ example: 21500000, nullable: true })
  last_volume!: number | null;

  @ApiProperty({ example: 24800000, nullable: true })
  average_volume!: number | null;

  @ApiProperty({ example: 0.87, nullable: true })
  volume_ratio!: number | null;

  @ApiProperty({ example: "volume dans la moyenne" })
  interpretation!: string;
}

export class TechnicalResultDto {
  @ApiProperty({ example: "MSFT" })
  ticker!: string;

  @ApiProperty({ enum: ["success", "partial", "failed"], example: "success" })
  status!: "success" | "partial" | "failed";

  @ApiProperty({
    enum: ["twelve_data", "yfinance", "alpha_vantage", "financial_modeling_prep", "tiingo"],
    isArray: true,
    example: ["twelve_data", "financial_modeling_prep"],
  })
  sources_used!: Array<"twelve_data" | "yfinance" | "alpha_vantage" | "financial_modeling_prep" | "tiingo">;

  @ApiProperty({ example: 58.4, nullable: true, description: "RSI 14 (Wilder)" })
  rsi!: number | null;

  @ApiProperty({ type: MovingAveragesDto })
  moving_averages!: MovingAveragesDto;

  @ApiProperty({ type: MacdIndicatorDto })
  macd!: MacdIndicatorDto;

  @ApiProperty({ example: 6.4, nullable: true })
  atr_14!: number | null;

  @ApiProperty({ example: 1.65, nullable: true })
  atr_percent!: number | null;

  @ApiProperty({ type: BollingerBandsDto })
  bollinger_bands!: BollingerBandsDto;

  @ApiProperty({ example: 1.9, nullable: true, description: "Ecart type des rendements quotidiens (%)" })
  volatility!: number | null;

  @ApiProperty({ enum: ["bullish", "bearish", "neutral"], example: "bullish" })
  trend!: "bullish" | "bearish" | "neutral";

  @ApiProperty({ example: 374.5, nullable: true, description: "Plus bas des 30 dernieres seances" })
  support_level!: number | null;

  @ApiProperty({ example: 402.3, nullable: true, description: "Plus haut des 30 dernieres seances" })
  resistance_level!: number | null;

  @ApiProperty({ type: VolumeAnalysisDto })
  volume_analysis!: VolumeAnalysisDto;

  @ApiProperty({ example: 72, nullable: true, minimum: 0, maximum: 100 })
  technical_score!: number | null;

  @ApiProperty({ enum: ["positive", "negative", "neutral"], example: "positive" })
  signal!: "positive" | "negative" | "neutral";

  @ApiProperty({ example: [], type: [String] })
  errors!: string[];

  @ApiProperty({ type: TechnicalSlmSummaryDto, nullable: true })
  slm_summary!: TechnicalSlmSummaryDto | null;
}
