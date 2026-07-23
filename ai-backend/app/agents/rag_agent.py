"""RAGAgent : interrogation des documents financiers officiels (SEC EDGAR).

Pipeline :
    ticker -> [MCP] filings 10-K/10-Q -> texte -> chunks (filtres) ->
    embeddings Nebius -> Qdrant (local) -> recherche -> passages sources -> SLM.

Qdrant tourne en mode local embarque (chemin disque, sans serveur), sauf si
QDRANT_URL est fourni. Les points ont un ID deterministe (UUID de l'URL + index)
pour rendre l'ingestion idempotente.
"""

from __future__ import annotations

import os
import re
import threading
import uuid
from pathlib import Path

from .mcp_client import McpClient
from .nebius_client import NebiusClient
from .schemas import (
    RagDocument,
    RagIngestResult,
    RagPassage,
    RagResult,
)

_UUID_NAMESPACE = uuid.UUID("6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8")

DEFAULT_COLLECTION = "financial_docs"
EMBEDDING_DIM = 4096  # Qwen/Qwen3-Embedding-8B

CHUNK_SIZE = 1100
CHUNK_OVERLAP = 150
MAX_CHUNKS_PER_DOC = 120  # borne le cout d'embedding sur un 10-K volumineux
EMBED_BATCH = 32


def _collection_name() -> str:
    return os.getenv("RAG_COLLECTION", DEFAULT_COLLECTION).strip() or DEFAULT_COLLECTION


def _qdrant_location() -> dict[str, str]:
    """Serveur si QDRANT_URL, sinon chemin local embarque."""
    url = os.getenv("QDRANT_URL", "").strip()
    if url:
        return {"url": url}
    project_root = Path(__file__).resolve().parents[3]
    configured_path = os.getenv("QDRANT_PATH", "").strip()
    path = Path(configured_path) if configured_path else project_root / "data" / "qdrant"
    if not path.is_absolute():
        path = project_root / path
    return {"path": str(path)}


def _chunk_text(text: str) -> list[str]:
    """Decoupe en chunks avec recouvrement, en ne gardant que le narratif.

    Un depot SEC contient beaucoup de bruit XBRL / tableaux chiffres : on ecarte
    les chunks trop peu alphabetiques ou trop pauvres en mots reels.
    """
    cleaned = re.sub(r"\s+", " ", text).strip()
    chunks: list[str] = []
    start = 0
    length = len(cleaned)
    while start < length and len(chunks) < MAX_CHUNKS_PER_DOC:
        end = min(start + CHUNK_SIZE, length)
        chunk = cleaned[start:end].strip()
        if _is_narrative(chunk):
            chunks.append(chunk)
        start += CHUNK_SIZE - CHUNK_OVERLAP
    return chunks


def _is_narrative(chunk: str) -> bool:
    if len(chunk) < 200:
        return False
    lowered = chunk.lower()
    letters = sum(1 for ch in chunk if ch.isalpha())
    if letters / len(chunk) < 0.6:  # trop de chiffres/symboles (tableaux, XBRL)
        return False
    words = re.findall(r"[A-Za-z]{3,}", chunk)
    if len(words) < 30:
        return False
    if _looks_like_xbrl_noise(chunk, lowered):
        return False
    return True


def _looks_like_xbrl_noise(chunk: str, lowered: str) -> bool:
    xbrl_markers = [
        "fasb.org",
        "xbrl",
        "us-gaap",
        "dei:",
        "srt:",
        "iso4217",
        "xbrli",
        "xbrldi",
        "nondesignatedmember",
        "creditconcentrationriskmember",
    ]
    if any(marker in lowered for marker in xbrl_markers):
        return True
    namespace_tokens = re.findall(r"\b[a-z]{2,12}:[A-Za-z][A-Za-z0-9_-]+", chunk)
    if len(namespace_tokens) >= 3:
        return True
    if len(re.findall(r"\b[A-Za-z]+Member\b", chunk)) >= 8:
        return True
    if len(re.findall(r"\b\d{10}\b", chunk)) >= 4:
        return True
    return False


def _query_variants(question: str) -> list[str]:
    """Construit quelques requetes de recherche pour couvrir les questions mixtes."""
    raw = question.strip()
    lowered = raw.lower()
    variants = [raw]

    if any(term in lowered for term in ("risk", "risque", "risques", "facteur", "facteurs")):
        variants.append("risk factors regulatory competition operational financial risks")
    if any(term in lowered for term in ("segment", "segments", "activite", "activité", "business")):
        variants.append("business segments products services revenue by segment")
    if any(term in lowered for term in ("revenue", "chiffre", "affaires", "sales", "ventes")):
        variants.append("revenue sales growth financial performance")

    unique: list[str] = []
    seen: set[str] = set()
    for variant in variants:
        key = variant.lower()
        if key not in seen:
            seen.add(key)
            unique.append(variant)
    return unique[:4]


