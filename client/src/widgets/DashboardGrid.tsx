/*
 * Dashboard layout (E4). This module is lazy-loaded by pages/dashboard.tsx,
 * so react-grid-layout and its CSS stay out of the main chunk (E23).
 * ────────────────────────────────────────────────────────────────────
 *                        prefs.layout + prefs.hidden
 *                                  │ visibleLayout(): drop hidden, compact,
 *                                  │ reading order (y, then x)
 *               ┌──────────────────┴──────────────────┐
 *        viewport ≥ md (768px)                 viewport < md
 *   <DashboardGrid> (this file)            <StackedDashboard> (dashboard.tsx)
 *     useContainerWidth → skeleton          one CSS column in reading order,
 *     until the width is measured, then     natural card heights; no grid,
 *     GridLayout: 12 cols, one layout       no drag/resize handles, no Edit
 *     locked unless Edit mode:
 *       drag by .pi-drag-handle, resize ↘
 *       onDragStop / onResizeStop → setLayout (never onLayoutChange, E21)
 */
import { useMemo, type RefObject } from "react";
import GridLayout, { useContainerWidth, type Layout, type LayoutItem as RglItem } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import type { Density, LayoutItem } from "@/prefs/prefs";
import { GRID_COLS } from "@/prefs/prefs";
import { DashboardCard, type EditAction } from "./DashboardCard";
import { GridSkeleton } from "./GridSkeleton";
import { WIDGETS } from "./registry";

/** JS twin of the density tokens in index.css (RGL needs numbers, not CSS vars). */
export const GRID_METRICS: Record<Density, { rowHeight: number; margin: number }> = {
  comfortable: { rowHeight: 30, margin: 16 },
  compact: { rowHeight: 26, margin: 8 },
};

const DEFS = new Map(WIDGETS.map((d) => [d.id, d]));

export default function DashboardGrid({
  layout,
  editing,
  density,
  onCommit,
  onEdit,
}: {
  /** Visible cards only, compacted, in reading order. */
  layout: LayoutItem[];
  editing: boolean;
  density: Density;
  onCommit: (visible: LayoutItem[]) => void;
  onEdit: (id: string, action: EditAction) => void;
}) {
  const { width, containerRef, mounted } = useContainerWidth({ measureBeforeMount: true });
  const { rowHeight, margin } = GRID_METRICS[density];

  // Add each widget's size limits; they live in the registry, not in prefs.
  const rglLayout = useMemo<Layout>(
    () =>
      layout.map((l): RglItem => {
        const d = DEFS.get(l.i);
        return {
          ...l,
          minW: d?.minSize?.w,
          minH: d?.minSize?.h,
          maxW: d?.maxSize?.w ?? GRID_COLS,
          maxH: d?.maxSize?.h,
        };
      }),
    [layout],
  );

  const commit = (next: Layout) => onCommit(next.map(({ i, x, y, w, h }) => ({ i, x, y, w, h })));

  return (
    // RGL types the ref for React 19 (RefObject<T | null>); same object at runtime.
    <div ref={containerRef as RefObject<HTMLDivElement>} className="pi-grid" data-testid="dashboard-grid">
      {!mounted ? (
        <GridSkeleton />
      ) : (
        <GridLayout
          width={width}
          layout={rglLayout}
          gridConfig={{ cols: GRID_COLS, rowHeight, margin: [margin, margin], containerPadding: [0, 0] }}
          dragConfig={{ enabled: editing, handle: ".pi-drag-handle", cancel: ".pi-no-drag" }}
          // Disabled items still render hidden handles; render none outside Edit mode.
          resizeConfig={{ enabled: editing, handles: editing ? ["se"] : [] }}
          onDragStop={commit}
          onResizeStop={commit}
        >
          {layout.map((l, idx) => {
            const def = DEFS.get(l.i);
            if (!def) return null;
            return (
              <div key={l.i} data-grid-item={l.i}>
                <DashboardCard
                  def={def}
                  editing={editing}
                  draggable
                  isFirst={idx === 0}
                  isLast={idx === layout.length - 1}
                  onEdit={onEdit}
                  className="h-full"
                />
              </div>
            );
          })}
        </GridLayout>
      )}
    </div>
  );
}
