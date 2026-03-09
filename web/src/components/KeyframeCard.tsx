import type { Keyframe } from "../api/types";

interface KeyframeCardProps {
  keyframe: Keyframe;
  imageUrl?: string;
  onClick: () => void;
}

export function KeyframeCard({ keyframe, imageUrl, onClick }: KeyframeCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left bg-white rounded-[var(--radius-card)] shadow-sm hover:shadow-md transition-all border border-bark-100 overflow-hidden group"
    >
      {/* Thumbnail */}
      <div className="aspect-square bg-cream-dark relative overflow-hidden">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={`Page ${keyframe.page_number}`}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-bark-300 text-3xl font-bold font-[family-name:var(--font-heading)]">
              {keyframe.page_number}
            </span>
          </div>
        )}
        {keyframe.is_cover && (
          <span className="absolute top-2 left-2 px-2 py-0.5 bg-amber-500/90 text-white text-[10px] font-semibold rounded-full">
            Cover
          </span>
        )}
        <span className="absolute bottom-2 right-2 px-2 py-0.5 bg-bark-800/70 text-white text-[10px] rounded-full backdrop-blur-sm">
          {keyframe.mood}
        </span>
      </div>

      {/* Text preview */}
      <div className="p-3">
        <p className="text-xs text-bark-600 line-clamp-3 leading-relaxed font-[family-name:var(--font-story)]">
          {keyframe.page_text}
        </p>
      </div>
    </button>
  );
}
