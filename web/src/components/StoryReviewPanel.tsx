import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getStory, updateStory } from "../api/client";
import type { Keyframe } from "../api/types";

interface StoryReviewPanelProps {
  slug: string;
  onApprove: () => void;
  approving?: boolean;
  hideApproveButton?: boolean;
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
  const words = kf.page_text.split(/\s+/).slice(0, 5).join(" ");
  return words + (kf.page_text.split(/\s+/).length > 5 ? "\u2026" : "");
}

/* ─── Serpentine ordering ─── */

const COLS = 4;

/** Returns keyframe indices reordered for serpentine grid display (odd rows reversed). */
function getSerpentineOrder(count: number): number[] {
  const order: number[] = [];
  const rows = Math.ceil(count / COLS);
  for (let r = 0; r < rows; r++) {
    const start = r * COLS;
    const end = Math.min(start + COLS, count);
    const rowIndices = Array.from({ length: end - start }, (_, i) => start + i);
    if (r % 2 === 1) rowIndices.reverse();
    order.push(...rowIndices);
  }
  return order;
}

/* ─── SVG path builder ─── */

function buildPathFromPoints(points: { x: number; y: number }[]): string {
  if (points.length < 2) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (Math.abs(prev.y - curr.y) < 10) {
      // Same row: gentle arc
      const midX = (prev.x + curr.x) / 2;
      d += ` Q ${midX} ${prev.y - 16}, ${curr.x} ${curr.y}`;
    } else {
      // Row transition: S-curve
      const midY = (prev.y + curr.y) / 2;
      d += ` C ${prev.x} ${midY}, ${curr.x} ${midY}, ${curr.x} ${curr.y}`;
    }
  }
  return d;
}

/* ─── Component ─── */

