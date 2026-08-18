/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SkillForm } from "@/components/skill-form";
import type { SkillEntry } from "@/lib/types";

const learnedSkill: SkillEntry = {
  id: "342908fd-5477-4a0e-bf98-957b778b8911",
  name: "Tying his shoelaces",
  createdBy: "edward",
  createdAt: "2026-08-16T09:00:00.000Z",
  completedBy: "lisa",
  completedAt: "2026-08-16T10:00:00.000Z",
  updatedBy: "lisa",
  updatedAt: "2026-08-16T10:00:00.000Z",
  version: 2,
};

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

async function enterValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  if (!setter) throw new Error("Input value setter is unavailable.");
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit(container: ParentNode): Promise<void> {
  const form = container.querySelector("form");
  if (!(form instanceof HTMLFormElement)) throw new Error("Form not found.");
  await act(async () => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
  });
}

describe("skill form", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.removeAttribute("open");
      },
    });
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

  it("renders an accessible create form and saves the cleaned name", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      root.render(
        <SkillForm
          skill={null}
          onClose={vi.fn()}
          onSave={onSave}
          onDelete={null}
        />,
      );
    });

    const dialog = container.querySelector("dialog");
    const input = container.querySelector("#skill-name");
    expect(dialog?.getAttribute("aria-labelledby")).toBe("sheet-title");
    expect(container.querySelector("#sheet-title")?.textContent).toBe(
      "Add a skill",
    );
    expect(
      container.querySelector('label[for="skill-name"]')?.textContent,
    ).toBe("What is Atlas learning?");
    expect(input).toBeInstanceOf(HTMLInputElement);
    if (!(input instanceof HTMLInputElement)) return;
    expect(input.required).toBe(true);
    expect(input.maxLength).toBe(80);
    expect(input.autocomplete).toBe("off");

    await enterValue(input, "   \n  ");
    await submit(container);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Enter a skill",
    );
    expect(onSave).not.toHaveBeenCalled();

    await enterValue(input, "  Ｔｙｉｎｇ   his\n shoelaces ");
    await submit(container);
    expect(onSave).toHaveBeenCalledWith({ name: "Tying his shoelaces" });
  });

  it("announces save failures and restores the submit action", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("Shared save failed"));
    await act(async () => {
      root.render(
        <SkillForm
          skill={null}
          onClose={vi.fn()}
          onSave={onSave}
          onDelete={null}
        />,
      );
    });
    const input = container.querySelector("#skill-name");
    if (!(input instanceof HTMLInputElement)) throw new Error("Input missing.");
    await enterValue(input, "Riding a bike");
    await submit(container);

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Shared save failed",
    );
    expect(buttonWithText(container, "Add skill").disabled).toBe(false);
  });

  it("loads an existing skill and confirms the five-face deletion impact", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => {
      root.render(
        <SkillForm
          skill={learnedSkill}
          onClose={vi.fn()}
          onSave={vi.fn().mockResolvedValue(undefined)}
          onDelete={onDelete}
        />,
      );
    });

    const input = container.querySelector("#skill-name");
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect((input as HTMLInputElement).value).toBe(learnedSkill.name);
    expect(container.querySelector("#sheet-title")?.textContent).toBe(
      "Update skill",
    );

    await act(async () => {
      buttonWithText(container, "Remove skill").click();
      await Promise.resolve();
    });
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("removes its five happy-face points"),
    );
    expect(onDelete).toHaveBeenCalledWith(learnedSkill);
  });
});
