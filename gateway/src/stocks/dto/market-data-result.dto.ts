import { ApiProperty } from "@nestjs/swagger";

class HistoricalPriceDto {
  @ApiProperty({ example: "2026-07-01" })
  date!: string;

  @ApiProperty({ example: 305.12, nullable: true })
  open!: number | null;

  @ApiProperty({ example: 307.4, nullable: true })
  high!: number | null;

  @ApiProperty({ example: 303.9, nullable: true })
  low!: number | null;

  @ApiProperty({ example: 305.84 })
  close!: number;

  @ApiProperty({ example: 52100000, nullable: true })
  volume!: number | null;
}

class CompanyProfileDto {
  @ApiProperty({ example: "Apple Inc.", nullable: true })
  name!: string | null;

  @ApiProperty({ example: "Technology", nullable: true })
  sector!: string | null;

  @ApiProperty({ example: "Consumer Electronics", nullable: true })
  industry!: string | null;

  @ApiProperty({ example: "United States", nullable: true })
  country!: string | null;

  @ApiProperty({ example: "https://www.apple.com", nullable: true })
  website!: string | null;

  @ApiProperty({ example: 4521000000000, nullable: true })
  market_cap!: number | null;

  @ApiProperty({ example: "USD", nullable: true })
  currency!: string | null;

  @ApiProperty({ example: "NASDAQ", nullable: true })
  exchange!: string | null;
}

class FinancialStatementsSummaryDto {
  @ApiProperty({ example: "2025-09-27", nullable: true })
  fiscal_date!: string | null;

  @ApiProperty({ example: 416161000000, nullable: true })
  total_revenue!: number | null;

  @ApiProperty({ example: 100118000000, nullable: true })
  net_income!: number | null;

  @ApiProperty({ example: 359241000000, nullable: true })
  total_assets!: number | null;

  @ApiProperty({ example: 112377000000, nullable: true })
  total_debt!: number | null;

  @ApiProperty({ example: 118254000000, nullable: true })
  operating_cashflow!: number | null;
}

class SlmSummaryDto {
  @ApiProperty({ example: "ollama" })
  provider!: string;

  @ApiProperty({ example: "qwen2.5:3b" })
  model!: string;

  @ApiProperty({ example: "Les donnees principales sont presentes et les fondamentaux sont complets." })
  summary!: string;

  @ApiProperty({ example: "bon" })
  data_quality!: string;

  @ApiProperty({ example: ["Prix live disponible", "Etats financiers remplis", "Aucun fallback interne"], type: [String] })
  key_points!: string[];

  @ApiProperty({ example: ["yfinance est temporairement limite"], type: [String] })
  warnings!: string[];
}

export class MarketDataResultDto {
  @ApiProperty({ example: "AAPL" })
  ticker!: string;

  @ApiProperty({ enum: ["success", "partial", "failed"], example: "partial" })
  status!: "success" | "partial" | "failed";

  @ApiProperty({
    enum: ["twelve_data", "yfinance", "alpha_vantage", "financial_modeling_prep"],
    isArray: true,
    example: ["twelve_data", "alpha_vantage", "financial_modeling_prep"],
  })
  sources_used!: Array<"twelve_data" | "yfinance" | "alpha_vantage" | "financial_modeling_prep">;

  @ApiProperty({ example: false })
  used_fallback!: boolean;

  @ApiProperty({ example: 305.84, nullable: true })
  price!: number | null;

  @ApiProperty({ example: 1.42, nullable: true })
  change_percent!: number | null;

  @ApiProperty({ type: [HistoricalPriceDto] })
  historical_prices!: HistoricalPriceDto[];

  @ApiProperty({ type: CompanyProfileDto })
  company_profile!: CompanyProfileDto;

  @ApiProperty({
    example: {
      trailing_pe: 32.5,
      forward_pe: 28.1,
      profit_margin: 0.241,
      debt_to_equity: 1.54,
    },
  })
  financial_ratios!: Record<string, number | null>;

  @ApiProperty({ type: FinancialStatementsSummaryDto })
  financial_statements_summary!: FinancialStatementsSummaryDto;

  @ApiProperty({ example: ["Alpha Vantage daily rate limit reached."], type: [String] })
  errors!: string[];

  @ApiProperty({ type: SlmSummaryDto, nullable: true })
  slm_summary!: SlmSummaryDto | null;
}
