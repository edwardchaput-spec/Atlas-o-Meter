"use client";

import { format } from "date-fns";
import { Save } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import { Modal } from "@/components/modal";
import { MoodAvatar } from "@/components/mood-avatar";
import type { BehaviorEntry, Mood, TagSummary } from "@/lib/types";

export interface BehaviorFormValue {
  mood: Mood;
  occurredAt: string;
  tag: string | null;
}

interface BehaviorFormProps {
  entry: BehaviorEntry | null;
  selectedDate: Date;
  tags: TagSummary[];
  onClose: () => void;
  onSave: (value: BehaviorFormValue) => Promise<void>;
}

function initialDateValue(
  entry: BehaviorEntry | null,
  selectedDate: Date,
): string {
  if (entry) return format(new Date(entry.occurredAt), "yyyy-MM-dd'T'HH:mm");
  const now = new Date();
  const date = new Date(selectedDate);
  date.setHours(now.getHours(), now.getMinutes(), 0, 0);
  return format(date, "yyyy-MM-dd'T'HH:mm");
}

export function BehaviorForm({
  entry,
  selectedDate,
  tags,
  onClose,
  onSave,
}: BehaviorFormProps) {
  const [mood, setMood] = useState<Mood>(entry?.mood ?? "happy");
  const [occurredAt, setOccurredAt] = useState(
    initialDateValue(entry, selectedDate),
  );
  const [tag, setTag] = useState(entry?.tag?.name ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const sortedTags = useMemo(
    () => [...tags].sort((left, right) => right.usageCount - left.usageCount),
    [tags],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave({
        mood,
        occurredAt: new Date(occurredAt).toISOString(),
        tag: tag.trim() || null,
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "That behaviour could not be saved.",
      );
      setSaving(false);
    }
  }

  return (
    <Modal
      title={entry ? "Update behaviour" : "Add a behaviour"}
      description={
        entry
          ? "Change the face, time, or tag."
          : "A quick moment worth remembering."
      }
      onClose={onClose}
    >
      <form className="sheet-form" onSubmit={submit}>
        <fieldset className="mood-fieldset">
          <legend>How did it go?</legend>
          <div className="mood-options">
            <button
              className={`mood-option mood-option--happy ${mood === "happy" ? "is-selected" : ""}`}
              type="button"
              aria-pressed={mood === "happy"}
              onClick={() => setMood("happy")}
            >
              <MoodAvatar
                mood="happy"
                size={44}
                className="mood-option__avatar"
              />
              <span>
                <strong>Happy</strong>
                <small>A positive moment</small>
              </span>
            </button>
            <button
              className={`mood-option mood-option--sad ${mood === "sad" ? "is-selected" : ""}`}
              type="button"
              aria-pressed={mood === "sad"}
              onClick={() => setMood("sad")}
            >
              <MoodAvatar
                mood="sad"
                size={44}
                className="mood-option__avatar"
              />
              <span>
                <strong>Tricky</strong>
                <small>A tricky moment</small>
              </span>
            </button>
          </div>
        </fieldset>

        <div className="field">
          <label htmlFor="occurred-at">When?</label>
          <input
            id="occurred-at"
            type="datetime-local"
            value={occurredAt}
            onChange={(event) => setOccurredAt(event.target.value)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="behaviour-tag">
            Tag <span className="optional">optional</span>
          </label>
          <input
            id="behaviour-tag"
            list="existing-tags"
            value={tag}
            maxLength={48}
            onChange={(event) => setTag(event.target.value)}
            placeholder="e.g. Tidying up"
            autoComplete="off"
          />
          <datalist id="existing-tags">
            {sortedTags.map((existingTag) => (
              <option key={existingTag.id} value={existingTag.name} />
            ))}
          </datalist>
          <p className="field-hint">
            Choose an existing tag or type a new one.
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
          disabled={saving}
        >
          <Save aria-hidden="true" size={18} />
          {saving ? "Saving…" : entry ? "Save changes" : "Add to calendar"}
        </button>
      </form>
    </Modal>
  );
}
