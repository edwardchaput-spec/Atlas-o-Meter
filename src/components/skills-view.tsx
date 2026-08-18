"use client";

import { format } from "date-fns";
import {
  Award,
  BookOpenCheck,
  CircleCheckBig,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useMemo } from "react";

import type { SkillEntry, StarSummary } from "@/lib/types";

interface SkillsViewProps {
  skills: SkillEntry[];
  stars: StarSummary;
  online: boolean;
  pendingSkillId: string | null;
  onAdd: () => void;
  onEdit: (skill: SkillEntry) => void;
  onComplete: (skill: SkillEntry) => void;
  onReopen: (skill: SkillEntry) => void;
}

function personName(slug: SkillEntry["createdBy"]): "Edward" | "Lisa" {
  return slug === "edward" ? "Edward" : "Lisa";
}

export function SkillsView({
  skills,
  stars,
  online,
  pendingSkillId,
  onAdd,
  onEdit,
  onComplete,
  onReopen,
}: SkillsViewProps) {
  const { learning, learned } = useMemo(() => {
    const active = skills
      .filter((skill) => !skill.completedAt)
      .sort(
        (left, right) =>
          Date.parse(right.createdAt) - Date.parse(left.createdAt),
      );
    const complete = skills
      .filter((skill) => Boolean(skill.completedAt))
      .sort(
        (left, right) =>
          Date.parse(right.completedAt ?? right.updatedAt) -
          Date.parse(left.completedAt ?? left.updatedAt),
      );
    return { learning: active, learned: complete };
  }, [skills]);

  function confirmReopen(skill: SkillEntry) {
    const confirmed = window.confirm(
      `Move “${skill.name}” back to learning? This removes its five happy-face points and recalculates automatic stars.`,
    );
    if (confirmed) onReopen(skill);
  }

  return (
    <div className="skills-view">
      <section className="skills-hero" aria-labelledby="skills-intro-heading">
        <div className="skills-hero__glow" aria-hidden="true" />
        <div className="skills-hero__heading">
          <span className="skills-hero__icon" aria-hidden="true">
            <Award size={25} />
          </span>
          <div>
            <p className="eyebrow">Growing confidence</p>
            <h2 id="skills-intro-heading">Practise, learn, celebrate</h2>
          </div>
        </div>
        <p className="skills-hero__copy">
          When Atlas learns a skill, it adds five happy-face points — halfway to
          an automatic star.
        </p>
        <div className="skills-hero__stats" aria-label="Skills summary">
          <div>
            <strong>{learning.length}</strong>
            <span>learning</span>
          </div>
          <div>
            <strong>{learned.length}</strong>
            <span>learned</span>
          </div>
          <div>
            <strong>+{stars.completedSkillCount * 5}</strong>
            <span>face points</span>
          </div>
        </div>
      </section>

      <section className="skills-section" aria-labelledby="learning-heading">
        <div className="section-heading skills-section__heading">
          <div>
            <p className="eyebrow">In progress</p>
            <h2 id="learning-heading">Learning</h2>
          </div>
          <span className="skills-count">
            {learning.length} skill{learning.length === 1 ? "" : "s"}
          </span>
        </div>

        {learning.length ? (
          <ul className="skill-list">
            {learning.map((skill) => {
              const pending = pendingSkillId === skill.id;
              const busy = pendingSkillId !== null;
              return (
                <li className="skill-card" key={skill.id}>
                  <span className="skill-card__icon" aria-hidden="true">
                    <BookOpenCheck size={22} />
                  </span>
                  <div className="skill-card__copy">
                    <div className="skill-card__title-row">
                      <h3>{skill.name}</h3>
                      <button
                        className="icon-button icon-button--quiet skill-card__edit"
                        type="button"
                        onClick={() => onEdit(skill)}
                        disabled={!online || busy}
                        aria-label={`Edit ${skill.name}`}
                      >
                        <Pencil aria-hidden="true" size={15} />
                      </button>
                    </div>
                    <p>
                      Added by {personName(skill.createdBy)} ·{" "}
                      {format(new Date(skill.createdAt), "d MMM yyyy")}
                    </p>
                  </div>
                  <button
                    className="button button--soft skill-card__primary-action"
                    type="button"
                    onClick={() => onComplete(skill)}
                    disabled={!online || busy}
                    aria-label={`Mark ${skill.name} as learned`}
                  >
                    <CircleCheckBig aria-hidden="true" size={18} />
                    {pending ? "Saving…" : "Mark learned"}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="skills-empty">
            <Sparkles aria-hidden="true" size={26} />
            <h3>
              {learned.length
                ? "Ready for the next skill"
                : "Start a skills list"}
            </h3>
            <p>
              {learned.length
                ? "Everything on the list has been learned. Add the next thing when Atlas is ready."
                : "Add one clear skill for Atlas to practise together."}
            </p>
            <button
              className="button button--soft"
              type="button"
              onClick={onAdd}
              disabled={!online || pendingSkillId !== null}
            >
              <Plus aria-hidden="true" size={18} /> Add a skill
            </button>
          </div>
        )}
      </section>

      <section className="skills-section" aria-labelledby="learned-heading">
        <div className="section-heading skills-section__heading">
          <div>
            <p className="eyebrow">Achievements</p>
            <h2 id="learned-heading">Learned</h2>
          </div>
          <span className="skills-count">
            {learned.length} skill{learned.length === 1 ? "" : "s"}
          </span>
        </div>

        {learned.length ? (
          <ul className="skill-list">
            {learned.map((skill) => {
              const pending = pendingSkillId === skill.id;
              const busy = pendingSkillId !== null;
              return (
                <li className="skill-card skill-card--complete" key={skill.id}>
                  <span
                    className="skill-card__icon skill-card__icon--complete"
                    aria-hidden="true"
                  >
                    <CircleCheckBig size={23} />
                  </span>
                  <div className="skill-card__copy">
                    <div className="skill-card__title-row">
                      <h3>{skill.name}</h3>
                      <div className="skill-card__title-tools">
                        <span
                          className="skill-face-value"
                          aria-label="Adds five happy-face points"
                        >
                          +5 faces
                        </span>
                        <button
                          className="icon-button icon-button--quiet skill-card__edit"
                          type="button"
                          onClick={() => onEdit(skill)}
                          disabled={!online || busy}
                          aria-label={`Edit ${skill.name}`}
                        >
                          <Pencil aria-hidden="true" size={15} />
                        </button>
                      </div>
                    </div>
                    <p>
                      Learned by{" "}
                      {personName(skill.completedBy ?? skill.updatedBy)} ·{" "}
                      {format(
                        new Date(skill.completedAt ?? skill.updatedAt),
                        "d MMM yyyy",
                      )}
                    </p>
                  </div>
                  <button
                    className="button button--text skill-card__reopen"
                    type="button"
                    onClick={() => confirmReopen(skill)}
                    disabled={!online || busy}
                    aria-label={`Mark ${skill.name} as still learning`}
                  >
                    <RotateCcw aria-hidden="true" size={16} />
                    {pending ? "Saving…" : "Still learning"}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="compact-empty skills-compact-empty">
            <Award aria-hidden="true" size={22} />
            <p>Learned skills and their five-point boost will appear here.</p>
          </div>
        )}
      </section>
    </div>
  );
}
