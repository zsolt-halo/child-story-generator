import { useParams, useSearchParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getStory } from "../api/client";
import { PagesTab } from "../components/workspace/PagesTab";
import { IllustrationsTab } from "../components/workspace/IllustrationsTab";
import { BookTab } from "../components/workspace/BookTab";
import { CastTab } from "../components/workspace/CastTab";

const TABS = [
  { key: "pages", label: "Pages", icon: PagesIcon },
  { key: "illustrations", label: "Illustrations", icon: IllustrationsIcon },
  { key: "book", label: "Book", icon: BookIcon },
  { key: "cast", label: "Cast", icon: CastIcon },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function StoryWorkspace() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["story", slug],
    queryFn: () => getStory(slug!),
    enabled: !!slug,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["story", slug] });

  // Determine active tab
  const requestedTab = searchParams.get("tab") as TabKey | null;
  const activeTab: TabKey = requestedTab && TABS.some((t) => t.key === requestedTab)
    ? requestedTab
    : data?.has_pdf
      ? "book"
      : Object.keys(data?.image_urls ?? {}).length > 0
        ? "illustrations"
        : "pages";

  const setTab = (tab: TabKey) => {
    setSearchParams({ tab }, { replace: true });
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-6 bg-bark-100 rounded w-64" />
        <div className="h-10 bg-bark-100 rounded w-96" />
        <div className="grid grid-cols-4 gap-4 mt-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-square bg-bark-100 rounded-[var(--radius-card)]" />
          ))}
        </div>
      </div>
    );
  }

  if (!data || !slug) {
    return <p className="text-bark-400">Story not found.</p>;
  }

  const hasImages = Object.keys(data.image_urls).length > 0;

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-1">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold text-bark-800 font-[family-name:var(--font-story)] truncate">
            {data.story.title}
          </h1>
          {data.story.title_translated && (
            <p className="text-sm text-bark-400 mt-0.5 truncate">{data.story.title_translated}</p>
          )}
          {data.story.dedication && (
            <p className="text-sm text-bark-500 mt-1 italic font-[family-name:var(--font-story)]">
              {data.story.dedication}
            </p>
          )}
        </div>
        <div className="flex gap-2 shrink-0 ml-4">
          {hasImages && (
            <Link
              to={`/stories/${slug}/read-along`}
              className="px-4 py-2 text-xs font-medium text-bark-600 bg-white border border-bark-200 hover:bg-bark-50 rounded-[var(--radius-btn)] transition-colors inline-flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.91 11.672a.375.375 0 0 1 0 .656l-5.603 3.113a.375.375 0 0 1-.557-.328V8.887c0-.286.307-.466.557-.327l5.603 3.112Z" />
              </svg>
              Read Along
            </Link>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-bark-200 -mx-1">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors relative mx-1 ${
                isActive
                  ? "text-bark-800"
                  : "text-bark-400 hover:text-bark-600"
              }`}
            >
              <tab.icon active={isActive} />
              {tab.label}
              {isActive && (
                <span className="absolute bottom-0 left-1 right-1 h-0.5 bg-sage-500 rounded-full" />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === "pages" && (
        <PagesTab slug={slug} data={data} invalidate={invalidate} />
      )}
      {activeTab === "illustrations" && (
        <IllustrationsTab slug={slug} data={data} invalidate={invalidate} />
      )}
      {activeTab === "book" && (
        <BookTab slug={slug} data={data} invalidate={invalidate} />
      )}
      {activeTab === "cast" && (
        <CastTab slug={slug} data={data} invalidate={invalidate} />
      )}
    </div>
  );
}

// ── Tab Icons ────────────────────────────────────────────────────────

function PagesIcon({ active }: { active: boolean }) {
  return (
    <svg className={`w-4 h-4 ${active ? "text-sage-600" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
  );
}

function IllustrationsIcon({ active }: { active: boolean }) {
  return (
    <svg className={`w-4 h-4 ${active ? "text-sage-600" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" />
    </svg>
  );
}

function BookIcon({ active }: { active: boolean }) {
  return (
    <svg className={`w-4 h-4 ${active ? "text-sage-600" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
    </svg>
  );
}

function CastIcon({ active }: { active: boolean }) {
  return (
    <svg className={`w-4 h-4 ${active ? "text-sage-600" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0112.75 0v.109zM12 9.75a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  );
}
