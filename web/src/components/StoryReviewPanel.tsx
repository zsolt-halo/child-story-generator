import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getStory } from "../api/client";
import type { Keyframe } from "../api/types";

interface StoryReviewPanelProps {
  slug: string;
  onApprove: () => void;
  approving?: boolean;
}

/* ─── Mood → color mapping ─── */

const MOOD_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  joyful:      { bg: "bg-amber-100",   text: "text-amber-700",   dot: "bg-amber-400" },
  happy:       { bg: "bg-amber-100",   text: "text-amber-700",   dot: "bg-amber-400" },
  cheerful:    { bg: "bg-amber-100",   text: "text-amber-700",   dot: "bg-amber-400" },
  excited:     { bg: "bg-orange-100",  text: "text-orange-700",  dot: "bg-orange-400" },
  playful:     { bg: "bg-orange-100",  text: "text-orange-700",  dot: "bg-orange-400" },
  mysterious:  { bg: "bg-violet-100",  text: "text-violet-700",  dot: "bg-violet-400" },
  curious:     { bg: "bg-violet-100",  text: "text-violet-700",  dot: "bg-violet-400" },
  wonder:      { bg: "bg-violet-100",  text: "text-violet-700",  dot: "bg-violet-400" },
  cozy:        { bg: "bg-rose-100",    text: "text-rose-700",    dot: "bg-rose-400" },
  warm:        { bg: "bg-rose-100",    text: "text-rose-700",    dot: "bg-rose-400" },
  tender:      { bg: "bg-rose-100",    text: "text-rose-700",    dot: "bg-rose-400" },
  gentle:      { bg: "bg-rose-100",    text: "text-rose-700",    dot: "bg-rose-400" },
  adventurous: { bg: "bg-emerald-100", text: "text-emerald-700", dot: "bg-emerald-400" },
  brave:       { bg: "bg-emerald-100", text: "text-emerald-700", dot: "bg-emerald-400" },
  determined:  { bg: "bg-emerald-100", text: "text-emerald-700", dot: "bg-emerald-400" },
  proud:       { bg: "bg-emerald-100", text: "text-emerald-700", dot: "bg-emerald-400" },
  peaceful:    { bg: "bg-sky-100",     text: "text-sky-700",     dot: "bg-sky-400" },
  calm:        { bg: "bg-sky-100",     text: "text-sky-700",     dot: "bg-sky-400" },
  serene:      { bg: "bg-sky-100",     text: "text-sky-700",     dot: "bg-sky-400" },
  dreamy:      { bg: "bg-indigo-100",  text: "text-indigo-700",  dot: "bg-indigo-400" },
  sleepy:      { bg: "bg-indigo-100",  text: "text-indigo-700",  dot: "bg-indigo-400" },
  sad:         { bg: "bg-slate-100",   text: "text-slate-700",   dot: "bg-slate-400" },
  anxious:     { bg: "bg-slate-100",   text: "text-slate-700",   dot: "bg-slate-400" },
  silly:       { bg: "bg-pink-100",    text: "text-pink-700",    dot: "bg-pink-400" },
  funny:       { bg: "bg-pink-100",    text: "text-pink-700",    dot: "bg-pink-400" },
};

const DEFAULT_MOOD = { bg: "bg-bark-100", text: "text-bark-600", dot: "bg-bark-400" };

function getMoodColor(mood: string) {
  const key = mood.toLowerCase().split(/[\s,/]+/)[0];
  return MOOD_COLORS[key] || DEFAULT_MOOD;
}

function getBeatLabel(kf: Keyframe): string {
  if (kf.beat_summary) return kf.beat_summary;
  // Fallback: first ~5 words of page_text
  const words = kf.page_text.split(/\s+/).slice(0, 5).join(" ");
  return words + (kf.page_text.split(/\s+/).length > 5 ? "..." : "");
}

/* ─── Serpentine layout calculations ─── */

const COLS = 4;
const NODE_W = 140;
const NODE_H = 100;
const GAP_X = 24;
const GAP_Y = 40;

function getNodePosition(index: number): { x: number; y: number } {
  const row = Math.floor(index / COLS);
  const colInRow = index % COLS;
  // Alternate row direction: even rows L→R, odd rows R→L
  const col = row % 2 === 0 ? colInRow : COLS - 1 - colInRow;
  return {
    x: col * (NODE_W + GAP_X),
    y: row * (NODE_H + GAP_Y),
  };
}

function buildSerpentinePath(count: number): string {
  if (count < 2) return "";
  const points = Array.from({ length: count }, (_, i) => {
    const pos = getNodePosition(i);
    return { x: pos.x + NODE_W / 2, y: pos.y + NODE_H / 2 };
  });

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    // Use smooth bezier curves
    const midY = (prev.y + curr.y) / 2;
    if (prev.y === curr.y) {
      // Same row: horizontal curve
      const midX = (prev.x + curr.x) / 2;
      d += ` Q ${midX} ${prev.y - 20}, ${curr.x} ${curr.y}`;
    } else {
      // Row transition: vertical S-curve
      d += ` C ${prev.x} ${midY}, ${curr.x} ${midY}, ${curr.x} ${curr.y}`;
    }
  }
  return d;
}

/* ─── Component ─── */

