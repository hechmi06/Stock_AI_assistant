import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import {
  EducationChatRequestDto,
  EducationChatResponseDto,
} from "./dto/education-chat.dto";
import { EducationService } from "./education.service";

@ApiTags("education")
@ApiCookieAuth("stock_ai_session")
@UseGuards(SessionAuthGuard)
@Controller("education")
export class EducationController {
  constructor(private readonly educationService: EducationService) {}

  @ApiOperation({
    summary: "Expliquer une notion financiere avec le LLM pedagogique",
    description:
      "Explique les metriques, ratios, instruments et notions de marche sans produire d'ordre d'achat ou de vente.",
  })
  @ApiOkResponse({ type: EducationChatResponseDto })
  @Post("chat")
  chat(@Body() input: EducationChatRequestDto) {
    return this.educationService.chat(input);
  }
}
