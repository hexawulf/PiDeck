import { useUiPrefs, useUiPrefsDispatch } from "@/prefs/UiPrefsProvider";
import { widgetsFor } from "./registry";
import { useHost } from "@/hosts/HostProvider";

/**
 * Show/hide list for every widget (Edit mode and Settings). Hidden widgets
 * are unmounted, so their queries stop polling.
 */
export function WidgetVisibilityList({ idPrefix }: { idPrefix: string }) {
  const { hidden } = useUiPrefs();
  const dispatch = useUiPrefsDispatch();
  const widgets = widgetsFor(useHost().isLocal); // a remote host lists only widgets that work there
  const isHidden = new Set(hidden);
  return (
    <ul className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
      {widgets.map(({ id, title, icon: Icon }) => {
        const inputId = `${idPrefix}-${id}`;
        return (
          <li key={id}>
            <label htmlFor={inputId} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-sm hover:bg-pi-card-hover">
              <input
                id={inputId}
                type="checkbox"
                className="h-4 w-4 accent-[var(--pi-accent)]"
                checked={!isHidden.has(id)}
                onChange={(e) => dispatch({ type: e.target.checked ? "show" : "hide", id })}
              />
              <Icon className="h-4 w-4 text-pi-text-muted" aria-hidden />
              <span className={isHidden.has(id) ? "text-pi-text-muted" : ""}>{title}</span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
