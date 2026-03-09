import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

const NAV_ITEMS = [
  { path: "/stories", label: "Stories", icon: BookIcon },
  { path: "/new", label: "New Story", icon: PlusIcon },
];

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 bg-bark-800 text-cream flex flex-col">
        <div className="px-5 py-6">
          <Link to="/stories" className="block">
            <h1 className="text-xl font-extrabold tracking-tight font-[family-name:var(--font-heading)] text-amber-300">
              StarlightScribe
            </h1>
            <p className="text-xs text-bark-300 mt-0.5">Children's Book Studio</p>
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
                    ? "bg-bark-700 text-amber-200"
                    : "text-bark-200 hover:bg-bark-700/50 hover:text-cream"
                }`}
              >
                <item.icon />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="px-5 py-4 text-[10px] text-bark-500 font-mono">
          {__COMMIT_HASH__}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 py-8">
          {children}
        </div>
      </main>
    </div>
  );
}

function BookIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
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
