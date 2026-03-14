import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getStory, getWorkerStatus } from "../api/client";
import { usePipelineStore } from "../stores/pipelineStore";
import { FadeImage } from "./FadeImage";
import type { Keyframe } from "../api/types";

/* ─── Helpers ─── */

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

/* ─── Sparkle SVG — tiny star that floats ─── */
function Sparkle({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
      <path d="M6 0l1.5 4.5L12 6l-4.5 1.5L6 12 4.5 7.5 0 6l4.5-1.5z" />
    </svg>
  );
}

/* ─── Wand icon ─── */
function WandIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 4V2m0 2v2m0-2h2m-2 0h-2" />
      <path d="M8.5 8.5l-6 6a1.414 1.414 0 000 2l1 1a1.414 1.414 0 002 0l6-6" />
      <path d="M11.5 5.5l7 7" />
      <path d="M20 2l-2 2" />
      <path d="M19.5 8.5l1.5-1.5" />
      <path d="M15.5 4.5l1.5-1.5" />
    </svg>
  );
}

/* ─── Page tile ─── */
function PageTile({
  keyframe,
  imageUrl,
  videoUrl,
  isComplete,
  index,
  totalComplete,
}: {
  keyframe: Keyframe;
  imageUrl: string | null;
  videoUrl: string | null;
  isComplete: boolean;
  index: number;
  totalComplete: number;
}) {
  const [videoLoaded, setVideoLoaded] = useState(false);

  // Stagger entry delay based on index (initial render)
  const entryDelay = `${index * 40}ms`;

  const label = keyframe.is_cover
    ? "Cover"
    : `Page ${keyframe.page_number}`;

  const shortText = keyframe.page_text_translated || keyframe.page_text;
  const truncated = shortText.length > 50 ? shortText.slice(0, 50) + "\u2026" : shortText;

  return (
    <div
      className="anim-tile-enter relative group"
      style={{ animationDelay: entryDelay }}
    >
      <div
        className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-all duration-700 ${
          isComplete
            ? "border-sage-300 shadow-md"
            : "border-bark-100"
        }`}
      >
        {/* Static image base layer */}
        {imageUrl && (
          <FadeImage
            src={imageUrl}
            thumbWidth={400}
            alt={label}
            className={`absolute inset-0 w-full h-full object-cover transition-all duration-1000 ${
              isComplete ? "scale-105 blur-[1px]" : ""
            }`}
          />
        )}

        {/* No image placeholder */}
        {!imageUrl && (
          <div className="absolute inset-0 bg-bark-100 flex items-center justify-center">
            <span className="text-bark-300 text-xs">{label}</span>
          </div>
        )}

        {/* Video overlay — fades in when complete */}
        {isComplete && videoUrl && (
          <video
            key={videoUrl}
            src={videoUrl}
            autoPlay
            muted
            loop
            playsInline
            onLoadedData={() => setVideoLoaded(true)}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${
              videoLoaded ? "opacity-100" : "opacity-0"
            }`}
          />
        )}

        {/* Completion shimmer overlay */}
        {isComplete && (
          <div className="absolute inset-0 anim-shimmer-once pointer-events-none" />
        )}

        {/* Pre-complete: dim overlay with waiting indicator */}
        {!isComplete && imageUrl && (
          <div className="absolute inset-0 bg-bark-900/10 flex items-center justify-center">
            <div className="w-6 h-6 rounded-full bg-white/80 backdrop-blur-sm flex items-center justify-center">
              <div className="w-2.5 h-2.5 rounded-full bg-bark-300" />
            </div>
          </div>
        )}

        {/* Label badge */}
        <div className={`absolute bottom-1.5 left-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold backdrop-blur-sm transition-colors duration-500 ${
          isComplete
            ? "bg-sage-500/90 text-white"
            : "bg-white/70 text-bark-500"
        }`}>
          {label}
        </div>

        {/* Animated sparkle on completion */}
        {isComplete && (
          <Sparkle
            className="absolute top-2 right-2 text-starlight anim-sparkle-pop"
            style={{ animationDelay: `${(totalComplete - 1) * 100}ms` }}
          />
        )}
      </div>

      {/* Page text preview on hover */}
      <div className="absolute -bottom-1 left-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-10">
        <div className="bg-bark-800/90 backdrop-blur-sm text-white text-[10px] leading-tight p-2 rounded-lg mx-1 mt-2 shadow-lg">
          {truncated}
        </div>
      </div>
    </div>
  );
}