export function StoryReviewPanel({ slug, onApprove, approving }: StoryReviewPanelProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["story", slug],
    queryFn: () => getStory(slug),
  });

  const pathRef = useRef<SVGPathElement>(null);
  const [pathLength, setPathLength] = useState(0);
  const [hoveredPage, setHoveredPage] = useState<number | null>(null);

  const keyframes = data?.story.keyframes ?? [];
  const totalRows = Math.ceil(keyframes.length / COLS);
  const svgWidth = COLS * (NODE_W + GAP_X) - GAP_X;
  const svgHeight = totalRows * (NODE_H + GAP_Y) - GAP_Y;
  const containerWidth = svgWidth;
  const containerHeight = svgHeight;

  const pathD = useMemo(() => buildSerpentinePath(keyframes.length), [keyframes.length]);

  useEffect(() => {
    if (pathRef.current) {
      setPathLength(pathRef.current.getTotalLength());
    }
  }, [pathD]);

  const handleMouseEnter = useCallback((page: number) => setHoveredPage(page), []);
  const handleMouseLeave = useCallback(() => setHoveredPage(null), []);

  if (isLoading) {
    return (
      <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-8 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-bark-400">Loading story...</span>
        </div>
      </div>
    );
  }

  if (!keyframes.length) return null;

  return (
    <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-6 shadow-sm">
      {/* Flowchart */}
      <div
        className="relative mx-auto overflow-x-auto"
        style={{ maxWidth: containerWidth + 32 }}
      >
        <div
          className="relative mx-auto"
          style={{ width: containerWidth, height: containerHeight }}
        >
          {/* SVG connector path */}
          <svg
            className="absolute inset-0 pointer-events-none"
            width={containerWidth}
            height={containerHeight}
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          >
            {/* Background path (static) */}
            <path
              d={pathD}
              fill="none"
              stroke="var(--color-bark-100)"
              strokeWidth="2"
              strokeLinecap="round"
            />
            {/* Animated drawn path */}
            {pathLength > 0 && (
              <path
                ref={pathRef}
                d={pathD}
                fill="none"
                stroke="var(--color-sage-300)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={pathLength}
                style={{
                  animation: `path-draw 1.5s ease-out forwards`,
                  ["--path-length" as string]: pathLength,
                }}
              />
            )}
            {/* Initial ref measurement path (hidden after measurement) */}
            {pathLength === 0 && (
              <path
                ref={pathRef}
                d={pathD}
                fill="none"
                stroke="transparent"
                strokeWidth="2"
              />
            )}
            {/* Flowing dots overlay */}
            {pathLength > 0 && (
              <path
                d={pathD}
                fill="none"
                stroke="var(--color-sage-400)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray="4 20"
                style={{
                  animation: `path-flow 1.2s linear infinite`,
                  animationDelay: "1.5s",
                  opacity: 0.5,
                }}
              />
            )}
          </svg>

          {/* Node cards */}
          {keyframes.map((kf, i) => {
            const pos = getNodePosition(i);
            const moodColor = getMoodColor(kf.mood);
            const isHovered = hoveredPage === kf.page_number;
            const isCover = kf.is_cover;

            return (
              <div
                key={kf.page_number}
                className="story-node-enter absolute"
                style={{
                  left: pos.x,
                  top: pos.y,
                  width: NODE_W,
                  height: NODE_H,
                  animationDelay: `${i * 80}ms`,
                }}
                onMouseEnter={() => handleMouseEnter(kf.page_number)}
                onMouseLeave={handleMouseLeave}
              >
                <div
                  className={`
                    relative h-full rounded-xl border px-3 py-2.5
                    transition-all duration-200 cursor-default
                    ${isCover
                      ? "border-amber-300 bg-amber-50/80"
                      : "border-bark-100 bg-white"
                    }
                    ${isHovered ? "shadow-lg -translate-y-1 border-bark-200" : "shadow-sm"}
                  `}
                >
                  {/* Page badge */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <div
                      className={`
                        w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0
                        ${isCover
                          ? "bg-amber-400 text-white"
                          : "bg-bark-100 text-bark-500"
                        }
                      `}
                    >
                      {isCover ? (
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                      ) : (
                        kf.page_number
                      )}
                    </div>

                    {/* Mood pill */}
                    <span
                      className={`
                        inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold leading-none
                        ${moodColor.bg} ${moodColor.text}
                      `}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${moodColor.dot}`} />
                      {kf.mood}
                    </span>
                  </div>

                  {/* Beat summary */}
                  <p className="text-[11px] font-semibold text-bark-700 leading-snug line-clamp-2">
                    {getBeatLabel(kf)}
                  </p>

                  {/* Weight indicator (future-ready) */}
                  <div className="absolute bottom-1.5 right-2">
                    <div className="w-4 h-0.5 rounded-full bg-bark-100" />
                  </div>
                </div>

                {/* Hover tooltip: first sentence of page_text */}
                {isHovered && (
                  <div
                    className="absolute left-1/2 -translate-x-1/2 z-20 w-56 p-3 rounded-lg bg-bark-800 text-white text-[11px] leading-relaxed shadow-xl tl-fade-in"
                    style={{ top: NODE_H + 8 }}
                  >
                    <p className="line-clamp-3">
                      {kf.page_text.split(/[.!?]/)[0].trim()}.
                    </p>
                    <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-bark-800" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Approve section */}
      <div className="mt-8 pt-6 border-t border-bark-100 text-center">
        <p className="text-xs text-bark-400 mb-4">
          Review your story flow. You can regenerate later if needed.
        </p>
        <button
          onClick={onApprove}
          disabled={approving}
          className={`
            inline-flex items-center gap-2 px-6 py-2.5 rounded-[var(--radius-btn)]
            font-bold text-sm transition-all duration-200
            ${approving
              ? "bg-bark-200 text-bark-400 cursor-not-allowed"
              : "bg-amber-400 text-amber-900 hover:bg-amber-500 hover:shadow-md active:scale-[0.98]"
            }
          `}
        >
          {approving ? (
            <>
              <div className="w-4 h-4 border-2 border-bark-400 border-t-transparent rounded-full animate-spin" />
              Finding characters...
            </>
          ) : (
            <>
              Looks Good — Find My Characters
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
