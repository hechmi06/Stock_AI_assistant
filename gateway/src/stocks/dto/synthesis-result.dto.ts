import { ApiProperty } from "@nestjs/swagger";
import { MarketDataResultDto } from "./market-data-result.dto";
import { NewsResultDto } from "./news-result.dto";
import { RagResultDto } from "./rag-result.dto";
import { RiskResultDto } from "./risk-result.dto";
import { TechnicalResultDto } from "./technical-result.dto";

class SynthesisScoresDto {
  @ApiProperty({ minimum: 0, maximum: 100 })
  technical!: number;

  @ApiProperty({ minimum: 0, maximum: 100 })
  fundamental!: number;

  @ApiProperty({ minimum: 0, maximum: 100 })
  news!: number;

  @ApiProperty({ minimum: 0, maximum: 100, description: "Score de maitrise du risque (100 - risk_score)." })
  risk!: number;
}

class AgentStatusSummaryDto {
  @ApiProperty({ enum: ["success", "partial", "failed"] })
  market_data!: string;

  @ApiProperty({ enum: ["success", "partial", "failed"] })
  technical!: string;

  @ApiProperty({ enum: ["success", "partial", "failed"] })
  news!: string;

  @ApiProperty({ enum: ["success", "partial", "failed"] })
  rag!: string;

  @ApiProperty({ enum: ["success", "partial", "failed"] })
  risk!: string;
}

export class SynthesisResultDto {
  @ApiProperty({ example: "MSFT" })
  ticker!: string;

  @ApiProperty({ enum: ["success", "partial", "failed"] })
  status!: "success" | "partial" | "failed";

  @ApiProperty({ minimum: 0, maximum: 100 })
  global_score!: number;

  @ApiProperty({ enum: ["favorable", "a_surveiller", "prudence", "defavorable", "donnees_insuffisantes"] })
  recommendation!: string;

  @ApiProperty({ minimum: 0, maximum: 100 })
  confidence_score!: number;

  @ApiProperty({ enum: ["low", "medium", "high"] })
  confidence_level!: string;

  @ApiProperty({ type: SynthesisScoresDto })
  scores!: SynthesisScoresDto;

  @ApiProperty({ example: { technical: 0.3, fundamental: 0.25, news: 0.15, risk: 0.3 } })
  weights!: Record<string, number>;

  @ApiProperty()
  summary!: string;

  @ApiProperty({ type: [String] })
  strengths!: string[];

  @ApiProperty({ type: [String] })
  weaknesses!: string[];

  @ApiProperty({ type: [Object] })
  key_risks!: object[];

  @ApiProperty({ type: [String] })
  sources!: string[];

  @ApiProperty({ type: AgentStatusSummaryDto })
  agent_status!: AgentStatusSummaryDto;

  @ApiProperty({ type: [String] })
  warnings!: string[];

  @ApiProperty({ type: [String] })
  errors!: string[];

  @ApiProperty({ nullable: true, type: Object })
  slm_summary!: object | null;
}

class AgentExecutionDto {
  @ApiProperty({ example: "MarketDataAgent" })
  agent!: string;

  @ApiProperty({ enum: ["success", "partial", "failed"] })
  status!: string;

  @ApiProperty({ example: 243 })
  duration_ms!: number;
}

export class OrchestratedAnalysisDto {
  @ApiProperty({ example: "MSFT" })
  ticker!: string;

  @ApiProperty({ enum: ["success", "partial", "failed"] })
  status!: string;

  @ApiProperty({ example: "langgraph" })
  workflow!: string;

  @ApiProperty({ format: "date-time" })
  generated_at!: string;

  @ApiProperty({ type: [AgentExecutionDto] })
  execution_trace!: AgentExecutionDto[];

  @ApiProperty({ type: MarketDataResultDto })
  market_data!: MarketDataResultDto;

  @ApiProperty({ type: TechnicalResultDto })
  technical!: TechnicalResultDto;

  @ApiProperty({ type: NewsResultDto })
  news!: NewsResultDto;

  @ApiProperty({ type: RagResultDto })
  rag!: RagResultDto;

  @ApiProperty({ type: RiskResultDto })
  risk!: RiskResultDto;

  @ApiProperty({ type: SynthesisResultDto })
  synthesis!: SynthesisResultDto;
}
