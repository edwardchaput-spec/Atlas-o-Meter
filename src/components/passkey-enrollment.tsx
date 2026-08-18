"use client";

import { Fingerprint, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { Modal } from "@/components/modal";
import {
  registerPasskey,
  rememberPasskey,
  supportsPasskeys,
} from "@/lib/passkey-client";
import type { UserSlug } from "@/lib/types";

interface PasskeyEnrollmentProps {
  user: UserSlug;
  onClose: () => void;
  onRegistered: (count: number) => void;
}

export function PasskeyEnrollment({
  user,
  onClose,
  onRegistered,
}: PasskeyEnrollmentProps) {
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState("");
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setSupported(supportsPasskeys()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function register() {
    setRegistering(true);
    setError("");
    try {
      const count = await registerPasskey();
      rememberPasskey(user);
      onRegistered(count);
    } catch (caught) {
      setError(
        caught instanceof Error && caught.name !== "NotAllowedError"
          ? caught.message
          : "Phone unlock was not set up. You can try again later in Settings.",
      );
      setRegistering(false);
    }
  }

  return (
    <Modal
      title="Use phone unlock next time?"
      description="Add a passkey after signing in to Atlas-o-meter."
      onClose={onClose}
    >
      <div className="passkey-enrollment">
        <div className="passkey-hero" aria-hidden="true">
          <Fingerprint size={42} />
        </div>
        {supported === null ? (
          <p>Checking phone-unlock support…</p>
        ) : supported ? (
          <>
            <p>
              Android can use your fingerprint, face, screen lock, or saved
              passkey to confirm it&apos;s you. Atlas-o-meter never receives
              your biometric data.
            </p>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : (
              <div className="passkey-benefit">
                <ShieldCheck aria-hidden="true" size={18} />
                Faster sign-in, with your usual sign-in method always available
                as backup.
              </div>
            )}
            <button
              className="button button--primary button--wide"
              type="button"
              disabled={registering}
              onClick={() => void register()}
            >
              <Fingerprint aria-hidden="true" size={20} />
              {registering ? "Opening phone unlock…" : "Set up phone unlock"}
            </button>
            <button
              className="button button--text button--wide"
              type="button"
              disabled={registering}
              onClick={onClose}
            >
              Maybe later
            </button>
          </>
        ) : (
          <>
            <p>
              This browser does not offer passkeys. Your usual sign-in method
              will remain available.
            </p>
            <button
              className="button button--soft button--wide"
              type="button"
              onClick={onClose}
            >
              Continue
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
