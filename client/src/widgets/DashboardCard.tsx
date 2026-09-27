import { ArrowDown, ArrowUp, EyeOff, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WidgetDef } from "./registry";
import { WidgetFrame } from "./WidgetFrame";

export type EditAction = "up" | "down" | "hide";

const editButton =
  "pi-no-drag inline-flex h-7 w-7 items-center justify-center rounded-md border border-pi-border text-pi-text-muted hover:bg-pi-card-hover hover:text-pi-text disabled:opacity-40 disabled:hover:bg-transparent";

/**
 * One dashboard card. In Edit mode its header gains a drag handle (grid only)
 * and Move up / Move down / Hide buttons — the keyboard path for reordering (D1).
 */
export function DashboardCard({
  def,
  editing,
  draggable,
  isFirst,
  isLast,
  onEdit,
  className,
  bodyClassName,
}: {
  def: WidgetDef;
  editing: boolean;
  draggable: boolean;
  isFirst: boolean;
  isLast: boolean;
  onEdit: (id: string, action: EditAction) => void;
  className?: string;
  bodyClassName?: string;
}) {
  const Body = def.component;
  const actions = editing ? (
    <>
      {draggable && (
        <span
          className="pi-drag-handle inline-flex h-7 w-7 cursor-move items-center justify-center rounded-md text-pi-text-muted hover:bg-pi-card-hover"
          title={`Drag to move ${def.title}`}
          data-testid={`drag-${def.id}`}
          aria-hidden
        >
          <GripVertical className="h-4 w-4" />
        </span>
      )}
      <button type="button" className={editButton} data-edit-action="up" disabled={isFirst} aria-label={`Move ${def.title} up`} onClick={() => onEdit(def.id, "up")}>
        <ArrowUp className="h-4 w-4" aria-hidden />
      </button>
      <button type="button" className={editButton} data-edit-action="down" disabled={isLast} aria-label={`Move ${def.title} down`} onClick={() => onEdit(def.id, "down")}>
        <ArrowDown className="h-4 w-4" aria-hidden />
      </button>
      <button type="button" className={editButton} data-edit-action="hide" aria-label={`Hide ${def.title}`} onClick={() => onEdit(def.id, "hide")}>
        <EyeOff className="h-4 w-4" aria-hidden />
      </button>
    </>
  ) : undefined;

  return (
    <WidgetFrame
      id={def.id}
      title={def.title}
      icon={def.icon}
      actions={actions}
      className={cn(editing && "ring-1 ring-pi-border", className)}
      bodyClassName={bodyClassName}
    >
      <Body />
    </WidgetFrame>
  );
}
