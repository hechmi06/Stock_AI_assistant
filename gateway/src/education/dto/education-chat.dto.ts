import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class EducationMessageDto {
  @ApiProperty({ enum: ["user", "assistant"] })
  role!: "user" | "assistant";

  @ApiProperty()
  content!: string;
}

export class EducationChatRequestDto {
  @ApiProperty({
    example: "Quelle est la différence entre un cours spot et un forward ?",
  })
  message!: string;

  @ApiPropertyOptional({ type: [EducationMessageDto] })
  history?: EducationMessageDto[];

  @ApiPropertyOptional({ example: "analysis" })
  page?: string;

  @ApiPropertyOptional({ example: "AAPL" })
  ticker?: string;
}

export class EducationChatResponseDto {
  @ApiProperty({ enum: ["success", "partial"] })
  status!: "success" | "partial";

  @ApiProperty()
  answer!: string;

  @ApiProperty({ type: [String] })
  concepts!: string[];

  @ApiProperty({ type: [String] })
  suggested_questions!: string[];

  @ApiProperty({ example: "nebius" })
  provider!: string;

  @ApiProperty({ nullable: true })
  model!: string | null;

  @ApiProperty({ example: true })
  educational_only!: boolean;

  @ApiProperty({ nullable: true })
  warning!: string | null;
}
