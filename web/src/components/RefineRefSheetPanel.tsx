import { useState, useCallback, useRef } from "react";
import { refineCharacterRefSheet, uploadCharacterPhoto, updateCharacter } from "../api/client";
import type { CharacterDetail, SSEEvent } from "../api/types";
import { useSSE } from "../hooks/useSSE";

/* ═══════════════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════════════ */

type FieldStrategy = "keep" | "clear" | "edit";

interface RefineRefSheetPanelProps {
  character: CharacterDetail;
  currentRefSheetUrl: string | null;
  onAccepted: () => void;
  onClose: () => void;
}

/* ═══════════════════════════════════════════════════════════════════════
   Styles
   ═══════════════════════════════════════════════════════════════════════ */

const inputCls =
  "w-full px-3 py-2.5 bg-cream border border-bark-200 rounded-[var(--radius-btn)] text-sm text-bark-800 placeholder:text-bark-300 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400";
const textareaCls = `${inputCls} resize-none`;

/* ═══════════════════════════════════════════════════════════════════════
   Component
   ═══════════════════════════════════════════════════════════════════════ */

export function RefineRefSheetPanel({
  character,
  currentRefSheetUrl,
  onAccepted,
  onClose,
}: RefineRefSheetPanelProps) {
  // ── Photo ──
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Visual constants ──
  const [constantsStrategy, setConstantsStrategy] = useState<FieldStrategy>(
    character.visual.constants ? "keep" : "clear",
  );
  const [constantsEdit, setConstantsEdit] = useState(character.visual.constants);

  // ── Color palette ──
  const [paletteStrategy, setPaletteStrategy] = useState<FieldStrategy>(
    character.visual.color_palette.length > 0 ? "keep" : "clear",
  );
  const [paletteEdit, setPaletteEdit] = useState<string[]>([...character.visual.color_palette]);
  const [pickerColor, setPickerColor] = useState("#a855f7");

  // ── Generation state ──
  const [generating, setGenerating] = useState(false);
  const [genTaskId, setGenTaskId] = useState<string | null>(null);
  const [genMessage, setGenMessage] = useState<string | null>(null);
  const [newRefUrl, setNewRefUrl] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  // ── Accept state ──
  const [accepting, setAccepting] = useState(false);

  // ── SSE ──
  const handleSSEEvent = useCallback((event: SSEEvent) => {
    if (event.type === "phase_start" && event.message) {
      setGenMessage(event.message);
    }
    if (event.type === "queue_position") {
      setGenMessage(`Waiting in queue (position ${event.position})...`);
    }
    if (event.type === "reference_sheet_complete") {
      setGenerating(false);
      setGenTaskId(null);
      setGenMessage(null);
      setNewRefUrl(event.url ?? null);
    }
    if (event.type === "task_complete") {
      setGenerating(false);
      setGenTaskId(null);
      setGenMessage(null);
    }
    if (event.type === "error") {
      setGenerating(false);
      setGenTaskId(null);
      setGenError(event.message ?? "Generation failed");
      setGenMessage(null);
    }
  }, []);

  useSSE(genTaskId, "/api/pipeline/progress", handleSSEEvent);

  // ── Handlers ──
  const acceptPhoto = (file: File) => {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const resolveConstants = (): string | undefined => {
    if (constantsStrategy === "keep") return undefined; // use stored
    if (constantsStrategy === "clear") return "";
    return constantsEdit; // edit
  };

  const resolvePalette = (): string[] | undefined => {
    if (paletteStrategy === "keep") return undefined; // use stored
    if (paletteStrategy === "clear") return [];
    return paletteEdit; // edit
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setGenMessage("Starting...");
    setGenError(null);
    setNewRefUrl(null);
    try {
      const res = await refineCharacterRefSheet(character.id!, {
        photo: photoFile ?? undefined,
        visual_constants: resolveConstants(),
        color_palette: resolvePalette(),
      });
      setGenTaskId(res.task_id);
    } catch (err) {
      setGenerating(false);
      setGenError(err instanceof Error ? err.message : "Failed to start");
    }
  };

  const handleTryAgain = () => {
    setNewRefUrl(null);
    setGenError(null);
  };

  const handleAccept = async () => {
    setAccepting(true);
    try {
      // Persist photo if swapped
      if (photoFile && character.id) {
        await uploadCharacterPhoto(character.id, photoFile);
      }
      // Persist visual changes
      const updates: Record<string, unknown> = {};
      const constants = resolveConstants();
      const palette = resolvePalette();
      if (constants !== undefined || palette !== undefined) {
        updates.visual = {
          description: character.visual.description,
          constants: constants ?? character.visual.constants,
          color_palette: palette ?? character.visual.color_palette,
        };
      }
      if (Object.keys(updates).length > 0 && character.id) {
        await updateCharacter(character.id, updates);
      }
      onAccepted();
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Failed to save changes");
      setAccepting(false);
    }
  };

  // ── Result view (after generation) ──
  if (newRefUrl) {
    return (
      <div className="border border-sage-200 rounded-[var(--radius-card)] overflow-hidden bg-gradient-to-b from-sage-50/40 to-white">
        {/* Before / After */}
        <div className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <svg className="w-4 h-4 text-sage-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3 className="text-sm font-bold text-bark-800">New Reference Sheet Ready</h3>
          </div>

          <div className="space-y-4">
            {/* New (large, prominent) */}
            <div>
              <span className="text-[10px] font-semibold text-sage-600 uppercase tracking-wider block mb-1.5">New</span>
              <img
                src={`${newRefUrl}?w=800&t=${Date.now()}`}
                alt="New reference sheet"
                className="w-full rounded-lg border-2 border-sage-300 shadow-md"
              />
            </div>

            {/* Previous (small, collapsed) */}
            {currentRefSheetUrl && (
              <details className="group">
                <summary className="cursor-pointer text-[10px] font-semibold text-bark-400 uppercase tracking-wider hover:text-bark-500 transition-colors select-none">
                  Previous version
                  <svg className="w-3 h-3 inline ml-1 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </summary>
                <img
                  src={`${currentRefSheetUrl}?w=400`}
                  alt="Previous reference sheet"
                  className="mt-2 w-1/2 rounded-lg border border-bark-200 opacity-60"
                />
              </details>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="px-5 py-3.5 border-t border-sage-100 bg-sage-50/30 flex items-center justify-between">
          <button
            type="button"
            onClick={handleTryAgain}
            disabled={accepting}
            className="px-4 py-2 text-xs font-semibold text-bark-600 bg-white border border-bark-200 hover:bg-bark-50 rounded-[var(--radius-btn)] transition-colors"
          >
            Try Again
          </button>
          <button
            type="button"
            onClick={handleAccept}
            disabled={accepting}
            className="px-5 py-2 text-xs font-semibold text-white bg-sage-600 hover:bg-sage-700 disabled:opacity-50 rounded-[var(--radius-btn)] transition-colors inline-flex items-center gap-2"
          >
            {accepting ? (
              <>
                <Spinner className="w-3.5 h-3.5" />
                Saving...
              </>
            ) : (
              "Accept & Save"
            )}
          </button>
        </div>
      </div>
    );
  }

  // ── Controls view ──
  return (
    <div className="border border-amber-200 rounded-[var(--radius-card)] overflow-hidden bg-gradient-to-b from-amber-50/40 to-white">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-amber-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 19.644l3.181-3.182" />
          </svg>
          <h3 className="text-sm font-bold text-bark-800">Refine Reference Sheet</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-bark-400 hover:text-bark-600 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="p-5 space-y-5">
        {/* ── Photo Section ── */}
        <div>
          <span className="text-[10px] font-bold text-bark-500 uppercase tracking-widest block mb-2">
            Reference Photo
          </span>
          <div className="flex items-start gap-4">
            {/* Current photo */}
            {character.photo_url && !photoPreview && (
              <div className="relative group">
                <img
                  src={`${character.photo_url}?w=200`}
                  alt="Current photo"
                  className="w-20 h-20 rounded-xl object-cover border border-bark-200 shadow-sm"
                />
                <div className="absolute inset-0 rounded-xl bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="opacity-0 group-hover:opacity-100 px-2.5 py-1 text-[10px] font-semibold text-white bg-black/50 backdrop-blur-sm rounded-full transition-opacity"
                  >
                    Swap
                  </button>
                </div>
              </div>
            )}

            {/* New photo preview */}
            {photoPreview && (
              <div className="flex items-start gap-3">
                {character.photo_url && (
                  <div className="text-center">
                    <img
                      src={`${character.photo_url}?w=200`}
                      alt="Previous"
                      className="w-14 h-14 rounded-lg object-cover border border-bark-200 opacity-50"
                    />
                    <span className="text-[9px] text-bark-400 mt-0.5 block">Before</span>
                  </div>
                )}
                {character.photo_url && (
                  <svg className="w-3.5 h-3.5 text-bark-300 mt-5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                )}
                <div className="text-center">
                  <img
                    src={photoPreview}
                    alt="New photo"
                    className="w-20 h-20 rounded-xl object-cover border-2 border-amber-400 shadow-sm"
                  />
                  <button
                    type="button"
                    onClick={() => { setPhotoFile(null); setPhotoPreview(null); }}
                    className="text-[10px] text-bark-400 hover:text-red-500 mt-1 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              </div>
            )}

            {/* Upload zone (shown when no photo at all, or alongside current) */}
            {!photoPreview && (
              <label
                className={`flex-1 flex flex-col items-center justify-center h-20 border-2 border-dashed rounded-xl cursor-pointer transition-all ${
                  dragOver
                    ? "border-amber-500 bg-amber-100/60 scale-[1.01]"
                    : "border-amber-200 bg-white/50 hover:border-amber-400 hover:bg-white/80"
                }`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) acceptPhoto(f); }}
              >
                <svg className="w-5 h-5 text-amber-400 mb-1" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                <span className="text-[11px] font-medium text-bark-500">
                  {character.photo_url ? "Use a different photo" : "Upload a photo"}
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) acceptPhoto(f); }}
                  className="hidden"
                />
              </label>
            )}
          </div>
        </div>

        {/* ── Visual Constants ── */}
        <div>
          <span className="text-[10px] font-bold text-bark-500 uppercase tracking-widest block mb-2">
            Visual Constants
          </span>
          <div className="flex gap-1.5 mb-2">
            {character.visual.constants && (
              <StrategyPill
                label="Keep current"
                active={constantsStrategy === "keep"}
                onClick={() => setConstantsStrategy("keep")}
              />
            )}
            <StrategyPill
              label="Clear"
              active={constantsStrategy === "clear"}
              onClick={() => setConstantsStrategy("clear")}
            />
            <StrategyPill
              label="Edit"
              active={constantsStrategy === "edit"}
              onClick={() => setConstantsStrategy("edit")}
            />
          </div>
          {constantsStrategy === "keep" && character.visual.constants && (
            <p className="text-xs text-bark-400 italic px-1 leading-relaxed">
              {character.visual.constants}
            </p>
          )}
          {constantsStrategy === "edit" && (
            <textarea
              value={constantsEdit}
              onChange={(e) => setConstantsEdit(e.target.value)}
              placeholder="e.g., Always wears purple boots and a star hairclip"
              rows={2}
              className={textareaCls}
            />
          )}
          {constantsStrategy === "clear" && (
            <p className="text-[11px] text-bark-300 italic px-1">
              AI will decide freely — no clothing/accessory constraints
            </p>
          )}
        </div>

        {/* ── Color Palette ── */}
        <div>
          <span className="text-[10px] font-bold text-bark-500 uppercase tracking-widest block mb-2">
            Color Palette
          </span>
          <div className="flex gap-1.5 mb-2">
            {character.visual.color_palette.length > 0 && (
              <StrategyPill
                label="Keep current"
                active={paletteStrategy === "keep"}
                onClick={() => setPaletteStrategy("keep")}
              />
            )}
            <StrategyPill
              label="Clear"
              active={paletteStrategy === "clear"}
              onClick={() => setPaletteStrategy("clear")}
            />
            <StrategyPill
              label="Edit"
              active={paletteStrategy === "edit"}
              onClick={() => setPaletteStrategy("edit")}
            />
          </div>
          {paletteStrategy === "keep" && character.visual.color_palette.length > 0 && (
            <div className="flex gap-1.5 px-1">
              {character.visual.color_palette.map((c) => (
                <div
                  key={c}
                  className="w-6 h-6 rounded-full border border-bark-200/60 shadow-sm"
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
          )}
          {paletteStrategy === "edit" && (
            <div>
              <div className="flex flex-wrap gap-1.5 mb-2 min-h-[28px]">
                {paletteEdit.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setPaletteEdit((p) => p.filter((c) => c !== color))}
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
                  className="w-8 h-8 rounded-lg border border-bark-200 cursor-pointer p-0.5 bg-white"
                />
                <span className="text-[10px] text-bark-400 font-mono w-14">{pickerColor}</span>
                <button
                  type="button"
                  onClick={() => {
                    if (!paletteEdit.includes(pickerColor)) {
                      setPaletteEdit((p) => [...p, pickerColor]);
                    }
                  }}
                  className="px-2.5 py-1.5 text-[10px] font-semibold text-bark-600 bg-bark-50 hover:bg-bark-100 rounded-[var(--radius-btn)] transition-colors"
                >
                  Add
                </button>
              </div>
            </div>
          )}
          {paletteStrategy === "clear" && (
            <p className="text-[11px] text-bark-300 italic px-1">
              AI will pick colors based on the photo
            </p>
          )}
        </div>

        {/* ── Error ── */}
        {genError && (
          <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg">
            <svg className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <p className="text-xs text-red-700">{genError}</p>
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="px-5 py-3.5 border-t border-amber-100 bg-amber-50/30 flex items-center justify-between">
        <button
          type="button"
          onClick={onClose}
          disabled={generating}
          className="px-4 py-2 text-xs font-semibold text-bark-500 hover:text-bark-700 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="px-5 py-2 text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-50 rounded-[var(--radius-btn)] transition-colors inline-flex items-center gap-2"
        >
          {generating ? (
            <>
              <Spinner className="w-3.5 h-3.5" />
              {genMessage || "Generating..."}
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 19.644l3.181-3.182" />
              </svg>
              Regenerate
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Sub-components
   ═══════════════════════════════════════════════════════════════════════ */

function StrategyPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 text-[10px] font-semibold rounded-full transition-colors ${
        active
          ? "bg-amber-500 text-white shadow-sm"
          : "bg-bark-50 text-bark-500 hover:bg-bark-100"
      }`}
    >
      {label}
    </button>
  );
}

function Spinner({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
