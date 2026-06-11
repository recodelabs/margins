import { AlertTriangle } from "lucide-react";
import { Button } from "./components/ui/button";
import { isGitHubMode } from "./detect-backend";

/**
 * Shown when a requested document fails to load. Replaces the old behaviour of
 * rendering the marketing Homepage with the error as its subtitle (ARCH-5): in
 * GitHub mode the only route to Homepage was a load error, so users saw the
 * roughdraft.md sales page instead of a real error.
 */
export function DocumentLoadError({ message }: { message: string }) {
  const githubMode = isGitHubMode();

  return (
    <main className="flex h-screen min-w-0 flex-col items-center justify-center gap-6 bg-[#FCFCFC] px-6 text-center text-slate-950 dark:bg-background dark:text-slate-50">
      <div className="flex max-w-md flex-col items-center gap-4">
        <div className="flex size-12 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
          <AlertTriangle className="size-6" aria-hidden="true" />
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold">Couldn't open this document</h1>
          <p
            className="text-sm text-slate-600 dark:text-slate-400"
            data-testid="document-load-error-message"
          >
            {message}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={() => window.location.reload()}>Retry</Button>
          <Button variant="outline" onClick={() => window.location.assign("/")}>
            {githubMode ? "Back to picker" : "Back to home"}
          </Button>
        </div>
      </div>
    </main>
  );
}
