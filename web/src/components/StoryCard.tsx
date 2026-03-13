import { Link } from "react-router-dom";
import type { StoryListItem } from "../api/types";
import { FadeImage } from "./FadeImage";

export function StoryCard({ story, onDelete }: { story: StoryListItem; onDelete?: () => void }) {
  const isPaused = story.pipeline_status === "story_review" || story.pipeline_status === "cast_review";
  const linkTo = isPaused
    ? `/stories/${story.slug}/pipeline`
    : story.has_images
      ? `/stories/${story.slug}?tab=illustrations`
      : `/stories/${story.slug}?tab=pages`;

  return (
    <Link
      to={linkTo}
      className="group relative block rounded-[var(--radius-card)] shadow-sm hover:shadow-md hover:-translate-y-1 hover:rotate-[0.5deg] transition-all duration-200 border border-bark-100 overflow-hidden"
    >
      {/* Book spine shadow */}
      <div className="absolute inset-y-0 left-0 w-3 bg-gradient-to-r from-bark-200/40 to-transparent z-10 pointer-events-none" />

      {/* Cover image with title overlay */}
      <div className="aspect-[3/4] bg-cream-dark relative overflow-hidden">
        {story.cover_url ? (
          <FadeImage
            src={story.cover_url}
            thumbWidth={400}
            alt={story.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-b from-bark-100 to-cream-dark">
            <svg className="w-16 h-16 text-bark-200" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
            </svg>
          </div>
        )}

        {/* Delete button */}
        {onDelete && (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete();
            }}
            className="absolute top-2 left-4 w-8 h-8 rounded-full bg-bark-900/60 hover:bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all z-20"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
            </svg>
          </button>
        )}

        {/* Single status badge (top right) — only show the most important one */}
        <div className="absolute top-2 right-2 z-10">
          {isPaused ? (
            <span className="px-2.5 py-1 bg-amber-500/90 text-white text-[10px] font-semibold rounded-full backdrop-blur-sm animate-pulse">
              Resume
            </span>
          ) : story.has_images && !story.has_pdf ? (
            <span className="w-3 h-3 block rounded-full bg-sage-400 border-2 border-white shadow-sm" />
          ) : null}
        </div>

        {/* Title overlay at bottom of image */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-bark-900/80 via-bark-900/40 to-transparent pt-12 pb-3 px-4 z-10">
          <h3 className="font-[family-name:var(--font-story)] font-bold text-white text-sm leading-tight drop-shadow-md truncate">
            {story.is_auto && <span className="mr-1 text-amber-300" title="Auto-generated">&#x2726;</span>}
            {story.title}
          </h3>
          {story.title_translated && (
            <p className="text-[11px] text-white/70 mt-0.5 truncate">{story.title_translated}</p>
          )}
        </div>

        {/* Read-along quick link */}
        {(story.has_video || story.has_images) && (
          <Link
            to={`/stories/${story.slug}/read-along`}
            onClick={(e) => e.stopPropagation()}
            className="absolute top-2 right-2 p-1.5 rounded-full text-white/70 hover:text-white hover:bg-white/20 transition-colors opacity-0 group-hover:opacity-100 z-20"
            title="Read Along"
            style={{ right: isPaused || (story.has_images && !story.has_pdf) ? "2.5rem" : undefined }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.91 11.672a.375.375 0 0 1 0 .656l-5.603 3.113a.375.375 0 0 1-.557-.328V8.887c0-.286.307-.466.557-.327l5.603 3.112Z" />
            </svg>
          </Link>
        )}
      </div>
    </Link>
  );
}
