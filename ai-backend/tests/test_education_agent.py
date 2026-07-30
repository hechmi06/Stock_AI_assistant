from app.agents.education_agent import EducationAgent
from app.agents.schemas import EducationChatRequest


class FakeEducationClient:
    model = "Qwen/Test"

    def explain_finance(self, message, history, context):
        return {
            "answer": f"Explication de {message}",
            "concepts": ["bêta", "benchmark"],
            "suggested_questions": ["Pourquoi comparer au marché ?"],
        }


class DisabledEducationClient:
    model = "Qwen/Test"

    def explain_finance(self, message, history, context):
        return None


def test_education_agent_returns_structured_llm_answer():
    result = EducationAgent(FakeEducationClient()).answer(
        EducationChatRequest(
            message="Explique le bêta",
            page="analysis",
            ticker="msft",
        )
    )

    assert result.status == "success"
    assert result.provider == "nebius"
    assert result.model == "Qwen/Test"
    assert result.concepts == ["bêta", "benchmark"]
    assert result.educational_only is True


def test_education_agent_uses_glossary_when_llm_is_unavailable():
    result = EducationAgent(DisabledEducationClient()).answer(
        EducationChatRequest(message="Quelle différence entre spot et forward ?")
    )

    assert result.status == "partial"
    assert result.provider == "glossary"
    assert result.concepts == ["spot", "forward"]
    assert "règlement immédiat" in result.answer
