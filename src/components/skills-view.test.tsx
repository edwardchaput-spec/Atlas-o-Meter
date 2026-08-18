/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SkillsView } from "@/components/skills-view";
import type { SkillEntry, StarSummary } from "@/lib/types";

const learning: SkillEntry = {
  id: "6a335957-9105-42d1-ad3c-556f28abc131",
  name: "Tying his shoelaces",
  createdBy: "edward",
  createdAt: "2026-08-14T09:00:00.000Z",
  completedBy: null,
  completedAt: null,
  updatedBy: "edward",
  updatedAt: "2026-08-14T09:00:00.000Z",
  version: 1,
};
const learned: SkillEntry = {
  id: "f8662e74-c4cb-46dd-b6f9-f1d694fb008c",
  name: "Fastening his coat",
  createdBy: "edward",
  createdAt: "2026-08-12T09:00:00.000Z",
  completedBy: "lisa",
  completedAt: "2026-08-15T10:00:00.000Z",
  updatedBy: "lisa",
  updatedAt: "2026-08-15T10:00:00.000Z",
  version: 2,
};
const stars: StarSummary = {
  balance: 1,
  happyCount: 5,
  trickyCount: 0,
  completedSkillCount: 1,
  effectiveHappyCount: 10,
  automaticEarned: 1,
  adjustmentTotal: 0,
  progress: 0,
  target: 10,
};

function buttonByLabel(
  container: ParentNode,
  label: string,
): HTMLButtonElement {
  const button = container.querySelector(`button[aria-label="${label}"]`);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Could not find button labelled ${label}.`);
  }
  return button;
}

function buttonWithText(
  container: ParentNode,
  text: string,
): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Could not find button containing ${text}.`);
  }
  return button;
}

describe("skills view", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await act(async () => root.unmount());
    container.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("separates learning and learned skills with accessible shared actions", async () => {
    const onEdit = vi.fn();
    const onComplete = vi.fn();
    const onReopen = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => {
      root.render(
        <SkillsView
          skills={[learned, learning]}
          stars={stars}
          online
          pendingSkillId={null}
          onAdd={vi.fn()}
          onEdit={onEdit}
          onComplete={onComplete}
          onReopen={onReopen}
        />,
      );
    });

    expect(
      container.querySelector('[aria-label="Skills summary"]')?.textContent,
    ).toContain("1learning");
    expect(
      container.querySelector('[aria-label="Skills summary"]')?.textContent,
    ).toContain("1learned");
    expect(
      container.querySelector('[aria-label="Skills summary"]')?.textContent,
    ).toContain("+5face points");
    expect(container.textContent).toContain("Added by Edward");
    expect(container.textContent).toContain("Learned by Lisa");
    expect(
      container.querySelector('[aria-label="Adds five happy-face points"]'),
    ).not.toBeNull();

    await act(async () => {
      buttonByLabel(container, `Edit ${learning.name}`).click();
      buttonByLabel(container, `Mark ${learning.name} as learned`).click();
      buttonByLabel(
        container,
        `Mark ${learned.name} as still learning`,
      ).click();
    });
    expect(onEdit).toHaveBeenCalledWith(learning);
    expect(onComplete).toHaveBeenCalledWith(learning);
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("removes its five happy-face points"),
    );
    expect(onReopen).toHaveBeenCalledWith(learned);
  });

  it("disables writes while offline or while another skill is saving", async () => {
    const callbacks = {
      onAdd: vi.fn(),
      onEdit: vi.fn(),
      onComplete: vi.fn(),
      onReopen: vi.fn(),
    };
    await act(async () => {
      root.render(
        <SkillsView
          skills={[]}
          stars={{ ...stars, completedSkillCount: 0 }}
          online={false}
          pendingSkillId={null}
          {...callbacks}
        />,
      );
    });
    expect(buttonWithText(container, "Add a skill").disabled).toBe(true);

    await act(async () => {
      root.render(
        <SkillsView
          skills={[learning, learned]}
          stars={stars}
          online
          pendingSkillId={learning.id}
          {...callbacks}
        />,
      );
    });
    expect(buttonByLabel(container, `Edit ${learning.name}`).disabled).toBe(
      true,
    );
    expect(
      buttonByLabel(container, `Mark ${learning.name} as learned`).disabled,
    ).toBe(true);
    expect(
      buttonByLabel(container, `Mark ${learned.name} as still learning`)
        .disabled,
    ).toBe(true);
    expect(container.textContent).toContain("Saving…");
  });
});
