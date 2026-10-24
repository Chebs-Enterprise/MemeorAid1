"""
Shared LLM client (document of proof section 2.2.2).

MemorAid does not train a custom model — it calls Google Gemini with backend
logic that collects and structures user data into a rich context before each
call. Every generator has a deterministic fallback so the system stays
functional when the API is unavailable (section 1.6 acknowledges the
dependency on a third-party API).

Provider abstraction
--------------------
The features never talk to a vendor SDK directly: they call ``call_llm`` /
``stream_llm`` / ``call_llm_json`` below. The active provider is chosen with
``AI_PROVIDER`` (default ``gemini``) and its credentials with
``GEMINI_API_KEY``. To add another provider, implement a generate and a
stream function for it and register them in ``_PROVIDERS``; nothing else in
the application needs to change.

Model tiering
-------------
    Config.GEMINI_MODEL       the chat companion — the reply the user reads
    Config.GEMINI_MODEL_FAST  background work (fact extraction, question
                              generation, digests, pattern detection)
    Config.GEMINI_MODEL_DEEP  optional "deep reflection" chat mode

Personalisation features added on top of the raw API
-----------------------------------------------------
    * real multi-turn ``contents`` (not a flattened transcript)
    * a separate system instruction for the persona + durable facts, plus the
      volatile retrieved context, so the stable prefix stays identical from
      turn to turn (Gemini's implicit caching can reuse it)
    * server-sent-event streaming, so the reply appears token by token
    * structured JSON output for the understanding / fact-extraction passes

With no API key the client either returns ``None`` (the caller falls back)
or, when ``AI_MOCK_MODE=1``, produces a deterministic reply that is built
from the *same context pack* the real model would receive — so the whole
personalisation pipeline is testable offline.
"""
import json
import re
import socket
import threading
import time
import urllib.error
import urllib.request

from config import Config

# Section markers used by the mock reply builder and by the context pack.
SECTION_FACTS = "What I know about you"
SECTION_MEMORIES = "Relevant memories"
SECTION_CHAT = "From our past conversations"

# Used when the corresponding GEMINI_MODEL* variable is missing/empty.
DEFAULT_MODELS = {
    "default": "gemini-3.6-flash",
    "fast": "gemini-3.5-flash-lite",
    "deep": "gemini-3.8-flash",
}


# ──────────────────────────────────────────────────────────────────────
# Provider selection
# ──────────────────────────────────────────────────────────────────────
def _provider():
    return str(getattr(Config, "AI_PROVIDER", "gemini") or "gemini").strip().lower()


def _api_key():
    if _provider() == "gemini":
        return str(getattr(Config, "GEMINI_API_KEY", "") or "").strip()
    return ""


def llm_configured():
    """True when the active provider has credentials configured.

    Features use this instead of checking a vendor-specific key, so switching
    providers requires no change outside this module.
    """
    return bool(_api_key())


def _model_for(tier=None):
    """Resolve a model id for a tier: fast | deep | default."""
    if tier == "fast":
        return (getattr(Config, "GEMINI_MODEL_FAST", "") or DEFAULT_MODELS["fast"]).strip()
    if tier == "deep":
        return (getattr(Config, "GEMINI_MODEL_DEEP", "") or DEFAULT_MODELS["deep"]).strip()
    return (getattr(Config, "GEMINI_MODEL", "") or DEFAULT_MODELS["default"]).strip()


def _mock_enabled():
    return bool(getattr(Config, "AI_MOCK_MODE", False))


# ──────────────────────────────────────────────────────────────────────
# Prompt helpers shared by every provider
# ──────────────────────────────────────────────────────────────────────
def _extract_section(text, header):
    """Pull the bullet lines of one marked section out of a context block."""
    if not text:
        return []
    out = []
    capture = False
    for line in text.splitlines():
        stripped = line.strip()
        if not capture:
            if stripped.startswith(header):
                capture = True
            continue
        if not stripped:
            continue
        if stripped.startswith("- "):
            out.append(stripped[2:].strip())
            continue
        # Any other line ends this section.
        break
    return out


