/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const passkeyMocks = vi.hoisted(() => ({
  registerPasskey: vi.fn(),
  rememberPasskey: vi.fn(),
  supportsPasskeys: vi.fn(),
}));

vi.mock("@/lib/passkey-client", () => passkeyMocks);

import { PasskeyEnrollment } from "@/components/passkey-enrollment";

function buttonWithText(
  container: HTMLElement,
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

async function flushEffects(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

describe("passkey enrollment", () => {
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

  it("registers and remembers Lisa's phone unlock", async () => {
    passkeyMocks.supportsPasskeys.mockReturnValue(true);
    passkeyMocks.registerPasskey.mockResolvedValue(2);
    const onRegistered = vi.fn();
    await act(async () => {
      root.render(
        <PasskeyEnrollment
          user="lisa"
          onClose={vi.fn()}
          onRegistered={onRegistered}
        />,
      );
    });
    await flushEffects();

    expect(container.textContent).toContain(
      "your usual sign-in method always available as backup",
    );
    expect(container.textContent).not.toContain("Google");
    await act(async () => {
      buttonWithText(container, "Set up phone unlock").click();
    });
    await flushEffects();

    expect(passkeyMocks.registerPasskey).toHaveBeenCalledOnce();
    expect(passkeyMocks.rememberPasskey).toHaveBeenCalledWith("lisa");
    expect(onRegistered).toHaveBeenCalledWith(2);
  });

  it("keeps the usual sign-in available when passkeys are unsupported", async () => {
    passkeyMocks.supportsPasskeys.mockReturnValue(false);
    await act(async () => {
      root.render(
        <PasskeyEnrollment
          user="lisa"
          onClose={vi.fn()}
          onRegistered={vi.fn()}
        />,
      );
    });
    await flushEffects();

    expect(container.textContent).toContain(
      "Your usual sign-in method will remain available.",
    );
    expect(container.textContent).not.toContain("Google");
    expect(passkeyMocks.registerPasskey).not.toHaveBeenCalled();
  });
});