class RagAgent:
    def __init__(
        self,
        mcp_client: McpClient | None = None,
        slm_client: NebiusClient | None = None,
        graph=None,
    ) -> None:
        self.mcp_client = mcp_client or McpClient()
        self.slm_client = slm_client or NebiusClient.for_agent("rag")
        self.graph = graph
        self._client = None
        # Qdrant en mode local embarque est mono-writer et n'est pas concu pour
        # l'acces concurrent : ce verrou serialise toutes les operations Qdrant
        # (init, search, count, upsert, delete) quand plusieurs threads du
        # workflow portefeuille interrogent le RAG en parallele.
        self._lock = threading.RLock()

    # -- Qdrant (chargement paresseux pour ne pas verrouiller le chemin au boot) --
    def _qdrant(self):
        if self._client is None:
            with self._lock:
                if self._client is None:
                    from qdrant_client import QdrantClient
                    from qdrant_client.models import Distance, VectorParams

                    client = QdrantClient(**_qdrant_location())
                    existing = {c.name for c in client.get_collections().collections}
                    if _collection_name() not in existing:
                        client.create_collection(
                            collection_name=_collection_name(),
                            vectors_config=VectorParams(size=EMBEDDING_DIM, distance=Distance.COSINE),
                        )
                    self._client = client
        return self._client

    def _point_id(self, url: str, index: int) -> str:
        return str(uuid.uuid5(_UUID_NAMESPACE, f"{url}#{index}"))

    def ingest(self, ticker: str, limit: int = 2) -> RagIngestResult:
        symbol = ticker.strip().upper()
        if not symbol:
            return RagIngestResult(ticker="", status="failed", errors=["Ticker is required."])

        warnings: list[str] = []
        errors: list[str] = []

        filings_payload = self.mcp_client.get(f"tools/sec-filings/{symbol}?forms=10-K,10-Q&limit={limit}")
        if not filings_payload:
            return RagIngestResult(ticker=symbol, status="failed", errors=["SEC filings unavailable via MCP."])
        warnings.extend(filings_payload.get("errors") or [])

        filings = filings_payload.get("filings") or []
        if not filings:
            return RagIngestResult(ticker=symbol, status="failed", warnings=warnings, errors=["Aucun depot 10-K/10-Q trouve."])

        try:
            from qdrant_client.models import PointStruct
        except Exception as error:  # qdrant-client non installe
            return RagIngestResult(ticker=symbol, status="failed", warnings=warnings, errors=[f"qdrant-client indisponible: {error}"])

        documents: list[RagDocument] = []
        total_chunks = 0

        for filing in filings:
            url = filing.get("document_url")
            if not url:
                continue
            doc_payload = self.mcp_client.get(f"tools/sec-document?url={url}", timeout=60)
            if not doc_payload or not doc_payload.get("text"):
                warnings.append(f"Document illisible: {url}")
                continue

            chunks = _chunk_text(doc_payload["text"])
            if not chunks:
                warnings.append(f"Aucun passage narratif exploitable: {url}")
                continue

            try:
                vectors = self._embed_batched(chunks)
            except Exception as error:
                errors.append(f"Embeddings indisponibles ({filing.get('form')}): {error}")
                continue

            points = [
                PointStruct(
                    id=self._point_id(url, index),
                    vector=vector,
                    payload={
                        "ticker": symbol,
                        "form": filing.get("form"),
                        "filing_date": filing.get("filing_date"),
                        "url": url,
                        "chunk_index": index,
                        "text": chunk,
                    },
                )
                for index, (chunk, vector) in enumerate(zip(chunks, vectors))
            ]
            try:
                self._delete_existing_chunks(symbol, url)
            except Exception as error:
                warnings.append(f"Ancienne version du document non supprimee avant upsert: {error}")
            with self._lock:
                self._qdrant().upsert(collection_name=_collection_name(), points=points)
            documents.append(
                RagDocument(
                    form=filing.get("form") or "",
                    filing_date=filing.get("filing_date"),
                    url=url,
                    chunks_indexed=len(points),
                )
            )
            total_chunks += len(points)
            self._remember(symbol, filing)

        status = "success" if total_chunks > 0 else ("partial" if documents else "failed")
        if total_chunks == 0 and not errors:
            errors.append("Aucun passage indexe.")
        return RagIngestResult(
            ticker=symbol,
            status=status,
            documents=documents,
            chunks_indexed=total_chunks,
            warnings=warnings,
            errors=errors,
        )

    def query(self, ticker: str, question: str, top_k: int = 5, with_slm: bool = True) -> RagResult:
        symbol = ticker.strip().upper()
        if not symbol or not question.strip():
            return RagResult(ticker=symbol, question=question, status="failed", errors=["Ticker et question requis."])

        try:
            from qdrant_client.models import FieldCondition, Filter, MatchValue
        except Exception as error:
            return RagResult(ticker=symbol, question=question, status="failed", errors=[f"qdrant-client indisponible: {error}"])

        indexed = self._count_indexed(symbol)
        if indexed == 0:
            return RagResult(
                ticker=symbol,
                question=question,
                status="failed",
                indexed_chunks=0,
                errors=[f"Aucun document indexe pour {symbol}. Lancer l'ingestion d'abord."],
            )

        queries = _query_variants(question)
        try:
            query_vectors = self.slm_client.embed(queries)
        except Exception as error:
            return RagResult(ticker=symbol, question=question, status="failed", indexed_chunks=indexed, errors=[f"Embedding question echoue: {error}"])

        top_k = max(1, min(top_k, 12))
        query_filter = Filter(must=[FieldCondition(key="ticker", match=MatchValue(value=symbol))])
        per_query_limit = top_k if len(query_vectors) == 1 else max(3, min(top_k, (top_k + len(query_vectors) - 1) // len(query_vectors) + 2))
        grouped_hits = []
        hits_by_key = {}
        for query_vector in query_vectors:
            with self._lock:
                group = self._qdrant().search(
                    collection_name=_collection_name(),
                    query_vector=query_vector,
                    query_filter=query_filter,
                    limit=per_query_limit,
                    with_payload=True,
                )
            grouped_hits.append(group)
            for hit in group:
                key = self._hit_key(hit)
                previous = hits_by_key.get(key)
                if previous is None or float(hit.score) > float(previous.score):
                    hits_by_key[key] = hit

        hits = []
        selected_keys: set[str] = set()
        per_variant_quota = 2 if len(grouped_hits) > 1 and top_k >= 4 else 1
        for group in grouped_hits:
            added_for_group = 0
            for hit in sorted(group, key=lambda item: float(item.score), reverse=True):
                key = self._hit_key(hit)
                if key in selected_keys:
                    continue
                hits.append(hit)
                selected_keys.add(key)
                added_for_group += 1
                if added_for_group >= per_variant_quota or len(hits) >= top_k:
                    break
            if len(hits) >= top_k:
                break

        remaining_hits = sorted(hits_by_key.values(), key=lambda item: float(item.score), reverse=True)
        for hit in remaining_hits:
            if len(hits) >= top_k:
                break
            key = self._hit_key(hit)
            if key not in selected_keys:
                hits.append(hit)
                selected_keys.add(key)

        passages = [
            RagPassage(
                text=str(hit.payload.get("text") or ""),
                form=hit.payload.get("form"),
                filing_date=hit.payload.get("filing_date"),
                url=hit.payload.get("url"),
                score=float(hit.score),
            )
            for hit in hits
        ]
        if not passages:
            return RagResult(ticker=symbol, question=question, status="partial", indexed_chunks=indexed, warnings=["Aucun passage pertinent trouve."])

        answer = None
        warnings: list[str] = []
        if with_slm:
            answer = self.slm_client.answer_rag(question, [p.model_dump() for p in passages])
            if answer is None:
                warnings.append("Synthese SLM indisponible : passages bruts renvoyes.")

        return RagResult(
            ticker=symbol,
            question=question,
            status="success",
            answer=answer,
            passages=passages,
            indexed_chunks=indexed,
            warnings=warnings,
        )

    def _embed_batched(self, chunks: list[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for start in range(0, len(chunks), EMBED_BATCH):
            vectors.extend(self.slm_client.embed(chunks[start : start + EMBED_BATCH]))
        return vectors

    def _hit_key(self, hit) -> str:
        payload = hit.payload or {}
        url = payload.get("url")
        chunk_index = payload.get("chunk_index")
        if url is not None and chunk_index is not None:
            return f"{url}#{chunk_index}"
        return str(getattr(hit, "id", id(hit)))

    def _count_indexed(self, ticker: str) -> int:
        try:
            from qdrant_client.models import FieldCondition, Filter, MatchValue

            with self._lock:
                result = self._qdrant().count(
                    collection_name=_collection_name(),
                    count_filter=Filter(must=[FieldCondition(key="ticker", match=MatchValue(value=ticker))]),
                    exact=True,
                )
            return int(result.count)
        except Exception:
            return 0

    def _delete_existing_chunks(self, ticker: str, url: str) -> None:
        from qdrant_client.models import FieldCondition, Filter, MatchValue

        with self._lock:
            self._qdrant().delete(
                collection_name=_collection_name(),
                points_selector=Filter(
                    must=[
                        FieldCondition(key="ticker", match=MatchValue(value=ticker)),
                        FieldCondition(key="url", match=MatchValue(value=url)),
                    ]
                ),
                wait=True,
            )

    def _remember(self, ticker: str, filing: dict) -> None:
        if self.graph is None:
            return
        try:
            form = filing.get("form") or "document"
            date = filing.get("filing_date") or ""
            doc_id = f"{ticker}:{form}:{date}"
            self.graph.add_fact(ticker, "has_document", doc_id)
            self.graph.add_fact(doc_id, "is_a", "sec_filing")
            self.graph.add_fact(doc_id, "document_from", "SEC_EDGAR")
            self.graph.add_fact(doc_id, "has_form", form)
        except Exception:
            pass
