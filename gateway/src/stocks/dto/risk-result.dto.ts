import { ApiProperty } from "@nestjs/swagger";

class RiskItemDto {
  @ApiProperty({ enum: ["market", "technical", "fundamental", "news", "data_quality"] })
  category!: "market" | "technical" | "fundamental" | "news" | "data_quality";

  @ApiProperty({ enum: ["low", "medium", "high"] })
  level!: "low" | "medium" | "high";

  @ApiProperty()
  title!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ type: [String] })
  evidence!: string[];

  @ApiProperty({ minimum: 0, maximum: 100 })
  score_impact!: number;
}

class AgentRiskSnapshotDto {
  @ApiProperty({ enum: ["success", "partial", "failed"] })
  market_data_status!: "success" | "partial" | "failed";

  @ApiProperty({ enum: ["success", "partial", "failed"] })
  technical_status!: "success" | "partial" | "failed";

  @ApiProperty({ enum: ["success", "partial", "failed"] })
  news_status!: "success" | "partial" | "failed";

  @ApiProperty({ type: [String] })
  market_data_errors!: string[];

  @ApiProperty({ type: [String] })
  technical_errors!: string[];

  @ApiProperty({ type: [String] })
  news_errors!: string[];
}

class RiskSlmSummaryDto {
  @ApiProperty()
  provider!: string;

  @ApiProperty()
  model!: string;

  @ApiProperty()
  summary!: string;

  @ApiProperty()
  data_quality!: string;

  @ApiProperty({ type: [String] })
  key_points!: string[];

  @ApiProperty({ type: [String] })
  warnings!: string[];
}

export class RiskResultDto {
  @ApiProperty({ example: "AAPL" })
  ticker!: string;

  @ApiProperty({ enum: ["success", "partial", "failed"] })
  status!: "success" | "partial" | "failed";

  @ApiProperty({ enum: ["low", "medium", "high"] })
  overall_risk_level!: "low" | "medium" | "high";

  @ApiProperty({ minimum: 0, maximum: 100 })
  risk_score!: number;

  @ApiProperty({
    type: "object",
    additionalProperties: { type: "number" },
    description: "Contribution de chaque categorie au risk_score (market, technical, fundamental, news).",
    example: { fundamental: 16, technical: 24, news: 22, market: 12 },
  })
  risk_score_breakdown!: Record<string, number>;

  @ApiProperty({ minimum: 0, maximum: 100 })
  data_confidence_score!: number;

  @ApiProperty({ enum: ["low", "medium", "high"] })
  data_confidence_level!: "low" | "medium" | "high";

  @ApiProperty({ type: [RiskItemDto] })
  risks!: RiskItemDto[];

  @ApiProperty({ type: AgentRiskSnapshotDto })
  component_status!: AgentRiskSnapshotDto;

  @ApiProperty({ type: [String] })
  warnings!: string[];

  @ApiProperty({ type: [String] })
  errors!: string[];

  @ApiProperty({ type: RiskSlmSummaryDto, nullable: true })
  slm_summary!: RiskSlmSummaryDto | null;
}
