import { Check, Copy, ExternalLink } from "lucide-react";
import {
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./components/ui/dialog";
import {
  HomepageWorkflowComposite,
  HomepageWorkflowScene,
} from "./homepage-workflow-mocks";
import { UpdateNotice } from "./UpdateNotice";
import type { UpdateStatus } from "./update-status";

const RoughdraftFormatDemo = lazy(() =>
  import("./RoughdraftFormatDemo").then((module) => ({
    default: module.RoughdraftFormatDemo,
  })),
);

const AGENT_SETUP_PROMPT =
  "Install Roughdraft for me using `npm i -g roughdraft`, then read https://roughdraft.md/setup.md and set yourself up to use it.";
const HOMEPAGE_WORKFLOW_SCENES = [
  {
    step: "1",
    title: "Ask for a plan",
    description:
      "Start in the same agent chat you already use. Ask for a reviewable Markdown plan before implementation begins.",
  },
  {
    step: "2",
    title: "The agent works normally",
    description:
      "It inspects files, runs tools, and drafts the plan in the background. Roughdraft does not replace your agent workflow.",
  },
  {
    step: "3",
    title: "Roughdraft opens the plan",
    description:
      "When the file is ready, the agent opens the Markdown plan in Roughdraft and waits while you review.",
  },
  {
    step: "4",
    title: "Leave comments and suggestions",
    description:
      "Ask questions, redirect priorities, and suggest exact wording inline where the agent can read it later.",
  },
  {
    step: "5",
    title: "Click I'm done",
    description:
      "Roughdraft hands control back to the agent once you are finished with the blocking review step.",
  },
  {
    step: "6",
    title: "The agent resumes",
    description:
      "The next agent turn reads the same Markdown file, sees your comments and suggestions, and continues with the corrected plan.",
  },
] as const;

export function HomepageSubtitle() {
  return (
    <>
      Refine complex ideas with{" "}
      <span
        className="rounded-sm bg-[#fff5c7] px-1 text-slate-950 dark:bg-amber-500/35 dark:text-slate-50"
        data-testid="homepage-subtitle-comment"
      >
        comments
      </span>{" "}
      <span
        className="rounded-sm bg-emerald-50 px-1 text-emerald-950 underline decoration-emerald-500/75 underline-offset-[0.16em] dark:bg-emerald-950/50 dark:text-emerald-200"
        data-testid="homepage-subtitle-addition"
      >
        and suggestions
      </span>
      .
      <br data-testid="homepage-subtitle-break" />
      Free, open source, local.
    </>
  );
}

export function Homepage({
  message,
  updateStatus,
}: {
  message: ReactNode;
  updateStatus: UpdateStatus | null;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const workflowStepRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const workflowIntroRef = useRef<HTMLDivElement | null>(null);
  const workflowStickyVisualRef = useRef<HTMLDivElement | null>(null);
  const workflowTerminalRef = useRef<HTMLDivElement | null>(null);
  const [homepageWorkflowStage, setHomepageWorkflowStage] = useState(1);
  const [mobileWorkflowVisualVisible, setMobileWorkflowVisualVisible] =
    useState(false);

  const handleCopySetupPrompt = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(AGENT_SETUP_PROMPT);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setCopyState("error");
    }
  }, []);

  useEffect(() => {
    const updateHomepageWorkflowStage = () => {
      const isMobileStoryboard =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(max-width: 899px)").matches;
      const workflowIntroRect =
        workflowIntroRef.current?.getBoundingClientRect();
      const nextMobileWorkflowVisualVisible =
        !isMobileStoryboard ||
        (workflowIntroRect ? workflowIntroRect.bottom <= 0 : false);

      setMobileWorkflowVisualVisible((current) =>
        current === nextMobileWorkflowVisualVisible
          ? current
          : nextMobileWorkflowVisualVisible,
      );

      const pageCanScroll =
        document.documentElement.scrollHeight > window.innerHeight + 1;
      if (!pageCanScroll) return;

      const stickyVisualRect =
        workflowStickyVisualRef.current?.getBoundingClientRect();
      const terminalRect = workflowTerminalRef.current?.getBoundingClientRect();
      const mobileReadableOffset = stickyVisualRect
        ? Math.min(stickyVisualRect.height + 32, window.innerHeight * 0.35)
        : 0;
      const activationLine =
        isMobileStoryboard && stickyVisualRect
          ? Math.max(0, Math.ceil(stickyVisualRect.top - mobileReadableOffset))
          : (terminalRect?.top ?? 0);

      let nextStage = 1;
      for (const [step, element] of Object.entries(workflowStepRefs.current)) {
        if (!element) continue;

        const stepNumber = Number(step);
        if (
          element.getBoundingClientRect().top <= activationLine &&
          stepNumber > nextStage
        ) {
          nextStage = stepNumber;
        }
      }

      setHomepageWorkflowStage((current) =>
        current === nextStage ? current : nextStage,
      );
    };

    updateHomepageWorkflowStage();
    window.addEventListener("scroll", updateHomepageWorkflowStage, {
      passive: true,
    });
    window.addEventListener("resize", updateHomepageWorkflowStage);

    return () => {
      window.removeEventListener("scroll", updateHomepageWorkflowStage);
      window.removeEventListener("resize", updateHomepageWorkflowStage);
    };
  }, []);

  return (
    <div
      className="flex min-h-screen items-start justify-center bg-[#FCFCFC] dark:bg-background px-6 pt-8 pb-12 text-slate-950 dark:text-slate-50"
      data-testid="homepage"
    >
      {updateStatus ? (
        <div className="absolute top-4 right-4 max-w-sm">
          <UpdateNotice updateStatus={updateStatus} />
        </div>
      ) : null}
      <div className="w-full">
        <div className="font-die-grotesk-a mx-auto max-w-[100rem] text-left">
          <p
            className="text-[clamp(1.125rem,0.9rem+0.35vw,1.375rem)] font-bold text-stone-500 dark:text-stone-500"
            data-testid="homepage-logo"
          >
            roughdraft.md
          </p>
          <div className="mt-20 sm:mt-28">
            <h1
              className="font-die-grotesk-b text-[clamp(2.875rem,14.2vw,5rem)] leading-[0.88] font-bold text-slate-950 dark:text-slate-50"
              data-testid="homepage-heading"
            >
              Easier collaboration
              <br data-testid="homepage-heading-break" />
              with your agent
            </h1>
            <p className="mt-5 max-w-5xl text-[clamp(1.25rem,0.9rem+1vw,1.75rem)] leading-none text-slate-950 dark:text-slate-50">
              {message}
            </p>

            <div className="mt-7 flex flex-col items-start justify-start gap-3">
              <Dialog>
                <DialogTrigger
                  render={
                    <Button
                      className="h-14 cursor-pointer gap-2 px-5 text-[clamp(1.25rem,1rem+0.6vw,1.5rem)]"
                      data-testid="homepage-install-button"
                      size="lg"
                    >
                      Install now
                    </Button>
                  }
                />
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Give this to your coding agent</DialogTitle>
                    <DialogDescription>
                      This prompt tells the agent how to install Roughdraft and
                      set up the review workflow.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4">
                    <p className="break-words text-sm leading-6 text-stone-800 dark:text-stone-200">
                      {AGENT_SETUP_PROMPT}
                    </p>
                    {copyState === "error" ? (
                      <p className="mt-3 text-sm text-red-600">
                        Copy failed. Select the instruction text and copy it
                        manually.
                      </p>
                    ) : null}
                  </div>

                  <DialogFooter>
                    <Button
                      className="h-9 gap-2 px-3 text-sm"
                      data-testid="homepage-copy-prompt-button"
                      type="button"
                      onClick={handleCopySetupPrompt}
                    >
                      {copyState === "copied" ? (
                        <Check className="size-4" aria-hidden="true" />
                      ) : (
                        <Copy className="size-4" aria-hidden="true" />
                      )}
                      {copyState === "copied" ? "Copied" : "Copy prompt"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <div className="flex flex-wrap items-center justify-start gap-x-4 gap-y-1.5 text-xs text-stone-500">
                <Button
                  className="h-6 gap-1.5 px-1 text-xs text-stone-500 hover:bg-transparent hover:text-stone-700"
                  nativeButton={false}
                  size="sm"
                  variant="ghost"
                  render={
                    <a
                      href="https://github.com/Lex-Inc/roughdraft"
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink className="size-3.5" aria-hidden="true" />
                      View on GitHub
                    </a>
                  }
                />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-10 w-screen max-w-none -translate-x-6 overflow-hidden border-y border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-[0_20px_60px_rgba(15,23,42,0.12)] dark:shadow-[0_20px_60px_rgba(0,0,0,0.4)] min-[1000px]:mx-auto min-[1000px]:w-full min-[1000px]:max-w-[100rem] min-[1000px]:translate-x-0 min-[1000px]:rounded-lg min-[1000px]:border">
          <img
            data-testid="homepage-sneak-peek-image"
            src="/sneak-peek.png"
            alt="Roughdraft markdown review workspace"
            className="block aspect-[1728/1117] w-full object-cover"
          />
        </div>

        <section
          aria-labelledby="homepage-workflow-heading"
          className="mx-auto mt-12 w-full max-w-6xl overflow-visible text-left dark:text-slate-50"
          data-homepage-workflow-storyboard=""
          data-testid="homepage-workflow-storyboard"
        >
          <div
            className="homepage-workflow-intro font-die-grotesk-a py-8 pb-6 font-bold min-[900px]:pt-12 min-[900px]:pb-8"
            ref={workflowIntroRef}
          >
            <h2
              className="font-die-grotesk-b text-center text-[clamp(4rem,2.8rem+3vw,4.5rem)] font-bold text-slate-950 dark:text-slate-50"
              id="homepage-workflow-heading"
              data-testid="homepage-workflow-heading"
            >
              How it works
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-6 [--homepage-workflow-dock-bottom:calc(0.75rem+env(safe-area-inset-bottom,0px))] [--homepage-workflow-dock-gap:clamp(1rem,4vw,1.5rem)] [--homepage-workflow-dock-height:clamp(16rem,38svh,20rem)] max-[899px]:gap-0 min-[900px]:grid-cols-[minmax(16rem,0.72fr)_minmax(0,1.28fr)] min-[900px]:items-start min-[900px]:gap-[clamp(2rem,5vw,4rem)] min-[900px]:[--homepage-workflow-dock-bottom:0rem] min-[900px]:[--homepage-workflow-dock-gap:0rem] min-[900px]:[--homepage-workflow-dock-height:auto]">
            <div
              className="homepage-workflow-sticky-visual min-w-0 max-[899px]:sticky max-[899px]:z-[2] max-[899px]:flex max-[899px]:h-[var(--homepage-workflow-dock-height)] max-[899px]:min-h-0 max-[899px]:items-end max-[899px]:overflow-visible max-[899px]:rounded-[0.65rem] max-[899px]:shadow-[0_18px_48px_rgba(15,23,42,0.16)] max-[899px]:transition-opacity max-[899px]:duration-200 max-[899px]:[bottom:var(--homepage-workflow-dock-bottom)] max-[899px]:[top:calc(100svh-var(--homepage-workflow-dock-height)-var(--homepage-workflow-dock-bottom))] max-[899px]:data-[mobile-workflow-visible=false]:pointer-events-none max-[899px]:data-[mobile-workflow-visible=false]:opacity-0 min-[900px]:sticky min-[900px]:top-8 min-[900px]:order-2 min-[900px]:flex min-[900px]:min-h-[calc(100vh-4rem)] min-[900px]:items-center min-[900px]:overflow-visible"
              data-homepage-workflow-sticky-visual=""
              data-mobile-workflow-visible={
                mobileWorkflowVisualVisible ? "true" : "false"
              }
              data-testid="homepage-workflow-sticky-visual"
              ref={workflowStickyVisualRef}
            >
              <HomepageWorkflowComposite
                workflowStage={homepageWorkflowStage}
                terminalRef={workflowTerminalRef}
              />
            </div>

            <ol
              className="grid list-none grid-cols-1 gap-0 p-0 max-[899px]:pb-[calc(var(--homepage-workflow-dock-height)+var(--homepage-workflow-dock-bottom)+2rem)] min-[900px]:order-1"
              data-testid="homepage-workflow-scene-list"
            >
              {HOMEPAGE_WORKFLOW_SCENES.map((scene) => (
                <HomepageWorkflowScene
                  description={scene.description}
                  key={scene.step}
                  sceneRef={(element) => {
                    workflowStepRefs.current[scene.step] = element;
                  }}
                  step={scene.step}
                  title={scene.title}
                />
              ))}
            </ol>
          </div>
        </section>

        <Suspense fallback={null}>
          <RoughdraftFormatDemo />
        </Suspense>
      </div>
    </div>
  );
}
