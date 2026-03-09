import { useState, useCallback } from "react";
import { polishCharacter } from "../api/client";
import type {
  CharacterDetail,
  CharacterCreateRequest,
  CharacterPersonality,
  CharacterVisual,
  CharacterStoryRules,
} from "../api/types";

interface CharacterEditorProps {
  initialData?: CharacterDetail;
  onSave: (data: CharacterCreateRequest) => void;
  onCancel?: () => void;
  mode: "create" | "edit";
}

function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

const emptyPersonality: CharacterPersonality = { traits: [], speech_style: "" };
const emptyVisual: CharacterVisual = { description: "", constants: "", color_palette: [] };
const emptyRules: CharacterStoryRules = { always: "", never: "" };

const inputCls =
  "w-full px-3 py-2.5 bg-cream border border-bark-200 rounded-[var(--radius-btn)] text-sm text-bark-800 placeholder:text-bark-300 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400";
const textareaCls = `${inputCls} resize-none`;
const labelCls = "text-xs font-semibold text-bark-500 uppercase tracking-wide";

export function CharacterEditor({ initialData, onSave, onCancel, mode }: CharacterEditorProps) {
  const [name, setName] = useState(initialData?.name ?? "");
  const [childName, setChildName] = useState(initialData?.child_name ?? "");
  const [slug, setSlug] = useState(initialData?.slug ?? "");
  const [slugManual, setSlugManual] = useState(false);

  const [personality, setPersonality] = useState<CharacterPersonality>(
    initialData?.personality ?? { ...emptyPersonality, traits: [] },
  );
  const [visual, setVisual] = useState<CharacterVisual>(
    initialData?.visual ?? { ...emptyVisual, color_palette: [] },
  );
  const [storyRules, setStoryRules] = useState<CharacterStoryRules>(
    initialData?.story_rules ?? { ...emptyRules },
  );

  // Trait input
  const [traitInput, setTraitInput] = useState("");
  // Color input
  const [colorInput, setColorInput] = useState("#");

  // Polish state
  const [roughDescription, setRoughDescription] = useState("");
  const [polishing, setPolishing] = useState(false);
  const [polishError, setPolishError] = useState<string | null>(null);

  const isFieldsMostlyEmpty =
    personality.traits.length === 0 &&
    !personality.speech_style &&
    !visual.description &&
    !visual.constants &&
    visual.color_palette.length === 0 &&
    !storyRules.always &&
    !storyRules.never;

  const showPolishPanel = mode === "create" || isFieldsMostlyEmpty;

  const handleNameChange = (value: string) => {
    setName(value);
    if (!slugManual) {
      setSlug(toSlug(value));
    }
  };

  const handleSlugChange = (value: string) => {
    setSlugManual(true);
    setSlug(toSlug(value));
  };

  const handlePolish = useCallback(async () => {
    setPolishing(true);
    setPolishError(null);
    try {
      const result = await polishCharacter({
        name,
        child_name: childName,
        rough_description: roughDescription,
      });
      setPersonality({ traits: [...result.personality.traits], speech_style: result.personality.speech_style });
      setVisual({
        description: result.visual.description,
        constants: result.visual.constants,
        color_palette: [...result.visual.color_palette],
      });
      setStoryRules({ always: result.story_rules.always, never: result.story_rules.never });
    } catch (err) {
      setPolishError(err instanceof Error ? err.message : "Failed to polish character");
    } finally {
      setPolishing(false);
    }
  }, [name, childName, roughDescription]);

  const addTrait = () => {
    const trimmed = traitInput.trim();
    if (trimmed && !personality.traits.includes(trimmed)) {
      setPersonality((p) => ({ ...p, traits: [...p.traits, trimmed] }));
      setTraitInput("");
    }
  };

  const removeTrait = (trait: string) => {
    setPersonality((p) => ({ ...p, traits: p.traits.filter((t) => t !== trait) }));
  };

  const addColor = () => {
    const trimmed = colorInput.trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed) && !visual.color_palette.includes(trimmed)) {
      setVisual((v) => ({ ...v, color_palette: [...v.color_palette, trimmed] }));
      setColorInput("#");
    }
  };

  const removeColor = (color: string) => {
    setVisual((v) => ({ ...v, color_palette: v.color_palette.filter((c) => c !== color) }));
  };

  const handleSubmit = () => {
    onSave({
      slug,
      name,
      child_name: childName,
      personality,
      visual,
      story_rules: storyRules,
    });
  };

  const polishDisabled = !name || !childName || roughDescription.length < 10 || polishing;

  return (
    <div className="space-y-6">
      {/* ── AI Polish Panel ── */}
      {showPolishPanel && (
        <div className="bg-amber-50 border border-amber-200 rounded-[var(--radius-card)] p-5">
          <h3 className="text-sm font-bold text-bark-800 mb-1">AI Character Polish</h3>
          <p className="text-xs text-bark-400 mb-3">
            Describe your character idea and let AI fill in the personality, visual details, and story rules.
          </p>
          <textarea
            value={roughDescription}
            onChange={(e) => setRoughDescription(e.target.value)}
            placeholder="Describe your character idea... e.g., A friendly purple dragon who loves baking cookies"
            rows={3}
            className={textareaCls}
          />
          {polishError && (
            <p className="text-xs text-red-600 mt-2">{polishError}</p>
          )}
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={handlePolish}
              disabled={polishDisabled}
              className="px-4 py-2 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-[var(--radius-btn)] transition-colors inline-flex items-center gap-2"
            >
              {polishing && (
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              {polishing ? "Polishing..." : "Polish with AI"}
            </button>
            {polishDisabled && !polishing && (
              <span className="text-xs text-bark-400">
                {!name || !childName
                  ? "Fill in name and child's name first"
                  : "Description must be at least 10 characters"}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Basic Info ── */}
      <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-5 space-y-4">
        <h3 className="text-sm font-bold text-bark-800">Basic Info</h3>

        <label className="block">
          <span className={labelCls}>Character Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="Luna the Llama"
            className={`mt-1.5 ${inputCls}`}
          />
        </label>

        <label className="block">
          <span className={labelCls}>Child's Name</span>
          <input
            type="text"
            value={childName}
            onChange={(e) => setChildName(e.target.value)}
            placeholder="Lana"
            className={`mt-1.5 ${inputCls}`}
          />
        </label>

        <label className="block">
          <span className={labelCls}>URL Slug</span>
          <input
            type="text"
            value={slug}
            onChange={(e) => handleSlugChange(e.target.value)}
            placeholder="luna-the-llama"
            className={`mt-1.5 ${inputCls}`}
          />
          <span className="text-[10px] text-bark-400 mt-1 block">
            Auto-generated from name. Edit to customize.
          </span>
        </label>
      </div>

      {/* ── Personality ── */}
      <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-5 space-y-4">
        <h3 className="text-sm font-bold text-bark-800">Personality</h3>

        <div>
          <span className={labelCls}>Traits</span>
          <div className="flex flex-wrap gap-2 mt-2 mb-2 min-h-[28px]">
            {personality.traits.map((trait) => (
              <span
                key={trait}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-100 text-amber-800 text-xs font-medium rounded-full"
              >
                {trait}
                <button
                  type="button"
                  onClick={() => removeTrait(trait)}
                  className="ml-0.5 text-amber-600 hover:text-amber-900 transition-colors"
                  aria-label={`Remove trait: ${trait}`}
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={traitInput}
              onChange={(e) => setTraitInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTrait();
                }
              }}
              placeholder="Type a trait and press Enter"
              className={`flex-1 ${inputCls}`}
            />
            <button
              type="button"
              onClick={addTrait}
              className="px-3 py-2 text-xs font-medium text-bark-600 bg-bark-50 hover:bg-bark-100 rounded-[var(--radius-btn)] transition-colors"
            >
              Add
            </button>
          </div>
        </div>

        <label className="block">
          <span className={labelCls}>Speech Style</span>
          <textarea
            value={personality.speech_style}
            onChange={(e) => setPersonality((p) => ({ ...p, speech_style: e.target.value }))}
            rows={2}
            placeholder="How does this character talk?"
            className={`mt-1.5 ${textareaCls}`}
          />
        </label>
      </div>

      {/* ── Visual ── */}
      <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-5 space-y-4">
        <h3 className="text-sm font-bold text-bark-800">Visual</h3>

        <label className="block">
          <span className={labelCls}>Visual Description</span>
          <textarea
            value={visual.description}
            onChange={(e) => setVisual((v) => ({ ...v, description: e.target.value }))}
            rows={3}
            placeholder="Describe the character's appearance..."
            className={`mt-1.5 ${textareaCls}`}
          />
        </label>

        <label className="block">
          <span className={labelCls}>Visual Constants</span>
          <textarea
            value={visual.constants}
            onChange={(e) => setVisual((v) => ({ ...v, constants: e.target.value }))}
            rows={2}
            placeholder="e.g., Always wears a red scarf and round glasses"
            className={`mt-1.5 ${textareaCls}`}
          />
          <span className="text-[10px] text-bark-400 mt-1 block">
            Accessories/clothing that appear in EVERY illustration
          </span>
        </label>

        <div>
          <span className={labelCls}>Color Palette</span>
          <div className="flex flex-wrap gap-2 mt-2 mb-2 min-h-[28px]">
            {visual.color_palette.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => removeColor(color)}
                title={`${color} — click to remove`}
                className="group relative w-7 h-7 rounded-full border-2 border-bark-200 hover:border-red-400 transition-colors shadow-sm"
                style={{ backgroundColor: color }}
              >
                <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <svg className="w-3 h-3 text-white drop-shadow" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </span>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={colorInput}
              onChange={(e) => setColorInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addColor();
                }
              }}
              placeholder="#a855f7"
              className={`flex-1 ${inputCls}`}
            />
            <div
              className="w-10 h-10 rounded-[var(--radius-btn)] border border-bark-200 shrink-0"
              style={{ backgroundColor: /^#[0-9a-fA-F]{3,8}$/.test(colorInput) ? colorInput : "#ffffff" }}
            />
            <button
              type="button"
              onClick={addColor}
              className="px-3 py-2 text-xs font-medium text-bark-600 bg-bark-50 hover:bg-bark-100 rounded-[var(--radius-btn)] transition-colors"
            >
              Add
            </button>
          </div>
        </div>
      </div>

      {/* ── Story Rules ── */}
      <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-5 space-y-4">
        <h3 className="text-sm font-bold text-bark-800">Story Rules</h3>

        <label className="block">
          <span className={labelCls}>Always</span>
          <textarea
            value={storyRules.always}
            onChange={(e) => setStoryRules((r) => ({ ...r, always: e.target.value }))}
            rows={2}
            placeholder="Things this character always does..."
            className={`mt-1.5 ${textareaCls}`}
          />
        </label>

        <label className="block">
          <span className={labelCls}>Never</span>
          <textarea
            value={storyRules.never}
            onChange={(e) => setStoryRules((r) => ({ ...r, never: e.target.value }))}
            rows={2}
            placeholder="Things this character never does..."
            className={`mt-1.5 ${textareaCls}`}
          />
        </label>
      </div>

      {/* ── Action Buttons ── */}
      <div className="flex gap-3 justify-end">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-5 py-2.5 text-sm font-medium text-bark-600 bg-bark-50 hover:bg-bark-100 rounded-[var(--radius-btn)] transition-colors"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={handleSubmit}
          className="px-6 py-2.5 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-[var(--radius-btn)] transition-colors"
        >
          {mode === "create" ? "Save Character" : "Update Character"}
        </button>
      </div>
    </div>
  );
}
