import { useState } from "react";
import type { CoverVariation } from "../api/types";

interface CoverSelectionPanelProps {
  slug: string;
  variations: CoverVariation[];
  onSelect: (choice: number) => void;
  selecting?: boolean;
}

export function CoverSelectionPanel({ variations, onSelect, selecting }: CoverSelectionPanelProps) {
  const [chosen, setChosen] = useState<number | null>(null);

  return (
    <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-6 shadow-sm">
      <div className="mb-5">
        <h2 className="text-lg font-bold text-bark-800">Choose Your Cover</h2>
        <p className="text-sm text-bark-400 mt-1">
          Pick the cover that best captures the story. The selected cover will be used in the final book.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {variations.map((v) => (
          <button
            key={v.index}
            onClick={() => setChosen(v.index)}
            disabled={selecting}
            className={`relative aspect-square rounded-xl overflow-hidden border-3 transition-all ${
              chosen === v.index
                ? "border-amber-400 ring-2 ring-amber-400/30 scale-[1.02]"
                : "border-bark-100 hover:border-bark-200"
            } ${selecting ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
          >
            <img
              src={v.url}
              alt={`Cover option ${v.index}`}
              className="w-full h-full object-cover"
            />
            <div className={`absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-bold ${
              chosen === v.index
                ? "bg-amber-400 text-bark-800"
                : "bg-black/40 text-white"
            }`}>
              Option {v.index}
            </div>
            {chosen === v.index && (
              <div className="absolute inset-0 bg-amber-400/10 flex items-center justify-center">
                <div className="w-10 h-10 rounded-full bg-amber-400 flex items-center justify-center">
                  <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </div>
              </div>
            )}
          </button>
        ))}
      </div>

      <div className="flex justify-end mt-5 pt-5 border-t border-bark-100">
        <button
          onClick={() => chosen && onSelect(chosen)}
          disabled={!chosen || selecting}
          className="px-6 py-2.5 text-sm font-semibold text-white bg-sage-600 hover:bg-sage-700 disabled:opacity-60 disabled:cursor-not-allowed rounded-[var(--radius-btn)] transition-colors"
        >
          {selecting ? "Continuing..." : "Use This Cover & Continue"}
        </button>
      </div>
    </div>
  );
}
