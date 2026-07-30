import {
  ArrowBigUp,
  ExternalLink,
  MessageCircle,
  MessagesSquare,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fetchSocialMedia } from "../services/analysisApi";
import type {
  NewsSentiment,
  SocialMediaResult,
  SocialPost,
} from "../types";

const SENTIMENT_LABELS: Record<NewsSentiment, string> = {
  positive: "Positif",
  negative: "Négatif",
  neutral: "Neutre",
  mixed: "Mitigé",
};

function formatPublishedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function Engagement({ post }: { post: SocialPost }) {
  return (
    <>
      <span><ArrowBigUp size={12} /> {post.engagement.score ?? 0}</span>
      <span><MessageCircle size={12} /> {post.engagement.comments ?? 0}</span>
    </>
  );
}

export function SocialMediaFeed({ ticker }: { ticker: string }) {
  const [result, setResult] = useState<SocialMediaResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(symbol: string, fresh = false) {
    setLoading(true);
    setError(null);
    try {
      setResult(await fetchSocialMedia(symbol, fresh));
    } catch {
      setResult(null);
      setError("Le signal social est momentanément indisponible.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(ticker);
  }, [ticker]);

  const posts = useMemo(
    () => (result?.posts ?? []).slice(0, 6),
    [result],
  );

  const reddit = result?.source_status.reddit;

  return (
    <article className="panel social-media-panel">
      <div className="panel-title">
        <MessagesSquare size={18} />
        <strong>Social Media · {ticker}</strong>
        <span className={`social-reddit-source ${reddit?.status ?? "empty"}`}>
          <MessagesSquare size={13} />
          Reddit
          <b>{reddit?.posts_count ?? 0}</b>
        </span>
        {result?.sentiment_label ? (
          <span
            className={`sentiment-badge ${result.sentiment_label}`}
            data-finance-concept="sentiment social"
          >
            {SENTIMENT_LABELS[result.sentiment_label]}
            {result.sentiment_score != null
              ? ` · ${result.sentiment_score > 0 ? "+" : ""}${result.sentiment_score.toFixed(2)}`
              : ""}
          </span>
        ) : null}
        <button
          className="icon-button"
          type="button"
          aria-label="Rafraîchir le signal social"
          onClick={() => void load(ticker, true)}
        >
          <RefreshCw size={16} className={loading ? "spin" : ""} />
        </button>
      </div>

      {result?.summary ? (
        <div className="social-summary">
          <Sparkles size={14} />
          <p>{result.summary}</p>
        </div>
      ) : null}

      {result?.themes.length ? (
        <div className="social-themes">
          {result.themes.slice(0, 4).map((theme) => (
            <span key={theme}>{theme}</span>
          ))}
        </div>
      ) : null}

      {error ? <div className="social-empty error">{error}</div> : null}
      {loading && !result ? (
        <div className="social-empty">Collecte Reddit en cours…</div>
      ) : null}

      <div className="social-post-list">
        {posts.map((post) => (
          <a
            className="social-post"
            href={post.url}
            key={post.id}
            target="_blank"
            rel="noreferrer"
          >
            <div className="social-source-mark reddit">
              <MessagesSquare size={15} />
            </div>
            <div className="social-post-content">
              <div className="social-post-head">
                <strong>{post.author}</strong>
                <time>{formatPublishedAt(post.published_at)}</time>
                <ExternalLink size={12} />
              </div>
              <p>{post.text}</p>
              <div className="social-post-meta">
                {post.sentiment ? (
                  <span className={`social-sentiment ${post.sentiment}`}>
                    {SENTIMENT_LABELS[post.sentiment]}
                  </span>
                ) : null}
                <Engagement post={post} />
              </div>
            </div>
          </a>
        ))}
        {result && !posts.length ? (
          <div className="social-empty">Aucune publication Reddit disponible.</div>
        ) : null}
      </div>

      {result?.warnings.length ? (
        <div className="social-source-note">
          {result.warnings[0]}
        </div>
      ) : null}
    </article>
  );
}
