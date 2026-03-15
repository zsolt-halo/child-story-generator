import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getFamilyTree, removeFamilyMember } from "../api/client";
import type { FamilyMemberInfo } from "../api/types";
import { AddFamilyMemberModal } from "./AddFamilyMemberModal";

function PaletteAvatar({ palette, size = 36 }: { palette: string[]; size?: number }) {
  const colors = palette.length > 0 ? palette.slice(0, 5) : ["#d4c5a9", "#b8a88a"];
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

export function FamilyTreeSection({
  characterId,
  characterName,
  onNavigateToMember,
}: {
  characterId: string;
  characterName: string;
  onNavigateToMember?: (memberId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [hoveredLink, setHoveredLink] = useState<string | null>(null);

  const { data: members, isLoading } = useQuery({
    queryKey: ["family-tree", characterId],
    queryFn: () => getFamilyTree(characterId),
  });

  const removeMutation = useMutation({
    mutationFn: (linkId: string) => removeFamilyMember(characterId, linkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["family-tree", characterId] });
      queryClient.invalidateQueries({ queryKey: ["all-characters"] });
    },
  });

  const handleAdded = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["family-tree", characterId] });
    queryClient.invalidateQueries({ queryKey: ["all-characters"] });
    setShowModal(false);
  }, [queryClient, characterId]);

  if (isLoading) {
    return (
      <section className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-5">
        <div className="animate-pulse">
          <div className="h-4 bg-bark-100 rounded w-1/3 mb-4" />
          <div className="h-20 bg-bark-50 rounded" />
        </div>
      </section>
    );
  }

  const isEmpty = !members || members.length === 0;

  return (
    <section className="bg-white rounded-[var(--radius-card)] border border-bark-100 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-bold text-bark-500 uppercase tracking-widest">
          Family Tree
        </h3>
        <button
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-sage-700 bg-sage-50 hover:bg-sage-100 rounded-full transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add Member
        </button>
      </div>

      {isEmpty ? (
        <div className="text-center py-6">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-amber-50 flex items-center justify-center">
            <svg className="w-6 h-6 text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
            </svg>
          </div>
          <p className="text-sm text-bark-500 mb-1">Every story needs a family!</p>
          <p className="text-xs text-bark-400">Add parents, siblings, pets, or friends.</p>
        </div>
      ) : (
        <FamilyTreeVisualization
          members={members!}
          characterName={characterName}
          hoveredLink={hoveredLink}
          onHoverLink={setHoveredLink}
          onRemove={(linkId) => removeMutation.mutate(linkId)}
          onNavigate={onNavigateToMember}
        />
      )}

      {showModal && (
        <AddFamilyMemberModal
          characterId={characterId}
          existingMemberIds={members?.map((m) => m.member_id) ?? []}
          onClose={() => setShowModal(false)}
          onAdded={handleAdded}
        />
      )}
    </section>
  );
}

/* ── Family Tree Visualization ── */

function FamilyTreeVisualization({
  members,
  characterName,
  hoveredLink,
  onHoverLink,
  onRemove,
  onNavigate,
}: {
  members: FamilyMemberInfo[];
  characterName: string;
  hoveredLink: string | null;
  onHoverLink: (id: string | null) => void;
  onRemove: (linkId: string) => void;
  onNavigate?: (memberId: string) => void;
}) {
  // Radial layout: center character with members around it
  const cx = 160;
  const cy = 100;
  const rx = 120;
  const ry = 70;
  const nodeSize = 28;

  const nodes = members.map((m, i) => {
    const angle = (i / members.length) * 2 * Math.PI - Math.PI / 2;
    return {
      ...m,
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
    };
  });

  const svgWidth = 320;
  const svgHeight = 200;

  return (
    <div className="relative">
      <svg width="100%" viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="mx-auto">
        {/* Connectors */}
        {nodes.map((node) => {
          const isHovered = hoveredLink === node.link_id;
          return (
            <path
              key={`line-${node.link_id}`}
              d={`M ${cx} ${cy} Q ${(cx + node.x) / 2} ${(cy + node.y) / 2 - 10} ${node.x} ${node.y}`}
              fill="none"
              stroke={isHovered ? "var(--color-sage-400)" : "var(--color-bark-200)"}
              strokeWidth={isHovered ? 2.5 : 1.5}
              strokeLinecap="round"
              className="transition-all duration-200"
            />
          );
        })}

        {/* Center node (protagonist) */}
        <circle cx={cx} cy={cy} r={nodeSize + 4} fill="var(--color-amber-100)" />
        <circle cx={cx} cy={cy} r={nodeSize} fill="var(--color-amber-400)" />
        <text
          x={cx}
          y={cy + 1}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="white"
          fontSize="11"
          fontWeight="700"
        >
          {characterName.slice(0, 2).toUpperCase()}
        </text>

        {/* Member nodes */}
        {nodes.map((node) => {
          const isHovered = hoveredLink === node.link_id;
          return (
            <g
              key={node.link_id}
              onMouseEnter={() => onHoverLink(node.link_id)}
              onMouseLeave={() => onHoverLink(null)}
              onClick={() => onNavigate?.(node.member_id)}
              className="cursor-pointer"
            >
              <circle
                cx={node.x}
                cy={node.y}
                r={nodeSize - 4 + (isHovered ? 3 : 0)}
                fill={node.color_palette[0] || "var(--color-bark-200)"}
                className="transition-all duration-200"
              />
              <text
                x={node.x}
                y={node.y + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="white"
                fontSize="9"
                fontWeight="600"
              >
                {node.member_name.slice(0, 2).toUpperCase()}
              </text>
              {/* Relationship label below */}
              <text
                x={node.x}
                y={node.y + nodeSize + 2}
                textAnchor="middle"
                fill="var(--color-bark-500)"
                fontSize="8"
                fontWeight="500"
              >
                {node.relationship_label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Member list below visualization */}
      <div className="mt-3 space-y-1.5">
        {members.map((m) => (
          <div
            key={m.link_id}
            className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-bark-50 transition-colors group"
            onMouseEnter={() => onHoverLink(m.link_id)}
            onMouseLeave={() => onHoverLink(null)}
          >
            {m.reference_sheet_url ? (
              <img
                src={`${m.reference_sheet_url}?w=200`}
                alt={m.member_name}
                className="w-8 h-8 rounded-full object-cover shrink-0"
              />
            ) : (
              <PaletteAvatar palette={m.color_palette} size={32} />
            )}
            <div className="flex-1 min-w-0">
              <button
                type="button"
                onClick={() => onNavigate?.(m.member_id)}
                className="text-sm font-semibold text-bark-700 hover:text-sage-700 truncate block text-left"
              >
                {m.member_name}
              </button>
              <span className="text-[11px] text-bark-400">{m.relationship_label}</span>
            </div>
            <button
              type="button"
              onClick={() => onRemove(m.link_id)}
              className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded-full text-bark-400 hover:text-red-500 hover:bg-red-50 transition-all"
              title="Remove from family"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
