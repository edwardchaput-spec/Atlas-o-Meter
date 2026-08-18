import { z } from "zod";

import { USER_SLUGS } from "@/lib/types";

export { calculateStarSummary } from "@/lib/progress";

const isoDateTime = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString())
  .refine((value) => {
    const year = new Date(value).getUTCFullYear();
    return year >= 2000 && year <= 2100;
  }, "Enter a date and time between 2000 and 2100.");

export const loginSchema = z
  .object({
    username: z.string().trim().toLowerCase().pipe(z.enum(USER_SLUGS)),
  })
  .strict();

export const googleLoginSchema = z
  .object({
    username: z.string().trim().toLowerCase().pipe(z.literal("edward")),
  })
  .strict();

const rawPassword = z
  .string()
  .max(128, "Use no more than 128 characters.")
  .refine(
    (value) => Buffer.byteLength(value, "utf8") <= 512,
    "That password is too large.",
  );

export const passwordLoginSchema = z
  .object({
    username: z.literal("lisa"),
    password: rawPassword.min(1, "Enter Lisa's password."),
  })
  .strict();

export const lisaPasswordUpdateSchema = z
  .object({
    password: rawPassword
      .min(12, "Use at least 12 characters.")
      .refine(
        (value) => /\S/u.test(value),
        "Use at least one visible character.",
      ),
  })
  .strict();

const base64Url = z
  .string()
  .min(1)
  .max(131_072)
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid WebAuthn value.");

const authenticatorTransports = z.array(
  z.enum(["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"]),
);

const clientExtensionResults = z.record(z.string().max(64), z.unknown());

export const webAuthnRegistrationResponseSchema = z
  .object({
    id: base64Url.max(2048),
    rawId: base64Url.max(2048),
    response: z
      .object({
        clientDataJSON: base64Url,
        attestationObject: base64Url,
        transports: authenticatorTransports.optional(),
        publicKeyAlgorithm: z.number().int().optional(),
        publicKey: base64Url.optional(),
        authenticatorData: base64Url.optional(),
      })
      .strict(),
    type: z.literal("public-key"),
    clientExtensionResults,
    authenticatorAttachment: z.enum(["cross-platform", "platform"]).optional(),
  })
  .strict();

export const webAuthnAuthenticationRequestSchema = z
  .object({
    username: z.string().trim().toLowerCase().pipe(z.enum(USER_SLUGS)),
    response: z
      .object({
        id: base64Url.max(2048),
        rawId: base64Url.max(2048),
        response: z
          .object({
            clientDataJSON: base64Url,
            authenticatorData: base64Url,
            signature: base64Url,
            userHandle: base64Url.max(2048).optional(),
          })
          .strict(),
        type: z.literal("public-key"),
        clientExtensionResults,
        authenticatorAttachment: z
          .enum(["cross-platform", "platform"])
          .optional(),
      })
      .strict(),
  })
  .strict();

export const behaviorCreateSchema = z
  .object({
    mood: z.enum(["happy", "sad"]),
    occurredAt: isoDateTime,
    tag: z.string().max(48).nullable(),
    clientRequestId: z.string().uuid(),
  })
  .strict();

export const behaviorUpdateSchema = z
  .object({
    mood: z.enum(["happy", "sad"]),
    occurredAt: isoDateTime,
    tag: z.string().max(48).nullable(),
    version: z.number().int().min(1),
  })
  .strict();

export const behaviorDeleteSchema = z
  .object({
    version: z.number().int().min(1),
  })
  .strict();

export function cleanSkillName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

const skillName = z
  .string()
  .transform(cleanSkillName)
  .pipe(
    z
      .string()
      .min(2, "Use at least 2 characters for the skill.")
      .max(80, "Use no more than 80 characters for the skill."),
  );

export const skillCreateSchema = z
  .object({
    name: skillName,
    clientRequestId: z.string().uuid(),
  })
  .strict();

export const skillUpdateSchema = z
  .object({
    name: skillName.optional(),
    completed: z.boolean().optional(),
    version: z.number().int().min(1),
  })
  .strict()
  .refine(
    ({ name, completed }) => name !== undefined || completed !== undefined,
    {
      message: "Change the skill name or its completion status.",
    },
  );

export const skillDeleteSchema = z
  .object({
    version: z.number().int().min(1),
  })
  .strict();

export const dashboardQuerySchema = z
  .object({
    from: isoDateTime,
    to: isoDateTime,
  })
  .strict()
  .superRefine(({ from, to }, context) => {
    const fromTime = Date.parse(from);
    const toTime = Date.parse(to);
    if (toTime <= fromTime) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "The end must be after the start.",
      });
    }
    if (toTime - fromTime > 32 * 24 * 60 * 60 * 1000) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "Choose a range of 32 days or fewer.",
      });
    }
  });

export const historyQuerySchema = z
  .object({
    from: isoDateTime,
    to: isoDateTime,
  })
  .strict()
  .superRefine(({ from, to }, context) => {
    const fromTime = Date.parse(from);
    const toTime = Date.parse(to);
    if (toTime <= fromTime) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "The end must be after the start.",
      });
    }
    if (toTime - fromTime > 100 * 24 * 60 * 60 * 1000) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "Choose a range of 100 days or fewer.",
      });
    }
  });

export const starAdjustmentSchema = z
  .object({
    delta: z.number().int().min(-50).max(50).refine(Boolean, {
      message: "The star change cannot be zero.",
    }),
    kind: z.enum(["correction", "reward"]),
    reason: z.string().trim().min(2).max(80),
    clientRequestId: z.string().uuid(),
  })
  .strict()
  .superRefine(({ delta, kind }, context) => {
    if (kind === "reward" && delta >= 0) {
      context.addIssue({
        code: "custom",
        path: ["delta"],
        message: "A reward must use at least one star.",
      });
    }
  });

export function normalizeTagName(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-GB");
}

export function cleanTagName(value: string | null): string | null {
  if (value === null) return null;
  const cleaned = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  return cleaned.length === 0 ? null : cleaned;
}

export function normalizeSkillName(value: string): string {
  return cleanSkillName(value).toLocaleLowerCase("en-GB");
}

export function displayName(
  slug: (typeof USER_SLUGS)[number],
): "Edward" | "Lisa" {
  return slug === "edward" ? "Edward" : "Lisa";
}
