import { ApiProperty } from "@nestjs/swagger";
import { MarketDataResultDto } from "./market-data-result.dto";
import { NewsResultDto } from "./news-result.dto";
import { RagResultDto } from "./rag-result.dto";
import { RiskResultDto } from "./risk-result.dto";
import { SynthesisResultDto } from "./synthesis-result.dto";
import { TechnicalResultDto } from "./technical-result.dto";

class HistoricalReplayTraceDto {
  @ApiProperty({ example: "market_data" })
  component!: string;

  @ApiProperty({ enum: ["success", "partial", "failed"] })
  status!: "success" | "partial" | "failed";

  @ApiProperty({ type: [String] })
  event_ids!: string[];

  @ApiProperty({ example: 262 })
  event_count!: number;

  @ApiProperty({ nullable: true })
  latest_available_at!: string | null;

  @ApiProperty({ type: [String], example: ["observed", "reconstructed"] })
  knowledge_modes!: Array<"observed" | "reconstructed" | "derived">;

  @ApiProperty({ example: "262 prix disponibles." })
  message!: string;
}

export class HistoricalReplayResultDto {
  @ApiProperty({ example: "MSFT" })
  ticker!: string;

  @ApiProperty({ enum: ["success", "partial", "failed"] })
  status!: "success" | "partial" | "failed";

  @ApiProperty({ example: "2025-07-30T12:00:00+00:00" })
  as_of!: string;

  @ApiProperty({ enum: ["strict", "research"] })
  replay_mode!: "strict" | "research";

  @ApiProperty({ example: false })
  allow_reconstructed_prices!: boolean;

  @ApiProperty({ example: true })
  lookahead_guard_passed!: boolean;

  @ApiProperty({ example: 67, minimum: 0, maximum: 100 })
  archive_coverage_score!: number;

  @ApiProperty({ type: [HistoricalReplayTraceDto] })
  trace!: HistoricalReplayTraceDto[];

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

  @ApiProperty({ type: [String] })
  warnings!: string[];

  @ApiProperty({ type: [String] })
  errors!: string[];
}
