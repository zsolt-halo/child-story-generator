# Local LLM Feasibility Study

**Date:** March 2026
**Hardware:** RTX 5090 (32GB VRAM), 64GB DDR5, 5TB Gen5 NVMe

## Executive Summary

Running StarlightScribe entirely on local hardware is **feasible** with the RTX 5090. The project requires two separate AI capabilities — text generation and image generation — which currently run through Gemini's unified API. Locally, these become two distinct systems that must time-share the GPU due to VRAM constraints. Quality is close to Gemini for both text and images, with Hungarian translation being the highest-risk area to validate.

**Bottom line:** ~$0/book marginal cost, ~15-25 min per book (comparable to Gemini), with some quality trade-offs.

---

## Hardware Budget

| Resource | Available | Implication |
|---|---|---|
| RTX 5090 VRAM | 32GB | Fits ~35B models at Q8, or ~70B at Q4 |
| System RAM | 64GB DDR5 | Sufficient for model loading + PDF rendering |
| Storage | 5TB Gen5 NVMe | ~10GB/s reads, plenty of space for multiple models |

---

## Project AI Requirements

StarlightScribe uses AI for 7 distinct tasks across text and image generation:

### Text Generation (currently Gemini 2.5 Pro)

| Task | Input | Output | Structured? | Tokens |
|---|---|---|---|---|
| **Story writing** | Parent notes (50-150 words) + narrator persona + character sheet | 800-1500 word prose | No | ~2,500 |
| **Keyframe extraction** | Full prose + page count | 16 keyframes with visual descriptions (JSON) | Yes — `Story` Pydantic schema | ~6,400 |
| **Cast extraction** | All keyframes | 2-5 secondary characters with visual sheets (JSON) | Yes — `CastList` schema | ~5,000 |
| **Cast rewrite** | Cast sheet + all visual descriptions | Rewritten visual descriptions with canonical cast info | No (delimiter-based) | ~8,300 |
| **Translation** | Full story structure | Complete translation (delimiter-based) | No | ~2,800 |
| **Premise generation** | Character + narrator | 30-80 words synthetic parent notes | No | ~500 |
| **Character polish** | Rough description | Full character sheet (JSON) | Yes — `Character` schema | ~1,500 |

**Key requirements:** Reliable structured JSON output, strong creative writing, Hungarian translation, 8 narrator persona voices.

### Image Generation (currently Gemini 2.5 Flash Image)

| Task | Count per Book | Resolution | Special Needs |
|---|---|---|---|
| **Character reference sheet** | 1 | 2400×2400 | Multi-pose turnaround on white background |
| **Cast reference sheets** | 1-5 | 2400×2400 | Same format, one per named secondary character |
| **Cover variations** | 1-4 | 2400×2400 | Title text integrated into composition |
| **Page illustrations** | 16 | 2400×2400 | Reference images as input for consistency |
| **Decorative backdrops** | 4 | 2400×2400 | Borders/ornaments, text-free |

**Key requirements:** Multi-reference image input (character consistency), text rendering in covers, 4 art style presets (digital, watercolor, ghibli, papercut).

### Multimodal Analysis (optional)

| Task | Input | Output |
|---|---|---|
| **Sanity checking** | Illustration PNG + visual description text | JSON with issues + severity |

---

## Recommended Local Models

### Text: Qwen3.5-35B-A3B (via Ollama)

| Spec | Value |
|---|---|
| Architecture | MoE — 35B total, 3B active per token |
| VRAM (Q8) | ~22GB |
| Speed on RTX 5090 | ~194 tok/s |
| Creative writing | 85%+ human preference rating |
| Structured JSON | Reliable via Ollama `format` parameter |
| License | Apache 2.0 |
| Hungarian | Good multilingual support — needs validation |

**Why this model:** MoE architecture gives frontier-class quality at small-model speeds. Only 3B params active per token means fast inference while maintaining the writing quality of much larger models. Fits comfortably in 32GB with room for KV cache.

**Alternatives considered:**

