"use client";

import { KeyRound, Save } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Modal } from "@/components/modal";
import { apiRequest } from "@/lib/client-api";
import type { UserSlug } from "@/lib/types";

interface LisaPasswordSettingsProps {
  viewer: UserSlug;
  onSaved: () => void;
}

interface LisaPasswordStatus {
  configured: boolean;
  updatedAt: string | null;
}

const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;

export function LisaPasswordSettings({
  viewer,
  onSaved,
}: LisaPasswordSettingsProps) {
  if (viewer !== "edward") return null;
  return <EdwardLisaPasswordSettings onSaved={onSaved} />;
}

function EdwardLisaPasswordSettings({ onSaved }: { onSaved: () => void }) {
  const [status, setStatus] = useState<LisaPasswordStatus | null>(null);
  const [statusError, setStatusError] = useState("");
  const [editing, setEditing] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void apiRequest<LisaPasswordStatus>("/api/settings/lisa-password")
      .then((result) => {
        if (active) setStatus(result);
      })
      .catch(() => {
        if (active) {
          setStatusError(
            "Password status could not be checked. You can still set a new password.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  function openEditor(): void {
    setPassword("");
    setConfirmation("");
    setError("");
    setEditing(true);
  }

  function closeEditor(): void {
    setEditing(false);
    setPassword("");
    setConfirmation("");
    setError("");
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      password.length < PASSWORD_MIN_LENGTH ||
      password.length > PASSWORD_MAX_LENGTH ||
      !/\S/.test(password)
    ) {
      setError(
        "Use 12–128 characters and include at least one non-whitespace character.",
      );
      return;
    }
    if (password !== confirmation) {
      setError("The two passwords do not match.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const result = await apiRequest<LisaPasswordStatus>(
        "/api/settings/lisa-password",
        {
          method: "PUT",
          body: JSON.stringify({ password }),
        },
      );
      setStatus(result);
      setStatusError("");
      closeEditor();
      onSaved();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Lisa’s password could not be saved. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  const configured = status?.configured ?? false;

  return (
    <>
      <section
        className="settings-card lisa-password-settings"
        aria-labelledby="lisa-password-settings-heading"
      >
        <div className="settings-card__heading">
          <span>
            <KeyRound aria-hidden="true" size={20} />
          </span>
          <div>
            <h2 id="lisa-password-settings-heading">Lisa&apos;s sign-in</h2>
            <p>
              {status === null && !statusError
                ? "Checking password status…"
                : configured
                  ? "Password is set"
                  : statusError
                    ? "Status unavailable"
                    : "Password is not set"}
            </p>
          </div>
        </div>
        <p className="settings-card-copy">
          Set or replace the password Lisa can use when phone unlock is
          unavailable. Replacing it does not sign out her existing sessions or
          remove phone unlocks.
        </p>
        {statusError ? (
          <p className="settings-inline-message" role="status">
            {statusError}
          </p>
        ) : null}
        <button
          className="button button--soft button--wide"
          type="button"
          onClick={openEditor}
        >
          <KeyRound aria-hidden="true" size={18} />
          {configured ? "Replace Lisa’s password" : "Set Lisa’s password"}
        </button>
      </section>

      {editing ? (
        <Modal
          title={configured ? "Replace Lisa’s password" : "Set Lisa’s password"}
          description="Lisa can use this when phone unlock is unavailable."
          onClose={closeEditor}
        >
          <form className="sheet-form" onSubmit={savePassword}>
            <div className="field">
              <label htmlFor="new-lisa-password">New password</label>
              <input
                id="new-lisa-password"
                name="new-password"
                type="password"
                value={password}
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={PASSWORD_MAX_LENGTH}
                autoComplete="new-password"
                aria-describedby={
                  error
                    ? "lisa-password-requirements lisa-password-settings-error"
                    : "lisa-password-requirements"
                }
                aria-invalid={Boolean(error)}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError("");
                }}
                required
                autoFocus
                spellCheck={false}
              />
              <p className="field-hint" id="lisa-password-requirements">
                Use 12–128 characters with at least one non-whitespace
                character. Spaces are preserved exactly as entered.
              </p>
            </div>

            <div className="field">
              <label htmlFor="confirm-lisa-password">
                Confirm new password
              </label>
              <input
                id="confirm-lisa-password"
                name="confirm-password"
                type="password"
                value={confirmation}
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={PASSWORD_MAX_LENGTH}
                autoComplete="new-password"
                aria-describedby={
                  error ? "lisa-password-settings-error" : undefined
                }
                aria-invalid={Boolean(error)}
                onChange={(event) => {
                  setConfirmation(event.target.value);
                  setError("");
                }}
                required
                spellCheck={false}
              />
            </div>

            {error ? (
              <p
                className="form-error"
                id="lisa-password-settings-error"
                role="alert"
              >
                {error}
              </p>
            ) : null}

            <button
              className="button button--primary button--wide"
              type="submit"
              disabled={saving}
            >
              <Save aria-hidden="true" size={18} />
              {saving ? "Saving password…" : "Save Lisa’s password"}
            </button>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
