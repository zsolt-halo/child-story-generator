import { useState } from "react";
import { updateStory } from "../../api/client";
import { CastReviewPanel } from "../CastReviewPanel";
import type { StoryDetail, CastMember } from "../../api/types";

interface CastTabProps {
  slug: string;
  data: StoryDetail;
  invalidate: () => void;
}

export function CastTab({ slug, data, invalidate }: CastTabProps) {
  const [saving, setSaving] = useState(false);

  const handleSave = async (cast: CastMember[]) => {
    setSaving(true);
    try {
      await updateStory(slug, { cast });
      invalidate();
    } finally {
      setSaving(false);
    }
  };

  if (!data.story.cast || data.story.cast.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="w-16 h-16 mx-auto mb-4 bg-bark-100 rounded-full flex items-center justify-center">
          <svg className="w-8 h-8 text-bark-300" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0112.75 0v.109zM12 9.75a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-bark-600 mb-1">No cast members yet</h3>
        <p className="text-xs text-bark-400">Cast members are created during the pipeline generation process.</p>
      </div>
    );
  }

  return (
    <CastReviewPanel
      slug={slug}
      initialCast={data.story.cast}
      castRefUrls={data.cast_ref_urls ?? {}}
      mainRefSheetUrl={data.reference_sheet_url ?? null}
      onApprove={handleSave}
      approving={saving}
      submitLabel="Save Changes"
      submittingLabel="Saving..."
    />
  );
}