def _clean_bullet(text):
    """Strip the context-pack formatting off a bullet, leaving the content."""
    text = re.sub(r"^\[[^\]]*\]\s*", "", text or "")          # [Family] prefix
    text = re.sub(r"^\d{4}-\d{2}-\d{2}:\s*", "", text)        # 2024-03-02: prefix
    text = re.sub(r"\s*—\s*selected because.*$", "", text)    # retrieval reason
    text = re.sub(r"\s*\(context:.*?\)\s*$", "", text)        # context note
    text = re.sub(r"\s*\([a-z]+,\s*confidence[^)]*\)\s*$", "", text)  # fact meta
    text = re.sub(r"\s*\([^)]*felt[^)]*\)\s*$", "", text)
    return text.strip()


def _as_second_person(text):
    """\"My granddaughter is called Lily\" -> \"your granddaughter is called Lily\"."""
    text = re.sub(r"(?i)^the user's\s+", "your ", text or "")
    text = re.sub(r"(?i)^the user\s+has\s+", "you have ", text)
    text = re.sub(r"(?i)^the user\s+is\s+", "you are ", text)
    text = re.sub(r"(?i)^the user\s+", "you ", text)
    if text.startswith("My "):
        return "your " + text[3:]
    if text.startswith("I "):
        return "you " + text[2:]
    return text


def _topic_words(text):
    """Meaningful words only, so "how are you" never looks like a memory."""
    stop = {
        "the", "and", "but", "for", "with", "about", "that", "this", "you",
        "your", "yours", "she", "her", "him", "his", "they", "them", "their",
        "there", "here", "what", "when", "where", "which", "who", "how", "why",
        "are", "was", "were", "been", "being", "have", "has", "had", "does",
        "did", "doing", "done", "can", "could", "would", "should", "will",
        "shall", "may", "might", "must", "not", "dont", "don't", "very", "just",
        "like", "really", "today", "now", "then", "from", "into", "out", "all",
        "any", "some", "one", "two", "get", "got", "tell", "said", "say",
        "know", "think", "feel", "feeling", "going", "good", "well", "much",
    }
    words = re.findall(r"[a-z0-9']+", (text or "").lower())
    return {word for word in words if len(word) > 2 and word not in stop}


def _context_matches_message(said, memories, facts):
    words = _topic_words(said)
    if not words:
        return False
    for text in list(memories or []) + list(facts or []):
        if _topic_words(text) & words:
            return True
    return False


MOCK_THANKS_RE = re.compile(
    r"(?i)\b(thanks|thank you|thankyou|cheers|appreciate (it|that))\b"
)
MOCK_ACK_RE = re.compile(
    r"(?i)^\s*(it'?s|it is|that'?s|that is|its)?\s*(ok|okay|fine|alright|all right)\b"
)
MOCK_REMIND_RE = re.compile(
    r"(?i)\b(remind|reminder|"
    r"what (am i|should i|do i need to|do i have to) (meant )?(to )?do|"
    r"what'?s (on|happening) tomorrow|what do i have (on )?tomorrow)\b"
)
MOCK_REMIND_REQUEST_RE = re.compile(
    r"(?i)\b(remind me|"
    r"what (am i|should i|do i need to|do i have to) (meant )?(to )?do|"
    r"what'?s (on|happening) tomorrow|what do i have (on )?tomorrow)\b"
)


