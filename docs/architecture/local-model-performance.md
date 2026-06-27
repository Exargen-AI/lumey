# Local-model performance — making agents not struggle

Lumey runs on **local models only**. On consumer hardware that means two failure
modes to engineer around: **slow inference** and **cold-load stalls**. The levers
below (biggest-bang first), with what's automated vs operator config.

## 1. Keep the model warm (the #1 win) — operator config

A 7B model takes ~30–60s to *load* on the first request after the server (or its
keep-alive window) goes cold — exactly when the first run is dispatched. Run
Ollama with a long keep-alive so it stays resident:

```bash
OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0 OLLAMA_KEEP_ALIVE=30m ollama serve
```

- **`OLLAMA_KEEP_ALIVE=30m`** — the model stays loaded between runs (no cold reload).
- **`OLLAMA_FLASH_ATTENTION=1`** + **`OLLAMA_KV_CACHE_TYPE=q8_0`** — faster
  attention + a smaller KV cache. Measured **~+30%** tok/s on `qwen2.5-coder:7b`
  (≈8 → ≈10.5 tok/s warm) and lower memory.

## 2. Warm at startup (automated) — `warmLocalModel()`

The backend fires a tiny throwaway completion at boot (`runtime/model/warmup.ts`,
wired into `bootstrap()`), paying the load cost up front so the **first real run
is instant**. Fire-and-forget, non-blocking; no-op without a local model.

## 3. Pick the right model

| Model | Tool-call reliability | Speed | Use |
|---|---|---|---|
| `qwen2.5-coder:7b` | ✅ reliable structured tool calls | moderate | the coding loop |
| `llama3.2:3b` | ⚠️ narrates tool use under complex prompts | fast | quick/triage |
| `nomic-embed-text` | n/a (embeddings) | very fast | semantic memory (RAG) |

The 7B coder is the sweet spot for agentic tool use; smaller models trade
reliability for speed (we saw 3B *narrate* tool use instead of calling tools).
The runtime is model-agnostic, so swapping is a config change.

## 4. Spend fewer tokens / turns (built in)

- **Prefix-stable prompts** (`ContextEngine`, M2.6) → the model/KV cache reuses
  the system prefix across turns instead of re-encoding it.
- **Context editing + compaction** → the window never bloats.
- **Semantic memory** (M2.19) recalls only the *relevant* learnings, not all.
- **Budgets** (step + token ceilings) cap a runaway loop.

## Tuning knobs (env)

| Var | Effect |
|---|---|
| `LUMEY_LOCAL_MODEL` | the model the runtime uses (e.g. `qwen2.5-coder:7b`) |
| `LUMEY_LOCAL_MODEL_URL` | OpenAI-compatible base (default Ollama `:11434/v1`) |
| `LUMEY_MODEL_TIMEOUT_MS` | per-request deadline (local default **300s**) |
| `LUMEY_EMBED_MODEL` | embedding model for semantic recall (e.g. `nomic-embed-text`) |
| `OLLAMA_KEEP_ALIVE` / `OLLAMA_FLASH_ATTENTION` / `OLLAMA_KV_CACHE_TYPE` | Ollama server tuning (above) |
