import { describe, expect, it } from "vitest";

import {
  behaviorCreateSchema,
  behaviorDeleteSchema,
  behaviorUpdateSchema,
  calculateStarSummary,
  cleanSkillName,
  cleanTagName,
  dashboardQuerySchema,
  googleLoginSchema,
  historyQuerySchema,
  lisaPasswordUpdateSchema,
  loginSchema,
  normalizeTagName,
  normalizeSkillName,
  passwordLoginSchema,
  skillCreateSchema,
  skillDeleteSchema,
  skillUpdateSchema,
  starAdjustmentSchema,
  webAuthnAuthenticationRequestSchema,
  webAuthnRegistrationResponseSchema,
} from "@/lib/domain";

describe("tag names", () => {
  it("normalizes Unicode, surrounding whitespace, repeated whitespace and case", () => {
    expect(normalizeTagName("  ＴＨＲＯＷＩＮＧ\u00a0\tＴＯＹＳ  ")).toBe(
      "throwing toys",
    );
  });

  it("cleans a display name without losing its chosen case", () => {
    expect(cleanTagName("\u3000Ｔｉｄｙｉｎｇ  \n up\t")).toBe("Tidying up");
    expect(cleanTagName(" \n\t ")).toBeNull();
    expect(cleanTagName(null)).toBeNull();
  });
});

describe("skill names", () => {
  it("cleans and normalizes Unicode, whitespace, and case", () => {
    expect(cleanSkillName("  Ｔｙｉｎｇ\u3000 his\n shoelaces  ")).toBe(
      "Tying his shoelaces",
    );
    expect(normalizeSkillName("  ＴＹＩＮＧ\tHIS SHOELACES ")).toBe(
      "tying his shoelaces",
    );
  });
});

