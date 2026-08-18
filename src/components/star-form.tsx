"use client";

import { Gift, Minus, Plus, Star } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Modal } from "@/components/modal";
import type { AdjustmentKind } from "@/lib/types";

export type StarFormMode = "add" | "remove" | "reward";

export interface StarFormValue {
  delta: number;
  kind: AdjustmentKind;
  reason: string;
}

interface StarFormProps {
  mode: StarFormMode;
  balance: number;
  onClose: () => void;
  onSave: (value: StarFormValue) => Promise<void>;
}

const modeCopy: Record<
  StarFormMode,
  { title: string; description: string; reason: string }
> = {
  add: {
    title: "Add stars",
    description: "Make a clear correction to the balance.",
    reason: "Why are stars being added?",
  },
  remove: {
    title: "Remove stars",
    description: "Correct a mistake without losing the history.",
    reason: "Why are stars being removed?",
  },
  reward: {
    title: "Use stars for a reward",
    description: "Record the gift or treat they have been traded for.",
    reason: "What was the reward?",
  },
};

export function StarForm({ mode, balance, onClose, onSave }: StarFormProps) {
  const [amount, setAmount] = useState(1);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const copy = modeCopy[mode];
  const isNegative = mode !== "add";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave({
        delta: isNegative ? -amount : amount,
        kind: mode === "reward" ? "reward" : "correction",
        reason,
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "That star change could not be saved.",
      );
      setSaving(false);
    }
  }

  return (
    <Modal title={copy.title} description={copy.description} onClose={onClose}>
      <form className="sheet-form" onSubmit={submit}>
        <div className="star-amount" aria-label={`${amount} stars`}>
          <button
            type="button"
            className="amount-button"
            onClick={() => setAmount((current) => Math.max(1, current - 1))}
            disabled={amount <= 1}
            aria-label="One fewer star"
          >
            <Minus aria-hidden="true" size={20} />
          </button>
          <div>
            <span className="star-amount__number">{amount}</span>
            <span className="star-amount__label">
              <Star aria-hidden="true" size={17} fill="currentColor" /> star
              {amount === 1 ? "" : "s"}
            </span>
          </div>
          <button
            type="button"
            className="amount-button"
            onClick={() => setAmount((current) => Math.min(50, current + 1))}
            disabled={amount >= 50 || (mode === "reward" && amount >= balance)}
            aria-label="One more star"
          >
            <Plus aria-hidden="true" size={20} />
          </button>
        </div>

        <div className="field">
          <label htmlFor="star-reason">{copy.reason}</label>
          <input
            id="star-reason"
            value={reason}
            minLength={2}
            maxLength={80}
            onChange={(event) => setReason(event.target.value)}
            placeholder={
              mode === "reward"
                ? "e.g. Choose tonight's film"
                : "e.g. Correcting a mistake"
            }
            required
            autoFocus
          />
        </div>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <button
          className={`button button--wide ${mode === "reward" ? "button--gold" : "button--primary"}`}
          type="submit"
          disabled={saving || (mode === "reward" && balance < 1)}
        >
          {mode === "reward" ? (
            <Gift aria-hidden="true" size={18} />
          ) : (
            <Star aria-hidden="true" size={18} />
          )}
          {saving
            ? "Saving…"
            : mode === "reward"
              ? `Use ${amount} star${amount === 1 ? "" : "s"}`
              : `${mode === "add" ? "Add" : "Remove"} ${amount} star${amount === 1 ? "" : "s"}`}
        </button>
      </form>
    </Modal>
  );
}