| Model | Params | VRAM (Q4) | Verdict |
|---|---|---|---|
| Qwen3-32B (dense) | 32B | ~19.8GB | Good fallback if MoE has structured output issues |
| Qwen3.5-27B (dense) | 27B | ~17GB | Better at code, slightly weaker at creative writing |
| Gemma 3 27B | 27B | ~14.1GB (QAT INT4) | Has vision (useful for sanity checks), weaker creative |
| DeepSeek R1-Distill-32B | 32B | ~18GB | Strong reasoning, less creative |
| Mistral Small 3.1 24B | 24B | ~14GB | Fast, but less proven for structured output |
| GPT-OSS-20B | 20B | ~12GB | Optimized for consumer GPUs, needs quality testing |

**Models that DON'T fit:**

| Model | Why Not |
|---|---|
| Llama 4 Scout (109B MoE) | ~55GB Q4 — too large |
| Llama 4 Maverick (128 experts) | ~243GB Q4 — way too large |
| DeepSeek V3/R1 full (671B) | ~386GB Q4 — absurd |
| Mistral Large 2 (123B) | ~58GB Q4 — needs 4× 24GB GPUs |
| Qwen3.5-122B-A10B (MoE) | ~70GB total — needs 48GB+ |

### Images: Flux 2 dev (via ComfyUI)

| Spec | Value |
|---|---|
| Parameters | 32B |
| VRAM (FP8) | ~24GB |
| Native resolution | Up to 2048×2048 (4MP) |
| Multi-reference | Up to 10 reference images |
| Text rendering | Best-in-class among open models |
| License | Open weights (non-commercial dev) |

**Why this model:** Best open image model available. Multi-reference support maps directly to our reference sheet workflow. Text rendering capability (critical for book covers) is the best among open models, though still below Gemini's native quality.

**Alternatives / companions:**

| Model | VRAM | Best For |
|---|---|---|
| Flux 2 klein (4B/9B) | ~13-16GB | Faster generation, lower quality |
| Flux 1 Kontext dev | ~20GB (FP8) | Identity preservation from reference sheets |
| SDXL | 8-12GB | Huge ecosystem, lower quality |
| SD 3.5 Large | 12GB+ | Good quality, less proven for multi-ref |

### Upscaling: Real-ESRGAN x4plus_anime

- VRAM: ~2-4GB (runs after image model unloads)
- Purpose: Upscale 1024-2048px generations to 2400×2400
- The `anime_6B` variant is specifically optimized for illustrated art with clean lines — perfect for children's book styles
- Python library, runs in-process

### Vision (optional): Gemma 3 27B

- ~14GB VRAM at QAT INT4
- Multimodal: accepts image + text input
- Could replace Gemini for sanity checking
- Would need to time-share GPU with other models

---

## Architecture

### Current (Gemini Cloud)

```
FastAPI Server
  └── google-genai SDK ──→ Gemini API (text + images, one API)
```

### Proposed (Local)

```
FastAPI Server
  │
  ├── Text ──────→ Ollama (localhost:11434)
  │                 OpenAI-compatible API
  │                 Qwen3.5-35B-A3B Q8
  │
  ├── Images ────→ ComfyUI (localhost:8188)
  │                 WebSocket + REST API
  │                 Flux 2 dev FP8
  │                 Saved workflow JSONs for each task
  │
  ├── Upscale ──→ Real-ESRGAN (in-process Python library)
  │
  └── PDF ──────→ WeasyPrint (unchanged, CPU only)
```

### VRAM Time-Sharing (Critical Constraint)

Text and image models **cannot** run simultaneously in 32GB. Pipeline must serialize with explicit model swapping:

```
Phase 1: Ollama loads Qwen3.5 (~22GB VRAM)
  → Premise (if auto) → Story → Keyframes → Cast → Cast Rewrite → Translation
  → Ollama unloads model (API: ollama stop)

Phase 2: ComfyUI loads Flux 2 (~24GB VRAM)
  → Reference sheets → Cover variations → 16 page illustrations → Backdrops
  → ComfyUI unloads model

Phase 3: Real-ESRGAN (~2-4GB VRAM)
  → Upscale all generated images to 2400×2400

Phase 4: WeasyPrint (CPU only)
  → PDF rendering (unchanged)
```

