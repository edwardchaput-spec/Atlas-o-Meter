"use client";

import { BookOpenCheck, Save, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Modal } from "@/components/modal";
import type { SkillEntry } from "@/lib/types";

export interface SkillFormValue {
  name: string;
}

interface SkillFormProps {
  skill: SkillEntry | null;
  onClose: () => void;
  onSave: (value: SkillFormValue) => Promise<void>;
  onDelete: ((skill: SkillEntry) => Promise<void>) | null;
}

function cleanSkillName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function SkillForm({
  skill,
  onClose,
  onSave,
  onDelete,
}: SkillFormProps) {
  const [name, setName] = useState(skill?.name ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanedName = cleanSkillName(name);
    if (!cleanedName) {
      setError("Enter a skill for Atlas to learn.");
      return;
    }
    if (cleanedName.length < 2) {
      setError("Use at least 2 characters for the skill.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await onSave({ name: cleanedName });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "That skill could not be saved.",
      );
      setSaving(false);
    }
  }

  async function remove() {
    if (!skill || !onDelete) return;
    const impact = skill.completedAt
      ? " This removes its five happy-face points and recalculates automatic stars."
      : "";
    if (
      !window.confirm(`Remove “${skill.name}” from the skills list?${impact}`)
    )
      return;

    setDeleting(true);
    setError("");
    try {
      await onDelete(skill);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "That skill could not be removed.",
      );
      setDeleting(false);
    }
  }

  return (
    <Modal
      title={skill ? "Update skill" : "Add a skill"}
      description={
        skill
          ? "Correct the name while keeping its shared history."
          : "Choose one clear thing Atlas can practise and learn."
      }
      onClose={onClose}
    >
      <form className="sheet-form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="skill-name">What is Atlas learning?</label>
          <input
            id="skill-name"
            value={name}
            minLength={2}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Tying his shoelaces"
            autoComplete="off"
            autoFocus
            required
          />
          <p className="field-hint">
            {skill
              ? "This change will appear on both phones."
              : "Both Edward and Lisa will see this in the shared list."}
          </p>
        </div>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <button
          className="button button--primary button--wide"
          type="submit"
          disabled={saving || deleting}
        >
          {skill ? (
            <Save aria-hidden="true" size={18} />
          ) : (
            <BookOpenCheck aria-hidden="true" size={18} />
          )}
          {saving ? "Saving…" : skill ? "Save changes" : "Add skill"}
        </button>

        {skill && onDelete ? (
          <button
            className="button button--danger button--wide"
            type="button"
            onClick={() => void remove()}
            disabled={saving || deleting}
          >
            <Trash2 aria-hidden="true" size={17} />
            {deleting ? "Removing…" : "Remove skill"}
          </button>
        ) : null}
      </form>
    </Modal>
  );
}
