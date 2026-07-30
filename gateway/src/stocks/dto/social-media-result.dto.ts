import { ApiProperty } from "@nestjs/swagger";

class SocialEngagementDto {
  @ApiProperty({ nullable: true, required: false, example: 125 })
  score?: number | null;

  @ApiProperty({ nullable: true, required: false, example: 28 })
  comments?: number | null;
}

class SocialPostDto {
  @ApiProperty({ example: "reddit-abc123" })
  id!: string;

  @ApiProperty({ enum: ["reddit"], example: "reddit" })
  source!: "reddit";

  @ApiProperty({ example: "market_observer" })
  author!: string;

  @ApiProperty({ example: "Discussion about AAPL services growth..." })
  text!: string;

  @ApiProperty({ example: "https://www.reddit.com/r/stocks/comments/abc123" })
  url!: string;

  @ApiProperty({ example: "2026-07-28T11:30:00.000Z" })
  published_at!: string;

  @ApiProperty({ type: SocialEngagementDto })
  engagement!: SocialEngagementDto;

  @ApiProperty({
    enum: ["positive", "negative", "neutral", "mixed"],
    nullable: true,
  })
  sentiment!: "positive" | "negative" | "neutral" | "mixed" | null;
}

class SocialSourceStatusDto {
  @ApiProperty({
    enum: ["success", "empty", "unavailable", "failed"],
    example: "success",
  })
  status!: "success" | "empty" | "unavailable" | "failed";

  @ApiProperty({ example: 12 })
  posts_count!: number;

  @ApiProperty({ nullable: true, required: false })
  error?: string | null;
}

class SocialSlmSummaryDto {
  @ApiProperty({ example: "nebius" })
  provider!: string;

  @ApiProperty({ example: "Qwen/Qwen3-30B-A3B-Instruct-2507" })
  model!: string;

  @ApiProperty({ example: "Le signal social est mitige et peu representatif." })
  summary!: string;

  @ApiProperty({ example: "partial" })
  data_quality!: string;

  @ApiProperty({ type: [String], example: ["Discussion sur les resultats"] })
  key_points!: string[];

  @ApiProperty({ type: [String], example: ["Echantillon Reddit limite"] })
  warnings!: string[];
}

export class SocialMediaResultDto {
  @ApiProperty({ example: "AAPL" })
  ticker!: string;

  @ApiProperty({ enum: ["success", "partial", "failed"], example: "partial" })
  status!: "success" | "partial" | "failed";

  @ApiProperty({ nullable: true, example: "2026-07-28T11:30:00.000Z" })
  collected_at!: string | null;

  @ApiProperty({ type: [SocialPostDto] })
  posts!: SocialPostDto[];

  @ApiProperty({ enum: ["reddit"], isArray: true, example: ["reddit"] })
  sources_used!: Array<"reddit">;

  @ApiProperty({
    example: {
      reddit: { status: "success", posts_count: 12 },
    },
  })
  source_status!: Record<"reddit", SocialSourceStatusDto>;

  @ApiProperty({
    enum: ["positive", "negative", "neutral", "mixed"],
    nullable: true,
  })
  sentiment_label!: "positive" | "negative" | "neutral" | "mixed" | null;

  @ApiProperty({ nullable: true, example: 0.18 })
  sentiment_score!: number | null;

  @ApiProperty({ type: [String], example: ["services", "valorisation"] })
  themes!: string[];

  @ApiProperty({ nullable: true })
  summary!: string | null;

  @ApiProperty({ type: [String] })
  warnings!: string[];

  @ApiProperty({ type: [String] })
  errors!: string[];

  @ApiProperty({ type: SocialSlmSummaryDto, nullable: true })
  slm_summary!: SocialSlmSummaryDto | null;
}
