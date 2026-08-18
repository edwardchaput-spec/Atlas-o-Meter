import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";

import { apiRequest } from "@/lib/client-api";
import type { SessionUser } from "@/lib/types";

const PASSKEY_MEMORY_PREFIX = "atlas-passkey:";

type AuthenticationOptions = Parameters<
  typeof startAuthentication
>[0]["optionsJSON"];
type RegistrationOptions = Parameters<
  typeof startRegistration
>[0]["optionsJSON"];

export function supportsPasskeys(): boolean {
  return browserSupportsWebAuthn();
}

export function rememberPasskey(user: SessionUser["slug"]): void {
  window.localStorage.setItem(`${PASSKEY_MEMORY_PREFIX}${user}`, "yes");
}

export function forgetRememberedPasskey(user: SessionUser["slug"]): void {
  window.localStorage.removeItem(`${PASSKEY_MEMORY_PREFIX}${user}`);
}

export function hasRememberedPasskey(user: SessionUser["slug"]): boolean {
  return (
    window.localStorage.getItem(`${PASSKEY_MEMORY_PREFIX}${user}`) === "yes"
  );
}

export async function authenticateWithPasskey(
  username: SessionUser["slug"],
): Promise<SessionUser> {
  const options = await apiRequest<AuthenticationOptions>(
    "/api/auth/passkeys/authenticate/options",
    {
      method: "POST",
      body: JSON.stringify({ username }),
    },
  );
  const response = await startAuthentication({ optionsJSON: options });
  const result = await apiRequest<{ user: SessionUser }>(
    "/api/auth/passkeys/authenticate/verify",
    {
      method: "POST",
      body: JSON.stringify({ username, response }),
    },
  );
  return result.user;
}

export async function registerPasskey(): Promise<number> {
  const options = await apiRequest<RegistrationOptions>(
    "/api/auth/passkeys/register/options",
    { method: "POST" },
  );
  const response = await startRegistration({ optionsJSON: options });
  const result = await apiRequest<{ count: number }>(
    "/api/auth/passkeys/register/verify",
    {
      method: "POST",
      body: JSON.stringify(response),
    },
  );
  return result.count;
}
