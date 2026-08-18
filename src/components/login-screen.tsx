"use client";

import { ArrowRight, Fingerprint, LockKeyhole, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { apiRequest, ClientApiError } from "@/lib/client-api";
import {
  authenticateWithPasskey,
  forgetRememberedPasskey,
  hasRememberedPasskey,
  rememberPasskey,
  supportsPasskeys,
} from "@/lib/passkey-client";
import type { SessionUser, UserSlug } from "@/lib/types";

interface LoginScreenProps {
  onSignedIn: (user: SessionUser, offerPasskey: boolean) => void;
}

const LAST_USER_KEY = "atlas-last-user";

function isUserSlug(value: string | null): value is UserSlug {
  return value === "edward" || value === "lisa";
}

function googleErrorMessage(code: string | null): string {
  if (code === "not_authorised") {
    return "That Google account isn't authorised for this Atlas profile.";
  }
  if (code === "cancelled") {
    return "Google sign-in was cancelled. Try again when you’re ready.";
  }
  if (code === "expired") {
    return "That Google sign-in expired. Please start again.";
  }
  if (code === "too_many_attempts") {
    return "Too many sign-in attempts. Please wait and try again.";
  }
  if (code) {
    return "Google sign-in could not be verified. Please try again.";
  }
  return "";
}

export function LoginScreen({ onSignedIn }: LoginScreenProps) {
  const [username, setUsername] = useState<UserSlug | null>(null);
  const [password, setPassword] = useState("");
  const [useLisaPassword, setUseLisaPassword] = useState(false);
  const [error, setError] = useState("");
  const [passwordInvalid, setPasswordInvalid] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [rememberedPasskey, setRememberedPasskey] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPasskeySupported(supportsPasskeys());
      const parameters = new URLSearchParams(window.location.search);
      const returnedProfile = parameters.get("profile");
      const rememberedUser = window.localStorage.getItem(LAST_USER_KEY);
      const initialUser = isUserSlug(returnedProfile)
        ? returnedProfile
        : isUserSlug(rememberedUser)
          ? rememberedUser
          : null;
      setUsername(initialUser);
      setRememberedPasskey(
        initialUser ? hasRememberedPasskey(initialUser) : false,
      );
      setError(
        initialUser === "edward"
          ? googleErrorMessage(parameters.get("authError"))
          : "",
      );
      if (parameters.has("authError") || parameters.has("profile")) {
        parameters.delete("authError");
        parameters.delete("profile");
        const query = parameters.toString();
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${query ? `?${query}` : ""}`,
        );
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const displayName = useMemo(
    () =>
      username === "edward" ? "Edward" : username === "lisa" ? "Lisa" : "",
    [username],
  );

  function chooseUser(user: UserSlug): void {
    setUsername(user);
    setRememberedPasskey(hasRememberedPasskey(user));
    setUseLisaPassword(false);
    setPassword("");
    setError("");
    setPasswordInvalid(false);
  }

  function rememberUser(user: UserSlug): void {
    window.localStorage.setItem(LAST_USER_KEY, user);
  }

  async function continueWithGoogle() {
    if (username !== "edward") {
      setError("Choose Edward to continue with Google.");
      return;
    }
    setSubmitting(true);
    setError("");
    setPasswordInvalid(false);
    try {
      const result = await apiRequest<{ authorizationUrl: string }>(
        "/api/auth/google/start",
        {
          method: "POST",
          body: JSON.stringify({ username: "edward" }),
        },
      );
      const destination = new URL(result.authorizationUrl);
      if (destination.origin !== "https://accounts.google.com") {
        throw new Error("Atlas received an invalid Google sign-in address.");
      }
      rememberUser("edward");
      window.location.assign(destination.href);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Google sign-in could not be started.",
      );
      setSubmitting(false);
    }
  }

  async function continueWithLisaPassword() {
    if (username !== "lisa") {
      setError("Choose Lisa to sign in with her password.");
      return;
    }
    setSubmitting(true);
    setError("");
    setPasswordInvalid(false);
    try {
      const result = await apiRequest<{ user: SessionUser }>(
        "/api/auth/password/login",
        {
          method: "POST",
          body: JSON.stringify({ username: "lisa", password }),
        },
      );
      setPassword("");
      rememberUser("lisa");
      onSignedIn(result.user, true);
    } catch (caught) {
      setPasswordInvalid(true);
      setError(
        caught instanceof Error
          ? caught.message
          : "Lisa could not be signed in. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function attemptPhoneUnlock() {
    if (!username) {
      setError("Choose Edward or Lisa first.");
      return;
    }
    setSubmitting(true);
    setError("");
    setPasswordInvalid(false);
    try {
      const user = await authenticateWithPasskey(username);
      rememberPasskey(username);
      rememberUser(username);
      onSignedIn(user, false);
    } catch (caught) {
      if (
        caught instanceof ClientApiError &&
        caught.code === "PASSKEY_NOT_CONFIGURED"
      ) {
        forgetRememberedPasskey(username);
        setRememberedPasskey(false);
        setError(
          username === "lisa"
            ? "Phone unlock is no longer registered. Sign in with Lisa’s password instead."
            : "Phone unlock is no longer registered. Continue with Google instead.",
        );
      } else {
        const fallback =
          username === "lisa" ? "Lisa’s password instead" : "Google instead";
        const safeMessage =
          caught instanceof Error &&
          caught.name !== "NotAllowedError" &&
          !/google/i.test(caught.message)
            ? caught.message
            : `Phone unlock was not completed. You can use ${fallback}.`;
        setError(safeMessage);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function continueSecurely(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!username) {
      setError("Choose Edward or Lisa first.");
      return;
    }
    if (passkeySupported && rememberedPasskey && !useLisaPassword) {
      await attemptPhoneUnlock();
    } else if (username === "lisa") {
      await continueWithLisaPassword();
    } else {
      await continueWithGoogle();
    }
  }

  const phoneUnlockPrimary =
    passkeySupported && rememberedPasskey && !useLisaPassword;
  const lisaPasswordVisible =
    username === "lisa" && (!phoneUnlockPrimary || useLisaPassword);
  const phoneUnlockFallback = passkeySupported && Boolean(username);

  return (
    <main className="login-page">
      <div className="login-orbit login-orbit--one" aria-hidden="true" />
      <div className="login-orbit login-orbit--two" aria-hidden="true" />
      <section className="login-card" aria-labelledby="login-heading">
        <div className="brand-mark brand-mark--large" aria-hidden="true">
          <Sparkles size={30} />
        </div>
        <p className="eyebrow">Your family&apos;s little wins</p>
        <h1 id="login-heading">Atlas-o-meter</h1>
        <p className="login-intro">
          Notice the good moments, learn from the tricky ones, and watch the
          stars add up.
        </p>

        <form className="login-form" onSubmit={continueSecurely}>
          <fieldset className="identity-fieldset">
            <legend>Who&apos;s opening Atlas-o-meter?</legend>
            <div className="identity-options">
              {(["edward", "lisa"] as const).map((user) => (
                <button
                  key={user}
                  className={`identity-option ${username === user ? "is-selected" : ""}`}
                  type="button"
                  aria-pressed={username === user}
                  onClick={() => chooseUser(user)}
                >
                  <span>{user === "edward" ? "E" : "L"}</span>
                  {user === "edward" ? "Edward" : "Lisa"}
                </button>
              ))}
            </div>
          </fieldset>

          {lisaPasswordVisible ? (
            <div className="field login-password-field">
              <label htmlFor="lisa-password">Lisa&apos;s password</label>
              <div className="input-with-icon">
                <LockKeyhole aria-hidden="true" size={18} />
                <input
                  id="lisa-password"
                  name="password"
                  type="password"
                  value={password}
                  minLength={12}
                  maxLength={128}
                  autoComplete="current-password"
                  aria-describedby={
                    error
                      ? "lisa-password-hint login-error"
                      : "lisa-password-hint"
                  }
                  aria-invalid={passwordInvalid}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setPasswordInvalid(false);
                    setError("");
                  }}
                  required
                />
              </div>
              <p className="field-hint" id="lisa-password-hint">
                Enter the password Edward set in Settings. Spaces are kept
                exactly as entered.
              </p>
            </div>
          ) : null}

          {error ? (
            <p className="form-error" id="login-error" role="alert">
              {error}
            </p>
          ) : (
            <p className="field-hint secure-login-hint">
              <LockKeyhole aria-hidden="true" size={14} />
              {phoneUnlockPrimary
                ? "Your phone can confirm it’s you."
                : username === "lisa"
                  ? "Lisa’s password confirms this family profile."
                  : username === "edward"
                    ? "Google will confirm the selected family profile."
                    : "Choose a family profile to continue."}
            </p>
          )}

          <button
            className="button button--primary button--wide"
            type="submit"
            disabled={submitting || !username}
          >
            {phoneUnlockPrimary ? (
              <Fingerprint aria-hidden="true" size={20} />
            ) : username === "lisa" ? (
              <LockKeyhole aria-hidden="true" size={20} />
            ) : (
              <span className="google-mark" aria-hidden="true">
                G
              </span>
            )}
            {submitting
              ? "Checking…"
              : phoneUnlockPrimary
                ? `Unlock as ${displayName}`
                : username === "lisa"
                  ? "Sign in as Lisa"
                  : "Continue with Google"}
            {!submitting ? <ArrowRight aria-hidden="true" size={19} /> : null}
          </button>

          {phoneUnlockFallback ? (
            <button
              className="button button--text button--wide"
              type="button"
              disabled={submitting}
              onClick={() => {
                setError("");
                setPasswordInvalid(false);
                if (!phoneUnlockPrimary) {
                  if (username === "lisa" && rememberedPasskey) {
                    setUseLisaPassword(false);
                  } else {
                    void attemptPhoneUnlock();
                  }
                } else if (username === "lisa") {
                  setUseLisaPassword(true);
                  setPassword("");
                } else {
                  void continueWithGoogle();
                }
              }}
            >
              {!phoneUnlockPrimary ? (
                <Fingerprint aria-hidden="true" size={19} />
              ) : username === "lisa" ? (
                <LockKeyhole aria-hidden="true" size={19} />
              ) : (
                <span
                  className="google-mark google-mark--quiet"
                  aria-hidden="true"
                >
                  G
                </span>
              )}
              {!phoneUnlockPrimary
                ? "Use phone unlock instead"
                : username === "lisa"
                  ? "Use Lisa’s password instead"
                  : "Sign in with Google instead"}
            </button>
          ) : null}
        </form>

        <div className="login-private-note">
          <LockKeyhole aria-hidden="true" size={14} />
          <span>Secure sign-in and phone unlock protect this family space</span>
        </div>
      </section>
    </main>
  );
}
