# User Stories — Story Branching & Cast Review

## 1. New story creation with cast review gate

**As a** parent creating a new story,
**I want** to review the extracted character descriptions before illustration begins,
**so that** I can fix any mistakes (wrong species, missing details) without wasting Gemini image calls.

### Flow

1. Open the web UI, click **New Story**.
2. Walk through the wizard: notes, character, style & narrator, settings (pages, language).
3. Click **Create Story** — the pipeline page appears.
4. Phases run automatically: *Story Generation* → *Page Keyframes* → *Cast Extraction*.
5. After cast extraction the pipeline **pauses**. The timeline shows an amber "Review needed" badge on the Cast step.
6. A **Cast Review** panel appears on the right with every extracted character (name, role, species, visual description, visual constants, pages they appear on). All fields are editable.
7. Add or remove cast members as needed.
8. Click **Approve & Continue** — the cast is saved and the pipeline resumes: *Translation* (if a language was set) → *Illustrations* (with per-image SSE progress) → *Backdrops* → *PDF Rendering*.
9. On completion, redirect to the **Review** page where every illustration is laid out.

### Why it matters

Previously the pipeline ran straight through. If Gemini extracted "a small brown dog" when the story clearly describes a cat, 16+ image generations would use the wrong description. Now you catch it before a single image is generated.

---

## 2. Branch a story — full re-generation

**As a** parent who already has a completed book,
**I want** to create a variant with a different narrator voice or art style from the same notes,
**so that** I can compare versions (e.g. "whimsical + digital" vs. "bedtime + watercolor") without re-typing anything.

### Flow

1. Open an existing story's **Review** page.
2. Click the **Branch** button in the header (visible when metadata is present).
3. A dialog appears, pre-populated with the story's original config.
4. Change whatever you like — narrator to "bedtime", style to "watercolor", different character, more pages, add a translation language.
5. Select starting point: **Re-generate everything** (new prose, new illustrations from scratch).
6. Click **Create Branch**.
7. A new story folder is created with an auto-generated slug (e.g. `lanas-park-adventure-watercolor-bedtime`). The original notes are carried over from metadata.
8. The pipeline page opens. Because this is a full re-gen, it runs *Story → Keyframes → Cast Extraction* and then **pauses for cast review** (same as flow 1).
9. Review the cast, approve, illustrations generate in the new style, PDF is rendered.
10. Both the original and the branch appear on the **Dashboard**. The branch shows a small "branch of lanas-park-adventure" label.

### Why it matters

Previously you had to copy-paste notes into a new story and re-configure everything. Now it's two clicks from the Review page, and the lineage is tracked so you know which stories are related.

---

## 3. Branch a story — keep text, re-illustrate only

**As a** parent who loves the story text but wants to see it in a different art style,
**I want** to branch with "Keep story, re-illustrate" so the prose and keyframes are preserved,
**so that** I skip the 30+ second story/keyframe generation and go straight to new artwork.

### Flow

1. From the **Review** page of a completed story, click **Branch**.
2. Change the art style (e.g. "ghibli" → "papercut"). Optionally change the language.
3. Select starting point: **Keep story, re-illustrate**.
4. Click **Create Branch**.
5. The backend copies the full story data (title, keyframes, cast) into a new folder. If the language changed, translations are cleared (they'll be re-done).
6. The pipeline page opens and **skips directly to the continuation phases**: *Translation* (if language changed) → *Illustrations* → *Backdrops* → *PDF*. No cast review pause — the cast was already reviewed in the original.
7. New illustrations generate in the chosen style. Same text, fresh art.

### Why it matters

Art style is the most common thing a parent wants to vary. This flow takes ~2 minutes (illustration only) instead of ~4 minutes (full pipeline), and the story text is guaranteed identical for a fair comparison.

---

## 4. Edit cast on an existing story before re-illustration

**As a** parent who notices a character was drawn wrong after illustrations are done,
**I want** to edit the cast descriptions on the Storyboard and then re-generate illustrations,
**so that** the next illustration run uses corrected visual descriptions.

### Flow

1. Open the **Storyboard** page for a story.
2. Click **Edit Cast (N)** in the actions bar (N = number of cast members).
3. The Cast Review panel expands inline above the keyframe grid.
4. Fix the problematic description — e.g. change "orange tabby cat" to "grey British shorthair".
5. Click **Approve & Continue** (saves the cast to the checkpoint).
6. Click **Generate Illustrations** — the next run uses the corrected cast descriptions in every image prompt.

---

## 5. Config persists across per-phase re-runs

**As a** parent who created a story with style=watercolor,
**I want** per-phase re-runs (re-illustrate, re-render PDF) to use the original config,
**so that** I don't accidentally get digital-style illustrations when I re-run from the Storyboard.

### Flow

1. Create a story via the web UI with style "watercolor".
2. Metadata is saved in `story.json`: `{"config": {"style": "watercolor", ...}}`.
3. Days later, open the **Storyboard**, edit a visual description, click **Generate Illustrations**.
4. The backend reads config from metadata (`watercolor`), not from `settings.toml` defaults (`digital`).
5. Illustrations come out in the correct watercolor style.

### Why it matters

This was a latent bug — all per-phase re-runs (`run_illustrate`, `run_backdrops`, `run_translate`, etc.) used `build_config()` with no arguments, which fell back to `settings.toml` defaults. Now they load the story's own config from metadata.

---

## 6. CLI still works, now saves metadata

**As a** developer using the CLI,
**I want** `uv run python main.py generate notes.txt --style watercolor --narrator bedtime` to save metadata,
**so that** the web UI can show config and enable branching for CLI-generated stories too.

### Flow

1. Run `uv run python main.py generate notes.txt -s watercolor -n bedtime -l hungarian`.
2. The first checkpoint write includes metadata: notes text, character, narrator, style, pages, language.
3. Open the web UI dashboard — the story appears.
4. Open Review — the **Branch** button is available because metadata exists.
5. `--resume` still works — metadata is preserved across checkpoint updates.

---

## 7. Backward compatibility with old stories

**As a** user with stories generated before the metadata feature,
**I want** old stories to still load and work correctly,
**so that** nothing breaks when I update the code.

### Flow

1. Old stories have `story.json` with no `"metadata"` key.
2. `load_checkpoint()` is unchanged — returns story + image_paths as before.
3. `load_metadata()` returns `None` for old stories.
4. Per-phase re-runs fall back to `build_config()` defaults (same behavior as before).
5. The **Branch** button does not appear on the Review page (metadata is null).
6. The Dashboard shows no "branch of" badge.
7. If the user re-generates from the CLI with the new code, metadata is saved going forward.

---

## Capability Matrix

| Action | Starting point | Cast review? | Phases run |
|---|---|---|---|
| New story | NewStory wizard | Yes (pause) | Story → Keyframes → Cast → *pause* → Translation → Illustration → Backdrops → PDF |
| Branch (full) | Review page | Yes (pause) | Story → Keyframes → Cast → *pause* → Translation → Illustration → Backdrops → PDF |
| Branch (re-illustrate) | Review page | No (reuses cast) | Translation (if needed) → Illustration → Backdrops → PDF |
| Edit cast + re-illustrate | Storyboard | Manual edit | Illustration → (user triggers backdrops/PDF separately) |
| CLI generate | Terminal | No (runs straight through) | Story → Keyframes → Cast → Translation → Illustration → Backdrops → PDF |