/* ─── Main Component ─── */

export function AnimationProgress({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const {
    videos,
    videoProgress,
    videoTotal,
    phaseMessage,
    phaseStartTime,
    completed,
    failed,
    error,
    queuePosition,
    queueAhead,
    resultSlug,
  } = usePipelineStore();

  // Fetch story data for keyframes and image URLs
  const { data: storyDetail } = useQuery({
    queryKey: ["story", slug],
    queryFn: () => getStory(slug),
    staleTime: 30_000,
  });

  // Worker status (poll every 15s during queue wait)
  const isQueued = queuePosition > 0;
  const { data: workerStatus } = useQuery({
    queryKey: ["workerStatus"],
    queryFn: getWorkerStatus,
    refetchInterval: isQueued ? 15_000 : false,
    enabled: isQueued,
  });

  // Live elapsed timer
  const [liveElapsed, setLiveElapsed] = useState(0);
  useEffect(() => {
    if (!phaseStartTime || completed || failed) {
      setLiveElapsed(0);
      return;
    }
    setLiveElapsed(Math.floor((Date.now() - phaseStartTime) / 1000));
    const interval = setInterval(() => {
      setLiveElapsed(Math.floor((Date.now() - phaseStartTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [phaseStartTime, completed, failed]);

  // Map completed videos by page number
  const videoByPage = useMemo(() => {
    const map: Record<number, string> = {};
    for (const v of videos) {
      map[v.page] = v.url;
    }
    return map;
  }, [videos]);

  // Estimate remaining time (rough: ~3min per page)
  const avgPerPage = useMemo(() => {
    if (videoProgress < 2 || liveElapsed < 30) return 180; // default 3 min
    return liveElapsed / videoProgress;
  }, [videoProgress, liveElapsed]);

  const remaining = useMemo(() => {
    if (videoTotal <= 0 || completed) return 0;
    const left = videoTotal - videoProgress;
    return Math.round(left * avgPerPage);
  }, [videoTotal, videoProgress, avgPerPage, completed]);

  // Navigate to workspace on completion
  useEffect(() => {
    if (completed && resultSlug) {
      const timer = setTimeout(() => {
        navigate(`/stories/${resultSlug}?tab=pages`);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [completed, resultSlug, navigate]);

  const keyframes = storyDetail?.story.keyframes ?? [];
  const imageUrls = storyDetail?.image_urls ?? {};
  const total = videoTotal || keyframes.length;
  const progressPct = total > 0 ? Math.round((videoProgress / total) * 100) : 0;

  // Sort keyframes: cover first, then by page number
  const sortedKeyframes = useMemo(() => {
    return [...keyframes].sort((a, b) => {
      if (a.is_cover !== b.is_cover) return a.is_cover ? -1 : 1;
      return a.page_number - b.page_number;
    });
  }, [keyframes]);

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 mb-3">
          <WandIcon className={`w-6 h-6 text-sage-500 ${!completed && !failed ? "anim-wand-wave" : ""}`} />
          <h1 className="text-2xl font-extrabold text-bark-800">
            {isQueued
              ? "Waiting for the Magic Stage"
              : completed
                ? "Your Book Has Come Alive!"
                : failed
                  ? "Animation Interrupted"
                  : "Bringing Your Pages to Life"}
          </h1>
        </div>
        <p className="text-sm text-bark-400">
          {isQueued
            ? "The animation studio is busy \u2014 your book is next in line"
            : completed
              ? "Every page is now a moving scene"
              : failed
                ? error || "Something went wrong during animation"
                : phaseMessage || "Each illustration is becoming a short animated clip"}
        </p>
      </div>

      {/* Queue waiting state */}
      {isQueued && (
        <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-10 shadow-sm text-center mb-6 anim-tile-enter">
          <div className="queue-float inline-block mb-5">
            <div className="w-20 h-20 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto border border-amber-200">
              <svg className="w-10 h-10 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-.112-2.244l.037-.002c.576-.066 1.07-.465 1.21-1.029A9 9 0 019.75 6.75a3 3 0 016 0v.008c.028.015.283.165.614.575a9 9 0 013.34 9.403c.139.563.633.963 1.21 1.029l.036.002a1.125 1.125 0 01-.112 2.244m-17.25-.001h17.25" />
              </svg>
            </div>
          </div>
          <div className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-amber-50 border border-amber-200 mb-4">
            <span className="text-3xl font-extrabold text-amber-600 tabular-nums font-heading">{queueAhead}</span>
            <span className="text-sm text-amber-700 font-medium">
              {queueAhead === 1 ? "book ahead" : "books ahead"}
            </span>
          </div>
          <p className="text-bark-500 text-sm leading-relaxed max-w-sm mx-auto mb-5">
            {workerStatus?.available === false
              ? "The GPU worker is currently offline. Animation will begin when it reconnects."
              : "Another book is being animated right now. Yours will begin automatically."}
          </p>
          <div className="flex items-center justify-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-amber-400 queue-dot-1" />
            <div className="w-2 h-2 rounded-full bg-amber-400 queue-dot-2" />
            <div className="w-2 h-2 rounded-full bg-amber-400 queue-dot-3" />
          </div>
        </div>
      )}

      {/* Progress bar + stats */}
      {!isQueued && (
        <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-5 shadow-sm mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold text-bark-700">
                {completed ? "All done!" : `${videoProgress} of ${total} pages`}
              </span>
              {!completed && !failed && videoProgress > 0 && remaining > 0 && (
                <span className="text-xs text-bark-300 tabular-nums">
                  ~{formatTime(remaining)} remaining
                </span>
              )}
            </div>
            <span className="text-sm font-extrabold text-sage-600 tabular-nums">{progressPct}%</span>
          </div>
          <div className="h-2.5 bg-bark-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ease-out ${
                completed ? "bg-sage-500" : "bg-sage-400"
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          {!completed && !failed && liveElapsed > 0 && (
            <div className="flex items-center justify-between mt-2">
              <span className="text-[10px] text-bark-300 tabular-nums">
                Elapsed: {formatTime(liveElapsed)}
              </span>
              {videoProgress > 0 && (
                <span className="text-[10px] text-bark-300 tabular-nums">
                  ~{formatTime(Math.round(avgPerPage))} per page
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Page grid */}
      {!isQueued && sortedKeyframes.length > 0 && (
        <div className="grid grid-cols-4 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-4 gap-3">
          {sortedKeyframes.map((kf, i) => (
            <PageTile
              key={kf.page_number}
              keyframe={kf}
              imageUrl={imageUrls[kf.page_number] ?? null}
              videoUrl={videoByPage[kf.page_number] ?? null}
              isComplete={!!videoByPage[kf.page_number]}
              index={i}
              totalComplete={videoProgress}
            />
          ))}
        </div>
      )}

      {/* Completion celebration */}
      {completed && (
        <div className="mt-8 text-center anim-tile-enter">
          <div className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-sage-50 border border-sage-200">
            <Sparkle className="text-sage-500 anim-sparkle-pop" />
            <span className="text-sm font-semibold text-sage-700">
              {storyDetail?.story.title ?? "Your story"} is now animated
            </span>
            <Sparkle className="text-sage-500 anim-sparkle-pop" style={{ animationDelay: "200ms" }} />
          </div>
          <p className="text-xs text-bark-400 mt-3">Redirecting to your story...</p>
        </div>
      )}

      {/* Error state */}
      {failed && error && (
        <div className="mt-6 bg-red-50 border border-red-200 rounded-[var(--radius-card)] p-5 text-sm text-red-700">
          <h3 className="font-bold mb-1">Animation Failed</h3>
          <p>{error}</p>
        </div>
      )}
    </div>
  );
}