describe("input schemas", () => {
  it("canonicalizes a known login and rejects unknown fields and users", () => {
    expect(loginSchema.parse({ username: "  EDWARD " })).toEqual({
      username: "edward",
    });
    expect(loginSchema.safeParse({ username: "atlas" }).success).toBe(false);
    expect(
      loginSchema.safeParse({ username: "lisa", role: "admin" }).success,
    ).toBe(false);
  });

  it("keeps Google Edward-only and validates raw Lisa password boundaries", () => {
    expect(googleLoginSchema.parse({ username: " EDWARD " })).toEqual({
      username: "edward",
    });
    expect(googleLoginSchema.safeParse({ username: "lisa" }).success).toBe(
      false,
    );

    const raw = "  exact Lisa password  ";
    expect(
      passwordLoginSchema.parse({ username: "lisa", password: raw }),
    ).toEqual({ username: "lisa", password: raw });
    expect(
      passwordLoginSchema.safeParse({ username: "edward", password: raw })
        .success,
    ).toBe(false);
    expect(
      passwordLoginSchema.safeParse({ username: "lisa", password: "" }).success,
    ).toBe(false);
    expect(
      lisaPasswordUpdateSchema.safeParse({ password: "short" }).success,
    ).toBe(false);
    expect(
      lisaPasswordUpdateSchema.safeParse({ password: " ".repeat(12) }).success,
    ).toBe(false);
    expect(
      lisaPasswordUpdateSchema.parse({ password: "  exact password  " }),
    ).toEqual({ password: "  exact password  " });
  });

  it("strictly validates WebAuthn registration responses and base64url fields", () => {
    const registration = {
      id: "credential_id",
      rawId: "credential_id",
      response: {
        clientDataJSON: "eyJ0eXBlIjoiY3JlYXRlIn0",
        attestationObject: "o2NmbXRkbm9uZQ",
        transports: ["internal", "hybrid"],
        publicKeyAlgorithm: -7,
      },
      type: "public-key",
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    } as const;

    expect(webAuthnRegistrationResponseSchema.parse(registration)).toEqual(
      registration,
    );
    expect(
      webAuthnRegistrationResponseSchema.safeParse({
        ...registration,
        id: "not standard base64url!",
      }).success,
    ).toBe(false);
    expect(
      webAuthnRegistrationResponseSchema.safeParse({
        ...registration,
        response: {
          ...registration.response,
          transports: ["bluetooth"],
        },
      }).success,
    ).toBe(false);
    expect(
      webAuthnRegistrationResponseSchema.safeParse({
        ...registration,
        response: {
          ...registration.response,
          unexpected: "field",
        },
      }).success,
    ).toBe(false);
    expect(
      webAuthnRegistrationResponseSchema.safeParse({
        ...registration,
        username: "edward",
      }).success,
    ).toBe(false);
  });

  it("strictly validates WebAuthn authentication requests and their user", () => {
    const authentication = {
      username: " LISA ",
      response: {
        id: "credential_id",
        rawId: "credential_id",
        response: {
          clientDataJSON: "eyJ0eXBlIjoiZ2V0In0",
          authenticatorData: "YXV0aGVudGljYXRvcl9kYXRh",
          signature: "c2lnbmF0dXJl",
          userHandle: "bGlzYQ",
        },
        type: "public-key",
        clientExtensionResults: {},
        authenticatorAttachment: "platform",
      },
    } as const;

    expect(
      webAuthnAuthenticationRequestSchema.parse(authentication),
    ).toMatchObject({ username: "lisa", response: authentication.response });
    expect(
      webAuthnAuthenticationRequestSchema.safeParse({
        ...authentication,
        username: "atlas",
      }).success,
    ).toBe(false);
    expect(
      webAuthnAuthenticationRequestSchema.safeParse({
        ...authentication,
        response: {
          ...authentication.response,
          response: {
            ...authentication.response.response,
            signature: "not+base64",
          },
        },
      }).success,
    ).toBe(false);
    expect(
      webAuthnAuthenticationRequestSchema.safeParse({
        ...authentication,
        response: { ...authentication.response, challenge: "client-value" },
      }).success,
    ).toBe(false);
  });

  it("accepts complete behavior payloads and enforces their trust boundaries", () => {
    const create = {
      mood: "happy",
      occurredAt: "2026-08-09T10:30:00.000Z",
      tag: "Tidying up",
      clientRequestId: "c531c640-145a-4dcb-b339-6bd758e2ab50",
    } as const;

    expect(behaviorCreateSchema.parse(create)).toEqual(create);
    expect(
      behaviorCreateSchema.parse({
        ...create,
        occurredAt: "2026-08-09T11:30:00+01:00",
      }).occurredAt,
    ).toBe("2026-08-09T10:30:00.000Z");
    expect(
      behaviorCreateSchema.safeParse({ ...create, mood: "angry" }).success,
    ).toBe(false);
    expect(
      behaviorCreateSchema.safeParse({
        ...create,
        occurredAt: "2026-08-09",
      }).success,
    ).toBe(false);
    expect(
      behaviorCreateSchema.safeParse({
        ...create,
        clientRequestId: "not-a-uuid",
      }).success,
    ).toBe(false);
    expect(
      behaviorCreateSchema.safeParse({ ...create, tag: "x".repeat(49) })
        .success,
    ).toBe(false);

    const update = {
      mood: "sad",
      occurredAt: create.occurredAt,
      tag: null,
      version: 1,
    } as const;
    expect(behaviorUpdateSchema.parse(update)).toEqual(update);
    expect(
      behaviorUpdateSchema.safeParse({ ...update, version: 0 }).success,
    ).toBe(false);
    expect(behaviorDeleteSchema.parse({ version: 2 })).toEqual({ version: 2 });
    expect(behaviorDeleteSchema.safeParse({ version: 1.5 }).success).toBe(
      false,
    );
  });

  it("strictly validates skill create, update, and delete payloads", () => {
    const clientRequestId = "b459c24a-27f5-49c4-ab0f-fe7d5af59c42";

    expect(
      skillCreateSchema.parse({
        name: "  Ｔｙｉｎｇ\t his  shoelaces ",
        clientRequestId,
      }),
    ).toEqual({ name: "Tying his shoelaces", clientRequestId });
    expect(
      skillCreateSchema.safeParse({ name: "x", clientRequestId }).success,
    ).toBe(false);
    expect(
      skillCreateSchema.safeParse({
        name: "x".repeat(81),
        clientRequestId,
      }).success,
    ).toBe(false);
    expect(
      skillCreateSchema.safeParse({
        name: "Tying shoes",
        clientRequestId: "not-a-uuid",
      }).success,
    ).toBe(false);
    expect(
      skillCreateSchema.safeParse({
        name: "Tying shoes",
        clientRequestId,
        createdBy: "edward",
      }).success,
    ).toBe(false);

    expect(
      skillUpdateSchema.parse({
        name: "  Riding   a bike ",
        completed: true,
        version: 2,
      }),
    ).toEqual({ name: "Riding a bike", completed: true, version: 2 });
    expect(skillUpdateSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(
      skillUpdateSchema.safeParse({ completed: false, version: 0 }).success,
    ).toBe(false);
    expect(
      skillUpdateSchema.safeParse({
        completed: true,
        version: 1,
        completedBy: "lisa",
      }).success,
    ).toBe(false);

    expect(skillDeleteSchema.parse({ version: 3 })).toEqual({ version: 3 });
    expect(
      skillDeleteSchema.safeParse({ version: 3, force: true }).success,
    ).toBe(false);
  });

  it("requires a forward dashboard range of no more than 32 days", () => {
    const from = "2026-08-01T00:00:00.000Z";

    expect(
      dashboardQuerySchema.safeParse({
        from,
        to: "2026-09-02T00:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      dashboardQuerySchema.safeParse({
        from,
        to: "2026-08-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      dashboardQuerySchema.safeParse({
        from,
        to: "2026-09-02T00:00:00.001Z",
      }).success,
    ).toBe(false);
  });

  it("requires a strict forward history range of no more than 100 days", () => {
    const from = "2026-01-01T00:00:00.000Z";
    const to = "2026-04-11T00:00:00.000Z";

    expect(historyQuerySchema.parse({ from, to })).toEqual({ from, to });
    expect(historyQuerySchema.safeParse({ from, to: from }).success).toBe(
      false,
    );
    expect(
      historyQuerySchema.safeParse({
        from,
        to: "2026-04-11T00:00:00.001Z",
      }).success,
    ).toBe(false);
    expect(
      historyQuerySchema.safeParse({ from, to, period: "quarter" }).success,
    ).toBe(false);
    expect(
      historyQuerySchema.safeParse({ from: "2026-01-01", to }).success,
    ).toBe(false);
  });

  it("permits corrections but requires rewards to spend a non-zero star amount", () => {
    const base = {
      reason: "A small reward",
      clientRequestId: "cd9659b5-7c9c-44aa-a80f-1f0b37564cc8",
    } as const;

    expect(
      starAdjustmentSchema.parse({
        ...base,
        delta: -1,
        kind: "reward",
      }),
    ).toMatchObject({ delta: -1, kind: "reward" });
    expect(
      starAdjustmentSchema.safeParse({
        ...base,
        delta: 1,
        kind: "reward",
      }).success,
    ).toBe(false);
    expect(
      starAdjustmentSchema.safeParse({
        ...base,
        delta: 0,
        kind: "correction",
      }).success,
    ).toBe(false);
    expect(
      starAdjustmentSchema.safeParse({
        ...base,
        delta: 2,
        kind: "correction",
      }).success,
    ).toBe(true);
  });
});

describe("star calculation", () => {
  it.each([
    {
      happyCount: 0,
      adjustmentTotal: 0,
      balance: 0,
      automaticEarned: 0,
      progress: 0,
    },
    {
      happyCount: 9,
      adjustmentTotal: 0,
      balance: 0,
      automaticEarned: 0,
      progress: 9,
    },
    {
      happyCount: 10,
      adjustmentTotal: 0,
      balance: 1,
      automaticEarned: 1,
      progress: 0,
    },
    {
      happyCount: 19,
      adjustmentTotal: -1,
      balance: 0,
      automaticEarned: 1,
      progress: 9,
    },
    {
      happyCount: 20,
      adjustmentTotal: 2,
      balance: 4,
      automaticEarned: 2,
      progress: 0,
    },
  ])(
    "maps $happyCount ordered happy events and $adjustmentTotal adjustments at reward boundaries",
    ({ happyCount, adjustmentTotal, balance, automaticEarned, progress }) => {
      const events = Array.from({ length: happyCount }, () => ({
        kind: "happy" as const,
      }));
      expect(calculateStarSummary(events, adjustmentTotal)).toEqual({
        balance,
        happyCount,
        trickyCount: 0,
        completedSkillCount: 0,
        effectiveHappyCount: happyCount,
        automaticEarned,
        adjustmentTotal,
        progress,
        target: 10,
      });
    },
  );
});
