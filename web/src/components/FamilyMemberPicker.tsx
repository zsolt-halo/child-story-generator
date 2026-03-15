import { useQuery } from "@tanstack/react-query";
import { getFamilyTree } from "../api/client";
import type { FamilyMemberInfo } from "../api/types";

function PaletteAvatar({ palette, size = 32 }: { palette: string[]; size?: number }) {
  const colors = palette.length > 0 ? palette.slice(0, 5) : ["#d4c5a9"];
  const ringCount = Math.min(colors.length, 5);
  const ringWidth = size / 2 / ringCount;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      {colors.slice(0, ringCount).reverse().map((color, i) => {
        const outerIdx = ringCount - 1 - i;
        const r = size / 2 - outerIdx * ringWidth;
        return <circle key={i} cx={size / 2} cy={size / 2} r={Math.max(r, 2)} fill={color} />;
      })}
    </svg>
  );
}

export function FamilyMemberPicker({
  characterId,
  selectedIds,
  onSelectionChange,
  allowExtraCast,
  onAllowExtraCastChange,
}: {
  characterId: string;
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  allowExtraCast: boolean;
  onAllowExtraCastChange: (v: boolean) => void;
}) {
  const { data: members, isLoading } = useQuery({
    queryKey: ["family-tree", characterId],
    queryFn: () => getFamilyTree(characterId),
    enabled: !!characterId,
  });

  if (isLoading || !members || members.length === 0) return null;

  const allSelected = members.every((m) => selectedIds.includes(m.member_id));
  const noneSelected = selectedIds.length === 0;

  const toggleMember = (id: string) => {
    if (selectedIds.includes(id)) {
      onSelectionChange(selectedIds.filter((x) => x !== id));
    } else {
      onSelectionChange([...selectedIds, id]);
    }
  };

  const toggleAll = () => {
    if (allSelected) {
      onSelectionChange([]);
    } else {
      onSelectionChange(members.map((m) => m.member_id));
    }
  };

  return (
    <div className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-bark-500 uppercase tracking-wide">Family Members</h3>
        <button
          type="button"
          onClick={toggleAll}
          className="text-[11px] font-medium text-sage-600 hover:text-sage-700"
        >
          {allSelected ? "Deselect All" : "Select All"}
        </button>
      </div>

      <div className="space-y-1">
        {members.map((m) => (
          <FamilyMemberRow
            key={m.link_id}
            member={m}
            checked={selectedIds.includes(m.member_id)}
            onToggle={() => toggleMember(m.member_id)}
          />
        ))}
      </div>

      {/* Allow extra cast toggle */}
      <label className="flex items-center gap-3 mt-4 pt-3 border-t border-bark-100 cursor-pointer">
        <input
          type="checkbox"
          checked={allowExtraCast}
          onChange={(e) => onAllowExtraCastChange(e.target.checked)}
          className="w-4 h-4 rounded border-bark-300 text-sage-500 focus:ring-sage-400"
        />
        <div>
          <span className="text-sm font-medium text-bark-700">Allow AI to add extra characters</span>
          <p className="text-[11px] text-bark-400 mt-0.5">
            {allowExtraCast
              ? "AI can invent new side characters beyond family members"
              : "Only pre-defined family members will appear in the story"}
          </p>
        </div>
      </label>

      {noneSelected && (
        <p className="text-[11px] text-amber-600 mt-2">No family members selected — the story will use auto-generated cast only.</p>
      )}
    </div>
  );
}

function FamilyMemberRow({
  member,
  checked,
  onToggle,
}: {
  member: FamilyMemberInfo;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-bark-50 cursor-pointer transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="w-4 h-4 rounded border-bark-300 text-sage-500 focus:ring-sage-400"
      />
      {member.reference_sheet_url ? (
        <img
          src={`${member.reference_sheet_url}?w=200`}
          alt={member.member_name}
          className="w-8 h-8 rounded-full object-cover shrink-0"
        />
      ) : (
        <PaletteAvatar palette={member.color_palette} size={32} />
      )}
      <div className="min-w-0 flex-1">
        <span className="text-[13px] font-semibold text-bark-700 truncate block">{member.member_name}</span>
      </div>
      <span className="text-[11px] text-bark-400 shrink-0">{member.relationship_label}</span>
    </label>
  );
}
