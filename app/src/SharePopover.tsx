import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./components/ui/popover";
import { getSharingFlags } from "./sharing-frontmatter";

export interface SharePopoverProps {
  canEdit: boolean;
  shareUrl: string;
  content: string;
  onSetPublic: (next: boolean) => Promise<void>;
}

export function SharePopover({
  canEdit,
  shareUrl,
  content,
  onSetPublic,
}: SharePopoverProps) {
  const isPublic = getSharingFlags(content).public;
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            data-testid="share-trigger"
            className="inline-flex items-center gap-1 rounded-full px-1 py-0.5 font-mono text-[0.7rem] text-stone-400 outline-none transition hover:bg-[#EEE9E1] hover:text-stone-600 dark:text-stone-500 dark:hover:bg-slate-800 dark:hover:text-stone-300"
            aria-label="Share document"
          >
            Share
          </button>
        }
      />
      <PopoverContent
        aria-label="Share options"
        className="w-72 p-3"
        align="end"
      >
        <label className="flex items-center gap-2 text-[0.8rem] text-stone-700 dark:text-slate-200">
          <input
            type="checkbox"
            data-testid="share-public-toggle"
            checked={isPublic}
            disabled={!canEdit || busy}
            onChange={async (e) => {
              setBusy(true);
              try {
                await onSetPublic(e.target.checked);
              } finally {
                setBusy(false);
              }
            }}
          />
          <span>Public — anyone with the link can view</span>
        </label>
        {!canEdit ? (
          <p className="mt-2 text-[0.7rem] text-stone-400">
            You need write access to change this.
          </p>
        ) : null}
        {isPublic ? (
          <div className="mt-3 flex items-center gap-2">
            <input
              readOnly
              data-testid="share-link"
              value={shareUrl}
              className="min-w-0 flex-1 truncate rounded border border-[#DCD6CC] bg-transparent px-2 py-1 text-[0.7rem] text-stone-600 dark:border-slate-700 dark:text-slate-300"
            />
            <button
              type="button"
              data-testid="share-copy"
              className="rounded px-2 py-1 text-[0.7rem] text-stone-500 hover:bg-[#EEE9E1] dark:hover:bg-slate-800"
              onClick={async () => {
                await navigator.clipboard.writeText(shareUrl);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
