import { ApiProperty } from "@nestjs/swagger";

class MetricResultDto {
  @ApiProperty({ example: "price_completeness" })
  name!: string;

  @ApiProperty({ example: 1, minimum: 0, maximum: 1 })
  score!: number;

  @ApiProperty({ example: true })
  passed!: boolean;

  @ApiProperty({ example: "Prix disponible : 308.63." })
  message!: string;
}

export class EvaluationReportDto {
  @ApiProperty({ example: "AAPL" })
  ticker!: string;

  @ApiProperty({ type: [MetricResultDto] })
  metrics!: MetricResultDto[];

  @ApiProperty({ example: 90.9, minimum: 0, maximum: 100 })
  total_score!: number;

  @ApiProperty({ enum: ["excellent", "good", "partial", "poor"], example: "excellent" })
  grade!: "excellent" | "good" | "partial" | "poor";

  @ApiProperty({ example: true })
  passed!: boolean;
}
