import { ApiProperty } from "@nestjs/swagger";

class NewsArticleDto {
  @ApiProperty({ example: "Apple unveils new AI features for iPhone" })
  title!: string;

  @ApiProperty({ example: "Reuters" })
  source!: string;

  @ApiProperty({ example: "2026-07-06T09:30:00.000Z" })
  published_at!: string;

  @ApiProperty({ example: "https://www.reuters.com/technology/apple-ai-features" })
  url!: string;

  @ApiProperty({ example: "Apple announced a suite of AI features...", nullable: true })
  summary!: string | null;

  @ApiProperty({
    description: "Texte principal extrait de l'article (si NEWS_EXTRACT_CONTENT actif), sinon null.",
    example: null,
    nullable: true,
  })
  content!: string | null;

  @ApiProperty({
    enum: ["financial_modeling_prep", "yahoo_rss", "finnhub", "google_news_rss", "newsdata_io"],
    example: "yahoo_rss",
  })
  origin!: "financial_modeling_prep" | "yahoo_rss" | "finnhub" | "google_news_rss" | "newsdata_io";

  @ApiProperty({
    enum: ["positive", "negative", "neutral", "mixed"],
    nullable: true,
    example: "positive",
    description: "Sentiment de l'article classe par le SLM",
  })
  sentiment!: "positive" | "negative" | "neutral" | "mixed" | null;
}

class NewsSlmSummaryDto {
  @ApiProperty({ example: "nebius" })
  provider!: string;

  @ApiProperty({ example: "Qwen/Qwen3-30B-A3B-Instruct-2507" })
  model!: string;

  @ApiProperty({ example: "Actualites globalement positives, portees par les annonces IA." })
  summary!: string;

  @ApiProperty({ example: "bon" })
  data_quality!: string;

  @ApiProperty({ example: ["Lancement de nouvelles fonctionnalites IA"], type: [String] })
  key_points!: string[];

  @ApiProperty({ example: ["Peu d'articles sur les fondamentaux"], type: [String] })
  warnings!: string[];
}

export class NewsResultDto {
  @ApiProperty({ example: "AAPL" })
  ticker!: string;

  @ApiProperty({ enum: ["success", "partial", "failed"], example: "success" })
  status!: "success" | "partial" | "failed";

  @ApiProperty({ type: [NewsArticleDto], description: "Articles dedupliques, du plus recent au plus ancien" })
  articles!: NewsArticleDto[];

  @ApiProperty({
    enum: ["financial_modeling_prep", "yahoo_rss", "finnhub", "google_news_rss", "newsdata_io"],
    isArray: true,
    example: ["yahoo_rss", "finnhub", "google_news_rss"],
  })
  sources_used!: Array<"financial_modeling_prep" | "yahoo_rss" | "finnhub" | "google_news_rss" | "newsdata_io">;

  @ApiProperty({
    enum: ["positive", "negative", "neutral", "mixed"],
    nullable: true,
    example: "positive",
    description: "Sentiment global des actualites",
  })
  sentiment_label!: "positive" | "negative" | "neutral" | "mixed" | null;

  @ApiProperty({ example: 0.45, nullable: true, description: "Score de sentiment entre -1 et 1" })
  sentiment_score!: number | null;

  @ApiProperty({ example: ["Resultats trimestriels au-dessus des attentes"], type: [String] })
  key_events!: string[];

  @ApiProperty({ example: [], type: [String], description: "Degradations non bloquantes (source indisponible, cache)" })
  warnings!: string[];

  @ApiProperty({ example: [], type: [String], description: "Erreurs fatales uniquement" })
  errors!: string[];

  @ApiProperty({ type: NewsSlmSummaryDto, nullable: true })
  slm_summary!: NewsSlmSummaryDto | null;
}
