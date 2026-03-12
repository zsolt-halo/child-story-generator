import { useState } from "react";
import type { PresetDetail } from "../api/types";

interface PresetCardProps {
  preset: PresetDetail;
  characterName?: string;
  onGenerate: (preset: PresetDetail) => void;
  onSetDefault: (preset: PresetDetail) => void;
  onDelete: (preset: PresetDetail) => void;
  generating?: boolean;
}

export function PresetCard({
  preset,
  characterName,
  onGenerate,
  onSetDefault,
  onDelete,
  generating,
}: PresetCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div
      className={`group relative flex flex-col min-w-[180px] max-w-[220px] rounded-2xl border transition-all duration-200 ${
        preset.is_default
          ? "border-amber-300 bg-gradient-to-b from-amber-50 to-white shadow-sm ring-1 ring-amber-200/50"
          : "border-bark-200 bg-white hover:border-bark-300 hover:shadow-sm"
      }`}
    >
      {/* Default star */}
      <button
        onClick={() => onSetDefault(preset)}
        className={`absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full flex items-center justify-center transition-all z-10 ${
          preset.is_default
            ? "bg-amber-400 text-white shadow-sm"
            : "bg-bark-100 text-bark-300 opacity-0 group-hover:opacity-100 hover:bg-amber-100 hover:text-amber-500"
        }`}
        title={preset.is_default ? "Default preset" : "Set as default"}
      >
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
          <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
        </svg>
      </button>

      {/* Delete button */}
      {!confirmDelete ? (
        <button
          onClick={() => setConfirmDelete(true)}
          className="absolute -top-1.5 -left-1.5 w-6 h-6 rounded-full bg-bark-100 text-bark-300 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-red-100 hover:text-red-500 transition-all z-10"
          title="Delete preset"
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      ) : (
        <button
          onClick={() => { onDelete(preset); setConfirmDelete(false); }}
          onMouseLeave={() => setConfirmDelete(false)}
          className="absolute -top-1.5 -left-1.5 px-2 h-6 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center gap-1 z-10 shadow-sm"
        >
          Delete
        </button>
      )}

      {/* Content */}
      <div className="px-3.5 pt-3.5 pb-2">
        <h4 className="text-sm font-bold text-bark-800 truncate leading-tight">
          {preset.name}
        </h4>
        <p className="text-[11px] text-bark-400 mt-1 truncate">
          {characterName || preset.character}
        </p>
      </div>

      {/* Tags */}
      <div className="px-3.5 pb-2 flex flex-wrap gap-1">
        <span className="inline-block px-1.5 py-0.5 bg-bark-50 text-bark-500 text-[10px] font-medium rounded capitalize">
          {preset.style}
        </span>
        <span className="inline-block px-1.5 py-0.5 bg-bark-50 text-bark-500 text-[10px] font-medium rounded capitalize">
          {preset.narrator}
        </span>
        {preset.language && (
          <span className="inline-block px-1.5 py-0.5 bg-sage-50 text-sage-600 text-[10px] font-medium rounded capitalize">
            {preset.language}
          </span>
        )}
        {preset.text_model === "gemini-2.5-flash" && (
          <span className="inline-block px-1.5 py-0.5 bg-sage-50 text-sage-600 text-[10px] font-medium rounded">
            Express
          </span>
        )}
      </div>

      {/* Generate button */}
      <div className="px-3 pb-3 mt-auto">
        <button
          onClick={() => onGenerate(preset)}
          disabled={generating}
          className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
            generating
              ? "bg-bark-100 text-bark-400 cursor-wait"
              : preset.is_default
                ? "bg-amber-500 hover:bg-amber-600 text-white shadow-sm"
                : "bg-bark-100 hover:bg-sage-500 hover:text-white text-bark-600"
          }`}
        >
          {generating ? (
            "Starting..."
          ) : (
            <>
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
              Generate
            </>
          )}
        </button>
      </div>
    </div>
  );
}
