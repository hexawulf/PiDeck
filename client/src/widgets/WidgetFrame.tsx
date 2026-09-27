import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { describeError } from "./useWidgetQuery";

/*
 * Every dashboard card is
 *   <WidgetFrame>  chrome: border, title, icon, optional actions
 *     <WidgetErrorBoundary>  a throwing body blanks only this card
 *       <XxxBox/>  body: data + <QueryState> for loading/error/empty
 * Bodies never draw their own border, rounding, shadow or max-width
 * (scripts/check-theme-tokens.sh enforces this under components/widgets/).
 */

type BoundaryProps = { id: string; onRetry: () => void; children: ReactNode };

class WidgetErrorBoundary extends Component<BoundaryProps, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[widget:${this.props.id}]`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <ErrorNotice
        summary="Widget failed"
        details={this.state.error.message}
        onRetry={() => {
          this.setState({ error: null });
          this.props.onRetry();
        }}
      />
    );
  }
}

export function WidgetFrame({
  id,
  title,
  icon: Icon,
  actions,
  className,
  bodyClassName,
  children,
}: {
  id: string;
  title: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  // Bumping the key remounts the body, so Retry starts from a clean slate.
  const [generation, setGeneration] = useState(0);
  const titleId = `widget-${id}-title`;
  const body = useRef<HTMLDivElement>(null);
  const overflowing = useOverflow(body);
  return (
    <section
      aria-labelledby={titleId}
      data-widget={id}
      className={cn(
        "flex min-w-0 flex-col rounded-lg border border-pi-border bg-pi-card text-pi-text shadow-sm",
        className,
      )}
    >
      <header className="flex min-h-10 items-center gap-2 px-[var(--pi-card-pad)] pb-2 pt-[calc(var(--pi-card-pad)*0.75)]">
        {Icon && <Icon className="h-4 w-4 shrink-0 text-pi-text-muted" aria-hidden />}
        <h2 id={titleId} className="truncate text-sm font-semibold">
          {title}
        </h2>
        {actions && <div className="ml-auto flex items-center gap-1">{actions}</div>}
      </header>
      {/* The card's only scroll container; focusable while it overflows so
          keyboard users can scroll it (axe scrollable-region-focusable). */}
      <div
        ref={body}
        tabIndex={overflowing ? 0 : undefined}
        aria-labelledby={overflowing ? titleId : undefined}
        role={overflowing ? "group" : undefined}
        className={cn(
          "pi-widget-body min-h-0 flex-1 overflow-auto px-[var(--pi-card-pad)] pb-[var(--pi-card-pad)] text-[length:var(--pi-font-body)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-pi-accent",
          bodyClassName,
        )}
      >
        <WidgetErrorBoundary key={generation} id={id} onRetry={() => setGeneration((g) => g + 1)}>
          {children}
        </WidgetErrorBoundary>
      </div>
    </section>
  );
}

/** True while the element's content is taller or wider than its box. */
function useOverflow(ref: React.RefObject<HTMLElement>): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const check = () => setOver(el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
    const ro = new ResizeObserver(check);
    ro.observe(el);
    const content = new MutationObserver(check);
    content.observe(el, { childList: true, subtree: true });
    check();
    return () => {
      ro.disconnect();
      content.disconnect();
    };
  }, [ref]);
  return over;
}

export function ErrorNotice({
  summary,
  details,
  onRetry,
}: {
  summary: string;
  details?: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="space-y-2">
      <p className="flex items-center gap-2 text-pi-error">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        <span>{summary}</span>
      </p>
      {details && (
        <details className="text-xs text-pi-text-muted">
          <summary className="cursor-pointer select-none">details</summary>
          <p className="mt-1 break-words font-mono">{details}</p>
        </details>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 rounded-md border border-pi-border px-2 py-1 text-xs hover:bg-pi-card-hover"
        >
          <RotateCw className="h-3 w-3" aria-hidden /> Retry
        </button>
      )}
    </div>
  );
}

/**
 * Loading / error / empty / data for one query. Keeps showing the last good
 * data if a later poll fails.
 */
export function QueryState<T>({
  query,
  isEmpty,
  emptyText = "No data available",
  children,
}: {
  query: Pick<UseQueryResult<T, Error>, "data" | "error" | "isPending" | "refetch">;
  isEmpty?: (data: T) => boolean;
  emptyText?: string;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  }
  if (query.data === undefined) {
    const { summary, details } = describeError(query.error);
    return <ErrorNotice summary={summary} details={details} onRetry={() => void query.refetch()} />;
  }
  if (isEmpty?.(query.data)) return <p className="text-pi-text-muted">{emptyText}</p>;
  return <>{children(query.data)}</>;
}
