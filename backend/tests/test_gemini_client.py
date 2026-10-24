"""Unit tests for the Gemini provider layer (no network, no API key).

These lock in the request/response contract of the shared client: the key
travels in a header, the persona and retrieved context become Gemini's
``systemInstruction``, chat turns become alternating ``contents``, tiers map
to the configured model ids, JSON mode is requested for structured passes,
and every failure path returns ``None`` so the deterministic fallbacks run.
"""
import json

import pytest

from services.ai import client


class FakeResponse:
    """Minimal stand-in for the object urllib.request.urlopen returns."""

    def __init__(self, body):
        self.body = body

    def read(self):
        return self.body.encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def __iter__(self):
        return iter(self.body.encode("utf-8").splitlines(keepends=True))


def _gemini_reply(text):
    return json.dumps({
        "candidates": [{
            "content": {"role": "model", "parts": [{"text": text}]},
            "finishReason": "STOP",
        }]
    })


@pytest.fixture()
def configured(monkeypatch):
    monkeypatch.setattr(client.Config, "AI_PROVIDER", "gemini")
    monkeypatch.setattr(client.Config, "GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(client.Config, "AI_MOCK_MODE", False)
    monkeypatch.setattr(client.Config, "GEMINI_MODEL", "gemini-3.6-flash")
    monkeypatch.setattr(client.Config, "GEMINI_MODEL_FAST", "gemini-3.5-flash-lite")
    monkeypatch.setattr(client.Config, "GEMINI_MODEL_DEEP", "gemini-3.8-flash")
    monkeypatch.setattr(client.Config, "GEMINI_THINKING_LEVEL", "")
    monkeypatch.setattr(client.Config, "GEMINI_THINKING_BUDGET", 0)
    monkeypatch.setattr(client.Config, "GEMINI_API_BASE", "https://example.test/v1beta")
    monkeypatch.setattr(client.Config, "AI_TIMEOUT_SECONDS", 5)


def test_request_shape_and_text_parsing(configured, monkeypatch):
    captured = {}

    def fake_urlopen(request, timeout=None):
        captured["url"] = request.full_url
        captured["headers"] = {k.lower(): v for k, v in request.header_items()}
        captured["payload"] = json.loads(request.data)
        return FakeResponse(_gemini_reply("Hello from Gemini"))

    monkeypatch.setattr(client.urllib.request, "urlopen", fake_urlopen)

    text = client.call_llm(
        "PERSONA",
        "How are you?",
        max_tokens=300,
        messages=[
            {"role": "assistant", "content": "Welcome"},
            {"role": "user", "content": "I am here"},
            {"role": "user", "content": "How are you?"},
        ],
        system_extra="CONTEXT",
    )

    assert text == "Hello from Gemini"
    assert captured["url"].endswith("/models/gemini-3.6-flash:generateContent")
    assert captured["headers"]["x-goog-api-key"] == "test-key"
    assert captured["payload"]["systemInstruction"] == {
        "parts": [{"text": "PERSONA\n\nCONTEXT"}]
    }
    # The leading assistant turn is dropped and same-role turns are merged.
    assert captured["payload"]["contents"] == [
        {"role": "user", "parts": [{"text": "I am here\n\nHow are you?"}]}
    ]
    generation = captured["payload"]["generationConfig"]
    # Thinking tokens share the output budget, so the chat tier is given room.
    assert generation["maxOutputTokens"] == 1024
    assert generation["thinkingConfig"] == {"thinkingLevel": "MINIMAL"}
    assert "responseMimeType" not in generation
    # A background/chat call must not leak the mock reply into other features.
    assert client.call_llm("S", "hi", mock_reply=False) == "Hello from Gemini"


def test_model_tiers_and_json_mode(configured, monkeypatch):
    captured = []

    def fake_urlopen(request, timeout=None):
        payload = json.loads(request.data)
        captured.append({"url": request.full_url, "payload": payload})
        if payload["generationConfig"].get("responseMimeType") == "application/json":
            return FakeResponse(_gemini_reply('[{"facttext": "My granddaughter is called Lily."}]'))
        return FakeResponse(_gemini_reply("ok"))

    monkeypatch.setattr(client.urllib.request, "urlopen", fake_urlopen)

    client.call_llm("S", "hi", tier="fast")
    client.call_llm("S", "hi", tier="deep")
    parsed = client.call_llm_json("Extract", "message", default=[])

    assert captured[0]["url"].endswith("gemini-3.5-flash-lite:generateContent")
    assert captured[0]["payload"]["generationConfig"]["thinkingConfig"] == {
        "thinkingLevel": "MINIMAL"
    }
    assert captured[1]["url"].endswith("gemini-3.8-flash:generateContent")
    assert captured[1]["payload"]["generationConfig"]["thinkingConfig"] == {
        "thinkingLevel": "HIGH"
    }
    assert captured[1]["payload"]["generationConfig"]["maxOutputTokens"] >= 2048
    assert captured[2]["payload"]["generationConfig"]["responseMimeType"] == "application/json"
    # Gemini 3.8 rejects MINIMAL, so the client must use LOW on that family.
    client.call_llm("S", "hi", model="gemini-3.8-flash")
    assert captured[-1]["payload"]["generationConfig"]["thinkingConfig"] == {
        "thinkingLevel": "LOW"
    }
    assert parsed == [{"facttext": "My granddaughter is called Lily."}]


def test_stream_parses_sse_chunks_without_losing_spaces(configured, monkeypatch):
    body = "\n\n".join([
        'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}',
        'data: {"candidates":[{"content":{"parts":[{"text":" there"}]}}]}',
        'data: {"candidates":[{"content":{"parts":[{"text":"!"}]},"finishReason":"STOP"}]}',
    ])

    def fake_urlopen(request, timeout=None):
        assert "streamGenerateContent?alt=sse" in request.full_url
        return FakeResponse(body)

    monkeypatch.setattr(client.urllib.request, "urlopen", fake_urlopen)

    chunks = list(client.stream_llm("P", [{"role": "user", "content": "hi"}]))
    assert chunks == ["Hello", " there", "!"]
    assert "".join(chunks) == "Hello there!"


def test_missing_key_returns_none_or_deterministic_mock(configured, monkeypatch):
    monkeypatch.setattr(client.Config, "GEMINI_API_KEY", "")
    monkeypatch.setattr(client.Config, "AI_MOCK_MODE", False)
    assert client.llm_configured() is False
    assert client.call_llm("S", "hi") is None
    assert client.call_llm("S", "hi", mock_reply=True) is None

    monkeypatch.setattr(client.Config, "AI_MOCK_MODE", True)
    # A greeting gets a greeting back — the fact must not become the centre
    # of the conversation.
    reply = client.call_llm(
        "What I know about you\n- My granddaughter is called Lily",
        "hi",
        mock_reply=True,
    )
    assert "Lily" not in reply
    assert "Hello" in reply

    # A question that is actually about that fact still uses it.
    reply = client.call_llm(
        "What I know about you\n- My granddaughter is called Lily",
        "Tell me about my granddaughter",
        mock_reply=True,
    )
    assert "your granddaughter is called Lily" in reply
    # Other generators keep their own fallbacks, not a chat-shaped sentence.
    assert client.call_llm("S", "hi") is None


def test_api_errors_and_unknown_providers_fall_back(configured, monkeypatch):
    def failing(request, timeout=None):
        raise client.urllib.error.HTTPError(
            request.full_url, 500, "server error", {}, None
        )

    monkeypatch.setattr(client.urllib.request, "urlopen", failing)
    monkeypatch.setattr(client.time, "sleep", lambda *_: None)
    assert client.call_llm("S", "hi") is None
    assert list(client.stream_llm("S", [{"role": "user", "content": "hi"}])) == []

    monkeypatch.setattr(client.Config, "AI_PROVIDER", "some-other-vendor")
    assert client.llm_configured() is False
    assert client.call_llm("S", "hi") is None
