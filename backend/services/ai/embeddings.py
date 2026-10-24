"""
Embeddings for retrieval — the "reach the right memory" layer.

Why this exists
---------------
The companion used to receive only the six most recent memories, so a
question like "how did my visit with Margaret go?" could not be answered
from a memory logged three months ago: the model simply had never seen it.
Retrieval fixes that by putting the *relevant* memories into the prompt.

Design
------
The provider is pluggable so the app works before any API key exists:

    local   (default) — offline hashing embedder. Character 3-grams + word
                        tokens are hashed into a fixed-size vector with
                        sub-linear term frequency weighting and L2
                        normalisation. Deterministic, no network, no key.
    voyage            — Voyage AI embeddings (strongest semantic quality).
    openai            — OpenAI embeddings.

`embed_text()` always returns the same shape regardless of provider, so the
retrieval code never changes when the provider does. Vectors are persisted in
the ``embeddingrecords`` table (see models.EmbeddingRecord) so a user's index
is built once and reused.

Note on hashing: `hashlib` is used rather than Python's built-in `hash()`
because the latter is salted per process, which would make stored vectors
meaningless across restarts.
"""
import hashlib
import math
import re
from collections import Counter

from config import Config

WORD_RE = re.compile(r"[a-z0-9']+")

# Whole words are weighted far above character n-grams. Without this the
# offline embedder gives every English sentence a similar vector (shared
# fragments like "ing" and " the"), and retrieval stops discriminating.
WORD_WEIGHT = 2.0
GRAM_WEIGHT = 0.3

STOPWORDS = {
    "a", "about", "after", "all", "am", "an", "and", "any", "are", "as", "at",
    "be", "because", "been", "but", "by", "can", "could", "did", "do", "does",
    "for", "from", "had", "has", "have", "he", "her", "hers", "him", "his",
    "how", "i", "if", "in", "into", "is", "it", "its", "just", "me", "more",
    "most", "my", "no", "not", "of", "on", "or", "our", "out", "over", "she",
    "so", "some", "such", "than", "that", "the", "their", "them", "then",
    "there", "these", "they", "this", "to", "too", "up", "very", "was", "we",
    "were", "what", "when", "where", "which", "while", "who", "why", "will",
    "with", "would", "you", "your",
}


def _tokens(text):
    """Word tokens (stopwords removed) plus character 3-grams.

    The 3-grams give the offline embedder some tolerance to spelling and
    morphology ("granddaughter" vs "granddaughters"), which pure word hashing
    would miss entirely. They are weighted down because they are far less
    discriminative than whole words — otherwise every pair of English
    sentences ends up looking similar.
    """
    text = (text or "").lower()
    words = [w for w in WORD_RE.findall(text) if w not in STOPWORDS and len(w) > 1]
    grams = ["w:" + w for w in words]
    padded = " " + re.sub(r"\s+", " ", text).strip() + " "
    for i in range(max(0, len(padded) - 2)):
        gram = padded[i:i + 3]
        if gram.strip():
            grams.append("c:" + gram)
    return grams


def _token_weight(token):
    """Whole words carry the meaning; character n-grams only add tolerance."""
    return WORD_WEIGHT if token.startswith("w:") else GRAM_WEIGHT


def _bucket(token, dim):
    digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
    return int.from_bytes(digest, "big") % dim


class LocalHashEmbedder:
    """Offline hashing embedder (hashing trick + sub-linear TF + L2 norm)."""

    name = "local"

    def __init__(self, dim=None):
        self.dim = dim or getattr(Config, "EMBEDDING_DIM", 384)

    def embed(self, text):
        counts = Counter(_tokens(text))
        vector = [0.0] * self.dim
        for token, tf in counts.items():
            weight = (1.0 + math.log(tf)) * _token_weight(token)
            vector[_bucket(token, self.dim)] += weight
        norm = math.sqrt(sum(v * v for v in vector))
        if norm == 0:
            return vector
        return [v / norm for v in vector]

    def embed_many(self, texts):
        return [self.embed(t) for t in texts]