def _mock_reply(system_prompt, user_prompt, messages=None):
    """Deterministic, context-derived reply used when no API key exists.

    It is grounded in the user's own history, but only mentions that history
    when the message is actually about it. A greeting gets a greeting back.
    """
    facts = [
        _clean_bullet(line)
        for line in _extract_section(system_prompt, SECTION_FACTS)
        if not line.startswith("(")
    ]
    memories = [
        _clean_bullet(line)
        for line in _extract_section(system_prompt, SECTION_MEMORIES)
        if not line.startswith("(")
    ]
    past = [
        line for line in _extract_section(system_prompt, SECTION_CHAT)
        if not line.startswith("(")
    ]

    said = (user_prompt or "").strip()
    if not said and messages:
        said = (messages[-1].get("content") or "").strip()

    name_match = re.search(r"(?i)\bhelp ([a-z][\w'-]+) feel known\b", system_prompt or "")
    name = name_match.group(1) if name_match else ""

    intent = ""
    match = re.search(r"(?im)^Intent:\s*(.+)$", system_prompt or "")
    if match:
        intent = match.group(1).strip().lower()

    # Gratitude / "it's okay" ends the turn; do not re-open the memory.
    gratitude = bool(MOCK_THANKS_RE.search(said) or MOCK_ACK_RE.search(said))
    if gratitude and not MOCK_REMIND_REQUEST_RE.search(said):
        return f"You're welcome, {name}." if name else "You're welcome."

    # A request to be reminded is where a memory belongs.
    if MOCK_REMIND_RE.search(said):
        item = memories[0] if memories else (facts[0] if facts else "")
        if item:
            line = _as_second_person(item).rstrip(".")
            if re.search(r"(?i)\bremind", said):
                greeting = f"Of course, {name}." if name else "Of course."
                return (
                    f"{greeting} {line[0].upper() + line[1:]}. I can remind you "
                    "again whenever you like."
                )
            return (
                f"You told me {line[0].lower() + line[1:]}. I hope that helps."
            )
        return (
            "Of course. I don't have a note about that yet. Would you like to "
            "tell me, so I can keep it?"
        )

    greeting = bool(re.match(
        r"(?i)^\s*(hi|hello|hey|good (morning|afternoon|evening))\b", said
    ))
    asks_how_you = bool(re.search(
        r"(?i)\b(how (are|is) (you|things|it going|your day)|how're you|"
        r"how have you been|what'?s up)\b",
        said,
    ))
    relevant = _context_matches_message(said, memories, facts)

    if greeting and not relevant:
        return "Hello. It's lovely to hear from you. How are you feeling today?"
    if asks_how_you and not relevant:
        return (
            "I'm doing well, thank you for asking. It's good to be here with "
            "you. How are you feeling today?"
        )
    if intent in ("greeting", "small talk") and not relevant:
        return "I'm here with you. What would you like to talk about today?"

    if not memories and not facts:
        if intent == "sharing a feeling":
            return (
                "I'm here with you. Would you like to tell me a little about "
                "what is on your mind?"
            )
        return "I'm here with you. Would you like to tell me about your day?"

    if intent == "asking a question":
        sentences = ["Here is what I remember."]
    elif intent == "sharing a feeling":
        sentences = ["I'm here with you."]
    else:
        sentences = ["I'm glad you told me."]

    if memories:
        sentences.append(f'I remember this one — you told me: "{memories[0]}".')
    if facts:
        sentences.append(
            f"I also remember that {_as_second_person(facts[0]).rstrip('.')}."
        )
    if past:
        sentences.append("We spoke about this before, so I have been thinking about it since.")
    sentences.append("Would you like to tell me a little more about how that felt?")

    return " ".join(sentences)


def _build_messages(user_prompt, messages):
    if messages:
        return list(messages)
    return [{"role": "user", "content": user_prompt or ""}]


# ──────────────────────────────────────────────────────────────────────
# Gemini transport
# ──────────────────────────────────────────────────────────────────────
def _gemini_endpoint(model, stream=False):
    base = str(
        getattr(Config, "GEMINI_API_BASE", "")
        or "https://generativelanguage.googleapis.com/v1beta"
    ).rstrip("/")
    name = (model or "").strip()
    if name.startswith("models/"):
        name = name[len("models/"):]
    method = "streamGenerateContent?alt=sse" if stream else "generateContent"
    return f"{base}/models/{name}:{method}"


def _is_pro(model):
    return "pro" in (model or "").lower()


