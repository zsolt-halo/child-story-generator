import { Link } from "react-router-dom";
import type { StoryListItem } from "../api/types";

export function StoryCard({ story }: { story: StoryListItem }) {
  const linkTo = story.has_images
    ? `/stories/${story.slug}/review`
    : `/stories/${story.slug}/storyboard`;

  return (
    <Link
      to={linkTo}
      className="group block bg-white rounded-[var(--radius-card)] shadow-sm hover:shadow-md transition-all border border-bark-100 overflow-hidden"
    >
      {/* Cover image */}
      <div className="aspect-square bg-cream-dark relative overflow-hidden">
        {story.cover_url ? (
          <img
            src={story.cover_url}
            alt={story.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-16 h-16 text-bark-200" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
            </svg>
          </div>
        )}
        {/* Status badges */}
        <div className="absolute top-2 right-2 flex gap-1.5">
          {story.has_images && (
            <span className="px-2 py-0.5 bg-sage-500/90 text-white text-[10px] font-semibold rounded-full backdrop-blur-sm">
              Illustrated
            </span>
          )}
          {story.has_pdf && (
            <span className="px-2 py-0.5 bg-amber-500/90 text-white text-[10px] font-semibold rounded-full backdrop-blur-sm">
              PDF
            </span>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="p-4">
        <h3 className="font-bold text-bark-800 truncate group-hover:text-amber-700 transition-colors">
          {story.title}
        </h3>
        {story.title_translated && (
          <p className="text-xs text-bark-400 mt-0.5 truncate">{story.title_translated}</p>
        )}
        <p className="text-xs text-bark-400 mt-2">
          {story.page_count} pages
          {story.parent_slug && (
            <span className="ml-2 text-bark-300">
              branch of {story.parent_slug}
            </span>
          )}
        </p>
      </div>
    </Link>
  );
}