class VoyageEmbedder:
    """Voyage AI embeddings (requires EMBEDDING_API_KEY)."""

    name = "voyage"

    def __init__(self, dim=None, api_key=None, model=None):
        self.dim = dim or getattr(Config, "EMBEDDING_DIM", 384)
        self.api_key = api_key or getattr(Config, "EMBEDDING_API_KEY", "")
        self.model = model or getattr(Config, "EMBEDDING_MODEL", "voyage-3")
        self._client = None

    def _ensure(self):
        if self._client is None:
            import voyageai

            self._client = voyageai.Client(api_key=self.api_key)
        return self._client

    def embed(self, text):
        return self.embed_many([text])[0]

    def embed_many(self, texts):
        result = self._ensure().embed(texts, model=self.model)
        return [list(v) for v in result.embeddings]


class OpenAIEmbedder:
    """OpenAI embeddings (requires EMBEDDING_API_KEY)."""

    name = "openai"

    def __init__(self, dim=None, api_key=None, model=None):
        self.dim = dim or getattr(Config, "EMBEDDING_DIM", 384)
        self.api_key = api_key or getattr(Config, "EMBEDDING_API_KEY", "")
        self.model = model or getattr(Config, "EMBEDDING_MODEL", "text-embedding-3-small")
        self._client = None

    def _ensure(self):
        if self._client is None:
            from openai import OpenAI

            self._client = OpenAI(api_key=self.api_key)
        return self._client

    def embed(self, text):
        return self.embed_many([text])[0]

    def embed_many(self, texts):
        result = self._ensure().embeddings.create(model=self.model, input=texts)
        return [list(v) for v in result.data]


_EMBEDDER = None


def get_embedder():
    """Return the configured embedder (cached)."""
    global _EMBEDDER
    if _EMBEDDER is not None:
        return _EMBEDDER

    provider = (getattr(Config, "EMBEDDING_PROVIDER", "local") or "local").lower()
    key = getattr(Config, "EMBEDDING_API_KEY", "")
    if provider == "voyage" and key:
        _EMBEDDER = VoyageEmbedder()
    elif provider == "openai" and key:
        _EMBEDDER = OpenAIEmbedder()
    else:
        # Any failure or missing key falls back to the offline embedder so
        # retrieval keeps working rather than silently degrading to "no
        # retrieval at all".
        _EMBEDDER = LocalHashEmbedder()
    return _EMBEDDER


def embed_text(text):
    """Embed one string. Never raises — an empty vector is returned on error."""
    try:
        return get_embedder().embed(text or "")
    except Exception as exc:  # pragma: no cover - network path
        print(f"[MemorAid] Embedding failed, using empty vector: {exc}")
        return [0.0] * getattr(Config, "EMBEDDING_DIM", 384)


def embed_texts(texts):
    try:
        return get_embedder().embed_many(list(texts))
    except Exception as exc:  # pragma: no cover - network path
        print(f"[MemorAid] Batch embedding failed: {exc}")
        return [[0.0] * getattr(Config, "EMBEDDING_DIM", 384) for _ in texts]


def cosine(a, b):
    """Cosine similarity of two vectors (0.0 when either is empty)."""
    if not a or not b:
        return 0.0
    size = min(len(a), len(b))
    dot = 0.0
    na = 0.0
    nb = 0.0
    for i in range(size):
        x = a[i]
        y = b[i]
        dot += x * y
        na += x * x
        nb += y * y
    if na == 0 or nb == 0:
        return 0.0
    return dot / (math.sqrt(na) * math.sqrt(nb))


def keyword_overlap(query, text):
    """Jaccard overlap of content words — catches exact names/dates."""
    q = {w for w in WORD_RE.findall((query or "").lower()) if w not in STOPWORDS and len(w) > 1}
    t = {w for w in WORD_RE.findall((text or "").lower()) if w not in STOPWORDS and len(w) > 1}
    if not q or not t:
        return 0.0
    return len(q & t) / len(q | t)
