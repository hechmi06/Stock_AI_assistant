export type EducationHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type EducationChatResponse = {
  status: "success" | "partial";
  answer: string;
  concepts: string[];
  suggested_questions: string[];
  provider: string;
  model: string | null;
  educational_only: boolean;
  warning: string | null;
};

export async function askEducationAssistant(input: {
  message: string;
  history: EducationHistoryMessage[];
  page: string;
  ticker: string;
}): Promise<EducationChatResponse> {
  const response = await fetch("/api/education/chat", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    let message = `Gateway returned ${response.status}`;
    try {
      const body = await response.json() as { message?: string | string[] };
      message = Array.isArray(body.message)
        ? body.message.join(" ")
        : body.message || message;
    } catch {
      // Keep the HTTP status when the response is not JSON.
    }
    throw new Error(message);
  }
  return await response.json() as EducationChatResponse;
}