def _thinking_config(model, tier=None):
    """Thinking control for the model family in use.

    Gemini 3/4 take a thinking *level*; earlier models take a token budget.
    The fast tier gets almost no thinking (its answers are short and
    structured), the chat tier a little, and the optional deep tier the most.
    A configured ``GEMINI_THINKING_LEVEL`` overrides the per-tier default.
    """
    name = (model or "").lower()
    if re.search(r"gemini-(?:3|4)", name):
        level = str(getattr(Config, "GEMINI_THINKING_LEVEL", "") or "").strip().upper()
        if level not in ("MINIMAL", "LOW", "MEDIUM", "HIGH"):
            level = {"fast": "MINIMAL", "deep": "HIGH"}.get(tier or "", "MINIMAL")
        # Gemini 3.8 and 4 Argon do not accept MINIMAL; LOW is their floor.
        if level == "MINIMAL" and re.search(r"gemini-(?:3\.8|4)", name):
            level = "LOW"
        return {"thinkingLevel": level}
    if _is_pro(model):
        return {"thinkingBudget": 128}
    if re.search(r"gemini-2\.5", name):
        budget = int(getattr(Config, "GEMINI_THINKING_BUDGET", 0) or 0)
        return {"thinkingBudget": max(0, budget)}
    return None


def _generation_config(model, max_tokens, json_mode=False, tier=None):
    config = {
        "maxOutputTokens": int(max_tokens or 500),
        "temperature": 0.15 if json_mode else 0.8,
    }
    thinking = _thinking_config(model, tier)
    if thinking:
        config["thinkingConfig"] = thinking
        # Thinking tokens count towards maxOutputTokens, so leave room for
        # the visible answer on the tiers that are allowed to reason.
        if tier == "deep" or _is_pro(model):
            config["maxOutputTokens"] = max(config["maxOutputTokens"], 2048)
        elif "thinkingLevel" in thinking:
            config["maxOutputTokens"] = max(config["maxOutputTokens"], 1024)
    if json_mode:
        config["responseMimeType"] = "application/json"
    return config


def _to_contents(messages):
    """Convert chat-shaped messages to Gemini ``contents``.

    Roles map assistant -> model. Consecutive turns with the same role are
    merged (Gemini expects an alternating conversation) and a leading model
    turn is dropped so the history always starts with the user.
    """
    contents = []
    for message in messages or []:
        role = (message.get("role") or "user").lower()
        target = "model" if role in ("assistant", "model", "ai") else "user"
        text = str(message.get("content") or "").strip()
        if not text:
            continue
        if contents and contents[-1]["role"] == target:
            contents[-1]["parts"][0]["text"] += "\n\n" + text
        else:
            contents.append({"role": target, "parts": [{"text": text}]})
    while contents and contents[0]["role"] == "model":
        contents.pop(0)
    return contents


def _gemini_payload(system_text, contents, max_tokens, model, json_mode=False, tier=None):
    payload = {
        "contents": contents,
        "generationConfig": _generation_config(model, max_tokens, json_mode, tier),
    }
    if system_text:
        payload["systemInstruction"] = {"parts": [{"text": system_text}]}
    return payload


_OPEN_LOCK = threading.Lock()


def _urlopen(request, timeout):
    """Open a request, trying IPv4 addresses before IPv6 ones.

    Some Windows networks resolve Google hosts to IPv6 addresses they cannot
    actually route to. Python then waits for the IPv6 attempt to time out
    before falling back, which looks like a Gemini outage. Reordering the
    resolved addresses keeps IPv6 as a fallback while making the common case
    fast. The patch is active only while the connection is being opened.
    """
    with _OPEN_LOCK:
        original = socket.getaddrinfo

        def ipv4_first(host, port, family=0, type=0, proto=0, flags=0):
            infos = original(host, port, family, type, proto, flags)
            if family not in (0, socket.AF_UNSPEC):
                return infos
            ipv4 = [info for info in infos if info[0] == socket.AF_INET]
            rest = [info for info in infos if info[0] != socket.AF_INET]
            return ipv4 + rest

        socket.getaddrinfo = ipv4_first
        try:
            return urllib.request.urlopen(request, timeout=timeout)
        finally:
            socket.getaddrinfo = original


