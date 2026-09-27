import { Component, useState, type ErrorInfo, type ReactNode } from "react";
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
  children,
}: {
  id: string;
  title: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  // Bumping the key remounts the body, so Retry starts from a clean slate.
  const [generation, setGeneration] = useState(0);
  const titleId = `widget-${id}-title`;
  return (
    <section
      aria-labelledby={titleId}
      data-widget={id}
      className={cn(
        "flex min-w-0 flex-col rounded-lg border border-pi-border bg-pi-card text-pi-text shadow-sm",
        className,
      )}
    >
      <header className="flex items-center gap-2 px-4 pb-2 pt-3">
        {Icon && <Icon className="h-4 w-4 shrink-0 text-pi-text-muted" aria-hidden />}
        <h2 id={titleId} className="truncate text-sm font-semibold">
          {title}
        </h2>
        {actions && <div className="ml-auto flex items-center gap-1">{actions}</div>}
      </header>
      <div className="min-h-0 flex-1 px-4 pb-4 text-sm">
        <WidgetErrorBoundary key={generation} id={id} onRetry={() => setGeneration((g) => g + 1)}>
          {children}
        </WidgetErrorBoundary>
      </div>
    </section>
  );
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
