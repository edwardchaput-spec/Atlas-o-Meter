/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}));

const passkeyMocks = vi.hoisted(() => ({
  authenticateWithPasskey: vi.fn(),
  forgetRememberedPasskey: vi.fn(),
  hasRememberedPasskey: vi.fn(),
  rememberPasskey: vi.fn(),
  supportsPasskeys: vi.fn(),
}));

vi.mock("@/lib/client-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/client-api")>()),
  apiRequest: apiMocks.apiRequest,
}));
vi.mock("@/lib/passkey-client", () => passkeyMocks);

import { LoginScreen } from "@/components/login-screen";
import { ClientApiError } from "@/lib/client-api";

const LISA = { slug: "lisa", displayName: "Lisa" } as const;

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

function inputWithName(container: HTMLElement, name: string): HTMLInputElement {
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

describe("household login UI", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.resetAllMocks();
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
    passkeyMocks.supportsPasskeys.mockReturnValue(false);
    passkeyMocks.hasRememberedPasskey.mockReturnValue(false);
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

  it("offers Google directly when the selected profile has no remembered passkey", async () => {
    await act(async () => {
      root.render(<LoginScreen onSignedIn={vi.fn()} />);
    });
    await flushEffects();

    await act(async () => {
      buttonWithText(container, "Edward").click();
    });

    const googleButton = buttonWithText(container, "Continue with Google");
    expect(googleButton.disabled).toBe(false);
    expect(container.textContent).toContain(
      "Google will confirm the selected family profile.",
    );
    expect(container.querySelector('input[name="password"]')).toBeNull();
    expect(apiMocks.apiRequest).not.toHaveBeenCalled();
  });

  it("signs Lisa in with her password and offers passkey enrollment", async () => {
    apiMocks.apiRequest.mockResolvedValue({ user: LISA });
    const onSignedIn = vi.fn();
    await act(async () => {
      root.render(<LoginScreen onSignedIn={onSignedIn} />);
    });
    await flushEffects();

    await act(async () => {
      buttonWithText(container, "Lisa").click();
    });

    const password = inputWithName(container, "password");
    expect(password.type).toBe("password");
    expect(password.autocomplete).toBe("current-password");
    expect(password.minLength).toBe(12);
    expect(password.maxLength).toBe(128);
    expect(container.textContent).not.toContain("Google");

    await enterValue(password, "  family password  ");
    await act(async () => {
      buttonWithText(container, "Sign in as Lisa").click();
    });
    await flushEffects();

    expect(apiMocks.apiRequest).toHaveBeenCalledWith(
      "/api/auth/password/login",
      {
        method: "POST",
        body: JSON.stringify({
          username: "lisa",
          password: "  family password  ",
        }),
      },
    );
    expect(window.localStorage.getItem("atlas-last-user")).toBe("lisa");
    expect(onSignedIn).toHaveBeenCalledWith(LISA, true);
  });

  it("keeps phone unlock available when browser memory was cleared", async () => {
    passkeyMocks.supportsPasskeys.mockReturnValue(true);
    passkeyMocks.hasRememberedPasskey.mockReturnValue(false);
    passkeyMocks.authenticateWithPasskey.mockResolvedValue(LISA);
    const onSignedIn = vi.fn();
    await act(async () => {
      root.render(<LoginScreen onSignedIn={onSignedIn} />);
    });
    await flushEffects();

    await act(async () => {
      buttonWithText(container, "Lisa").click();
    });
    expect(container.textContent).toContain("Sign in as Lisa");
    expect(container.textContent).toContain("Use phone unlock instead");

    await act(async () => {
      buttonWithText(container, "Use phone unlock instead").click();
    });
    await flushEffects();

    expect(passkeyMocks.authenticateWithPasskey).toHaveBeenCalledWith("lisa");
    expect(passkeyMocks.rememberPasskey).toHaveBeenCalledWith("lisa");
    expect(onSignedIn).toHaveBeenCalledWith(LISA, false);
  });

  it("shows password errors accessibly without signing Lisa in", async () => {
    apiMocks.apiRequest.mockRejectedValue(
      new ClientApiError("That password is not correct.", 401, "INVALID_LOGIN"),
    );
    const onSignedIn = vi.fn();
    await act(async () => {
      root.render(<LoginScreen onSignedIn={onSignedIn} />);
    });
    await flushEffects();
    await act(async () => {
      buttonWithText(container, "Lisa").click();
    });
    await enterValue(inputWithName(container, "password"), "incorrect pass");

    await act(async () => {
      buttonWithText(container, "Sign in as Lisa").click();
    });
    await flushEffects();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "That password is not correct.",
    );
    expect(
      inputWithName(container, "password").getAttribute("aria-invalid"),
    ).toBe("true");
    expect(buttonWithText(container, "Sign in as Lisa").disabled).toBe(false);
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it("keeps Google fallback available when phone unlock is cancelled", async () => {
    passkeyMocks.supportsPasskeys.mockReturnValue(true);
    passkeyMocks.hasRememberedPasskey.mockImplementation(
      (user: string) => user === "edward",
    );
    passkeyMocks.authenticateWithPasskey.mockRejectedValue(
      new DOMException("The ceremony was cancelled.", "NotAllowedError"),
    );
    window.localStorage.setItem("atlas-last-user", "edward");

    const onSignedIn = vi.fn();
    await act(async () => {
      root.render(<LoginScreen onSignedIn={onSignedIn} />);
    });
    await flushEffects();

    expect(container.textContent).toContain("Unlock as Edward");
    expect(container.textContent).toContain("Sign in with Google instead");
    await act(async () => {
      buttonWithText(container, "Unlock as Edward").click();
    });
    await flushEffects();

    expect(container.textContent).toContain(
      "Phone unlock was not completed. You can use Google instead.",
    );
    expect(container.textContent).toContain("Sign in with Google instead");
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(apiMocks.apiRequest).not.toHaveBeenCalled();
  });

  it("uses Lisa's password, never Google, as remembered-passkey fallback", async () => {
    passkeyMocks.supportsPasskeys.mockReturnValue(true);
    passkeyMocks.hasRememberedPasskey.mockImplementation(
      (user: string) => user === "lisa",
    );
    passkeyMocks.authenticateWithPasskey.mockRejectedValue(
      new DOMException("The ceremony was cancelled.", "NotAllowedError"),
    );
    window.localStorage.setItem("atlas-last-user", "lisa");

    await act(async () => {
      root.render(<LoginScreen onSignedIn={vi.fn()} />);
    });
    await flushEffects();

    expect(container.textContent).toContain("Unlock as Lisa");
    expect(container.textContent).toContain("Use Lisa’s password instead");
    expect(container.textContent).not.toContain("Google");
    expect(container.querySelector('input[name="password"]')).toBeNull();

    await act(async () => {
      buttonWithText(container, "Unlock as Lisa").click();
    });
    await flushEffects();
    expect(container.textContent).toContain(
      "Phone unlock was not completed. You can use Lisa’s password instead.",
    );
    expect(container.textContent).not.toContain("Google");

    await act(async () => {
      buttonWithText(container, "Use Lisa’s password instead").click();
    });
    expect(inputWithName(container, "password")).toBeTruthy();
    expect(container.textContent).toContain("Use phone unlock instead");
  });

  it("forgets a missing Lisa passkey and reveals password sign-in", async () => {
    passkeyMocks.supportsPasskeys.mockReturnValue(true);
    passkeyMocks.hasRememberedPasskey.mockReturnValue(true);
    passkeyMocks.authenticateWithPasskey.mockRejectedValue(
      new ClientApiError(
        "No phone unlock is registered yet. Continue with Google instead.",
        404,
        "PASSKEY_NOT_CONFIGURED",
      ),
    );
    window.localStorage.setItem("atlas-last-user", "lisa");

    await act(async () => {
      root.render(<LoginScreen onSignedIn={vi.fn()} />);
    });
    await flushEffects();
    await act(async () => {
      buttonWithText(container, "Unlock as Lisa").click();
    });
    await flushEffects();

    expect(passkeyMocks.forgetRememberedPasskey).toHaveBeenCalledWith("lisa");
    expect(inputWithName(container, "password")).toBeTruthy();
    expect(container.textContent).toContain(
      "Sign in with Lisa’s password instead.",
    );
    expect(container.textContent).not.toContain("Google");
  });

  it("clears Lisa's password when another profile is selected", async () => {
    await act(async () => {
      root.render(<LoginScreen onSignedIn={vi.fn()} />);
    });
    await flushEffects();
    await act(async () => {
      buttonWithText(container, "Lisa").click();
    });
    await enterValue(inputWithName(container, "password"), "private value");

    await act(async () => {
      buttonWithText(container, "Edward").click();
      buttonWithText(container, "Lisa").click();
    });

    expect(inputWithName(container, "password").value).toBe("");
  });
});
