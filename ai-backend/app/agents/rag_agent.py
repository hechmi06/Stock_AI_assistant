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
import uuid

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
    path = os.getenv("QDRANT_PATH", "").strip() or os.path.join("data", "qdrant")
    return {"path": path}


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
    letters = sum(1 for ch in chunk if ch.isalpha())
    if letters / len(chunk) < 0.6:  # trop de chiffres/symboles (tableaux, XBRL)
        return False
    words = re.findall(r"[A-Za-z]{3,}", chunk)
    if len(words) < 30:
        return False
    if "fasb.org" in chunk or "xbrl" in chunk.lower():
        return False
    return True


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

    # -- Qdrant (chargement paresseux pour ne pas verrouiller le chemin au boot) --
    def _qdrant(self):
        if self._client is None:
            from qdrant_client import QdrantClient
            from qdrant_client.models import Distance, VectorParams

            self._client = QdrantClient(**_qdrant_location())
            existing = {c.name for c in self._client.get_collections().collections}
            if _collection_name() not in existing:
                self._client.create_collection(
                    collection_name=_collection_name(),
                    vectors_config=VectorParams(size=EMBEDDING_DIM, distance=Distance.COSINE),
                )
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

        try:
            query_vector = self.slm_client.embed([question])[0]
        except Exception as error:
            return RagResult(ticker=symbol, question=question, status="failed", indexed_chunks=indexed, errors=[f"Embedding question echoue: {error}"])

        hits = self._qdrant().search(
            collection_name=_collection_name(),
            query_vector=query_vector,
            query_filter=Filter(must=[FieldCondition(key="ticker", match=MatchValue(value=symbol))]),
            limit=max(1, top_k),
            with_payload=True,
        )

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

    def _count_indexed(self, ticker: str) -> int:
        try:
            from qdrant_client.models import FieldCondition, Filter, MatchValue

            result = self._qdrant().count(
                collection_name=_collection_name(),
                count_filter=Filter(must=[FieldCondition(key="ticker", match=MatchValue(value=ticker))]),
                exact=True,
            )
            return int(result.count)
        except Exception:
            return 0

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
