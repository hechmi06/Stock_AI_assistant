import { ApiProperty } from "@nestjs/swagger";

export class PointInTimeEventDto {
  @ApiProperty({ example: "e9b50ca6-1b52-59cd-9e7b-b80a554d4098" })
  id!: string;

  @ApiProperty({ example: "MSFT" })
  ticker!: string;

  @ApiProperty({ example: "fundamental" })
  component!: string;

  @ApiProperty({ example: "financial_statement" })
  event_type!: string;

  @ApiProperty({ example: "2025-06-30T23:59:59.999999+00:00" })
  effective_at!: string;

  @ApiProperty({
    example: "2025-07-30T14:00:00+00:00",
    description: "Premiere date a laquelle le systeme pouvait utiliser cette donnee.",
  })
  available_at!: string;

  @ApiProperty({ example: "2025-07-30T14:00:00+00:00" })
  observed_at!: string;

  @ApiProperty({ example: "alpha_vantage" })
  source!: string;

  @ApiProperty({ enum: ["success", "partial", "failed"] })
  quality!: "success" | "partial" | "failed";

  @ApiProperty({
    enum: ["observed", "reconstructed", "derived"],
    description: "Observed est admissible en backtest strict; reconstructed exige une validation specifique.",
  })
  knowledge_mode!: "observed" | "reconstructed" | "derived";

  @ApiProperty({ example: 1 })
  schema_version!: number;

  @ApiProperty({ example: "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb" })
  payload_hash!: string;

  @ApiProperty({ nullable: true })
  run_id!: string | null;

  @ApiProperty({ type: "object", additionalProperties: true })
  payload!: Record<string, unknown>;
}

export class PointInTimeQueryResultDto {
  @ApiProperty({ example: "MSFT" })
  ticker!: string;

  @ApiProperty({ nullable: true })
  as_of!: string | null;

  @ApiProperty({ nullable: true })
  component!: string | null;

  @ApiProperty({ nullable: true })
  event_type!: string | null;

  @ApiProperty({ example: true })
  observed_only!: boolean;

  @ApiProperty({ example: 12 })
  count!: number;

  @ApiProperty({ type: [PointInTimeEventDto] })
  events!: PointInTimeEventDto[];
}

export class PointInTimeSummaryDto {
  @ApiProperty({ example: "MSFT" })
  ticker!: string;

  @ApiProperty({ example: 418 })
  total_events!: number;

  @ApiProperty({ example: { market_data: 402, fundamental: 4, technical: 6 } })
  components!: Record<string, number>;

  @ApiProperty({ example: { price_bar: 390, market_snapshot: 4 } })
  event_types!: Record<string, number>;

  @ApiProperty({ example: { observed: 12, reconstructed: 400, derived: 6 } })
  knowledge_modes!: Record<string, number>;

  @ApiProperty({ nullable: true })
  first_available_at!: string | null;

  @ApiProperty({ nullable: true })
  last_observed_at!: string | null;
}
