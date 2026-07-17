import { ExternalLink, Newspaper, RefreshCw, ChevronRight, BrainCircuit } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchNews } from "../services/analysisApi";
import type { NewsResult, NewsSentiment } from "../types";

const SENTIMENT_LABELS: Record<NewsSentiment, string> = {
  positive: "Positif",
  negative: "Négatif",
  neutral: "Neutre",
  mixed: "Mitigé",
};

const ORIGIN_LABELS: Record<string, string> = {
  financial_modeling_prep: "FMP",
  yahoo_rss: "Yahoo",
  finnhub: "Finnhub",
  google_news_rss: "Google News",
  newsdata_io: "NewsData",
};

function formatPublishedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function NewsFeed({ ticker }: { ticker: string }) {
  const [news, setNews] = useState<NewsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadNews(symbol: string) {
    setLoading(true);
    setError(null);
    try {
      setNews(await fetchNews(symbol));
    } catch {
      setNews(null);
      setError("Impossible de récupérer les actualités. Vérifiez que le backend est démarré.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadNews(ticker);
  }, [ticker]);

  const visibleEvents = news?.key_events.slice(0, 2) ?? [];
  const visibleArticles = news?.articles.slice(0, 5) ?? [];

  return (
    <article className="panel news-panel">
      <div className="panel-title">
        <Newspaper size={18} />
        <strong>Actualités · {ticker}</strong>
        {news?.sentiment_label ? (
          <span className={`sentiment-badge ${news.sentiment_label}`}>
            {SENTIMENT_LABELS[news.sentiment_label]}
            {news.sentiment_score != null ? ` · ${news.sentiment_score > 0 ? "+" : ""}${news.sentiment_score.toFixed(2)}` : ""}
          </span>
        ) : null}
        <button
          className="icon-button"
          type="button"
          onClick={() => void loadNews(ticker)}
          aria-label="Rafraîchir les actualités"
        >
          <RefreshCw size={16} className={loading ? "spin" : ""} />
        </button>
      </div>

      {error ? <div className="news-error">{error}</div> : null}
      {loading && !news ? <div className="news-loading">Chargement des actualités…</div> : null}

      {news?.slm_summary?.summary ? (
        <div className="news-summary-box">
          <div className="news-summary-header">
            <BrainCircuit size={14} /> Résumé IA
          </div>
          <p className="news-summary">{news.slm_summary.summary}</p>
        </div>
      ) : null}

      {visibleEvents.length ? (
        <div className="news-events-list">
          {visibleEvents.map((event, idx) => (
            <div className="news-event-item" key={idx}>
              <ChevronRight size={14} className="news-event-icon" />
              <span>{event}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="news-list">
        {visibleArticles.map((article) => (
          <a className="news-item" key={article.url} href={article.url} target="_blank" rel="noreferrer">
            <div className="news-item-head">
              {article.sentiment ? (
                <span className={`sentiment-dot ${article.sentiment}`} title={SENTIMENT_LABELS[article.sentiment]} />
              ) : (
                <span className="sentiment-dot" />
              )}
              <strong>{article.title}</strong>
              <ExternalLink size={13} className="news-ext" />
            </div>
            <div className="news-item-meta">
              <span>{article.source}</span>
              <span className="news-origin">{ORIGIN_LABELS[article.origin] ?? article.origin}</span>
              <span>{formatPublishedAt(article.published_at)}</span>
            </div>
            {article.summary ? <p className="news-item-summary">{article.summary}</p> : null}
          </a>
        ))}
        {news && news.articles.length === 0 ? (
          <div className="news-loading">Aucune actualité disponible pour ce titre.</div>
        ) : null}
      </div>
    </article>
  );
}