def _post(url, payload, key, stream=False):
    """POST JSON to Gemini, with one retry for transient failures."""
    body = json.dumps(payload).encode("utf-8")
    timeout = float(getattr(Config, "AI_TIMEOUT_SECONDS", 60) or 60)
    last_error = None
    for attempt in range(2):
        request = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                # Header (not a query parameter) so the key never lands in a
                # URL that could be logged.
                "x-goog-api-key": key,
            },
        )
        try:
            return _urlopen(request, timeout)
        except urllib.error.HTTPError as exc:
            detail = ""
            try:
                detail = exc.read().decode("utf-8", "replace")[:400]
            except Exception:
                pass
            last_error = RuntimeError(f"HTTP {exc.code}: {detail}".strip())
            if exc.code in (429, 500, 502, 503, 504) and attempt == 0:
                time.sleep(0.8)
                continue
            raise last_error from None
        except urllib.error.URLError as exc:
            last_error = RuntimeError(str(getattr(exc, "reason", None) or exc))
            if attempt == 0:
                time.sleep(0.8)
                continue
            raise last_error from None
    raise last_error or RuntimeError("Gemini request failed")


def _gemini_text(data, strip=True):
    """Join the visible text parts of a Gemini response (thoughts excluded).

    ``strip=False`` is used while streaming: Gemini chunks often begin with
    the space before the next word, so trimming each chunk would glue words
    together. The non-streaming path trims the completed answer instead.
    """
    parts = []
    for candidate in data.get("candidates") or []:
        content = candidate.get("content") or {}
        for part in content.get("parts") or []:
            if part.get("thought"):
                continue
            text = part.get("text")
            if text:
                parts.append(text)
    text = "".join(parts)
    return text.strip() if strip else text


def _gemini_stop_reason(data):
    feedback = data.get("promptFeedback") or {}
    if feedback.get("blockReason"):
        return f"blocked: {feedback['blockReason']}"
    for candidate in data.get("candidates") or []:
        reason = candidate.get("finishReason")
        if reason and reason not in ("STOP", "MAX_TOKENS"):
            return str(reason)
    return None


def _gemini_generate(system_text, contents, max_tokens, model, json_mode=False, tier=None):
    key = _api_key()
    url = _gemini_endpoint(model, stream=False)
    payload = _gemini_payload(system_text, contents, max_tokens, model, json_mode, tier)
    with _post(url, payload, key) as response:
        raw = response.read().decode("utf-8")
    data = json.loads(raw)
    reason = _gemini_stop_reason(data)
    if reason:
        print(f"[MemorAid] Gemini returned no usable text ({reason}).")
    return _gemini_text(data) or None


def _gemini_stream(system_text, contents, max_tokens, model, tier=None):
    key = _api_key()
    url = _gemini_endpoint(model, stream=True)
    payload = _gemini_payload(system_text, contents, max_tokens, model, tier=tier)
    with _post(url, payload, key) as response:
        for raw_line in response:
            line = raw_line.decode("utf-8", "replace").strip()
            if not line or line.startswith(":"):
                continue
            if line.startswith("data:"):
                line = line[5:].strip()
            if not line or line == "[DONE]":
                continue
            try:
                data = json.loads(line)
            except ValueError:
                continue
            text = _gemini_text(data, strip=False)
            if text:
                yield text


def _generate_text(system_text, contents, max_tokens, model, json_mode=False, tier=None):
    """Dispatch a one-shot generation to the configured provider."""
    if _provider() == "gemini":
        return _gemini_generate(system_text, contents, max_tokens, model, json_mode, tier)
    print(f"[MemorAid] Unsupported AI_PROVIDER '{_provider()}', using fallback.")
    return None


def _stream_text(system_text, contents, max_tokens, model, tier=None):
    """Dispatch a streamed generation to the configured provider."""
    if _provider() == "gemini":
        yield from _gemini_stream(system_text, contents, max_tokens, model, tier)
        return
    print(f"[MemorAid] Unsupported AI_PROVIDER '{_provider()}', using fallback.")