export function StoryReviewPanel({ slug, onApprove, approving, hideApproveButton }: StoryReviewPanelProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["story", slug],
    queryFn: () => getStory(slug),
  });

  const gridRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const measuringPathRef = useRef<SVGPathElement>(null);
  const [svgState, setSvgState] = useState<{
    d: string; width: number; height: number; length: number;
  } | null>(null);
  const [hoveredPage, setHoveredPage] = useState<number | null>(null);

  // Title editing
  const [editedTitle, setEditedTitle] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const originalTitle = data?.story.title ?? "";
  const currentTitle = editedTitle ?? originalTitle;
  const titleChanged = editedTitle !== null && editedTitle !== originalTitle;

  // Sync original title once loaded
  useEffect(() => {
    if (data?.story.title && editedTitle === null) {
      setEditedTitle(null); // keep using original
    }
  }, [data?.story.title, editedTitle]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  const handleTitleApprove = useCallback(async () => {
    // Save title if changed, then delegate to parent
    if (titleChanged) {
      await updateStory(slug, { title: editedTitle });
    }
    onApprove();
  }, [titleChanged, slug, editedTitle, onApprove]);

  const keyframes = data?.story.keyframes ?? [];
  const displayOrder = useMemo(() => getSerpentineOrder(keyframes.length), [keyframes.length]);

  // Measure grid node positions → build SVG path
  const measureAndBuildPath = useCallback(() => {
    const grid = gridRef.current;
    if (!grid || keyframes.length < 2) return;

    const gridRect = grid.getBoundingClientRect();
    // Collect centers in story order (index 0, 1, 2, ...)
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i < keyframes.length; i++) {
      const el = nodeRefs.current.get(i);
      if (!el) return; // not all mounted yet
      const r = el.getBoundingClientRect();
      points.push({
        x: r.left + r.width / 2 - gridRect.left,
        y: r.top + r.height / 2 - gridRect.top,
      });
    }

    const d = buildPathFromPoints(points);
    setSvgState({ d, width: gridRect.width, height: gridRect.height, length: 0 });
  }, [keyframes.length]);

  // Measure on mount + resize
  useEffect(() => {
    measureAndBuildPath();
    const ro = new ResizeObserver(() => measureAndBuildPath());
    if (gridRef.current) ro.observe(gridRef.current);
    return () => ro.disconnect();
  }, [measureAndBuildPath]);

  // Measure path length once SVG path renders
  useEffect(() => {
    if (measuringPathRef.current && svgState && svgState.length === 0) {
      const len = measuringPathRef.current.getTotalLength();
      setSvgState((prev) => prev ? { ...prev, length: len } : null);
    }
  }, [svgState]);

  const setNodeRef = useCallback((idx: number, el: HTMLDivElement | null) => {
    if (el) nodeRefs.current.set(idx, el);
    else nodeRefs.current.delete(idx);
  }, []);

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
      {/* Editable title */}
      <div className="mb-6 pb-5 border-b border-bark-100">
        <label className="text-[10px] font-bold uppercase tracking-wider text-bark-400 mb-1.5 block">
          Book Title
        </label>
        {editingTitle ? (
          <div className="flex items-center gap-2">
            <input
              ref={titleInputRef}
              type="text"
              value={currentTitle}
              onChange={(e) => setEditedTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setEditingTitle(false);
                if (e.key === "Escape") {
                  setEditedTitle(null);
                  setEditingTitle(false);
                }
              }}
              onBlur={() => setEditingTitle(false)}
              className="flex-1 text-xl font-extrabold text-bark-800 font-heading bg-transparent border-b-2 border-amber-400 outline-none py-0.5 px-0"
            />
          </div>
        ) : (
          <button
            onClick={() => {
              if (editedTitle === null) setEditedTitle(originalTitle);
              setEditingTitle(true);
            }}
            className="group flex items-center gap-2 text-left w-full"
          >
            <h2 className={`text-xl font-extrabold font-heading ${titleChanged ? "text-amber-600" : "text-bark-800"}`}>
              {currentTitle}
            </h2>
            <svg
              className="w-4 h-4 text-bark-300 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
            </svg>
            {titleChanged && (
              <span className="text-[10px] font-semibold text-amber-500 bg-amber-50 px-1.5 py-0.5 rounded-full">
                edited
              </span>
            )}
          </button>
        )}
        <p className="text-[11px] text-bark-400 mt-1.5">
          Click to edit — this will appear on the cover.
        </p>
      </div>

      {/* Grid with SVG overlay */}
      <div className="relative">
        {/* SVG connector path (behind nodes) */}
        {svgState && (
          <svg
            className="absolute inset-0 pointer-events-none"
            width={svgState.width}
            height={svgState.height}
            style={{ overflow: "visible" }}
          >
            {/* Static background line */}
            <path
              d={svgState.d}
              fill="none"
              stroke="var(--color-bark-100)"
              strokeWidth="2"
              strokeLinecap="round"
            />
            {/* Animated draw-in */}
            {svgState.length > 0 && (
              <path
                d={svgState.d}
                fill="none"
                stroke="var(--color-sage-300)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={svgState.length}
                style={{
                  animation: "path-draw 1.5s ease-out forwards",
                  ["--path-length" as string]: svgState.length,
                }}
              />
            )}
            {/* Measuring path (invisible, for getTotalLength) */}
            {svgState.length === 0 && (
              <path
                ref={measuringPathRef}
                d={svgState.d}
                fill="none"
                stroke="transparent"
                strokeWidth="2"
              />
            )}
            {/* Flowing dots */}
            {svgState.length > 0 && (
              <path
                d={svgState.d}
                fill="none"
                stroke="var(--color-sage-400)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray="4 20"
                style={{
                  animation: "path-flow 1.2s linear infinite",
                  animationDelay: "1.5s",
                  opacity: 0.5,
                }}
              />
            )}
          </svg>
        )}

        {/* Node grid */}
        <div
          ref={gridRef}
          className="grid gap-4"
          style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}
        >
          {displayOrder.map((storyIdx, displayIdx) => {
            const kf = keyframes[storyIdx];
            if (!kf) return null;
            const moodColor = getMoodColor(kf.mood);
            const isHovered = hoveredPage === kf.page_number;
            const isCover = kf.is_cover;

            return (
              <div
                key={kf.page_number}
                ref={(el) => setNodeRef(storyIdx, el)}
                className="story-node-enter relative z-10"
                style={{ animationDelay: `${displayIdx * 60}ms` }}
                onMouseEnter={() => handleMouseEnter(kf.page_number)}
                onMouseLeave={handleMouseLeave}
              >
                <div
                  className={`
                    relative rounded-xl border px-3 py-2.5
                    transition-all duration-200 cursor-default
                    ${isCover
                      ? "border-amber-300 bg-amber-50/80"
                      : "border-bark-100 bg-white"
                    }
                    ${isHovered ? "shadow-lg -translate-y-1 border-bark-200" : "shadow-sm"}
                  `}
                >
                  {/* Page badge + mood */}
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <div
                      className={`
                        w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0
                        ${isCover ? "bg-amber-400 text-white" : "bg-bark-100 text-bark-500"}
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

                    <span
                      className={`
                        inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold leading-none truncate
                        ${moodColor.bg} ${moodColor.text}
                      `}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${moodColor.dot}`} />
                      <span className="truncate">{kf.mood}</span>
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

                {/* Hover tooltip */}
                {isHovered && (
                  <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 z-50 w-56 p-3 rounded-lg bg-bark-800 text-white text-[11px] leading-relaxed shadow-xl tl-fade-in pointer-events-none">
                    <p className="line-clamp-3">
                      {kf.page_text.split(/[.!?]/)[0].trim()}.
                    </p>
                    <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-bark-800" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Approve section */}
      {!hideApproveButton && <div className="mt-8 pt-6 border-t border-bark-100 text-center">
        <p className="text-xs text-bark-400 mb-4">
          Review your story flow. You can regenerate later if needed.
        </p>
        <button
          onClick={handleTitleApprove}
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
      </div>}
    </div>
  );
}
