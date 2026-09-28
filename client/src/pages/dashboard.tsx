import { lazy, Suspense, useEffect, useMemo, useRef } from "react";
import { Check, LayoutGrid, RotateCcw, Rows3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MD_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import { mergeVisible, moveInOrder, visibleLayout, type LayoutItem } from "@/prefs/prefs";
import { useUiPrefs, useUiPrefsDispatch } from "@/prefs/UiPrefsProvider";
import { DashboardCard, type EditAction } from "@/widgets/DashboardCard";
import { GridSkeleton } from "@/widgets/GridSkeleton";
import { WIDGETS } from "@/widgets/registry";
import { WidgetVisibilityList } from "@/widgets/WidgetVisibilityList";

// react-grid-layout loads only with the dashboard at ≥md (see DashboardGrid.tsx).
const DashboardGrid = lazy(() => import("@/widgets/DashboardGrid"));
const DEFS = new Map(WIDGETS.map((d) => [d.id, d]));

const toolbarButton = "h-8 gap-1.5 border-pi-border bg-transparent px-3 text-pi-text hover:bg-pi-card-hover";

/** < md: one column in reading order, natural heights, no handles (E4). */
function StackedDashboard({ layout }: { layout: LayoutItem[] }) {
  return (
    <div className="flex flex-col gap-[var(--pi-gap)]" data-testid="dashboard-stack">
      {layout.map((l, idx) => {
        const def = DEFS.get(l.i);
        return def ? (
          <DashboardCard
            key={l.i}
            def={def}
            editing={false}
            draggable={false}
            isFirst={idx === 0}
            isLast={idx === layout.length - 1}
            onEdit={() => {}}
            bodyClassName="max-h-96"
          />
        ) : null;
      })}
    </div>
  );
}

export default function Dashboard() {
  const prefs = useUiPrefs();
  const dispatch = useUiPrefsDispatch();
  const isGrid = useMediaQuery(MD_QUERY);
  // Edit mode lives in UiPrefs (session-only) so the palette and the `e` shortcut can toggle it.
  const editing = prefs.editing;
  const setEditing = (next: boolean) => dispatch({ type: "setEditing", editing: next });
  const editToggle = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<{ id: string; action: EditAction } | null>(null);

  const { layout, hidden } = prefs;
  const visible = useMemo(() => visibleLayout({ layout, hidden }), [layout, hidden]);

  // Edit mode exists only with the grid; Esc or Done leaves it.
  useEffect(() => {
    if (!isGrid) dispatch({ type: "setEditing", editing: false });
  }, [isGrid, dispatch]);
  useEffect(() => () => dispatch({ type: "setEditing", editing: false }), [dispatch]); // leaving the tab ends Edit mode
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      // Esc inside a dialog (palette, confirm) only closes that dialog.
      if (e.key === "Escape" && !document.querySelector('[role="dialog"], [role="alertdialog"]')) {
        setEditing(false);
        editToggle.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing]);

  // After a keyboard move the card's DOM node moves; put focus back on the
  // button that was pressed (or its sibling if that one is now disabled).
  useEffect(() => {
    const p = pendingFocus.current;
    if (!p) return;
    pendingFocus.current = null;
    const card = document.querySelector(`[data-widget="${p.id}"]`);
    const btn = card?.querySelector<HTMLButtonElement>(`[data-edit-action="${p.action}"]`);
    const fallback = card?.querySelector<HTMLButtonElement>(`[data-edit-action="${p.action === "up" ? "down" : "up"}"]`);
    (btn && !btn.disabled ? btn : fallback)?.focus();
  }, [visible]);

  const onEdit = (id: string, action: EditAction) => {
    if (action === "hide") {
      dispatch({ type: "hide", id });
      editToggle.current?.focus();
      return;
    }
    pendingFocus.current = { id, action };
    dispatch({ type: "setLayout", layout: moveInOrder(prefs, id, action === "up" ? -1 : 1) });
  };
  const onCommit = (next: LayoutItem[]) => dispatch({ type: "setLayout", layout: mergeVisible(prefs.layout, next) });

  const hiddenCount = prefs.hidden.length;

  return (
    <div className="space-y-4">
      {isGrid && (
        <div className="flex flex-wrap items-center justify-end gap-2" role="toolbar" aria-label="Dashboard layout">
          {editing && (
            <>
              <Button
                variant="outline"
                size="sm"
                className={toolbarButton}
                aria-pressed={prefs.density === "compact"}
                onClick={() => dispatch({ type: "setDensity", density: prefs.density === "compact" ? "comfortable" : "compact" })}
              >
                <Rows3 className="h-4 w-4" aria-hidden /> Compact
              </Button>
              <Button variant="outline" size="sm" className={toolbarButton} onClick={() => dispatch({ type: "resetLayout" })}>
                <RotateCcw className="h-4 w-4" aria-hidden /> Reset layout
              </Button>
            </>
          )}
          <Button
            ref={editToggle}
            variant="outline"
            size="sm"
            className={toolbarButton}
            aria-pressed={editing}
            onClick={() => setEditing(!editing)}
          >
            {editing ? <Check className="h-4 w-4" aria-hidden /> : <LayoutGrid className="h-4 w-4" aria-hidden />}
            {editing ? "Done" : "Edit layout"}
          </Button>
        </div>
      )}

      {editing && (
        <section aria-labelledby="dash-widgets-title" className="rounded-lg border border-pi-border bg-pi-card p-4">
          <h2 id="dash-widgets-title" className="mb-2 text-sm font-semibold">
            Widgets{hiddenCount > 0 && <span className="font-normal text-pi-text-muted"> · {hiddenCount} hidden</span>}
          </h2>
          <p className="mb-3 text-xs text-pi-text-muted">
            Drag cards by their grip, resize from the bottom-right corner, or use the arrow buttons. Esc or Done to finish.
          </p>
          <WidgetVisibilityList idPrefix="dash-vis" />
        </section>
      )}

      {visible.length === 0 ? (
        <p className="rounded-lg border border-pi-border bg-pi-card p-6 text-center text-pi-text-muted">
          All widgets are hidden. {isGrid ? "Use Edit layout" : "Use Settings"} to show some.
        </p>
      ) : isGrid ? (
        <Suspense fallback={<GridSkeleton />}>
          <DashboardGrid layout={visible} editing={editing} density={prefs.density} onCommit={onCommit} onEdit={onEdit} />
        </Suspense>
      ) : (
        <StackedDashboard layout={visible} />
      )}
    </div>
  );
}
