import { Link } from "react-router-dom";

export function WelcomeHero() {
  return (
    <div className="max-w-2xl mx-auto text-center py-12">
      {/* Hero heading */}
      <h2 className="text-3xl font-extrabold text-bark-800 font-[family-name:var(--font-heading)] leading-tight">
        Turn bedtime moments into<br />illustrated picture books
      </h2>
      <div className="w-16 h-0.5 bg-sage-400 rounded-full mx-auto mt-4 mb-8" />

      {/* 3-step visual */}
      <div className="grid grid-cols-3 gap-6 mb-10">
        <StepCard
          step={1}
          icon={
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
            </svg>
          }
          title="Write notes"
          description="Jot down what happened today — a trip to the park, a funny thing they said"
        />
        <StepCard
          step={2}
          icon={
            <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
          }
          title="AI creates magic"
          description="We write the story, design characters, and illustrate every page"
        />
        <StepCard
          step={3}
          icon={
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
            </svg>
          }
          title="Your book is ready"
          description="A print-ready PDF picture book you can read together or have printed"
        />
      </div>

      {/* Tips card */}
      <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 shadow-sm p-6 text-left mb-10">
        <h3 className="text-sm font-bold text-bark-700 mb-3">What makes good notes?</h3>
        <div className="space-y-3">
          <NoteExample
            text="Today we went to the park and fed the ducks. Lana was very excited about the big white duck and wanted to share her sandwich."
            quality="great"
          />
          <NoteExample
            text="Max built a tower out of blocks and it fell down. He was sad but then he rebuilt it even taller and cheered."
            quality="great"
          />
          <NoteExample
            text="We had a fun day."
            quality="too-short"
          />
        </div>
        <p className="text-xs text-bark-400 mt-4">
          A 16-page book takes about 10 minutes to generate.
        </p>
      </div>

      {/* CTAs */}
      <div className="flex items-center justify-center gap-3">
        <Link
          to="/new"
          className="inline-flex items-center gap-2 px-7 py-3 bg-sage-600 hover:bg-sage-700 text-white font-semibold rounded-[var(--radius-btn)] transition-colors shadow-sm active:scale-[0.97]"
        >
          Write Your First Story
        </Link>
        <Link
          to="/new?mode=auto"
          className="inline-flex items-center gap-2 px-5 py-3 border border-bark-200 text-bark-600 hover:bg-bark-50 font-medium text-sm rounded-[var(--radius-btn)] transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
          </svg>
          See a Surprise Example
        </Link>
      </div>
    </div>
  );
}

function StepCard({ step, icon, title, description }: {
  step: number;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative w-14 h-14 rounded-full bg-sage-50 flex items-center justify-center text-sage-500">
        {icon}
        <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-sage-500 text-white text-[10px] font-bold flex items-center justify-center">
          {step}
        </span>
      </div>
      <h4 className="text-sm font-bold text-bark-700">{title}</h4>
      <p className="text-xs text-bark-400 leading-relaxed">{description}</p>
    </div>
  );
}

function NoteExample({ text, quality }: { text: string; quality: "great" | "too-short" }) {
  return (
    <div className={`flex items-start gap-3 text-sm ${quality === "too-short" ? "opacity-60" : ""}`}>
      <span className={`shrink-0 mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
        quality === "great"
          ? "bg-sage-100 text-sage-600"
          : "bg-bark-100 text-bark-400"
      }`}>
        {quality === "great" ? "\u2713" : "\u2717"}
      </span>
      <p className="text-bark-600 leading-relaxed font-[family-name:var(--font-story)] italic">
        &ldquo;{text}&rdquo;
      </p>
    </div>
  );
}
