import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import GoogleSignInCompletePage from "@/app/auth/google/complete/page";

describe("Google same-origin completion bridge", () => {
  it("offers the fixed passkey-enrollment destination without carrying callback secrets", () => {
    const html = renderToStaticMarkup(<GoogleSignInCompletePage />);

    expect(html).toContain('href="/?passkey=offer"');
    expect(html).toContain("Opening Atlas-o-meter");
    expect(html).not.toContain("code=");
    expect(html).not.toContain("state=");
    expect(html).not.toContain("access_token");
  });
});
