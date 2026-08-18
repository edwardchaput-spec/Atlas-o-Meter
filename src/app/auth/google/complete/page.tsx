"use client";

import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

/**
 * Google arrives through a cross-site navigation. This same-origin document
 * breaks that redirect chain before opening the authenticated app, allowing
 * the newly issued SameSite=Strict Atlas session cookie to remain strict.
 */
export default function GoogleSignInCompletePage() {
  useEffect(() => {
    window.location.replace("/?passkey=offer");
  }, []);

  return (
    <main className="login-page">
      <section
        className="login-card google-complete-card"
        aria-labelledby="google-complete-heading"
      >
        <div className="brand-mark brand-mark--large" aria-hidden="true">
          <Sparkles size={30} />
        </div>
        <p className="eyebrow">Identity confirmed</p>
        <h1 id="google-complete-heading">Opening Atlas-o-meter…</h1>
        <p className="login-intro" role="status">
          Your private family space is ready.
        </p>
        <noscript>
          <Link
            className="button button--primary button--wide"
            href="/?passkey=offer"
          >
            Continue to Atlas-o-meter
          </Link>
        </noscript>
      </section>
    </main>
  );
}
