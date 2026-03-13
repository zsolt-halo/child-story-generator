import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getStory } from "../api/client";
import { usePipelineStore } from "../stores/pipelineStore";
import { useSSE } from "../hooks/useSSE";
import { PipelineMiniTracker } from "./PipelineMiniTracker";

const NAV_ITEMS = [
  { path: "/stories", label: "Stories", icon: NavBookIcon },
  { path: "/characters", label: "Characters", icon: CharacterIcon },
  { path: "/new", label: "New Story", icon: PlusIcon },
];

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();

  // Global SSE — keeps pipeline progress flowing regardless of which page the user is on
  const taskId = usePipelineStore((s) => s.taskId);
  const handleEvent = usePipelineStore((s) => s.handleEvent);
  useSSE(taskId, "/api/pipeline/progress", handleEvent);

  // Detect workspace context for breadcrumb
  const workspaceMatch = location.pathname.match(/^\/stories\/([^/]+)$/);
  const isWorkspace = !!workspaceMatch;

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 bg-[#f6efe3] border-r border-bark-200 flex flex-col">
        <div className="px-5 py-6">
          <Link to="/stories" className="block">
            <h1 className="text-xl font-extrabold tracking-tight font-[family-name:var(--font-heading)] text-bark-800">
              StarlightScribe
            </h1>
            <p className="text-xs text-bark-400 mt-0.5">Children's Book Studio</p>
          </Link>
        </div>

        <nav className="flex-1 px-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const active = location.pathname === item.path ||
              (item.path === "/stories" && location.pathname.startsWith("/stories/"));
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-btn)] text-sm font-medium transition-colors ${
                  active
                    ? "bg-amber-100/70 text-amber-800 border-l-[3px] border-amber-500 pl-[9px]"
                    : "text-bark-600 hover:bg-bark-100/50 hover:text-bark-800"
                }`}
              >
                <item.icon />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="px-5 py-4 text-[10px] text-bark-400 font-mono">
          {__COMMIT_HASH__}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-y-auto">
        {/* Breadcrumb bar for workspace */}
        {isWorkspace && (
          <WorkspaceBreadcrumb slug={workspaceMatch![1]} />
        )}
        <div className="max-w-6xl mx-auto px-6 py-8">
          {children}
        </div>
      </main>

      {/* Floating mini-tracker for background pipeline progress */}
      <PipelineMiniTracker />
    </div>
  );
}

function WorkspaceBreadcrumb({ slug }: { slug: string }) {
  const { data } = useQuery({
    queryKey: ["story", slug],
    queryFn: () => getStory(slug),
    enabled: !!slug,
    staleTime: 30_000,
  });

  return (
    <div className="border-b border-bark-100 bg-white/60 backdrop-blur-sm px-6 py-2.5">
      <nav className="max-w-6xl mx-auto flex items-center gap-2 text-xs">
        <Link to="/stories" className="text-bark-400 hover:text-bark-600 transition-colors font-medium">
          Stories
        </Link>
        <svg className="w-3 h-3 text-bark-300" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        <span className="text-bark-700 font-semibold truncate max-w-xs">
          {data?.story.title ?? slug}
        </span>
      </nav>
    </div>
  );
}

function NavBookIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
    </svg>
  );
}

function CharacterIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}
