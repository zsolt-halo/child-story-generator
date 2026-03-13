import { Routes, Route, Navigate } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { Dashboard } from "./pages/Dashboard";
import { NewStory } from "./pages/NewStory";
import { Characters } from "./pages/Characters";
import { Pipeline } from "./pages/Pipeline";
import { StoryWorkspace } from "./pages/StoryWorkspace";
import { ReadAlong } from "./pages/ReadAlong";

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/stories" element={<Dashboard />} />
        <Route path="/new" element={<NewStory />} />
        <Route path="/stories/:slug/pipeline" element={<Pipeline />} />
        <Route path="/stories/:slug/read-along" element={<ReadAlong />} />
        <Route path="/stories/:slug" element={<StoryWorkspace />} />
        <Route path="/characters" element={<Characters />} />
        {/* Legacy redirects */}
        <Route path="/stories/:slug/storyboard" element={<LegacyRedirect tab="pages" />} />
        <Route path="/stories/:slug/review" element={<LegacyRedirect tab="illustrations" />} />
        <Route path="/stories/:slug/book" element={<LegacyRedirect tab="book" />} />
        <Route path="*" element={<Navigate to="/stories" replace />} />
      </Routes>
    </AppShell>
  );
}

function LegacyRedirect({ tab }: { tab: string }) {
  // Extract slug from current path and redirect to workspace tab
  const slug = window.location.pathname.split("/")[2];
  return <Navigate to={`/stories/${slug}?tab=${tab}`} replace />;
}
