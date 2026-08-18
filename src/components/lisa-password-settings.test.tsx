/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}));

vi.mock("@/lib/client-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/client-api")>()),
  apiRequest: apiMocks.apiRequest,
}));

import { LisaPasswordSettings } from "@/components/lisa-password-settings";
import { ClientApiError } from "@/lib/client-api";

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

function inputWithName(container: ParentNode, name: string): HTMLInputElement {
  const input = container.querySelector(`input[name="${name}"]`);
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Could not find input named ${name}.`);
  }
  return input;
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

async function flushEffects(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

describe("Lisa password settings", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.resetAllMocks();
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
    await act(async () => root.unmount());
    container.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("is not rendered or fetched for Lisa", async () => {
    await act(async () => {
      root.render(<LisaPasswordSettings viewer="lisa" onSaved={vi.fn()} />);
    });

    expect(container.textContent).toBe("");
    expect(apiMocks.apiRequest).not.toHaveBeenCalled();
  });

  it("shows Edward the current status and an accessible new-password form", async () => {
    apiMocks.apiRequest.mockResolvedValue({
      configured: true,
      updatedAt: "2026-08-10T10:00:00.000Z",
    });
    await act(async () => {
      root.render(<LisaPasswordSettings viewer="edward" onSaved={vi.fn()} />);
    });
    await flushEffects();

    expect(apiMocks.apiRequest).toHaveBeenCalledWith(
      "/api/settings/lisa-password",
    );
    expect(container.textContent).toContain("Password is set");
    expect(container.textContent).toContain(
      "does not sign out her existing sessions or remove phone unlocks",
    );
    await act(async () => {
      buttonWithText(container, "Replace Lisa’s password").click();
    });
    await flushEffects();

    const password = inputWithName(container, "new-password");
    const confirmation = inputWithName(container, "confirm-password");
    expect(password.type).toBe("password");
    expect(password.autocomplete).toBe("new-password");
    expect(password.minLength).toBe(12);
    expect(password.maxLength).toBe(128);
    expect(confirmation.autocomplete).toBe("new-password");
    expect(container.textContent).toContain(
      "Spaces are preserved exactly as entered.",
    );

    await enterValue(password, "temporary secret");
    await act(async () => {
      const close = container.querySelector('button[aria-label="Close"]');
      if (!(close instanceof HTMLButtonElement)) {
        throw new Error("Could not find the close button.");
      }
      close.click();
    });
    await act(async () => {
      buttonWithText(container, "Replace Lisa’s password").click();
    });
    expect(inputWithName(container, "new-password").value).toBe("");
  });

  it("rejects whitespace-only and mismatched passwords before the API call", async () => {
    apiMocks.apiRequest.mockResolvedValue({
      configured: false,
      updatedAt: null,
    });
    await act(async () => {
      root.render(<LisaPasswordSettings viewer="edward" onSaved={vi.fn()} />);
    });
    await flushEffects();
    await act(async () => {
      buttonWithText(container, "Set Lisa’s password").click();
    });

    await enterValue(inputWithName(container, "new-password"), "            ");
    await enterValue(
      inputWithName(container, "confirm-password"),
      "            ",
    );
    await act(async () => {
      buttonWithText(container, "Save Lisa’s password").click();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "at least one non-whitespace character",
    );

    await enterValue(
      inputWithName(container, "new-password"),
      "first password",
    );
    await enterValue(
      inputWithName(container, "confirm-password"),
      "second password",
    );
    await act(async () => {
      buttonWithText(container, "Save Lisa’s password").click();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "do not match",
    );
    expect(apiMocks.apiRequest).toHaveBeenCalledTimes(1);
  });

  it("preserves whitespace while saving, closes, and reports success", async () => {
    apiMocks.apiRequest.mockImplementation(
      (_path: string, init?: RequestInit) =>
        Promise.resolve(
          init?.method === "PUT"
            ? {
                configured: true,
                updatedAt: "2026-08-10T11:00:00.000Z",
              }
            : { configured: false, updatedAt: null },
        ),
    );
    const onSaved = vi.fn();
    await act(async () => {
      root.render(<LisaPasswordSettings viewer="edward" onSaved={onSaved} />);
    });
    await flushEffects();
    await act(async () => {
      buttonWithText(container, "Set Lisa’s password").click();
    });
    await enterValue(
      inputWithName(container, "new-password"),
      "  family password  ",
    );
    await enterValue(
      inputWithName(container, "confirm-password"),
      "  family password  ",
    );

    await act(async () => {
      buttonWithText(container, "Save Lisa’s password").click();
    });
    await flushEffects();

    expect(apiMocks.apiRequest).toHaveBeenCalledWith(
      "/api/settings/lisa-password",
      {
        method: "PUT",
        body: JSON.stringify({ password: "  family password  " }),
      },
    );
    expect(container.querySelector("dialog")).toBeNull();
    expect(container.textContent).toContain("Password is set");
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("keeps the modal open and announces a server error", async () => {
    apiMocks.apiRequest.mockImplementation(
      (_path: string, init?: RequestInit) =>
        init?.method === "PUT"
          ? Promise.reject(
              new ClientApiError(
                "Lisa’s password could not be saved.",
                500,
                "SAVE_FAILED",
              ),
            )
          : Promise.resolve({ configured: false, updatedAt: null }),
    );
    await act(async () => {
      root.render(<LisaPasswordSettings viewer="edward" onSaved={vi.fn()} />);
    });
    await flushEffects();
    await act(async () => {
      buttonWithText(container, "Set Lisa’s password").click();
    });
    await enterValue(
      inputWithName(container, "new-password"),
      "valid password",
    );
    await enterValue(
      inputWithName(container, "confirm-password"),
      "valid password",
    );
    await act(async () => {
      buttonWithText(container, "Save Lisa’s password").click();
    });
    await flushEffects();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "could not be saved",
    );
    expect(container.querySelector("dialog")).not.toBeNull();
    expect(buttonWithText(container, "Save Lisa’s password").disabled).toBe(
      false,
    );
  });
});
