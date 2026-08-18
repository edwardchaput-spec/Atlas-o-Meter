"use client";

import {
  Award,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Info,
  RefreshCw,
  Star,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MoodAvatar } from "@/components/mood-avatar";
import { apiRequest, ClientApiError } from "@/lib/client-api";
import {
  buildHistoryBuckets,
  getHistoryWindow,
  shiftHistoryAnchor,
  summarizeHistory,
  type HistoryPeriod,
} from "@/lib/history";
import type { HistoryPayload } from "@/lib/types";

interface HistoryViewProps {
  online: boolean;
  onUnauthenticated: () => void;
}

const PERIODS: Array<{ value: HistoryPeriod; label: string }> = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
];

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export function HistoryView({ online, onUnauthenticated }: HistoryViewProps) {
  const [period, setPeriod] = useState<HistoryPeriod>("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [payload, setPayload] = useState<HistoryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestVersion = useRef(0);

  const historyWindow = useMemo(
    () => getHistoryWindow(period, anchor),
    [anchor, period],
  );
  const from = historyWindow.start.toISOString();
  const to = historyWindow.end.toISOString();

  const load = useCallback(
    async (foreground = false) => {
      if (!online) {
        if (foreground) setLoading(false);
        return;
      }
      const version = ++requestVersion.current;
      if (foreground) setLoading(true);
      try {
        const query = new URLSearchParams({ from, to });
        const next = await apiRequest<HistoryPayload>(
          `/api/history?${query.toString()}`,
        );
        if (version !== requestVersion.current) return;
        setPayload(next);
        setError("");
      } catch (caught) {
        if (version !== requestVersion.current) return;
        if (caught instanceof ClientApiError && caught.status === 401) {
          onUnauthenticated();
          return;
        }
        setError(
          caught instanceof Error
            ? caught.message
            : "History could not be loaded.",
        );
      } finally {
        if (version === requestVersion.current) setLoading(false);
      }
    },
    [from, onUnauthenticated, online, to],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void load(true), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    const poll = window.setInterval(refresh, 12_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  const currentPayload =
    payload?.range.from === from && payload.range.to === to ? payload : null;
  const buckets = useMemo(
    () =>
      currentPayload
        ? buildHistoryBuckets(currentPayload, historyWindow)
        : null,
    [currentPayload, historyWindow],
  );
  const summary = useMemo(
    () =>
      currentPayload && buckets
        ? summarizeHistory(currentPayload, buckets)
        : null,
    [buckets, currentPayload],
  );
  const maxFaces = Math.max(
    1,
    ...(buckets?.flatMap((bucket) => [bucket.happy, bucket.tricky]) ?? []),
  );
  const empty =
    summary &&
    summary.happy === 0 &&
    summary.tricky === 0 &&
    summary.skills === 0 &&
    currentPayload?.adjustments.length === 0;

  return (
    <div className="history-view">
      <div className="period-selector" aria-label="History period">
        {PERIODS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={period === option.value ? "is-selected" : ""}
            aria-pressed={period === option.value}
            onClick={() => {
              setPeriod(option.value);
              setAnchor(new Date());
            }}
          >
            {option.label}
          </button>
        ))}
      </div>

      <section className="history-range-card" aria-label={historyWindow.label}>
        <button
          className="icon-button"
          type="button"
          onClick={() =>
            setAnchor((date) => shiftHistoryAnchor(period, date, -1))
          }
          aria-label={`Previous ${period}`}
        >
          <ChevronLeft aria-hidden="true" size={21} />
        </button>
        <div>
          <strong>{historyWindow.label}</strong>
          <button type="button" onClick={() => setAnchor(new Date())}>
            This period
          </button>
        </div>
        <button
          className="icon-button"
          type="button"
          onClick={() =>
            setAnchor((date) => shiftHistoryAnchor(period, date, 1))
          }
          aria-label={`Next ${period}`}
        >
          <ChevronRight aria-hidden="true" size={21} />
        </button>
      </section>

      {!online ? (
        <p className="history-offline" role="status">
          History will refresh when this phone reconnects.
        </p>
      ) : null}

      {error ? (
        <section className="error-panel" role="alert">
          <div>
            <strong>We couldn&apos;t load this overview.</strong>
            <p>{error}</p>
          </div>
          <button
            className="button button--small"
            type="button"
            onClick={() => void load(true)}
          >
            Retry
          </button>
        </section>
      ) : null}

      {loading && !currentPayload ? (
        <div className="loading-stack" role="status">
          <div className="skeleton skeleton--history" />
          <span className="sr-only">Loading history…</span>
        </div>
      ) : summary && buckets ? (
        <>
          <section className="history-summary" aria-label="Period totals">
            <article>
              <MoodAvatar mood="happy" size={36} />
              <span>Happy</span>
              <strong>{summary.happy}</strong>
            </article>
            <article>
              <MoodAvatar mood="sad" size={36} />
              <span>Tricky</span>
              <strong>{summary.tricky}</strong>
            </article>
            <article>
              <span className="history-summary__icon history-summary__icon--skill">
                <Award aria-hidden="true" size={20} />
              </span>
              <span>Skills learned</span>
              <strong>{summary.skills}</strong>
            </article>
            <article>
              <span className="history-summary__icon">
                <Star aria-hidden="true" size={19} fill="currentColor" />
              </span>
              <span>Auto-star change</span>
              <strong>{signed(summary.automaticStars)}</strong>
            </article>
            <article>
              <span className="history-summary__icon history-summary__icon--progress">
                <Gauge aria-hidden="true" size={20} />
              </span>
              <span>End progress</span>
              <strong>{summary.closingProgress}/10</strong>
            </article>
            <article>
              <span className="history-summary__icon history-summary__icon--balance">
                <BarChart3 aria-hidden="true" size={19} />
              </span>
              <span>End balance</span>
              <strong>{summary.closingBalance}</strong>
            </article>
          </section>

          {empty ? (
            <section className="history-empty">
              <BarChart3 aria-hidden="true" size={28} />
              <h2>No activity in this period</h2>
              <p>Faces, learned skills, and star changes will appear here.</p>
            </section>
          ) : (
            <>
              <section
                className="trend-card"
                aria-labelledby="mood-trend-heading"
              >
                <div className="trend-card__heading">
                  <div>
                    <p className="eyebrow">Mood pattern</p>
                    <h2 id="mood-trend-heading">Faces over time</h2>
                  </div>
                  <button
                    className="icon-button icon-button--quiet"
                    type="button"
                    onClick={() => void load(true)}
                    disabled={loading}
                    aria-label="Refresh history"
                  >
                    <RefreshCw
                      className={loading ? "spin" : ""}
                      aria-hidden="true"
                      size={17}
                    />
                  </button>
                </div>
                <div className="trend-legend" aria-hidden="true">
                  <span>
                    <i className="is-happy" /> Happy
                  </span>
                  <span>
                    <i className="is-tricky" /> Tricky
                  </span>
                </div>
                <ol className="mood-chart" aria-label="Face counts by period">
                  {buckets.map((bucket) => (
                    <li key={bucket.start.toISOString()}>
                      <span className="mood-chart__label">
                        {bucket.shortLabel}
                      </span>
                      <div className="mood-bars" aria-hidden="true">
                        <i
                          className="mood-bar mood-bar--happy"
                          style={{
                            width: `${(bucket.happy / maxFaces) * 100}%`,
                          }}
                        />
                        <i
                          className="mood-bar mood-bar--tricky"
                          style={{
                            width: `${(bucket.tricky / maxFaces) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="mood-chart__values">
                        {bucket.happy} happy · {bucket.tricky} tricky
                        {bucket.skills
                          ? ` · ${bucket.skills} skill${bucket.skills === 1 ? "" : "s"}`
                          : ""}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>

              <section
                className="period-stars"
                aria-labelledby="period-stars-heading"
              >
                <div className="period-stars__heading">
                  <span>
                    <Star aria-hidden="true" size={22} fill="currentColor" />
                  </span>
                  <div>
                    <p className="eyebrow">Star movement</p>
                    <h2 id="period-stars-heading">This period</h2>
                  </div>
                </div>
                <dl>
                  <div>
                    <dt>Opening balance</dt>
                    <dd>{summary.openingBalance}</dd>
                  </div>
                  <div>
                    <dt>Automatic star change</dt>
                    <dd>{signed(summary.automaticStars)}</dd>
                  </div>
                  <div>
                    <dt>Corrections added</dt>
                    <dd>+{summary.correctionsAdded}</dd>
                  </div>
                  <div>
                    <dt>Corrections removed</dt>
                    <dd>−{summary.correctionsRemoved}</dd>
                  </div>
                  <div>
                    <dt>Rewards used</dt>
                    <dd>−{summary.rewardsSpent}</dd>
                  </div>
                  <div className="period-stars__total">
                    <dt>Net change</dt>
                    <dd>{signed(summary.netStarChange)}</dd>
                  </div>
                </dl>
              </section>

              <section
                className="bucket-details"
                aria-labelledby="bucket-details-heading"
              >
                <h2 id="bucket-details-heading">Breakdown</h2>
                <ul>
                  {buckets.map((bucket) => (
                    <li key={bucket.start.toISOString()}>
                      <div>
                        <strong>{bucket.label}</strong>
                        <span>
                          {bucket.happy} happy · {bucket.tricky} tricky
                          {bucket.skills
                            ? ` · ${bucket.skills} skill${bucket.skills === 1 ? "" : "s"} (+${bucket.skills * 5})`
                            : ""}
                        </span>
                      </div>
                      <div>
                        <strong>{signed(bucket.netStarChange)} stars</strong>
                        <span>Balance {bucket.closingBalance}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}

          <aside className="history-note">
            <Info aria-hidden="true" size={18} />
            <p>
              History reflects today&apos;s active records. Correcting or
              removing an older face, or reopening a learned skill, can move a
              reconstructed star milestone.
            </p>
          </aside>
        </>
      ) : null}
    </div>
  );
}
