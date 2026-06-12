import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";

export interface UnsavedChangesDialogProps {
  open: boolean;
  /** GitHub backends commit manually; the primary label reflects that. */
  manualCommit: boolean;
  /** True while a commit-and-leave is in flight; disables all actions. */
  committing: boolean;
  /** Inline error from a failed commit attempt, if any. */
  error: string | null;
  onCommitAndLeave: () => void;
  onLeaveWithoutSaving: () => void;
  onStay: () => void;
}

export function UnsavedChangesDialog({
  open,
  manualCommit,
  committing,
  error,
  onCommitAndLeave,
  onLeaveWithoutSaving,
  onStay,
}: UnsavedChangesDialogProps) {
  const commitLabel = manualCommit ? "Commit & leave" : "Save & leave";
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Dismissing (Escape / backdrop) cancels the pending navigation, but
        // not while a commit is mid-flight.
        if (!next && !committing) onStay();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Unsaved changes</DialogTitle>
          <DialogDescription>
            You have changes that haven't been committed. Commit them before
            leaving, or leave without saving?
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onStay}
            disabled={committing}
          >
            Stay
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onLeaveWithoutSaving}
            disabled={committing}
          >
            Leave without saving
          </Button>
          <Button
            type="button"
            onClick={onCommitAndLeave}
            disabled={committing}
          >
            {committing ? "Committing…" : commitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