This maps naturally to the existing pipeline phases. The main new concern is orchestrating model load/unload between phases.

---

## Serving Infrastructure

### Text: Ollama

- Drop-in OpenAI-compatible API at `localhost:11434/v1`
- Structured JSON output via `format` parameter with Pydantic JSON schema
- Automatic model management and GGUF quantization
- VRAM management (auto-loads/unloads models)
- Simple: `ollama pull qwen3.5:35b-a3b-q8_0` and it works

### Images: ComfyUI

- Best option for programmatic/pipeline image generation
- WebSocket + REST API — submit workflow JSON, monitor progress, retrieve results
- Pre-built Flux 2 dev workflows available
- Multi-reference image workflows (critical for character consistency)
- Workflows exportable as JSON and replayable programmatically

### Why Not Other Options

| Tool | Verdict |
|---|---|
| llama.cpp/llama-server | More control, harder setup — Ollama wraps it |
| vLLM | Overkill for single-user local inference |
| LM Studio | GUI-focused, less suitable for API automation |
| A1111/Forge | Smaller ecosystem for Flux 2, less programmable than ComfyUI |
| InvokeAI | Not designed for external API usage |

---

## Performance Estimates

| Phase | Local (RTX 5090) | Gemini API |
|---|---|---|
| Story + Keyframes + Cast + Translation | ~30-40 sec | ~60-90 sec |
| Model swap (text → image) | ~10-20 sec | N/A |
| Reference sheets (2-5 images) | ~2-4 min | ~2-3 min |
| 16 page illustrations | ~8-15 min | ~10-15 min (with 5s rate limit pauses) |
| Cover variations (1-4) | ~1-4 min | ~1-3 min |
| Backdrops (4 images) | ~2-4 min | ~2-3 min |
| Upscaling (20+ images) | ~2-3 min | N/A (Pillow LANCZOS) |
| PDF rendering | ~30-60 sec | ~30-60 sec |
| **Total per book** | **~15-25 min** | **~15-25 min** |

