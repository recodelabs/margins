import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { ActivityEntry } from "./activity-log";
import { InstructionSender } from "./InstructionSender";

function mount(ui: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

const live: ActivityEntry[] = [
  {
    id: "i1",
    at: "t",
    by: "u",
    role: "user",
    type: "comments",
    instruction: "apply the comments",
  },
  {
    id: "a1",
    at: "t",
    by: "agent",
    role: "agent",
    replyTo: "i1",
    status: "done",
    summary: "applied 2 comments",
    commit: "abcdef0",
  },
];

describe("InstructionSender live history", () => {
  it("renders the history from liveEntries (Done status + summary)", () => {
    const { container, cleanup } = mount(
      <InstructionSender
        docPath="doc.md"
        author="me"
        readActivityLog={async () => []}
        appendActivityEntry={async () => {}}
        liveEntries={live}
      />,
    );
    expect(container.textContent).toContain("apply the comments");
    expect(container.textContent).toContain("Done");
    expect(container.textContent).toContain("applied 2 comments");
    cleanup();
  });
});
