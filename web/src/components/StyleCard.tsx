import type { StyleInfo } from "../api/types";
import { FadeImage } from "./FadeImage";

const STYLE_ICONS: Record<string, string> = {
  digital: "🎨",
  watercolor: "🖌️",
  ghibli: "🏯",
  papercut: "✂️",
};

interface StyleCardProps {
  style: StyleInfo;
  selected: boolean;
  onClick: () => void;
}

export function StyleCard({ style, selected, onClick }: StyleCardProps) {
  const label = style.name.charAt(0).toUpperCase() + style.name.slice(1);

  if (!style.preview_url) {
    return (
      <button
        onClick={onClick}
        className={`text-left p-4 rounded-xl border-2 transition-all duration-200 ${
          selected
            ? "border-amber-400 bg-amber-50 ring-2 ring-amber-400/30 scale-[1.02]"
            : "border-bark-100 bg-white hover:border-bark-200 hover:shadow-md"
        }`}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg">{STYLE_ICONS[style.name] || "🎨"}</span>
          <span className="font-semibold text-bark-800">{label}</span>
        </div>
        <p className="text-xs text-bark-400">{style.description}</p>
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className={`relative aspect-square rounded-xl overflow-hidden border-3 transition-all duration-200 cursor-pointer ${
        selected
          ? "border-amber-400 ring-2 ring-amber-400/30 scale-[1.02]"
          : "border-bark-100 hover:border-bark-200 hover:shadow-md"
      }`}
    >
      <FadeImage
        src={style.preview_url}
        thumbWidth={400}
        alt={`${label} style preview`}
        className="w-full h-full object-cover"
      />

      {/* Bottom gradient overlay with label */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-bark-900/80 via-bark-900/40 to-transparent pt-12 pb-3 px-3">
        <div className="font-semibold text-white text-sm">{label}</div>
        <div className="text-[11px] text-white/70 leading-tight mt-0.5">{style.description}</div>
      </div>

      {/* Checkmark badge */}
      {selected && (
        <div className="absolute inset-0 bg-amber-400/10 flex items-center justify-center">
          <div className="w-10 h-10 rounded-full bg-amber-400 flex items-center justify-center shadow-lg">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
        </div>
      )}
    </button>
  );
}
