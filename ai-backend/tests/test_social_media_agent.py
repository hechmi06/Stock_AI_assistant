from app.agents.social_media_agent import SocialMediaAgent


class FakeMcpClient:
    def get(self, path: str, timeout: int = 20):
        return {
            "ticker": "AAPL",
            "collected_at": "2026-07-28T12:00:00+00:00",
            "posts": [
                {
                    "id": "reddit-1",
                    "source": "reddit",
                    "author": "investor",
                    "text": "Apple services growth looks strong.",
                    "url": "https://www.reddit.com/r/stocks/comments/1",
                    "published_at": "2026-07-28T11:00:00+00:00",
                    "engagement": {"score": 12, "comments": 3},
                }
            ],
            "sources_used": ["reddit"],
            "source_status": {
                "reddit": {"status": "success", "posts_count": 1},
            },
            "errors": [],
        }


class FakeSlmClient:
    model = "Qwen/Test"

    def analyze_social_media(self, payload):
        return {
            "summary": "Le signal Reddit est positif mais peu representatif.",
            "data_quality": "partial",
            "sentiment_label": "positive",
            "sentiment_score": 0.4,
            "themes": ["services"],
            "key_points": ["Une seule source disponible."],
            "warnings": ["Echantillon Reddit limite."],
            "post_sentiments": [{"index": 0, "sentiment": "positive"}],
        }


def test_social_media_agent_succeeds_with_reddit():
    result = SocialMediaAgent(FakeMcpClient(), FakeSlmClient()).run(
        "aapl",
        use_cache=False,
    )

    assert result.status == "success"
    assert result.sources_used == ["reddit"]
    assert result.source_status["reddit"].status == "success"
    assert result.sentiment_label == "positive"
    assert result.posts[0].sentiment == "positive"
    assert result.warnings == []
