import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  EducationChatRequestDto,
  EducationChatResponseDto,
} from "./dto/education-chat.dto";

@Injectable()
export class EducationService {
  private readonly aiBackendUrl =
    process.env.AI_BACKEND_URL ?? "http://127.0.0.1:8000";

  async chat(
    input: EducationChatRequestDto,
  ): Promise<EducationChatResponseDto> {
    const message = String(input.message ?? "").trim();
    if (message.length < 2 || message.length > 1200) {
      throw new BadRequestException(
        "La question doit contenir entre 2 et 1200 caracteres.",
      );
    }

    const history = (input.history ?? [])
      .filter(
        (item) =>
          (item.role === "user" || item.role === "assistant")
          && typeof item.content === "string"
          && item.content.trim(),
      )
      .slice(-10)
      .map((item) => ({
        role: item.role,
        content: item.content.trim().slice(0, 2500),
      }));

    try {
      const response = await fetch(`${this.aiBackendUrl}/education/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          history,
          page: input.page?.trim().slice(0, 40) || null,
          ticker: input.ticker?.trim().toUpperCase().slice(0, 15) || null,
        }),
      });
      if (!response.ok) {
        throw new Error(`AI backend returned ${response.status}`);
      }
      return (await response.json()) as EducationChatResponseDto;
    } catch {
      throw new ServiceUnavailableException(
        "L'assistant pedagogique est temporairement indisponible.",
      );
    }
  }
}
