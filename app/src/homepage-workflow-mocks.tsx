import {
  Check,
  CodeXml,
  Eye,
  FileText,
  PencilLine,
  Terminal,
} from "lucide-react";
import {
  type Ref,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "./components/ui/button";
import {
  getCommentAnchorMeasurements,
  groupCommentAnchorMeasurements,
  normalizeCommentMeasurement,
  resolveAnchoredRailLayouts,
} from "./document-comments";
import { cn } from "./lib/utils";

const HOMEPAGE_WORKFLOW_REVIEW_ITEMS = [
  {
    key: "nora-comment",
    commentIds: ["nora-comment"],
    author: "Nora",
    body: 'This should go above "It\'s just Markdown."',
    kind: "comment",
    replies: [
      {
        author: "AI",
        body: "Sounds good. I'll move it above that section.",
      },
    ],
  },
  {
    key: "nora-suggestion",
    commentIds: ["nora-suggestion"],
    author: "Nora",
    body: 'Replace: "agent\'s plan" with "homepage plan"',
    kind: "suggestion",
    replies: [],
  },
] as const;

function getHomepageWorkflowDocumentScale(element: HTMLElement | null) {
  const scaleElement = element?.closest<HTMLElement>(
    "[data-homepage-workflow-document-scale]",
  );
  const scaleTransform = scaleElement
    ? window.getComputedStyle(scaleElement).transform
    : "none";
  const matrix =
    scaleTransform === "none" ? null : new DOMMatrixReadOnly(scaleTransform);

  return matrix?.a || 1;
}

export function HomepageWorkflowScene({
  description,
  sceneRef,
  step,
  title,
}: {
  description: string;
  sceneRef?: (element: HTMLLIElement | null) => void;
  step: string;
  title: string;
}) {
  return (
    <li
      className="homepage-workflow-scene relative min-h-72 min-w-0 border-t border-slate-200 py-[clamp(1.75rem,7vw,4.5rem)] first:border-t-0 dark:border-slate-700 max-[899px]:min-h-[calc(100svh-3rem)] max-[899px]:pt-[clamp(2rem,8vw,3rem)] max-[899px]:pb-[calc(var(--homepage-workflow-dock-height)+var(--homepage-workflow-dock-bottom)+var(--homepage-workflow-dock-gap))] min-[900px]:flex min-[900px]:min-h-[min(42rem,calc(100vh-4rem))] min-[900px]:items-center"
      data-homepage-workflow-scene=""
      data-testid="homepage-workflow-scene"
      ref={sceneRef}
    >
      <div className="font-die-grotesk-a min-w-0 max-w-[28rem] font-bold max-[899px]:max-w-[min(100%,27rem)]">
        <div className="inline-flex h-12 min-w-12 items-center justify-center rounded-full border border-slate-950 bg-slate-950 px-2 text-[2.25rem] leading-none font-bold text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-950">
          {step}
        </div>
        <h3 className="font-die-grotesk-b mt-5 text-[clamp(2rem,1.5rem+1.5vw,2.5rem)] leading-tight font-bold text-balance text-slate-950 dark:text-slate-50">
          {title}
        </h3>
        <p className="mt-4 max-w-md text-base leading-7 text-stone-600 dark:text-stone-400">
          {description}
        </p>
      </div>
    </li>
  );
}

export function HomepageWorkflowComposite({
  terminalRef,
  workflowStage,
}: {
  terminalRef?: Ref<HTMLDivElement>;
  workflowStage: number;
}) {
  return (
    <div className="relative min-h-[38rem] w-[min(100%,43rem)] max-[899px]:h-full max-[899px]:min-h-0 max-[899px]:w-full max-[520px]:min-h-0 min-[900px]:h-auto min-[900px]:min-h-[38rem]">
      <AgentChatMock terminalRef={terminalRef} workflowStage={workflowStage} />
      <RoughdraftPopupMock workflowStage={workflowStage} />
    </div>
  );
}

function AgentChatMock({
  terminalRef,
  workflowStage,
}: {
  terminalRef?: Ref<HTMLDivElement>;
  workflowStage: number;
}) {
  const showAgentWork = workflowStage >= 2;
  const showRoughdraftCommand = workflowStage >= 3;
  const showAgentResume = workflowStage >= 6;

  return (
    <div
      className="homepage-workflow-terminal w-full overflow-hidden rounded-lg border border-slate-950/70 bg-[#1F232B] font-mono text-slate-50 shadow-[0_20px_48px_rgba(15,23,42,0.16)] max-[899px]:h-full max-[899px]:border-slate-950/60 dark:shadow-[0_18px_44px_rgba(0,0,0,0.35)]"
      data-homepage-workflow-terminal-stage={workflowStage}
      data-testid="homepage-workflow-terminal"
      ref={terminalRef}
    >
      <div className="flex min-h-10 items-center justify-between gap-4 border-b border-slate-400/20 px-3.5 text-xs font-bold text-slate-300 max-[899px]:min-h-8 max-[899px]:px-3 max-[899px]:text-[0.68rem]">
        <div className="flex items-center gap-1.5" aria-hidden="true">
          <span className="inline-flex size-[0.65rem] rounded-full bg-rose-500" />
          <span className="inline-flex size-[0.65rem] rounded-full bg-amber-400" />
          <span className="inline-flex size-[0.65rem] rounded-full bg-emerald-500" />
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <Terminal className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">local-agent / roughdraft</span>
        </div>
      </div>

      <div className="grid gap-4 py-4 pb-[7.5rem] text-sm leading-[1.55] max-[899px]:gap-2.5 max-[899px]:py-3 max-[899px]:pb-[5.75rem] max-[899px]:text-[0.72rem] max-[899px]:leading-[1.45]">
        <div className="grid gap-0.5 px-4 text-slate-400 max-[899px]:px-3">
          <div className="font-semibold text-slate-100">Coding agent</div>
          <div>workspace ~/roughdraft</div>
        </div>

        <div className="flex gap-3 bg-zinc-700/75 px-4 py-[0.45rem] text-slate-50 max-[899px]:gap-2 max-[899px]:px-3 max-[899px]:py-1.5">
          <span className="text-slate-400">›</span>
          <span>
            Let's make the homepage more persuasive. Write a plan first.
          </span>
        </div>

        <div
          aria-hidden={showAgentWork ? undefined : true}
          className="grid max-h-80 gap-4 overflow-hidden opacity-100 transition-[max-height,opacity,transform] duration-300 data-[agent-work-visible=false]:max-h-0 data-[agent-work-visible=false]:translate-y-[-0.35rem] data-[agent-work-visible=false]:pointer-events-none data-[agent-work-visible=false]:opacity-0"
          data-agent-work-visible={showAgentWork ? "true" : "false"}
          data-testid="homepage-workflow-agent-work"
        >
          <div className="flex gap-3 px-4 text-slate-50 max-[899px]:px-3">
            <span className="mt-1 size-2 shrink-0 rounded-full bg-slate-100" />
            <span>
              I'll inspect the current homepage, draft a Markdown plan, and open
              it in Roughdraft for review before I code.
            </span>
          </div>

          <div
            className="mx-4 grid gap-1 text-xs leading-[1.55] text-slate-300 max-[899px]:mx-3 max-[899px]:text-[0.66rem]"
            data-testid="homepage-workflow-terminal-tools"
          >
            <div className="flex gap-3 font-bold text-slate-50">
              <span aria-hidden="true">•</span>
              <span>Explored</span>
            </div>
            <div className="grid gap-0.5 pr-1 pl-[1.55rem] max-[899px]:pl-[1.35rem]">
              <div className="grid grid-cols-[0.8rem_minmax(0,1fr)] gap-x-1.5 text-slate-50 [overflow-wrap:anywhere]">
                <span className="font-bold text-slate-400" aria-hidden="true">
                  └
                </span>
                <span>
                  <span className="text-teal-300">Search</span> rg "It's just
                  Markdown" packages/app/src
                </span>
              </div>
              <div className="grid grid-cols-[0.8rem_minmax(0,1fr)] gap-x-1.5 text-slate-50 [overflow-wrap:anywhere]">
                <span className="font-bold text-slate-400" aria-hidden="true" />
                <span>
                  <span className="text-teal-300">Read</span> sed -n '1,220p'
                  packages/app/src/App.tsx
                </span>
              </div>
              <div className="grid grid-cols-[0.8rem_minmax(0,1fr)] gap-x-1.5 text-slate-50 [overflow-wrap:anywhere]">
                <span className="font-bold text-slate-400" aria-hidden="true" />
                <span>
                  <span className="text-teal-300">Write</span>{" "}
                  .context/homepage-conversion-plan.md
                </span>
              </div>
            </div>
          </div>
        </div>

        <div
          aria-hidden={showRoughdraftCommand ? undefined : true}
          className="mx-4 max-h-32 overflow-hidden rounded-lg border border-slate-400/20 bg-slate-950/30 p-3 text-xs leading-[1.55] text-slate-50 opacity-100 transition-[max-height,margin,padding,border-width,opacity,transform] duration-300 data-[terminal-line-visible=false]:mt-[-1rem] data-[terminal-line-visible=false]:max-h-0 data-[terminal-line-visible=false]:translate-y-[-0.35rem] data-[terminal-line-visible=false]:border-0 data-[terminal-line-visible=false]:py-0 data-[terminal-line-visible=false]:pointer-events-none data-[terminal-line-visible=false]:opacity-0 max-[899px]:mx-3 max-[899px]:p-2 max-[899px]:text-[0.66rem]"
          data-terminal-line-visible={showRoughdraftCommand ? "true" : "false"}
          data-testid="homepage-workflow-terminal-command"
        >
          roughdraft open "/workspace/.context/homepage-conversion-plan.md"
          <div className="mt-2 text-slate-400">Waiting for I'm done...</div>
        </div>

        <div
          aria-hidden={showAgentResume ? undefined : true}
          className="flex max-h-32 gap-3 overflow-hidden px-4 text-slate-50 opacity-100 transition-[max-height,margin,padding,border-width,opacity,transform] duration-300 data-[terminal-line-visible=false]:mt-[-1rem] data-[terminal-line-visible=false]:max-h-0 data-[terminal-line-visible=false]:translate-y-[-0.35rem] data-[terminal-line-visible=false]:border-0 data-[terminal-line-visible=false]:py-0 data-[terminal-line-visible=false]:pointer-events-none data-[terminal-line-visible=false]:opacity-0 max-[899px]:px-3"
          data-terminal-line-visible={showAgentResume ? "true" : "false"}
          data-testid="homepage-workflow-agent-resume"
        >
          <span className="mt-1 size-2 shrink-0 rounded-full bg-emerald-300" />
          <span>
            I read your comments. I accepted your wording suggestion and moved
            the workflow story above the Markdown section.
          </span>
        </div>

        <div
          aria-hidden={showAgentWork ? undefined : true}
          className="flex min-h-[2.65rem] max-h-32 items-center gap-3 overflow-hidden border-y border-slate-300/60 px-4 text-slate-50 opacity-100 transition-[max-height,margin,padding,border-width,opacity,transform] duration-300 data-[terminal-line-visible=false]:mt-[-1rem] data-[terminal-line-visible=false]:max-h-0 data-[terminal-line-visible=false]:translate-y-[-0.35rem] data-[terminal-line-visible=false]:border-0 data-[terminal-line-visible=false]:py-0 data-[terminal-line-visible=false]:pointer-events-none data-[terminal-line-visible=false]:opacity-0"
          data-terminal-line-visible={showAgentWork ? "true" : "false"}
          data-testid="homepage-workflow-terminal-input"
        >
          <span className="text-slate-100">›</span>
          <span
            className="inline-flex h-5 w-2.5 bg-slate-50"
            aria-hidden="true"
          />
        </div>
      </div>
    </div>
  );
}

function RoughdraftPopupMock({ workflowStage }: { workflowStage: number }) {
  const visible = workflowStage >= 3;
  const showUserFeedback = workflowStage >= 4;
  const showAgentReply = workflowStage >= 6;
  const showIncorporatedPlan = workflowStage >= 6;
  const showDoneButton = workflowStage >= 5 && workflowStage < 6;
  const documentShellRef = useRef<HTMLDivElement | null>(null);
  const documentPageRef = useRef<HTMLDivElement | null>(null);
  const reviewRailRef = useRef<HTMLDivElement | null>(null);
  const threadRefs = useRef(new Map<string, HTMLDivElement>());
  const [commentAnchorGroups, setCommentAnchorGroups] = useState<
    Array<{
      key: string;
      commentIds: string[];
      anchorTop: number;
      anchorBottom: number;
    }>
  >([]);
  const [threadHeights, setThreadHeights] = useState<Record<string, number>>(
    {},
  );

  const measureHomepageReviewLayout = useCallback(() => {
    const shellElement = documentShellRef.current;
    const pageElement = documentPageRef.current;
    const railElement = reviewRailRef.current;

    if (!showUserFeedback || !shellElement || !pageElement || !railElement) {
      setCommentAnchorGroups([]);
      return;
    }

    const railRect = railElement.getBoundingClientRect();
    const measurementScale = getHomepageWorkflowDocumentScale(shellElement);
    const anchorElements =
      pageElement.querySelectorAll<HTMLElement>("[data-comment-ids]");

    setCommentAnchorGroups(
      groupCommentAnchorMeasurements(
        getCommentAnchorMeasurements(
          anchorElements,
          railRect.top,
          measurementScale,
        ),
      ),
    );
  }, [showUserFeedback]);

  useLayoutEffect(() => {
    measureHomepageReviewLayout();

    if (!showUserFeedback) return;

    const shellElement = documentShellRef.current;
    const pageElement = documentPageRef.current;
    const railElement = reviewRailRef.current;
    if (!shellElement || !pageElement || !railElement) return;

    const resizeObserver = new ResizeObserver(() => {
      measureHomepageReviewLayout();
    });

    resizeObserver.observe(shellElement);
    resizeObserver.observe(pageElement);
    resizeObserver.observe(railElement);
    window.addEventListener("resize", measureHomepageReviewLayout);

    if (document.fonts) {
      void document.fonts.ready.then(measureHomepageReviewLayout);
    }

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", measureHomepageReviewLayout);
    };
  }, [measureHomepageReviewLayout, showUserFeedback]);

  const setThreadRef = useCallback(
    (key: string, node: HTMLDivElement | null) => {
      if (node) {
        threadRefs.current.set(key, node);
      } else {
        threadRefs.current.delete(key);
      }
    },
    [],
  );

  useLayoutEffect(() => {
    if (!showUserFeedback) {
      setThreadHeights({});
      return;
    }

    const updateThreadHeights = () => {
      const measurementScale = getHomepageWorkflowDocumentScale(
        documentShellRef.current,
      );

      setThreadHeights((current) => {
        const next: Record<string, number> = {};
        let changed = false;

        for (const item of HOMEPAGE_WORKFLOW_REVIEW_ITEMS) {
          const element = threadRefs.current.get(item.key);
          const measuredHeight = Math.ceil(
            element?.getBoundingClientRect().height ?? 0,
          );
          const height =
            measuredHeight > 0
              ? Math.ceil(
                  normalizeCommentMeasurement(measuredHeight, measurementScale),
                )
              : (current[item.key] ?? 0);
          next[item.key] = height;
          changed ||= current[item.key] !== height;
        }

        if (
          !changed &&
          Object.keys(current).length === Object.keys(next).length
        ) {
          return current;
        }

        return next;
      });
    };

    updateThreadHeights();

    const resizeObserver = new ResizeObserver(() => {
      updateThreadHeights();
    });

    for (const item of HOMEPAGE_WORKFLOW_REVIEW_ITEMS) {
      const element = threadRefs.current.get(item.key);
      if (element) resizeObserver.observe(element);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [showUserFeedback]);

  const reviewLayouts = useMemo(() => {
    const railItems = HOMEPAGE_WORKFLOW_REVIEW_ITEMS.map((item) => {
      const anchorGroup = commentAnchorGroups.find((group) =>
        item.commentIds.every((commentId) =>
          group.commentIds.includes(commentId),
        ),
      );

      if (!anchorGroup) return null;

      return {
        ...item,
        anchorTop: anchorGroup.anchorTop,
        anchorBottom: anchorGroup.anchorBottom,
      };
    }).filter(
      (
        item,
      ): item is (typeof HOMEPAGE_WORKFLOW_REVIEW_ITEMS)[number] & {
        anchorTop: number;
        anchorBottom: number;
      } => Boolean(item),
    );

    return resolveAnchoredRailLayouts(railItems, threadHeights, null, 14, 72);
  }, [commentAnchorGroups, threadHeights]);

  return (
    <div
      aria-hidden={visible ? undefined : true}
      className="absolute right-[calc(-1*var(--homepage-workflow-popup-overhang))] bottom-4 left-[clamp(0.5rem,3vw,1.5rem)] z-[2] w-auto min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 shadow-[0_18px_44px_rgba(15,23,42,0.08)] transition-[opacity,transform] duration-200 [--homepage-workflow-popup-overhang:clamp(0rem,calc((100vw-72rem)*0.5),4rem)] data-[popup-visible=false]:translate-y-3 data-[popup-visible=false]:scale-[0.98] data-[popup-visible=false]:pointer-events-none data-[popup-visible=false]:opacity-0 data-[popup-visible=true]:translate-y-0 data-[popup-visible=true]:scale-100 data-[popup-visible=true]:opacity-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50 dark:shadow-[0_18px_44px_rgba(0,0,0,0.28)] max-[899px]:right-2 max-[899px]:bottom-2 max-[899px]:left-2 max-[899px]:[--homepage-workflow-popup-overhang:0rem] max-[520px]:right-1.5 max-[520px]:bottom-1.5 max-[520px]:left-1.5"
      data-homepage-workflow-popup=""
      data-popup-visible={visible ? "true" : "false"}
      data-testid="homepage-workflow-popup"
    >
      <div
        className="flex h-10 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 text-xs font-bold text-stone-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400 max-[520px]:px-3"
        data-testid="homepage-workflow-popup-header"
      >
        <div
          className="flex items-center gap-1.5"
          aria-hidden="true"
          data-testid="homepage-workflow-popup-traffic-lights"
        >
          <span
            className="inline-flex size-[0.65rem] rounded-full bg-rose-500"
            data-testid="homepage-workflow-popup-traffic-light"
          />
          <span
            className="inline-flex size-[0.65rem] rounded-full bg-amber-400"
            data-testid="homepage-workflow-popup-traffic-light"
          />
          <span
            className="inline-flex size-[0.65rem] rounded-full bg-emerald-500"
            data-testid="homepage-workflow-popup-traffic-light"
          />
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <FileText className="size-3.5 shrink-0" aria-hidden="true" />
        </div>
      </div>
      <div
        className="relative min-h-[28rem] overflow-hidden bg-stone-50 p-4 [--homepage-workflow-document-offset-y:0rem] [--homepage-workflow-document-scale:1] dark:bg-slate-900 min-[780px]:min-h-[25.5rem] min-[780px]:[--homepage-workflow-document-scale:0.6] max-[899px]:min-h-[14.5rem] max-[899px]:p-2.5 max-[899px]:[--homepage-workflow-document-offset-y:clamp(1rem,5svh,2.75rem)] max-[899px]:[--homepage-workflow-document-scale:0.66] max-[520px]:p-3 max-[520px]:[--homepage-workflow-document-scale:0.6]"
        data-homepage-workflow-review-visible={
          showUserFeedback ? "true" : "false"
        }
        data-testid="homepage-workflow-document-workspace"
      >
        <div
          className="relative w-full min-w-0 origin-top-left transform-[translateY(var(--homepage-workflow-document-offset-y))_scale(var(--homepage-workflow-document-scale))] min-[780px]:w-[calc(100%/var(--homepage-workflow-document-scale))] max-[899px]:w-[calc(100%/var(--homepage-workflow-document-scale))]"
          data-homepage-workflow-document-scale=""
          data-testid="homepage-workflow-document-scale"
        >
          {showDoneButton ? (
            <Button
              className="absolute top-3 right-3 z-[3] h-12 rounded-[7px] bg-black px-4.5 text-base font-bold text-white shadow-[0_10px_28px_rgba(0,0,0,0.18)] hover:bg-black/85"
              data-testid="homepage-workflow-handoff-button"
              type="button"
              size="sm"
            >
              <Check className="size-6" aria-hidden="true" />
              I'm done
            </Button>
          ) : null}
          <div
            className={cn(
              "mx-auto grid max-w-[39rem] min-w-0 items-start gap-4 transition-[max-width,grid-template-columns] duration-200",
              showUserFeedback
                ? "max-w-full min-[780px]:max-w-[56rem] min-[780px]:grid-cols-[minmax(0,1fr)_minmax(11rem,0.48fr)] min-[780px]:gap-5 max-[899px]:max-w-[46rem] max-[899px]:grid-cols-[minmax(0,1fr)_minmax(10rem,0.44fr)] max-[899px]:gap-[0.85rem]"
                : "max-w-[39rem]",
            )}
            data-testid={
              showUserFeedback
                ? "homepage-workflow-document-shell-with-comments"
                : "homepage-workflow-document-shell-no-comments"
            }
            ref={documentShellRef}
          >
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2 px-1 pb-3 font-mono text-[0.7rem] font-medium text-stone-400 dark:text-slate-400">
                <button
                  aria-label="Switch editor view"
                  className="grid h-[1.375rem] grid-cols-[repeat(2,1.625rem)] items-center rounded-full bg-[#DED8CE] p-0.5 shadow-[inset_0_1px_0_rgba(255,251,245,0.72)] dark:bg-slate-700 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                  type="button"
                >
                  <span className="flex h-[1.125rem] items-center justify-center rounded-full bg-[#FFFDFC] text-stone-700 shadow-[0_1px_2px_rgba(41,37,36,0.12)] dark:bg-slate-500 dark:text-white">
                    <Eye className="size-3" aria-hidden="true" />
                  </span>
                  <span className="flex h-[1.125rem] items-center justify-center rounded-full text-stone-500 dark:text-slate-400">
                    <CodeXml className="size-3" aria-hidden="true" />
                  </span>
                </button>
                <span className="min-w-0 truncate text-stone-600 dark:text-slate-400">
                  homepage-conversion-plan.md
                </span>
                <span className="ml-auto inline-flex items-center gap-1 text-stone-400 dark:text-slate-400 max-[520px]:hidden">
                  <PencilLine className="size-3" aria-hidden="true" />
                  editing
                </span>
              </div>
              <div
                className="min-h-[25rem] rounded-xl border border-[#E9E9E8] bg-white p-[clamp(2rem,6vw,3.5rem)] shadow-[0_18px_44px_rgba(57,47,38,0.08)] dark:border-slate-700 dark:bg-slate-900 dark:shadow-[0_18px_44px_rgba(0,0,0,0.35)] max-[899px]:min-h-[19rem] max-[899px]:p-6"
                ref={documentPageRef}
              >
                <p className="m-0 mb-4 text-[0.72rem] leading-none font-semibold tracking-[0.14em] text-stone-600 uppercase dark:text-slate-400">
                  Roughdraft
                </p>
                <h3
                  className="m-0 mb-6 text-[clamp(1.6rem,4vw,2.35rem)] leading-[1.1] font-semibold text-slate-950 dark:text-slate-50"
                  data-testid="homepage-workflow-document-title"
                >
                  Homepage Conversion Plan
                </h3>
                <p className="m-0 mb-4 text-[clamp(0.95rem,2.25vw,1.12rem)] leading-[1.65] text-stone-700 dark:text-stone-300">
                  Move the workflow story above{" "}
                  {showUserFeedback ? (
                    <span
                      className="bg-[#FFF5C7] decoration-clone box-decoration-clone dark:bg-amber-900/35"
                      data-comment-ids='["nora-comment"]'
                      data-testid="homepage-workflow-comment-highlight"
                    >
                      "It's just Markdown."
                    </span>
                  ) : (
                    '"It\'s just Markdown."'
                  )}
                </p>
                <p className="m-0 mb-4 text-[clamp(0.95rem,2.25vw,1.12rem)] leading-[1.65] text-stone-700 dark:text-stone-300">
                  Show the agent pause, the review window, and the resume
                  signal.
                </p>
                <p className="m-0 mb-4 text-[clamp(0.95rem,2.25vw,1.12rem)] leading-[1.65] text-stone-700 dark:text-stone-300">
                  Keep the format section as proof that the review data is
                  portable Markdown.
                </p>
                {showUserFeedback ? (
                  <p className="m-0 mb-4 text-[clamp(0.95rem,2.25vw,1.12rem)] leading-[1.65] text-stone-700 dark:text-stone-300">
                    <span
                      className="rounded-[0.2rem] bg-rose-50 text-rose-900 line-through decoration-rose-600/75 dark:bg-rose-900/35 dark:text-rose-300"
                      data-comment-ids='["nora-suggestion"]'
                      data-testid="homepage-workflow-suggestion-old"
                    >
                      Review an agent's plan
                    </span>{" "}
                    <span
                      className="rounded-[0.2rem] bg-emerald-50 text-emerald-800 underline decoration-emerald-500/75 underline-offset-[0.16em] dark:bg-emerald-950/50 dark:text-emerald-300"
                      data-comment-ids='["nora-suggestion"]'
                      data-testid="homepage-workflow-suggestion-new"
                    >
                      Review a homepage plan
                    </span>{" "}
                    before it starts coding.
                  </p>
                ) : showIncorporatedPlan ? (
                  <p className="m-0 mb-4 text-[clamp(0.95rem,2.25vw,1.12rem)] leading-[1.65] text-stone-700 dark:text-stone-300">
                    Review a homepage plan before it starts coding.
                  </p>
                ) : (
                  <p className="m-0 mb-4 text-[clamp(0.95rem,2.25vw,1.12rem)] leading-[1.65] text-stone-700 dark:text-stone-300">
                    Review an agent's plan before it starts coding.
                  </p>
                )}
              </div>
            </div>
            {showUserFeedback ? (
              <div
                className="relative min-h-[25rem] min-w-0 text-stone-700"
                data-testid="homepage-workflow-review-rail"
                ref={reviewRailRef}
              >
                {HOMEPAGE_WORKFLOW_REVIEW_ITEMS.map((item) => {
                  const layout = reviewLayouts.find(
                    (reviewLayout) => reviewLayout.key === item.key,
                  );

                  return (
                    <div
                      className="homepage-workflow-review-thread absolute right-0 left-0 grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-3 transition-[top] duration-200"
                      key={item.key}
                      ref={(node) => setThreadRef(item.key, node)}
                      style={layout ? { top: layout.railTop } : undefined}
                    >
                      <div className="flex size-8 items-center justify-center rounded-full border border-stone-300 bg-[#E7E0D5] text-[0.72rem] font-bold text-stone-700">
                        N
                      </div>
                      <div>
                        <div className="mb-1 text-[0.85rem] font-bold text-slate-950 dark:text-slate-50">
                          {item.author}
                        </div>
                        <p
                          className="m-0 text-[0.8rem] leading-[1.65] text-stone-700 dark:text-stone-300"
                          data-testid={
                            item.kind === "comment"
                              ? "homepage-workflow-review-comment"
                              : undefined
                          }
                        >
                          {item.body}
                        </p>
                        {showAgentReply
                          ? item.replies?.map((reply) => (
                              <div
                                className="mt-3 grid grid-cols-[1.65rem_minmax(0,1fr)] gap-2.5 border-t border-stone-200 pt-3"
                                key={`${item.key}-${reply.author}`}
                              >
                                <div className="flex size-[1.65rem] items-center justify-center rounded-full border border-sky-200 bg-sky-50 text-[0.62rem] font-bold text-sky-700">
                                  {reply.author}
                                </div>
                                <div>
                                  <div className="mb-0.5 text-[0.76rem] font-bold text-slate-950 dark:text-slate-50">
                                    {reply.author}
                                  </div>
                                  <p className="m-0 text-[0.8rem] leading-[1.65] text-stone-700 dark:text-stone-300">
                                    {reply.body}
                                  </p>
                                </div>
                              </div>
                            ))
                          : null}
                        {item.kind === "suggestion" ? (
                          <div className="mt-2 flex gap-3 text-[0.95rem] text-stone-400">
                            <Check className="size-3.5" aria-hidden="true" />
                            <span aria-hidden="true">×</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
