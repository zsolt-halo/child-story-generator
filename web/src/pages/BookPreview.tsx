import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getStory } from "../api/client";

export function BookPreview() {
  const { slug } = useParams<{ slug: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ["story", slug],
    queryFn: () => getStory(slug!),
    enabled: !!slug,
  });

  if (isLoading) {
    return <div className="animate-pulse"><div className="h-8 bg-bark-100 rounded w-48" /></div>;
  }

  if (!data) {
    return <p className="text-bark-400">Story not found.</p>;
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-bark-800">{data.story.title}</h1>
          <p className="text-sm text-bark-400 mt-0.5">Book Preview & Downloads</p>
        </div>
        <div className="flex gap-2">
          <Link
            to={`/stories/${slug}/storyboard`}
            className="px-4 py-2 text-xs font-medium text-bark-600 bg-white border border-bark-200 hover:bg-bark-50 rounded-[var(--radius-btn)] transition-colors"
          >
            Storyboard
          </Link>
          <Link
            to={`/stories/${slug}/review`}
            className="px-4 py-2 text-xs font-medium text-bark-600 bg-white border border-bark-200 hover:bg-bark-50 rounded-[var(--radius-btn)] transition-colors"
          >
            Review
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* PDF Preview / Spread viewer */}
        <div className="lg:col-span-2">
          {data.has_spread_pdf ? (
            <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 shadow-sm overflow-hidden">
              <iframe
                src={`/api/stories/${slug}/pdf/spreads`}
                className="w-full aspect-[16/10] border-0"
                title="Book Spreads Preview"
              />
            </div>
          ) : data.has_pdf ? (
            <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 shadow-sm overflow-hidden">
              <iframe
                src={`/api/stories/${slug}/pdf/screen`}
                className="w-full aspect-[3/4] border-0"
                title="Book PDF Preview"
              />
            </div>
          ) : (
            <div className="aspect-[3/4] bg-bark-100 rounded-[var(--radius-card)] flex items-center justify-center">
              <div className="text-center">
                <p className="text-bark-400 text-sm mb-2">No PDF generated yet</p>
                <p className="text-bark-300 text-xs">Go to Review and click "Render PDF"</p>
              </div>
            </div>
          )}
        </div>

        {/* Downloads */}
        <div className="space-y-4">
          <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-5 shadow-sm">
            <h2 className="font-bold text-bark-700 mb-4">Downloads</h2>
            <div className="space-y-3">
              {data.has_pdf && (
                <DownloadLink
                  href={`/api/stories/${slug}/pdf/print`}
                  label="Print PDF"
                  description="300 DPI, 8.25x8.25 with bleed"
                  icon="🖨️"
                />
              )}
              {data.has_screen_pdf && (
                <DownloadLink
                  href={`/api/stories/${slug}/pdf/screen`}
                  label="Screen PDF"
                  description="120 DPI, optimized for sharing"
                  icon="📱"
                />
              )}
              {data.has_spread_pdf && (
                <DownloadLink
                  href={`/api/stories/${slug}/pdf/spreads`}
                  label="Spreads PDF"
                  description="Landscape view, how the book looks open"
                  icon="📖"
                />
              )}
              {!data.has_pdf && !data.has_screen_pdf && !data.has_spread_pdf && (
                <p className="text-sm text-bark-400">No PDFs available yet. Generate them from the Review page.</p>
              )}
            </div>
          </div>

          {/* Story info */}
          <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-5 shadow-sm">
            <h2 className="font-bold text-bark-700 mb-3">Story Info</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-bark-400">Pages</dt>
                <dd className="text-bark-700 font-medium">{data.story.keyframes.length}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-bark-400">Images</dt>
                <dd className="text-bark-700 font-medium">{Object.keys(data.image_urls).length}</dd>
              </div>
              {data.story.title_translated && (
                <div className="flex justify-between">
                  <dt className="text-bark-400">Translated</dt>
                  <dd className="text-bark-700 font-medium truncate ml-4">{data.story.title_translated}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}

function DownloadLink({ href, label, description, icon }: {
  href: string;
  label: string;
  description: string;
  icon: string;
}) {
  return (
    <a
      href={href}
      download
      className="flex items-center gap-3 p-3 rounded-xl bg-cream hover:bg-cream-dark transition-colors group"
    >
      <span className="text-xl">{icon}</span>
      <div>
        <div className="text-sm font-semibold text-bark-700 group-hover:text-amber-700 transition-colors">{label}</div>
        <div className="text-[10px] text-bark-400">{description}</div>
      </div>
      <svg className="w-4 h-4 ml-auto text-bark-300 group-hover:text-amber-500 transition-colors" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
      </svg>
    </a>
  );
}
