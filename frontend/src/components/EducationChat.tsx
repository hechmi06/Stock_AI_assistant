import {
  BookOpen,
  Bot,
  MessageCircleQuestion,
  RotateCcw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  askEducationAssistant,
  type EducationHistoryMessage,
} from "../services/educationApi";

type ChatMessage = EducationHistoryMessage & {
  id: string;
  concepts?: string[];
  source?: string;
  warning?: string | null;
};

const quickQuestions = [
  "Quelle différence entre spot et forward ?",
  "Comment interpréter le bêta face à SPY ?",
  "À quoi sert le ratio de Sharpe ?",
];

const welcomeMessage: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Bonjour. Je peux expliquer les instruments, indicateurs techniques, ratios fondamentaux et mesures de risque utilisés dans l'application.",
  concepts: ["Spot", "Forward", "Bêta", "RSI", "Sharpe"],
  source: "Assistant pédagogique",
};

function loadMessages(key: string): ChatMessage[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]") as ChatMessage[];
    const valid = parsed.filter(
      (item) =>
        item
        && (item.role === "user" || item.role === "assistant")
        && typeof item.content === "string",
    );
    return valid.length ? valid.slice(-24) : [welcomeMessage];
  } catch {
    return [welcomeMessage];
  }
}

export function EducationChat({
  userId,
  page,
  ticker,
}: {
  userId: string;
  page: string;
  ticker: string;
}) {
  const storageKey = `stock-ai-education-chat-v1:${userId}`;
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    loadMessages(storageKey),
  );
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [suggestions, setSuggestions] = useState(quickQuestions);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages(loadMessages(storageKey));
  }, [storageKey]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(messages.slice(-24)));
  }, [messages, storageKey]);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages, open, sending]);

  useEffect(() => {
    function handleContextQuestion(event: Event) {
      const detail = (event as CustomEvent<{ question?: string }>).detail;
      const question = detail?.question?.trim();
      if (!question) return;
      setOpen(true);
      setInput(question);
    }

    window.addEventListener(
      "stock-ai:education-question",
      handleContextQuestion,
    );
    return () => {
      window.removeEventListener(
        "stock-ai:education-question",
        handleContextQuestion,
      );
    };
  }, []);

  const history = useMemo<EducationHistoryMessage[]>(
    () =>
      messages
        .filter((message) => message.id !== "welcome")
        .slice(-8)
        .map(({ role, content }) => ({ role, content })),
    [messages],
  );

  async function submit(questionValue?: string) {
    const question = (questionValue ?? input).trim();
    if (!question || sending) return;
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: question,
    };
    setMessages((current) => [...current, userMessage]);
    setInput("");
    setSending(true);
    try {
      const result = await askEducationAssistant({
        message: question,
        history,
        page,
        ticker,
      });
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: result.answer,
          concepts: result.concepts,
          source:
            result.provider === "nebius"
              ? "Qwen · Assistant pédagogique"
              : "Glossaire local",
          warning: result.warning,
        },
      ]);
      if (result.suggested_questions.length) {
        setSuggestions(result.suggested_questions);
      }
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            error instanceof Error
              ? error.message
              : "L'assistant pédagogique est indisponible.",
          source: "Erreur de connexion",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  function resetConversation() {
    setMessages([welcomeMessage]);
    setSuggestions(quickQuestions);
  }

  return (
    <div className={`education-chat ${open ? "open" : ""}`}>
      {open ? (
        <section
          className="education-chat-panel"
          aria-label="Assistant pédagogique boursier"
        >
          <header>
            <div className="education-chat-mark"><BookOpen size={18} /></div>
            <div>
              <strong>Comprendre la Bourse</strong>
              <span>Assistant pédagogique · {ticker}</span>
            </div>
            <button
              type="button"
              title="Nouvelle conversation"
              aria-label="Nouvelle conversation"
              onClick={resetConversation}
            >
              <RotateCcw size={16} />
            </button>
            <button
              type="button"
              title="Fermer"
              aria-label="Fermer l'assistant pédagogique"
              onClick={() => setOpen(false)}
            >
              <X size={17} />
            </button>
          </header>

          <div className="education-chat-context">
            <Sparkles size={13} />
            Contexte : {page} · {ticker}
          </div>

          <div className="education-chat-messages" aria-live="polite">
            {messages.map((message) => (
              <article
                className={`education-message ${message.role}`}
                key={message.id}
              >
                {message.role === "assistant" ? (
                  <div className="education-message-avatar"><Bot size={15} /></div>
                ) : null}
                <div>
                  <p>{message.content}</p>
                  {message.concepts?.length ? (
                    <div className="education-concepts">
                      {message.concepts.map((concept) => (
                        <span key={concept}>{concept}</span>
                      ))}
                    </div>
                  ) : null}
                  {message.source ? <small>{message.source}</small> : null}
                  {message.warning ? (
                    <small className="education-warning">
                      Réponse de secours : le LLM est momentanément indisponible.
                    </small>
                  ) : null}
                </div>
              </article>
            ))}
            {sending ? (
              <div className="education-thinking">
                <span />
                <span />
                <span />
                Explication en cours
              </div>
            ) : null}
            <div ref={endRef} />
          </div>

          <div className="education-suggestions">
            {suggestions.slice(0, 3).map((question) => (
              <button
                type="button"
                key={question}
                disabled={sending}
                onClick={() => void submit(question)}
              >
                {question}
              </button>
            ))}
          </div>

          <form
            className="education-chat-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <textarea
              value={input}
              maxLength={1200}
              rows={2}
              placeholder="Demandez : qu'est-ce que le bêta ?"
              aria-label="Question financière"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
            <button
              type="submit"
              title="Envoyer"
              aria-label="Envoyer la question"
              disabled={!input.trim() || sending}
            >
              <Send size={17} />
            </button>
          </form>
          <footer>
            Explications pédagogiques uniquement · pas un conseil financier
          </footer>
        </section>
      ) : null}

      <button
        className="education-chat-trigger"
        type="button"
        aria-label={
          open
            ? "Réduire l'assistant pédagogique"
            : "Ouvrir l'assistant pédagogique"
        }
        title="Comprendre une notion boursière"
        onClick={() => setOpen((current) => !current)}
      >
        {open ? <X size={21} /> : <MessageCircleQuestion size={23} />}
      </button>
    </div>
  );
}
