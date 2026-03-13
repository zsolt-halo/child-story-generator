import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getStory } from "../api/client";
import type { StoryDetail, Keyframe } from "../api/types";

const AUTO_PLAY_INTERVAL = 8000;

export function ReadAlong() {
  const { slug } = useParams<{ slug: string }>();
  const { data, isLoading } = useQuery({
    queryKey: ["story", slug],
    queryFn: () => getStory(slug!),
    enabled: !!slug,
  });

  const [currentPage, setCurrentPage] = useState(0); // 0 = cover, 1 = dedication, 2+ = pages
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Total pages: cover + dedication + keyframes (minus cover keyframe)
  const contentKeyframes = data?.story.keyframes.filter((kf) => !kf.is_cover) ?? [];
  const totalPages = data ? 2 + contentKeyframes.length : 0; // cover + dedication + content pages

  const goTo = useCallback(
    (page: number) => {
      setCurrentPage(Math.max(0, Math.min(page, totalPages - 1)));
    },
    [totalPages],
  );

  const goNext = useCallback(() => goTo(currentPage + 1), [currentPage, goTo]);
  const goPrev = useCallback(() => goTo(currentPage - 1), [currentPage, goTo]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        goNext();
        setIsAutoPlaying(false);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
        setIsAutoPlaying(false);
      } else if (e.key === "Escape" && isFullscreen) {
        document.exitFullscreen?.();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goNext, goPrev, isFullscreen]);

  // Auto-play
  useEffect(() => {
    if (!isAutoPlaying) return;
    const id = setInterval(() => {
      setCurrentPage((p) => {
        if (p >= totalPages - 1) {
          setIsAutoPlaying(false);
          return p;
        }
        return p + 1;
      });
    }, AUTO_PLAY_INTERVAL);
    return () => clearInterval(id);
  }, [isAutoPlaying, totalPages]);

  // Auto-hide controls
  useEffect(() => {
    const show = () => {
      setControlsVisible(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
    };
    window.addEventListener("mousemove", show);
    window.addEventListener("touchstart", show);
    show();
    return () => {
      window.removeEventListener("mousemove", show);
      window.removeEventListener("touchstart", show);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  // Fullscreen sync
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current?.requestFullscreen();
    }
  };

  // Touch swipe
  const touchStartX = useRef(0);
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > 50) {
      if (dx < 0) goNext();
      else goPrev();
      setIsAutoPlaying(false);
    }
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-neutral-950 flex items-center justify-center">
        <div className="w-16 h-16 border-4 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="fixed inset-0 bg-neutral-950 flex items-center justify-center">
        <p className="text-neutral-400">Story not found.</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 bg-neutral-950 flex flex-col select-none overflow-hidden"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Vignette overlay */}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.6) 100%)",
        }}
      />

      {/* Grain texture */}
      <div
        className="pointer-events-none absolute inset-0 z-10 opacity-[0.03]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        }}
      />

      {/* Top controls bar */}
      <div
        className={`relative z-30 transition-opacity duration-500 ${controlsVisible ? "opacity-100" : "opacity-0"}`}
      >
        <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/60 to-transparent">
          <Link
            to={`/stories/${slug}?tab=illustrations`}
            className="flex items-center gap-2 text-sm text-neutral-300 hover:text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Back
          </Link>

          <h1 className="text-sm font-medium text-neutral-300 truncate max-w-[40%]">
            {data.story.title}
          </h1>

          <div className="flex items-center gap-2">
            {/* Auto-play toggle */}
            <button
              onClick={() => setIsAutoPlaying(!isAutoPlaying)}
              className={`p-2 rounded-full transition-colors ${isAutoPlaying ? "bg-amber-500/30 text-amber-400" : "text-neutral-400 hover:text-white"}`}
              title={isAutoPlaying ? "Pause auto-play" : "Start auto-play"}
            >
              {isAutoPlaying ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z" />
                </svg>
              )}
            </button>

            {/* Fullscreen toggle */}
            <button
              onClick={toggleFullscreen}
              className="p-2 text-neutral-400 hover:text-white transition-colors"
              title="Toggle fullscreen"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                {isFullscreen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Main content area */}
      <div className="relative z-20 flex-1 flex items-center justify-center px-4 md:px-8 pb-16">
        <div className="w-full max-w-6xl aspect-[2/1] max-h-[80vh] relative">
          {currentPage === 0 && <CoverSpread data={data} />}
          {currentPage === 1 && <DedicationSpread data={data} />}
          {currentPage >= 2 && (
            <ContentSpread
              data={data}
              keyframe={contentKeyframes[currentPage - 2]}
            />
          )}
        </div>
      </div>

      {/* Navigation arrows */}
      <div
        className={`absolute inset-y-0 left-0 right-0 z-20 flex items-center justify-between px-2 md:px-4 pointer-events-none transition-opacity duration-500 ${controlsVisible ? "opacity-100" : "opacity-0"}`}
      >
        <button
          onClick={() => { goPrev(); setIsAutoPlaying(false); }}
          disabled={currentPage === 0}
          className="pointer-events-auto p-3 rounded-full bg-black/30 backdrop-blur-sm text-white/70 hover:text-white hover:bg-black/50 disabled:opacity-0 transition-all"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <button
          onClick={() => { goNext(); setIsAutoPlaying(false); }}
          disabled={currentPage >= totalPages - 1}
          className="pointer-events-auto p-3 rounded-full bg-black/30 backdrop-blur-sm text-white/70 hover:text-white hover:bg-black/50 disabled:opacity-0 transition-all"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      </div>

      {/* Page dots */}
      <div
        className={`absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 transition-opacity duration-500 ${controlsVisible ? "opacity-100" : "opacity-0"}`}
      >
        {Array.from({ length: totalPages }).map((_, i) => (
          <button
            key={i}
            onClick={() => { goTo(i); setIsAutoPlaying(false); }}
            className={`rounded-full transition-all duration-300 ${
              i === currentPage
                ? "w-6 h-2 bg-amber-400"
                : "w-2 h-2 bg-neutral-600 hover:bg-neutral-400"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

/* ---------- Spread components ---------- */

function CoverSpread({ data }: { data: StoryDetail }) {
  const coverKf = data.story.keyframes.find((kf) => kf.is_cover);
  const coverPage = coverKf?.page_number;
  const videoUrl = coverPage !== undefined ? data.video_urls[coverPage] : undefined;
  const imageUrl = coverPage !== undefined ? data.image_urls[coverPage] : undefined;

  return (
    <div className="w-full h-full rounded-lg overflow-hidden shadow-2xl shadow-amber-900/20 relative">
      <MediaElement videoUrl={videoUrl} imageUrl={imageUrl} className="w-full h-full object-cover" />
      {/* Title overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/20 flex flex-col items-center justify-end pb-12 px-8">
        <h2
          className="text-3xl md:text-5xl font-bold text-white text-center drop-shadow-lg"
          style={{ fontFamily: "var(--font-heading, 'Nunito', sans-serif)" }}
        >
          {data.story.title_translated || data.story.title}
        </h2>
        {data.story.title_translated && (
          <p className="text-base md:text-lg text-white/60 mt-2 italic">
            {data.story.title}
          </p>
        )}
      </div>
    </div>
  );
}

function DedicationSpread({ data }: { data: StoryDetail }) {
  const dedication = data.story.dedication_translated || data.story.dedication;
  return (
    <div className="w-full h-full rounded-lg overflow-hidden shadow-2xl shadow-amber-900/20 flex items-center justify-center" style={{ background: "#faf6f0" }}>
      <div className="text-center px-12 max-w-lg">
        <div className="w-12 h-px bg-amber-300/60 mx-auto mb-6" />
        <p
          className="text-xl md:text-2xl italic text-stone-600 leading-relaxed"
          style={{ fontFamily: "var(--font-story, Georgia, serif)" }}
        >
          {dedication || "For you, with love."}
        </p>
        <div className="w-12 h-px bg-amber-300/60 mx-auto mt-6" />
      </div>
    </div>
  );
}

function ContentSpread({ data, keyframe }: { data: StoryDetail; keyframe: Keyframe }) {
  const videoUrl = data.video_urls[keyframe.page_number];
  const imageUrl = data.image_urls[keyframe.page_number];

  return (
    <div className="w-full h-full rounded-lg overflow-hidden shadow-2xl shadow-amber-900/20 grid grid-cols-1 md:grid-cols-2">
      {/* Left: illustration / video */}
      <div className="bg-neutral-900 relative overflow-hidden">
        <MediaElement videoUrl={videoUrl} imageUrl={imageUrl} className="w-full h-full object-cover" />
      </div>

      {/* Right: text */}
      <div
        className="flex flex-col justify-center px-8 md:px-10 py-8 overflow-y-auto"
        style={{ background: "#faf6f0" }}
      >
        <p
          className="text-lg md:text-xl lg:text-2xl leading-relaxed text-stone-800 first-letter:text-4xl first-letter:font-[family-name:var(--font-heading)] first-letter:font-bold first-letter:float-left first-letter:mr-1.5 first-letter:mt-1 first-letter:text-bark-700"
          style={{ fontFamily: "var(--font-story, Georgia, serif)", lineHeight: 1.8 }}
        >
          {keyframe.page_text_translated || keyframe.page_text}
        </p>
        {keyframe.page_text_translated && (
          <>
            <div className="w-16 h-px bg-stone-300/50 my-5" />
            <p
              className="text-sm md:text-base italic text-stone-400 leading-relaxed"
              style={{ fontFamily: "var(--font-story, Georgia, serif)", lineHeight: 1.7 }}
            >
              {keyframe.page_text}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- Shared media element ---------- */

function MediaElement({
  videoUrl,
  imageUrl,
  className,
}: {
  videoUrl?: string;
  imageUrl?: string;
  className?: string;
}) {
  if (videoUrl) {
    return (
      <video
        key={videoUrl}
        src={videoUrl}
        autoPlay
        loop
        muted
        playsInline
        className={className}
      />
    );
  }
  if (imageUrl) {
    return <img src={imageUrl} alt="" className={className} />;
  }
  return (
    <div className={`bg-neutral-800 flex items-center justify-center ${className}`}>
      <svg className="w-16 h-16 text-neutral-600" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
      </svg>
    </div>
  );
}
