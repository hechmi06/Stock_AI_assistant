import {
  BookOpenText,
  ExternalLink,
  LoaderCircle,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { askEducationAssistant } from "../services/educationApi";

type Anchor = {
  x: number;
  y: number;
};

type ContextMenuState = Anchor & {
  concept: string;
};

type ExplanationState = Anchor & {
  concept: string;
  answer: string | null;
  error: string | null;
  loading: boolean;
  provider: string | null;
};

const conceptPatterns: Array<[RegExp, string]> = [
  [/\brsi(?:\s*14)?\b/i, "RSI 14"],
  [/\bsma\s*20\b/i, "SMA 20"],
  [/\bsma\s*50\b/i, "SMA 50"],
  [/\bmoyennes?\s+mobiles?\b/i, "moyenne mobile"],
  [/\bvolatilit[ée](?:\s+annualis[ée]e?)?\b/i, "volatilité"],
  [/\bb[êe]ta\b/i, "bêta"],
  [/\bbenchmark\b/i, "benchmark boursier"],
  [/\bspy\b/i, "SPY"],
  [/\bsharpe\b/i, "ratio de Sharpe"],
  [/\bdrawdown\b/i, "drawdown"],
  [/\bsupport\b/i, "support technique"],
  [/\br[ée]sistance\b/i, "résistance technique"],
  [/\b(?:p\/e|per)\b/i, "ratio P/E (PER)"],
  [/\bspread\b/i, "spread"],
  [/\bspot\b/i, "prix spot"],
  [/\bforward\b/i, "contrat forward"],
  [/\bliquidit[ée]s?\b/i, "liquidité"],
  [/\bfondamentaux\b/i, "analyse fondamentale"],
  [/\bcapitalisation\b/i, "capitalisation boursière"],
  [/\bcash[\s-]?flow\b/i, "cash-flow"],
  [/\bchiffre d['’]affaires\b/i, "chiffre d’affaires"],
  [/\br[ée]sultat net\b/i, "résultat net"],
  [/\bdette\b/i, "dette financière"],
  [/\bmarge\b/i, "marge financière"],
  [/\bvolume\b/i, "volume boursier"],
  [/\bmomentum\b/i, "momentum"],
  [/\bconfiance\b/i, "score de confiance"],
  [/\bdiversification\b/i, "diversification"],
  [/\bconcentration\b/i, "concentration du portefeuille"],
  [/\bcorr[ée]lation\b/i, "corrélation"],
  [/\bvar\b/i, "Value at Risk (VaR)"],
  [/\brendement annualis[ée]\b/i, "rendement annualisé"],
  [/\brisque\b/i, "niveau de risque"],
];

function normalizeText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function matchConcept(value: string) {
  for (const [pattern, concept] of conceptPatterns) {
    if (pattern.test(value)) return concept;
  }
  return null;
}

function findConcept(target: HTMLElement) {
  const annotated = target.closest<HTMLElement>("[data-finance-concept]");
  if (annotated?.dataset.financeConcept) {
    return normalizeText(annotated.dataset.financeConcept);
  }

  const selection = normalizeText(window.getSelection()?.toString());
  if (selection.length >= 2 && selection.length <= 90) {
    return matchConcept(selection) ?? selection;
  }

  let current: HTMLElement | null = target;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const text = normalizeText(current.innerText);
    if (text.length <= 220) {
      const concept = matchConcept(text);
      if (concept) return concept;
    }
    current = current.parentElement;
  }
  return null;
}

function boundedAnchor(
  x: number,
  y: number,
  width: number,
  height: number,
): Anchor {
  return {
    x: Math.max(12, Math.min(x, window.innerWidth - width - 12)),
    y: Math.max(12, Math.min(y, window.innerHeight - height - 12)),
  };
}

function shortAnswer(answer: string) {
  const normalized = normalizeText(answer);
  const sentences = normalized.match(/[^.!?]+[.!?]+/g);
  if (sentences?.length) {
    let concise = "";
    for (const sentence of sentences.slice(0, 3)) {
      const candidate = `${concise} ${sentence.trim()}`.trim();
      if (candidate.length > 560 && concise) break;
      concise = candidate;
    }
    if (concise) return concise;
  }
  if (normalized.length <= 560) return normalized;
  const shortened = normalized.slice(0, 557);
  return `${shortened.slice(0, shortened.lastIndexOf(" "))}…`;
}

export function ConceptContextHelp({
  page,
  ticker,
}: {
  page: string;
  ticker: string;
}) {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [explanation, setExplanation] =
    useState<ExplanationState | null>(null);

  useEffect(() => {
    function handleContextMenu(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (
        target.closest(
          "input, textarea, select, [contenteditable='true'], .education-chat, .concept-context-help",
        )
      ) {
        return;
      }
      const concept = findConcept(target);
      if (!concept) return;

      event.preventDefault();
      const anchor = boundedAnchor(event.clientX, event.clientY, 250, 70);
      setExplanation(null);
      setMenu({ ...anchor, concept });
    }

    function dismiss() {
      setMenu(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenu(null);
        setExplanation(null);
      }
    }

    window.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("click", dismiss);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("click", dismiss);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  async function explain(menuState: ContextMenuState) {
    const anchor = boundedAnchor(menuState.x, menuState.y, 360, 260);
    setMenu(null);
    setExplanation({
      ...anchor,
      concept: menuState.concept,
      answer: null,
      error: null,
      loading: true,
      provider: null,
    });

    try {
      const result = await askEducationAssistant({
        message:
          `Définis brièvement la notion financière « ${menuState.concept} » ` +
          "en 2 ou 3 phrases. Explique son utilité et la manière de l’interpréter.",
        history: [],
        page,
        ticker,
      });
      setExplanation((current) =>
        current
          ? {
              ...current,
              answer: shortAnswer(result.answer),
              loading: false,
              provider: result.provider,
            }
          : current,
      );
    } catch (error) {
      setExplanation((current) =>
        current
          ? {
              ...current,
              error:
                error instanceof Error
                  ? error.message
                  : "Explication momentanément indisponible.",
              loading: false,
            }
          : current,
      );
    }
  }

  function openInChat() {
    if (!explanation) return;
    window.dispatchEvent(
      new CustomEvent("stock-ai:education-question", {
        detail: {
          question: `Explique-moi plus en détail la notion « ${explanation.concept} ».`,
        },
      }),
    );
    setExplanation(null);
  }

  return (
    <div className="concept-context-help">
      {menu ? (
        <div
          className="concept-context-menu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => void explain(menu)}
          >
            <BookOpenText size={16} />
            <span>
              Expliquer cette notion
              <small>{menu.concept}</small>
            </span>
          </button>
        </div>
      ) : null}

      {explanation ? (
        <aside
          className="concept-explanation"
          aria-label={`Définition de ${explanation.concept}`}
          style={{ left: explanation.x, top: explanation.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <header>
            <div><Sparkles size={15} /></div>
            <span>
              <small>Notion financière</small>
              <strong>{explanation.concept}</strong>
            </span>
            <button
              type="button"
              aria-label="Fermer la définition"
              title="Fermer"
              onClick={() => setExplanation(null)}
            >
              <X size={16} />
            </button>
          </header>
          <div className="concept-explanation-body">
            {explanation.loading ? (
              <div className="concept-explanation-loading">
                <LoaderCircle size={16} />
                Définition en cours…
              </div>
            ) : explanation.error ? (
              <p className="concept-explanation-error">{explanation.error}</p>
            ) : (
              <p>{explanation.answer}</p>
            )}
          </div>
          {!explanation.loading && !explanation.error ? (
            <footer>
              <small>
                {explanation.provider === "nebius" ? "Qwen" : "Glossaire local"}
              </small>
              <button type="button" onClick={openInChat}>
                Approfondir <ExternalLink size={13} />
              </button>
            </footer>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}