Performance is roughly comparable. Local is faster for text (no network latency, no rate limits) but slower for images (Gemini's inference cluster is faster than a single GPU). The model swap overhead adds ~10-20 seconds.

---

## Cost Comparison

| | Gemini (Pro text) | Gemini (Flash text) | Local |
|---|---|---|---|
| Text generation | ~$0.30/book | ~$0.075/book | $0 |
| Image generation | ~$0.80/book | ~$0.80/book | $0 |
| **Total per book** | **~$1.10** | **~$0.88** | **$0** |
| Monthly (1 book/day) | ~$33 | ~$26 | $0 |
| Yearly (1 book/day) | ~$401 | ~$321 | $0 |

**Break-even vs Gemini Pro:** ~1,800 books (hardware already owned, so break-even is immediate for marginal cost).

**Electricity cost:** RTX 5090 TDP is 575W. At 20 min/book and ~$0.15/kWh, that's ~$0.03/book — negligible.

---

## Risk Assessment

### High Confidence (should work well)

- **Story writing quality** — Qwen3.5-35B-A3B scores very high on creative writing benchmarks
- **Structured JSON output** — Ollama + Qwen has proven reliable JSON schema support
- **Page illustrations** — Flux 2 dev produces excellent illustrations with reference guidance
- **Character consistency** — Flux 2 multi-reference is designed for exactly this use case
- **Performance** — RTX 5090 benchmarks confirm the speed estimates above

### Medium Risk (needs validation)

- **Hungarian translation quality** — Qwen's multilingual is good but not as battle-tested as Gemini for Hungarian specifically. Must test before committing.
- **Cover text rendering** — Flux 2 handles text well for an open model but Gemini is better. Fallback: composite title text in WeasyPrint/HTML overlay.
- **Art style consistency** — The 4 style presets (digital, watercolor, ghibli, papercut) need to be validated with Flux 2. May need style-specific LoRAs.
- **Narrator persona adherence** — Qwen should handle this given the detailed system prompts, but the 8 distinct voices need testing.

### Low Risk (minor concerns)

- **VRAM management** — Model swapping adds 10-20s overhead. Non-blocking.
- **Sanity checking** — Optional feature; can keep using Gemini for this or use Gemma 3 27B.
- **Backdrop generation** — Simple decorative images, any model handles these well.

---

## Code Changes Required

### New Abstraction Layer

Create a backend-agnostic interface so both Gemini and local can coexist:

1. **`src/brain/client.py`** — Add Ollama backend alongside Gemini. Route based on `BookConfig.backend` setting.
   - Structured output: `format=schema.model_json_schema()` for Ollama vs `response_schema=Schema` for Gemini
   - Text generation: Ollama Python client or OpenAI SDK → `localhost:11434/v1`

2. **`src/artist/generator.py`** — Add ComfyUI backend alongside Gemini.
   - Load saved workflow JSON templates for each image type (reference sheet, illustration, backdrop)
   - Inject prompt + reference images into workflow
   - Submit via WebSocket, poll for completion, retrieve result
   - Chain Real-ESRGAN upscaling afterward

3. **`src/models.py`** — Add configuration:
   ```python
   backend: str = "gemini"  # "gemini" | "local"
   local_text_model: str = "qwen3.5:35b-a3b-q8_0"
   local_image_model: str = "flux2-dev"
   ollama_url: str = "http://localhost:11434"
   comfyui_url: str = "http://localhost:8188"
   ```

4. **New: VRAM orchestrator** — Ensure text model unloads before image model loads.
   - `ollama stop` before ComfyUI workflow submission
   - Health checks to confirm VRAM is free

5. **ComfyUI workflow JSONs** — Create and save workflow templates for:
   - Character reference sheet generation
   - Page illustration with multi-reference input
   - Cover generation with title text
   - Backdrop generation

### Files to Modify

| File | Change |
|---|---|
| `src/brain/client.py` | Add Ollama backend for `generate_text`, `generate_structured` |
| `src/artist/generator.py` | Add ComfyUI backend for `generate_single_image` |
| `src/models.py` | Add `backend`, `local_text_model`, `local_image_model` config fields |
| `server/schemas.py` | Expose backend choice in API schemas |
| `web/src/pages/NewStory.tsx` | Add backend toggle (Cloud/Local) in Settings |
| New: `src/local/ollama_client.py` | Ollama text generation wrapper |
| New: `src/local/comfyui_client.py` | ComfyUI image generation wrapper |
| New: `src/local/vram.py` | VRAM orchestration (model load/unload) |
| New: `comfyui_workflows/*.json` | Saved workflow templates |

---

## Implementation Plan

### Phase 1: Text Only (lowest effort, highest learning)

1. Install Ollama, pull Qwen3.5-35B-A3B
2. Add Ollama backend to `src/brain/client.py`
3. Test all 7 text tasks — especially structured JSON and Hungarian translation
4. Keep Gemini for images

**Effort:** ~2-3 days
**Risk:** Low — text is the easier half

### Phase 2: Image Generation (higher effort)

1. Install ComfyUI, download Flux 2 dev
2. Build workflow templates for each image type
3. Add ComfyUI backend to `src/artist/generator.py`
4. Add VRAM orchestration
5. Validate character consistency across 16 pages

**Effort:** ~5-7 days
**Risk:** Medium — ComfyUI workflow programming is fiddly

### Phase 3: Full Integration

1. Add backend toggle to UI (Cloud / Local)
2. Wire through presets
3. End-to-end testing
4. Performance tuning

**Effort:** ~2-3 days

---

## What You Lose vs Gemini

| Concern | Severity | Mitigation |
|---|---|---|
| Gemini 2.5 Pro prose quality | Low | Qwen3.5 is very close for creative writing |
| Hungarian translation quality | Medium | Test first; fallback to Gemini for translation only |
| Native text-in-image quality | Medium | Flux 2 is decent; fallback to WeasyPrint title overlay |
| Single unified API | Low | Abstraction layer hides complexity |
| Multimodal sanity checking | Low | Gemma 3 27B has vision, or keep Gemini for this |
| Concurrent text+image | Medium | Sequential is fine — pipeline is already sequential |

## What You Gain

| Benefit | Impact |
|---|---|
| $0/book marginal cost | High — unlimited generation |
| No rate limits | High — no 5-second inter-image pauses |
| Offline capability | Medium — generate without internet |
| Full privacy | Medium — stories never leave the machine |
| No API deprecation risk | Medium — models are local files you control |
| Fine-tuning potential | Low (for now) — could train LoRAs for specific art styles |

---

## Appendix: Paid LLM API Alternatives

**Researched March 2026.** All prices are per-unit (per 1M tokens for text, per image for images).

### Current Baseline (Google Gemini)

| Setup | Text Cost | Image Cost (20 imgs) | Total/Book |
|---|---|---|---|
| Gemini 2.5 Pro + Flash Image | $0.30 | $0.78 | $1.08 |
| Gemini 2.5 Flash + Flash Image | $0.075 | $0.78 | $0.86 |
| Gemini 2.5 Flash + Imagen 4 Fast | $0.075 | $0.40 | $0.48 |

### Best Alternative Combinations

| Combo | Text | Images (20) | Total | vs Pro Baseline |
|---|---|---|---|---|
| **GPT-4.1 mini + Imagen 4 Fast** | $0.055 | $0.40 | **$0.46** | -58% |
| **DeepSeek V3.2 + Imagen 4 Fast** | $0.015 | $0.40 | **$0.42** | -62% |
| **GPT-4.1 mini + GPT Image 1.5 Med** | $0.055 | $0.68 | **$0.74** | -32% |
| **Grok 4.1 Fast + Imagen 4 Fast** | $0.02 | $0.40 | **$0.42** | -62% |
| **GPT-4.1 + GPT Image 1.5 Med** | $0.27 | $0.68 | **$0.95** | -12% |
| **DeepSeek V3.2 + fal.ai FLUX 2 Turbo** | $0.015 | $0.16 | **$0.18** | -83% |

### Text Model Pricing

#### Budget Tier

| Provider | Model | Input/1M | Output/1M | ~Cost/Book | Notes |
|---|---|---|---|---|---|
| DeepSeek | V3.2 | $0.28 | $0.42 | $0.015 | 20x cheaper than Pro. Off-peak 50-75% discount. |
| OpenAI | GPT-4.1 Nano | $0.10 | $0.40 | $0.014 | Ultra-cheap, may lack creative depth |
| xAI | Grok 4.1 Fast | $0.20 | $0.50 | $0.02 | 2M context window |
| OpenAI | GPT-4.1 mini | $0.40 | $1.60 | $0.055 | Excellent structured JSON, proven creative |
| Mistral | Large 3 | $0.50 | $1.50 | $0.05 | Good multilingual |
| Alibaba | Qwen3-32B | $0.15 | $0.75 | $0.025 | Direct from Alibaba, strong multilingual |

#### Mid Tier

| Provider | Model | Input/1M | Output/1M | ~Cost/Book | Notes |
|---|---|---|---|---|---|
| Google | Gemini 3 Flash | $0.50 | $3.00 | $0.10 | Beats 2.5 Pro quality, 3x faster |
| Anthropic | Claude Haiku 4.5 | $1.00 | $5.00 | $0.16 | Fast, good quality, 50% batch discount |
| Mistral | Medium 3 | $0.40 | $2.00 | $0.065 | Solid mid-tier |
| Alibaba | Qwen3-Max | $1.20 | $6.00 | $0.20 | Strong multilingual |

#### Premium Tier

| Provider | Model | Input/1M | Output/1M | ~Cost/Book | Notes |
|---|---|---|---|---|---|
| OpenAI | GPT-4.1 | $2.00 | $8.00 | $0.27 | Strong creative, great JSON |
| Anthropic | Claude Sonnet 4.6 | $3.00 | $15.00 | $0.49 | Best creative writing quality |
| xAI | Grok 4 | $3.00 | $15.00 | $0.49 | 2M context window |
| Google | Gemini 3.1 Pro | $2.00 | $12.00 | $0.38 | Latest Google flagship |

#### Inference Providers (Open-Source Models)

| Provider | Model | Input/1M | Output/1M | ~Cost/Book | Notes |
|---|---|---|---|---|---|
| Together AI | Llama 4 Maverick | $0.27 | $0.85 | $0.03 | Good quality open-source |
| Groq | Llama 3.3 70B | $0.59 | $0.79 | $0.025 | Extremely fast inference |
| Fireworks AI | Various 27B+ | $0.20-$0.90 | $0.20-$0.90 | $0.01-$0.03 | 50% batch discount |
| Cerebras | Llama 3.1 70B | $0.60 | $0.60 | $0.02 | 3000+ tok/s, fastest inference |
| DeepInfra | Qwen 2.5 72B | $0.23 | ~$0.40 | $0.01 | Cheapest Qwen host |

### Image Model Pricing

| Provider | Model | $/Image | 20 imgs | Strengths |
|---|---|---|---|---|
| Google | **Imagen 4 Fast** | **$0.02** | **$0.40** | Same SDK as Gemini, cheapest quality option |
| Google | Imagen 4 Standard | $0.04 | $0.80 | Higher quality than Fast |
| fal.ai | FLUX 2 Dev Turbo | $0.008 | $0.16 | Cheapest overall, quality tradeoff |
| BFL | FLUX Kontext Dev | $0.015 | $0.30 | Built-in character consistency |
| OpenAI | GPT Image 1.5 Medium | $0.034 | $0.68 | Top benchmark quality, best text rendering |
| BFL | FLUX 2 Pro | $0.03-$0.055 | $0.60-$1.10 | Strong artistic quality |
| BFL | **FLUX Kontext Pro** | $0.04 | $0.80 | Best character consistency — no ref sheets needed |
| OpenAI | GPT Image 1 Mini (Med) | $0.011 | $0.22 | Budget OpenAI option |
| Recraft | V4 | $0.04 | $0.80 | Excellent illustration style |
| Stability | SD 3.5 Core | $0.03 | $0.60 | Budget option, lower quality |

### Notable: FLUX Kontext Pro

FLUX Kontext Pro ($0.04/image) preserves character identity across scenes without fine-tuning or reference sheets. It creates an identity "fingerprint" from a single image. This could simplify the pipeline by eliminating the reference sheet generation + multi-image input workflow entirely. Worth evaluating as a future migration path.

### Volume Discounts & Free Tiers

| Provider | Discount |
|---|---|
| DeepSeek | 50-75% off during off-peak hours (16:30-00:30 GMT) |
| Anthropic | 50% batch discount (24h window), prompt caching up to 90% savings |
| OpenAI | Cached inputs 50-75% cheaper |
| Fireworks/Groq | 50% batch processing discount |
| xAI | $25 free credits on signup + $150/month via data sharing program |
| Google Gemini | Generous free tier (rate-limited) |
| OpenRouter | Dozens of free models (20 req/min, 200 req/day) |

### Recommendation

**Immediate (done):** Switched image model to Imagen 4 Fast ($0.02/image). Saves ~$0.38/book with zero quality risk — same Google ecosystem.

**Next step:** Test GPT-4.1 mini for text generation. If structured JSON and Hungarian translation quality hold up, the combo of GPT-4.1 mini + Imagen 4 Fast delivers $0.46/book (-58% from baseline).

**If cost is paramount:** DeepSeek V3.2 + Imagen 4 Fast at $0.42/book (-62%). Needs validation for Hungarian translation and structured output reliability.
