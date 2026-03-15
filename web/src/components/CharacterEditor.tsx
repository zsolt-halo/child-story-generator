import { useState, useCallback, useRef } from "react";
import { polishCharacter, uploadCharacterPhoto, deleteCharacterPhoto } from "../api/client";
import type {
  CharacterDetail,
  CharacterCreateRequest,
  CharacterPersonality,
  CharacterVisual,
  CharacterStoryRules,
} from "../api/types";

/* ═══════════════════════════════════════════════════════════════════════
   Types & constants
   ═══════════════════════════════════════════════════════════════════════ */

type CharacterKind = "imagined" | "real";

interface CharacterEditorProps {
  initialData?: CharacterDetail;
  onSave: (data: CharacterCreateRequest, pendingPhoto?: File) => void;
  onCancel?: () => void;
  mode: "create" | "edit";
  onPhotoChanged?: () => void;
  /** When "family-member", adjusts labels so they don't assume "child" */
  variant?: "character" | "family-member";
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

/* ═══════════════════════════════════════════════════════════════════════
   Shared sub-components
   ═══════════════════════════════════════════════════════════════════════ */

function Spinner({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function TraitEditor({
  traits,
  onAdd,
  onRemove,
}: {
  traits: string[];
  onAdd: (trait: string) => void;
  onRemove: (trait: string) => void;
}) {
  const [input, setInput] = useState("");
  const add = () => {
    const trimmed = input.trim();
    if (trimmed && !traits.includes(trimmed)) {
      onAdd(trimmed);
      setInput("");
    }
  };
  return (
    <div>
      <span className={labelCls}>Traits</span>
      <div className="flex flex-wrap gap-2 mt-2 mb-2 min-h-[28px]">
        {traits.map((trait) => (
          <span
            key={trait}
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-100 text-amber-800 text-xs font-medium rounded-full"
          >
            {trait}
            <button
              type="button"
              onClick={() => onRemove(trait)}
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
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="Type a trait and press Enter"
          className={`flex-1 ${inputCls}`}
        />
        <button
          type="button"
          onClick={add}
          className="px-3 py-2 text-xs font-medium text-bark-600 bg-bark-50 hover:bg-bark-100 rounded-[var(--radius-btn)] transition-colors"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function ColorPaletteEditor({
  colors,
  onAdd,
  onRemove,
}: {
  colors: string[];
  onAdd: (color: string) => void;
  onRemove: (color: string) => void;
}) {
  const [pickerColor, setPickerColor] = useState("#a855f7");
  const add = () => {
    if (!colors.includes(pickerColor)) {
      onAdd(pickerColor);
    }
  };
  return (
    <div>
      <span className={labelCls}>Color Palette</span>
      <div className="flex flex-wrap gap-2 mt-2 mb-2 min-h-[28px]">
        {colors.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => onRemove(color)}
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
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={pickerColor}
          onChange={(e) => setPickerColor(e.target.value)}
          className="w-10 h-10 rounded-[var(--radius-btn)] border border-bark-200 cursor-pointer p-0.5 bg-white"
        />
        <span className="text-xs text-bark-500 font-mono w-16">{pickerColor}</span>
        <button
          type="button"
          onClick={add}
          className="px-3 py-2 text-xs font-medium text-bark-600 bg-bark-50 hover:bg-bark-100 rounded-[var(--radius-btn)] transition-colors"
        >
          Add
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Main editor
   ═══════════════════════════════════════════════════════════════════════ */

export function CharacterEditor({ initialData, onSave, onCancel, mode, onPhotoChanged, variant = "character" }: CharacterEditorProps) {
  const isFamilyMember = variant === "family-member";
  // Determine initial kind from existing data
  const initialKind: CharacterKind = initialData?.has_photo ? "real" : "imagined";
  const [kind, setKind] = useState<CharacterKind>(initialKind);
  const [kindLocked, setKindLocked] = useState(mode === "edit");

  const [name, setName] = useState(initialData?.name ?? "");
  const [childName, setChildName] = useState(initialData?.child_name ?? "");
  const [age, setAge] = useState(initialData?.age ?? "");
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

  // Polish state (imagined path)
  const [roughDescription, setRoughDescription] = useState("");
  const [polishing, setPolishing] = useState(false);
  const [polishError, setPolishError] = useState<string | null>(null);

  // Photo state (real path)
  const [photoPreview, setPhotoPreview] = useState<string | null>(
    initialData?.photo_url ? `${initialData.photo_url}?w=400` : null,
  );
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isFieldsMostlyEmpty =
    personality.traits.length === 0 &&
    !personality.speech_style &&
    !visual.description &&
    !visual.constants &&
    visual.color_palette.length === 0 &&
    !storyRules.always &&
    !storyRules.never;

  const showPolishPanel = kind === "imagined" && (mode === "create" || isFieldsMostlyEmpty);

  /* ── Handlers ── */

  const handleNameChange = (value: string) => {
    setName(value);
    if (!slugManual) setSlug(toSlug(value));
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

  const acceptPhoto = (file: File) => {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setPhotoError("Only PNG, JPEG, and WebP images are supported");
      return;
    }
    setPhotoError(null);
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) acceptPhoto(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) acceptPhoto(file);
  };

  const handlePhotoUpload = async () => {
    if (!photoFile || !initialData?.id) return;
    setUploading(true);
    setPhotoError(null);
    try {
      await uploadCharacterPhoto(initialData.id, photoFile);
      setPhotoFile(null);
      onPhotoChanged?.();
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handlePhotoRemove = async () => {
    if (initialData?.id && initialData?.has_photo) {
      setUploading(true);
      try {
        await deleteCharacterPhoto(initialData.id);
        onPhotoChanged?.();
      } catch (err) {
        setPhotoError(err instanceof Error ? err.message : "Failed to remove photo");
        setUploading(false);
        return;
      } finally {
        setUploading(false);
      }
    }
    setPhotoPreview(null);
    setPhotoFile(null);
  };

  const handleSubmit = () => {
    onSave(
      {
        slug,
        name,
        child_name: childName,
        age: age || undefined,
        personality,
        visual,
        story_rules: storyRules,
      },
      kind === "real" && photoFile ? photoFile : undefined,
    );
  };

  const polishDisabled = !name || (!isFamilyMember && !childName) || roughDescription.length < 10 || polishing;

  /* ── Kind selector (step 0) ── */
  const selectKind = (k: CharacterKind) => {
    // When switching TO "real" from "imagined", clear AI-polished visual description
    // to prevent conflicting animal descriptions from overriding the photo
    if (k === "real" && kind === "imagined" && visual.description) {
      setVisual((v) => ({ ...v, description: "" }));
    }
    setKind(k);
    setKindLocked(true);
  };

  if (!kindLocked && mode === "create") {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          {/* Imagined character card */}
          <button
            type="button"
            onClick={() => selectKind("imagined")}
            className="group relative bg-white rounded-[var(--radius-card)] border-2 border-bark-100 hover:border-sage-400 p-6 text-left transition-all hover:shadow-md"
          >
            <div className="w-12 h-12 rounded-full bg-sage-50 flex items-center justify-center mb-4 group-hover:bg-sage-100 transition-colors">
              <svg className="w-6 h-6 text-sage-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18 9.75l.259.91a2.25 2.25 0 001.581 1.581l.91.26-.911.258a2.25 2.25 0 00-1.581 1.581l-.259.911-.259-.911a2.25 2.25 0 00-1.581-1.581l-.91-.259.91-.259a2.25 2.25 0 001.581-1.581L18 9.75z" />
              </svg>
            </div>
            <h3 className="text-sm font-bold text-bark-800 mb-1">Storybook Character</h3>
            <p className="text-xs text-bark-400 leading-relaxed">
              Imagine a character from scratch — a magical llama, a brave dragon, a curious bunny.
              AI will help flesh out the details.
            </p>
            <div className="absolute top-4 right-4 w-6 h-6 rounded-full border-2 border-bark-200 group-hover:border-sage-400 group-hover:bg-sage-50 transition-colors" />
          </button>

          {/* Real person card */}
          <button
            type="button"
            onClick={() => selectKind("real")}
            className="group relative bg-white rounded-[var(--radius-card)] border-2 border-bark-100 hover:border-amber-400 p-6 text-left transition-all hover:shadow-md"
          >
            <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center mb-4 group-hover:bg-amber-100 transition-colors">
              <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
              </svg>
            </div>
            <h3 className="text-sm font-bold text-bark-800 mb-1">
              {isFamilyMember ? "Based on a Real Person" : "Based on My Child"}
            </h3>
            <p className="text-xs text-bark-400 leading-relaxed">
              {isFamilyMember
                ? "Upload a photo and we'll create a cartoon character that captures their likeness. Uses our best AI model."
                : "Upload a photo and we'll create a cartoon character that looks like your child. Uses our best AI model for likeness."}
            </p>
            <div className="absolute top-4 right-4 w-6 h-6 rounded-full border-2 border-bark-200 group-hover:border-amber-400 group-hover:bg-amber-50 transition-colors" />
          </button>
        </div>

        {onCancel && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onCancel}
              className="px-5 py-2.5 text-sm font-medium text-bark-600 bg-bark-50 hover:bg-bark-100 rounded-[var(--radius-btn)] transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  }

  /* ── Main form ── */
  return (
    <div className="space-y-6">
      {/* Kind indicator (when editing or after selection) */}
      {mode === "create" && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setKindLocked(false)}
            className="text-xs text-bark-400 hover:text-bark-600 transition-colors underline underline-offset-2"
          >
            Change
          </button>
          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold ${
            kind === "real"
              ? "bg-amber-100 text-amber-700"
              : "bg-sage-100 text-sage-700"
          }`}>
            {kind === "real" ? (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            )}
            {kind === "real" ? "Based on photo" : "Storybook character"}
          </div>
        </div>
      )}

      {/* ═══ REAL PATH: Photo upload hero ═══ */}
      {kind === "real" && (
        <div className="bg-gradient-to-br from-amber-50 to-amber-100/50 border border-amber-200 rounded-[var(--radius-card)] p-5">
          <div className="flex items-start gap-2 mb-3">
            <svg className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
            </svg>
            <div>
              <h3 className="text-sm font-bold text-bark-800">Reference Photo</h3>
              <p className="text-xs text-bark-400 mt-0.5">
                {isFamilyMember
                  ? "Upload a clear photo of their face. We'll use our best AI to create a cartoon version that captures their likeness."
                  : "Upload a clear photo of your child's face. We'll use our best AI to create a cartoon version that captures their likeness."}
              </p>
            </div>
          </div>

          {photoPreview ? (
            <div className="flex items-start gap-4 mt-3">
              <div className="relative w-28 h-28 rounded-xl overflow-hidden border-2 border-amber-300 shadow-md shrink-0">
                <img src={photoPreview} alt="Reference photo" className="w-full h-full object-cover" />
              </div>
              <div className="flex flex-col gap-2 pt-2">
                {photoFile && initialData?.id && (
                  <button
                    type="button"
                    onClick={handlePhotoUpload}
                    disabled={uploading}
                    className="px-4 py-2 text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-50 rounded-[var(--radius-btn)] transition-colors inline-flex items-center gap-2"
                  >
                    {uploading && <Spinner className="w-3.5 h-3.5" />}
                    {uploading ? "Uploading..." : "Save Photo"}
                  </button>
                )}
                {photoFile && !initialData?.id && (
                  <p className="text-[11px] text-amber-700 bg-amber-100 rounded-[var(--radius-btn)] px-3 py-1.5">
                    Photo will be uploaded after saving the character
                  </p>
                )}
                {!photoFile && initialData?.has_photo && (
                  <p className="text-[11px] text-sage-700 font-medium flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    Photo saved
                  </p>
                )}
                <button
                  type="button"
                  onClick={handlePhotoRemove}
                  disabled={uploading}
                  className="px-3 py-1.5 text-xs font-medium text-bark-500 hover:text-red-600 disabled:opacity-50 transition-colors text-left"
                >
                  Remove photo
                </button>
              </div>
            </div>
          ) : (
            <label
              className={`mt-3 flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-xl cursor-pointer transition-all ${
                dragOver
                  ? "border-amber-500 bg-amber-100/60 scale-[1.01]"
                  : "border-amber-300 bg-white/50 hover:border-amber-400 hover:bg-white/80"
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <svg className="w-8 h-8 text-amber-400 mb-2" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              <span className="text-sm font-medium text-bark-600">
                {dragOver ? "Drop photo here" : "Click or drag a photo"}
              </span>
              <span className="text-[10px] text-bark-400 mt-1">PNG, JPG, or WebP</span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handlePhotoSelect}
                className="hidden"
              />
            </label>
          )}

          {photoError && <p className="text-xs text-red-600 mt-2">{photoError}</p>}
        </div>
      )}

      {/* ═══ IMAGINED PATH: AI Polish panel ═══ */}
      {showPolishPanel && (
        <div className="bg-sage-50 border border-sage-200 rounded-[var(--radius-card)] p-5">
          <div className="flex items-start gap-2 mb-3">
            <svg className="w-4 h-4 text-sage-600 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
            <div>
              <h3 className="text-sm font-bold text-bark-800">AI Character Polish</h3>
              <p className="text-xs text-bark-400 mt-0.5">
                Describe your character idea and AI will fill in personality, visual details, and story rules.
              </p>
            </div>
          </div>
          <textarea
            value={roughDescription}
            onChange={(e) => setRoughDescription(e.target.value)}
            placeholder="e.g., A friendly purple dragon who loves baking cookies and always wears a tiny chef hat"
            rows={3}
            className={textareaCls}
          />
          {polishError && <p className="text-xs text-red-600 mt-2">{polishError}</p>}
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={handlePolish}
              disabled={polishDisabled}
              className="px-4 py-2 text-sm font-semibold text-white bg-sage-600 hover:bg-sage-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-[var(--radius-btn)] transition-colors inline-flex items-center gap-2"
            >
              {polishing && <Spinner />}
              {polishing ? "Polishing..." : "Polish with AI"}
            </button>
            {polishDisabled && !polishing && (
              <span className="text-xs text-bark-400">
                {!name || (!isFamilyMember && !childName)
                  ? isFamilyMember ? "Fill in name first" : "Fill in name and child's name first"
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
          <span className={labelCls}>
            {kind === "real" ? "Character Name" : "Character Name"}
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder={kind === "real" ? "Lana" : "Luna the Llama"}
            className={`mt-1.5 ${inputCls}`}
          />
          {kind === "real" && (
            <span className="text-[10px] text-bark-400 mt-1 block">
              {isFamilyMember ? "Their real name or a storybook name" : "Your child's name or a storybook name for them"}
            </span>
          )}
        </label>

        {/* Hidden for family members — backend inherits child_name from parent character */}
        {!isFamilyMember && (
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
        )}

        <label className="block">
          <span className={labelCls}>Age</span>
          <input
            type="text"
            value={age}
            onChange={(e) => setAge(e.target.value)}
            placeholder="3 years"
            className={`mt-1.5 ${inputCls}`}
          />
          <span className="text-[10px] text-bark-400 mt-1 block">
            Helps generate age-appropriate reference sheets
          </span>
        </label>

        <label className="block">
          <span className={labelCls}>URL Slug</span>
          <input
            type="text"
            value={slug}
            onChange={(e) => handleSlugChange(e.target.value)}
            placeholder={kind === "real" ? "lana" : "luna-the-llama"}
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

        <TraitEditor
          traits={personality.traits}
          onAdd={(trait) => setPersonality((p) => ({ ...p, traits: [...p.traits, trait] }))}
          onRemove={(trait) => setPersonality((p) => ({ ...p, traits: p.traits.filter((t) => t !== trait) }))}
        />

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
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-bark-800">Visual</h3>
          {kind === "real" && (
            <span className="text-[10px] text-amber-600 font-medium bg-amber-50 px-2 py-0.5 rounded-full">
              Appearance is derived from your photo
            </span>
          )}
        </div>

        <label className="block">
          <span className={labelCls}>Visual Description</span>
          <textarea
            value={visual.description}
            onChange={(e) => setVisual((v) => ({ ...v, description: e.target.value }))}
            rows={3}
            placeholder={
              kind === "real"
                ? "Optional — describe anything the photo doesn't show (e.g., favorite outfit, hairstyle they usually wear)"
                : "Describe the character's appearance..."
            }
            className={`mt-1.5 ${textareaCls}`}
          />
          {kind === "real" && (
            <span className="text-[10px] text-bark-400 mt-1 block">
              The AI will use the photo as the primary reference. Add notes here for details the photo doesn't capture.
            </span>
          )}
        </label>

        <label className="block">
          <span className={labelCls}>Visual Constants</span>
          <textarea
            value={visual.constants}
            onChange={(e) => setVisual((v) => ({ ...v, constants: e.target.value }))}
            rows={2}
            placeholder={
              kind === "real"
                ? "e.g., Always wears her favorite purple boots and a star hairclip"
                : "e.g., Always wears a red scarf and round glasses"
            }
            className={`mt-1.5 ${textareaCls}`}
          />
          <span className="text-[10px] text-bark-400 mt-1 block">
            Accessories/clothing that appear in EVERY illustration
          </span>
        </label>

        <ColorPaletteEditor
          colors={visual.color_palette}
          onAdd={(color) => setVisual((v) => ({ ...v, color_palette: [...v.color_palette, color] }))}
          onRemove={(color) => setVisual((v) => ({ ...v, color_palette: v.color_palette.filter((c) => c !== color) }))}
        />
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
            placeholder={
              kind === "real"
                ? "e.g., Lana is the main character and the story mirrors her real adventures"
                : "Things this character always does..."
            }
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