# ──────────────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────────────
def call_llm(system_prompt, user_prompt=None, max_tokens=500, model=None,
             messages=None, cache_system=False, tier=None, system_extra=None,
             mock_reply=False, json_mode=False):
    """Return the model's text response, or None on any failure/missing key.

    ``system_prompt`` is the stable part (persona + durable facts) and
    ``system_extra`` the volatile part (memories retrieved for this message).
    Both are sent as Gemini's ``systemInstruction``; ``cache_system`` is kept
    for signature compatibility (Gemini caches stable prefixes implicitly).

    ``mock_reply`` opts this call into the offline stand-in used by the chat
    companion. Other generators (questions, check-ins) leave it off: their
    own deterministic fallbacks are better than a chat-shaped sentence.

    ``json_mode`` asks Gemini for a JSON MIME type, which makes the
    structured passes (understanding, fact extraction) more reliable.
    """
    full_system = system_prompt if not system_extra else f"{system_prompt}\n\n{system_extra}"
    if not llm_configured():
        if mock_reply and _mock_enabled():
            return _mock_reply(full_system, user_prompt, messages)
        return None
    try:
        model = model or _model_for(tier)
        contents = _to_contents(_build_messages(user_prompt, messages))
        if not contents:
            return None
        return _generate_text(
            full_system,
            contents,
            max_tokens,
            model,
            json_mode=json_mode,
            tier=tier,
        )
    except Exception as exc:  # pragma: no cover - network path
        print(f"[MemorAid] Gemini API call failed, using fallback: {exc}")
        return None


def stream_llm(system_prompt, messages, max_tokens=600, model=None, tier=None,
               system_extra=None, mock_reply=False):
    """Yield reply text chunk by chunk. Falls back to a single chunk."""
    full_system = system_prompt if not system_extra else f"{system_prompt}\n\n{system_extra}"
    if not llm_configured():
        text = _mock_reply(full_system, None, messages) if (mock_reply and _mock_enabled()) else None
        if not text:
            return
        # Word-by-word (with a small pause) so the frontend streaming path is
        # exercised offline exactly as it is with the real API.
        words = text.split(" ")
        delay = getattr(Config, "MOCK_STREAM_DELAY", 0.02)
        for index, word in enumerate(words):
            if delay:
                time.sleep(delay)
            yield word if index == 0 else " " + word
        return

    try:
        model = model or _model_for(tier)
        contents = _to_contents(messages)
        if not contents:
            return
        yield from _stream_text(full_system, contents, max_tokens, model, tier)
    except Exception as exc:  # pragma: no cover - network path
        print(f"[MemorAid] Gemini streaming failed: {exc}")


def call_llm_json(system_prompt, user_prompt=None, max_tokens=600, model=None,
                  messages=None, tier=None, default=None):
    """Ask the model for JSON and parse it defensively.

    Returns ``default`` (or None) when the key is missing, the call fails or
    the response is not valid JSON.
    """
    text = call_llm(
        system_prompt,
        user_prompt,
        max_tokens=max_tokens,
        model=model,
        messages=messages,
        tier=tier,
        json_mode=True,
    )
    if not text:
        return default
    parsed = parse_json(text, default=default)
    return parsed


def parse_json(text, default=None):
    """Parse JSON from a model response that may be wrapped in prose/code."""
    if not text:
        return default
    cleaned = text.strip()
    fence = re.search(r"```(?:json)?\s*(.+?)```", cleaned, re.S)
    if fence:
        cleaned = fence.group(1).strip()
    try:
        return json.loads(cleaned)
    except (ValueError, TypeError):
        pass
    for opener, closer in (("[", "]"), ("{", "}")):
        start = cleaned.find(opener)
        end = cleaned.rfind(closer)
        if start != -1 and end > start:
            try:
                return json.loads(cleaned[start:end + 1])
            except (ValueError, TypeError):
                continue
    return default


# Backwards-compatible aliases. These names date from the previous provider
# (Claude); new code should use the provider-neutral names above.
call_claude = call_llm
stream_claude = stream_llm
call_claude_json = call_llm_json
