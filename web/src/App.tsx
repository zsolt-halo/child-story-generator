import { Routes, Route, Navigate } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { Dashboard } from "./pages/Dashboard";
import { NewStory } from "./pages/NewStory";
import { Characters } from "./pages/Characters";
import { Pipeline } from "./pages/Pipeline";
import { Storyboard } from "./pages/Storyboard";
import { Review } from "./pages/Review";
import { BookPreview } from "./pages/BookPreview";

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/stories" element={<Dashboard />} />
        <Route path="/new" element={<NewStory />} />
        <Route path="/stories/:slug/pipeline" element={<Pipeline />} />
        <Route path="/stories/:slug/storyboard" element={<Storyboard />} />
        <Route path="/stories/:slug/review" element={<Review />} />
        <Route path="/stories/:slug/book" element={<BookPreview />} />
        <Route path="/characters" element={<Characters />} />
        <Route path="*" element={<Navigate to="/stories" replace />} />
      </Routes>
    </AppShell>
  );
}
