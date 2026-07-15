import { ApiProperty } from "@nestjs/swagger";

class RagPassageDto {
  @ApiProperty()
  text!: string;

  @ApiProperty({ nullable: true, example: "10-Q" })
  form!: string | null;

  @ApiProperty({ nullable: true, example: "2026-04-29" })
  filing_date!: string | null;

  @ApiProperty({ nullable: true })
  url!: string | null;

  @ApiProperty({ example: 0.51 })
  score!: number;
}

export class RagResultDto {
  @ApiProperty({ example: "MSFT" })
  ticker!: string;

  @ApiProperty({ example: "Quels sont les principaux facteurs de risque ?" })
  question!: string;

  @ApiProperty({ enum: ["success", "partial", "failed"] })
  status!: "success" | "partial" | "failed";

  @ApiProperty({ nullable: true, description: "Reponse sourcee synthetisee par le SLM." })
  answer!: string | null;

  @ApiProperty({ type: [RagPassageDto] })
  passages!: RagPassageDto[];

  @ApiProperty({ example: 120, description: "Nombre de passages indexes pour ce ticker." })
  indexed_chunks!: number;

  @ApiProperty({ type: [String] })
  warnings!: string[];

  @ApiProperty({ type: [String] })
  errors!: string[];
}

class RagDocumentDto {
  @ApiProperty({ example: "10-Q" })
  form!: string;

  @ApiProperty({ nullable: true, example: "2026-04-29" })
  filing_date!: string | null;

  @ApiProperty()
  url!: string;

  @ApiProperty({ example: 120 })
  chunks_indexed!: number;
}

export class RagIngestResultDto {
  @ApiProperty({ example: "MSFT" })
  ticker!: string;

  @ApiProperty({ enum: ["success", "partial", "failed"] })
  status!: "success" | "partial" | "failed";

  @ApiProperty({ type: [RagDocumentDto] })
  documents!: RagDocumentDto[];

  @ApiProperty({ example: 120 })
  chunks_indexed!: number;

  @ApiProperty({ type: [String] })
  warnings!: string[];

  @ApiProperty({ type: [String] })
  errors!: string[];
}
