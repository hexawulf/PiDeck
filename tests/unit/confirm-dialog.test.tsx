// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

afterEach(cleanup);

function Harness({ onConfirm = vi.fn(), pending = false, withReturnRef = false }: { onConfirm?: () => void; pending?: boolean; withReturnRef?: boolean }) {
  const [open, setOpen] = useState(false);
  const other = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      <button ref={other}>Elsewhere</button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Update system?"
        description="Runs apt."
        confirmLabel="Update system"
        pendingLabel="Updating…"
        destructive
        pending={pending}
        onConfirm={onConfirm}
        returnFocusRef={withReturnRef ? other : undefined}
      />
    </>
  );
}

const openIt = () => {
  const trigger = screen.getByRole("button", { name: "Open" });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
};

describe("ConfirmDialog", () => {
  it("opens with focus on Cancel, labelled by its title", () => {
    render(<Harness />);
    openIt();
    expect(screen.getByRole("dialog", { name: "Update system?" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
  });

  it("Cancel and Esc close without confirming, focus returns to the trigger", async () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    const trigger = openIt();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger)); // Radix restores focus on a timer

    openIt();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("Confirm calls onConfirm", () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    openIt();
    fireEvent.click(screen.getByRole("button", { name: "Update system" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("while pending: both buttons disabled, label changes, Esc can't dismiss", () => {
    const { rerender } = render(<Harness />);
    openIt();
    rerender(<Harness pending />);
    const confirm = screen.getByRole("button", { name: "Updating…" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect(confirm.getAttribute("aria-busy")).toBe("true");
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    act(() => { fireEvent.keyDown(document.body, { key: "Escape" }); });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("returns focus to returnFocusRef when given (trigger no longer exists)", async () => {
    render(<Harness withReturnRef />);
    openIt();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Elsewhere" })));
  });
});
