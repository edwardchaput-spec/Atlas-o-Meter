"use client";

import {
  addDays,
  format,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfWeek,
} from "date-fns";
import {
  Award,
  CalendarDays,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Download,
  Gift,
  Fingerprint,
  History,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Settings,
  ShieldAlert,
  Sparkles,
  Star,
  Tags,
  Trash2,
  WifiOff,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  BehaviorForm,
  type BehaviorFormValue,
} from "@/components/behavior-form";
import { HappyCelebration } from "@/components/happy-celebration";
import { HistoryView } from "@/components/history-view";
import { LoginScreen } from "@/components/login-screen";
import { LisaPasswordSettings } from "@/components/lisa-password-settings";
import { MoodAvatar } from "@/components/mood-avatar";
import { PasskeyEnrollment } from "@/components/passkey-enrollment";
import { SkillForm, type SkillFormValue } from "@/components/skill-form";
import { SkillsView } from "@/components/skills-view";
import {
  StarForm,
  type StarFormMode,
  type StarFormValue,
} from "@/components/star-form";
import { apiRequest, ClientApiError } from "@/lib/client-api";
import type {
  BehaviorEntry,
  DashboardPayload,
  PasskeyStatus,
  SessionUser,
  SkillEntry,
  StarSummary,
} from "@/lib/types";

type Tab = "calendar" | "skills" | "history" | "stars" | "settings";
type SyncState = "loading" | "syncing" | "saved" | "error";

const TAB_COPY: Record<Tab, { eyebrow: string; title: string }> = {
  calendar: { eyebrow: "Behaviour calendar", title: "This week" },
  skills: { eyebrow: "Growing confidence", title: "Skills" },
  history: { eyebrow: "Patterns over time", title: "History" },
  stars: { eyebrow: "Reward jar", title: "Stars & rewards" },
  settings: { eyebrow: "Family space", title: "Settings" },
};

interface AtlasAppProps {
  initialUser: SessionUser | null;
  initialPasskeyOffer?: boolean;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface MutationResult {
  stars: StarSummary;
}

interface SkillMutationResult extends MutationResult {
  skill: SkillEntry;
  created?: boolean;
}

function newRequestId(): string {
  return crypto.randomUUID();
}

function moodName(mood: BehaviorEntry["mood"]): "happy" | "tricky" {
  return mood === "happy" ? "happy" : "tricky";
}

export function AtlasApp({
  initialUser,
  initialPasskeyOffer = false,
}: AtlasAppProps) {
  const [user, setUser] = useState(initialUser);
  const [offerPasskey, setOfferPasskey] = useState(initialPasskeyOffer);
  if (!user)
    return (
      <LoginScreen
        onSignedIn={(signedInUser, shouldOfferPasskey) => {
          setUser(signedInUser);
          setOfferPasskey(shouldOfferPasskey);
        }}
      />
    );
  return (
    <AtlasDashboard
      user={user}
      initialPasskeyOffer={offerPasskey}
      onSignedOut={() => {
        setUser(null);
        setOfferPasskey(false);
      }}
    />
  );
}

function AtlasDashboard({
  user,
  initialPasskeyOffer,
  onSignedOut,
}: {
  user: SessionUser;
  initialPasskeyOffer: boolean;
  onSignedOut: () => void;
}) {
  const [tab, setTab] = useState<Tab>("calendar");
  const [selectedDate, setSelectedDate] = useState(() =>
    startOfDay(new Date()),
  );
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("loading");
  const [loadError, setLoadError] = useState("");
  const [online, setOnline] = useState(true);
  const [editor, setEditor] = useState<{ entry: BehaviorEntry | null } | null>(
    null,
  );
  const [skillEditor, setSkillEditor] = useState<{
    skill: SkillEntry | null;
  } | null>(null);
  const [pendingSkillId, setPendingSkillId] = useState<string | null>(null);
  const [starForm, setStarForm] = useState<StarFormMode | null>(null);
  const [toast, setToast] = useState("");
  const [passkeyPrompt, setPasskeyPrompt] = useState(initialPasskeyOffer);
  const [passkeyCount, setPasskeyCount] = useState<number | null>(null);
  const [celebration, setCelebration] = useState<{
    id: number;
    starEarned: boolean;
  } | null>(null);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const celebrationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dashboardRef = useRef<DashboardPayload | null>(null);
  const dashboardRequestVersion = useRef(0);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("passkey")) {
      url.searchParams.delete("passkey");
      window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    }
  }, []);

  const week = useMemo(() => {
    const start = startOfWeek(selectedDate, { weekStartsOn: 1 });
    return {
      start,
      end: addDays(start, 6),
      from: start.toISOString(),
      to: addDays(start, 7).toISOString(),
      days: Array.from({ length: 7 }, (_, index) => addDays(start, index)),
    };
  }, [selectedDate]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4200);
  }, []);

  const loadDashboard = useCallback(
    async (foreground = false) => {
      const requestVersion = ++dashboardRequestVersion.current;
      if (!navigator.onLine) {
        setOnline(false);
        return;
      }
      const currentDashboard = dashboardRef.current;
      if (foreground || !currentDashboard) {
        setSyncState(currentDashboard ? "syncing" : "loading");
      }
      try {
        const query = new URLSearchParams({ from: week.from, to: week.to });
        const data = await apiRequest<DashboardPayload>(
          `/api/dashboard?${query.toString()}`,
        );
        if (requestVersion !== dashboardRequestVersion.current) return;
        dashboardRef.current = data;
        setDashboard(data);
        setLoadError("");
        setSyncState("saved");
      } catch (caught) {
        if (requestVersion !== dashboardRequestVersion.current) return;
        if (caught instanceof ClientApiError && caught.status === 401) {
          onSignedOut();
          return;
        }
        setLoadError(
          caught instanceof Error
            ? caught.message
            : "The shared calendar could not load.",
        );
        setSyncState("error");
      }
    },
    [onSignedOut, week.from, week.to],
  );

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadDashboard(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [loadDashboard]);

  useEffect(() => {
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine)
        void loadDashboard();
    }, 12_000);
    const onFocus = () => void loadDashboard();
    const onOnline = () => {
      setOnline(true);
      void loadDashboard(true);
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [loadDashboard]);

  useEffect(() => {
    const media = window.matchMedia("(display-mode: standalone)");
    const updateStandalone = () => setStandalone(media.matches);
    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    updateStandalone();
    media.addEventListener("change", updateStandalone);
    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    return () => {
      media.removeEventListener("change", updateStandalone);
      window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      if (celebrationTimer.current) clearTimeout(celebrationTimer.current);
    };
  }, []);

  useEffect(() => {
    let active = true;
    void apiRequest<PasskeyStatus>("/api/auth/passkeys")
      .then((status) => {
        if (active) setPasskeyCount(status.count);
      })
      .catch((caught) => {
        if (
          active &&
          caught instanceof ClientApiError &&
          caught.status === 401
        ) {
          onSignedOut();
        }
      });
    return () => {
      active = false;
    };
  }, [onSignedOut]);

  async function saveBehavior(value: BehaviorFormValue) {
    if (!online)
      throw new Error("You are offline. Reconnect before saving a change.");
    const previousAutomatic = dashboard?.stars.automaticEarned ?? 0;
    const previousEffective = dashboard?.stars.effectiveHappyCount ?? 0;
    const wasEditing = Boolean(editor?.entry);
    let result: MutationResult;
    if (editor?.entry) {
      result = await apiRequest<MutationResult>(
        `/api/behaviors/${editor.entry.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ ...value, version: editor.entry.version }),
        },
      );
    } else {
      result = await apiRequest<MutationResult>("/api/behaviors", {
        method: "POST",
        body: JSON.stringify({ ...value, clientRequestId: newRequestId() }),
      });
    }
    setEditor(null);
    await loadDashboard(true);
    const starEarned = result.stars.automaticEarned > previousAutomatic;
    if (value.mood === "happy") {
      if (celebrationTimer.current) clearTimeout(celebrationTimer.current);
      setCelebration({ id: Date.now(), starEarned });
      celebrationTimer.current = setTimeout(() => setCelebration(null), 1350);
    }
    if (starEarned) {
      showToast("A new star! Star progress reached ten ⭐");
    } else {
      showToast(
        wasEditing
          ? "Behaviour updated"
          : value.mood === "sad"
            ? result.stars.effectiveHappyCount < previousEffective
              ? "Tricky moment added — one happy-face point removed"
              : "Tricky moment added — no happy-face point was available to remove"
            : "Behaviour added to the shared calendar",
      );
    }
  }

  async function removeBehavior(entry: BehaviorEntry) {
    const impact =
      " This will recalculate happy-face progress and automatic stars.";
    if (
      !window.confirm(`Remove this ${moodName(entry.mood)} behaviour?${impact}`)
    )
      return;
    try {
      await apiRequest<MutationResult>(`/api/behaviors/${entry.id}`, {
        method: "DELETE",
        body: JSON.stringify({ version: entry.version }),
      });
      await loadDashboard(true);
      showToast("Behaviour removed");
    } catch (caught) {
      showToast(
        caught instanceof Error
          ? caught.message
          : "The behaviour could not be removed.",
      );
      await loadDashboard(true);
    }
  }

  async function saveSkill(value: SkillFormValue) {
    if (!online)
      throw new Error("You are offline. Reconnect before saving a change.");
    const currentSkill = skillEditor?.skill ?? null;
    let result: SkillMutationResult;
    try {
      if (currentSkill) {
        result = await apiRequest<SkillMutationResult>(
          `/api/skills/${currentSkill.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              name: value.name,
              version: currentSkill.version,
            }),
          },
        );
      } else {
        result = await apiRequest<SkillMutationResult>("/api/skills", {
          method: "POST",
          body: JSON.stringify({
            name: value.name,
            clientRequestId: newRequestId(),
          }),
        });
      }
    } catch (caught) {
      if (
        caught instanceof ClientApiError &&
        (caught.code === "STALE_SKILL" || caught.code === "NOT_FOUND")
      ) {
        setSkillEditor(null);
        await loadDashboard(true);
        showToast(
          "That skill changed on the other phone. The list is refreshed.",
        );
        return;
      }
      throw caught;
    }
    setSkillEditor(null);
    await loadDashboard(true);
    showToast(
      currentSkill
        ? "Skill updated on the shared list"
        : result.created === false
          ? "That skill request was already handled; the shared list is up to date"
          : "Skill added to the shared list",
    );
  }

  async function deleteSkill(skill: SkillEntry) {
    if (!online)
      throw new Error("You are offline. Reconnect before removing a skill.");
    try {
      await apiRequest<MutationResult>(`/api/skills/${skill.id}`, {
        method: "DELETE",
        body: JSON.stringify({ version: skill.version }),
      });
    } catch (caught) {
      if (
        caught instanceof ClientApiError &&
        (caught.code === "STALE_SKILL" || caught.code === "NOT_FOUND")
      ) {
        setSkillEditor(null);
        await loadDashboard(true);
        showToast(
          "That skill changed on the other phone. The list is refreshed.",
        );
        return;
      }
      throw caught;
    }
    setSkillEditor(null);
    await loadDashboard(true);
    showToast("Skill removed and star progress recalculated");
  }

  async function setSkillCompletion(skill: SkillEntry, completed: boolean) {
    if (!online || pendingSkillId) return;
    const previousAutomatic = dashboard?.stars.automaticEarned ?? 0;
    setPendingSkillId(skill.id);
    try {
      const result = await apiRequest<SkillMutationResult>(
        `/api/skills/${skill.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ completed, version: skill.version }),
        },
      );
      await loadDashboard(true);

      if (completed) {
        const starEarned = result.stars.automaticEarned > previousAutomatic;
        if (celebrationTimer.current) clearTimeout(celebrationTimer.current);
        setCelebration({ id: Date.now(), starEarned });
        celebrationTimer.current = setTimeout(() => setCelebration(null), 1350);
        showToast(
          starEarned
            ? "Skill learned — five happy faces and a new star! ⭐"
            : "Skill learned — five happy-face points added",
        );
      } else {
        showToast("Skill moved back to learning — star progress recalculated");
      }
    } catch (caught) {
      showToast(
        caught instanceof Error
          ? caught.message
          : "That skill could not be updated.",
      );
      await loadDashboard(true);
    } finally {
      setPendingSkillId(null);
    }
  }

  async function saveStarChange(value: StarFormValue) {
    if (!online)
      throw new Error("You are offline. Reconnect before changing stars.");
    await apiRequest("/api/stars/adjustments", {
      method: "POST",
      body: JSON.stringify({ ...value, clientRequestId: newRequestId() }),
    });
    setStarForm(null);
    await loadDashboard(true);
    showToast(
      value.kind === "reward"
        ? "Reward recorded in the star history"
        : "Star balance corrected",
    );
  }

  async function logout() {
    try {
      await apiRequest("/api/auth/logout", { method: "POST" });
    } finally {
      onSignedOut();
    }
  }

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstallPrompt(null);
  }

  const selectedEntries =
    dashboard?.entries.filter((entry) =>
      isSameDay(new Date(entry.occurredAt), selectedDate),
    ) ?? [];
  const stars = dashboard?.stars;

  return (
    <div className="app-frame">
      {!online ? (
        <div className="offline-banner" role="status">
          <WifiOff aria-hidden="true" size={16} />
          You&apos;re offline. Viewing is available, but changes are paused.
        </div>
      ) : null}

      <header className="app-header">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <Sparkles size={20} />
          </div>
          <div>
            <span className="brand-name">Atlas-o-meter</span>
            <span className="brand-subtitle">Small moments, bright stars</span>
          </div>
        </div>
        <button
          className="header-star"
          type="button"
          onClick={() => setTab("stars")}
        >
          <Star aria-hidden="true" size={17} fill="currentColor" />
          <span>{stars?.balance ?? "—"}</span>
          <span className="sr-only">available stars</span>
        </button>
      </header>

      <main className="app-main">
        <div className="page-heading-row">
          <div>
            <p className="eyebrow">{TAB_COPY[tab].eyebrow}</p>
            <h1>{TAB_COPY[tab].title}</h1>
          </div>
          <div className="sync-indicator" aria-live="polite">
            {syncState === "syncing" || syncState === "loading" ? (
              <RefreshCw className="spin" aria-hidden="true" size={14} />
            ) : syncState === "saved" ? (
              <Check aria-hidden="true" size={15} />
            ) : null}
            <span>
              {syncState === "error"
                ? "Not synced"
                : syncState === "saved"
                  ? "Shared"
                  : "Syncing"}
            </span>
          </div>
        </div>

        {loadError ? (
          <section className="error-panel" role="alert">
            <div>
              <strong>We couldn&apos;t reach the shared calendar.</strong>
              <p>{loadError}</p>
            </div>
            <button
              className="button button--small"
              type="button"
              onClick={() => void loadDashboard(true)}
            >
              Retry
            </button>
          </section>
        ) : null}

        {syncState === "loading" && !dashboard ? (
          <LoadingCards />
        ) : tab === "calendar" ? (
          <CalendarView
            dashboard={dashboard}
            week={week}
            selectedDate={selectedDate}
            selectedEntries={selectedEntries}
            onSelectDate={setSelectedDate}
            onPrevious={() => setSelectedDate((date) => addDays(date, -7))}
            onNext={() => setSelectedDate((date) => addDays(date, 7))}
            onToday={() => setSelectedDate(startOfDay(new Date()))}
            onRefresh={() => void loadDashboard(true)}
            onAdd={() => setEditor({ entry: null })}
            onEdit={(entry) => setEditor({ entry })}
            onRemove={(entry) => void removeBehavior(entry)}
            refreshing={syncState === "syncing"}
          />
        ) : tab === "skills" ? (
          dashboard ? (
            <SkillsView
              skills={dashboard.skills}
              stars={dashboard.stars}
              online={online}
              pendingSkillId={pendingSkillId}
              onAdd={() => setSkillEditor({ skill: null })}
              onEdit={(skill) => setSkillEditor({ skill })}
              onComplete={(skill) => void setSkillCompletion(skill, true)}
              onReopen={(skill) => void setSkillCompletion(skill, false)}
            />
          ) : null
        ) : tab === "history" ? (
          <HistoryView online={online} onUnauthenticated={onSignedOut} />
        ) : tab === "stars" ? (
          <StarsView dashboard={dashboard} onOpenForm={setStarForm} />
        ) : (
          <SettingsView
            dashboard={dashboard}
            user={user}
            standalone={standalone}
            canInstall={Boolean(installPrompt)}
            passkeyCount={passkeyCount}
            onInstall={() => void installApp()}
            onAddPasskey={() => setPasskeyPrompt(true)}
            onLisaPasswordSaved={() =>
              showToast("Lisa’s sign-in password was updated")
            }
            onLogout={() => void logout()}
          />
        )}
      </main>

      {tab === "calendar" || tab === "skills" ? (
        <button
          className="fab"
          type="button"
          onClick={() =>
            tab === "calendar"
              ? setEditor({ entry: null })
              : setSkillEditor({ skill: null })
          }
          disabled={!online || (tab === "skills" && pendingSkillId !== null)}
        >
          <Plus aria-hidden="true" size={21} />
          {tab === "calendar" ? "Add behaviour" : "Add skill"}
        </button>
      ) : null}

      <nav className="bottom-nav" aria-label="Main navigation">
        <NavButton
          active={tab === "calendar"}
          label="Calendar"
          onClick={() => setTab("calendar")}
        >
          <CalendarDays aria-hidden="true" size={21} />
        </NavButton>
        <NavButton
          active={tab === "skills"}
          label="Skills"
          onClick={() => setTab("skills")}
        >
          <Award aria-hidden="true" size={21} />
        </NavButton>
        <NavButton
          active={tab === "history"}
          label="History"
          onClick={() => setTab("history")}
        >
          <BarChart3 aria-hidden="true" size={21} />
        </NavButton>
        <NavButton
          active={tab === "stars"}
          label="Stars"
          onClick={() => setTab("stars")}
        >
          <Star
            aria-hidden="true"
            size={21}
            fill={tab === "stars" ? "currentColor" : "none"}
          />
        </NavButton>
        <NavButton
          active={tab === "settings"}
          label="Settings"
          onClick={() => setTab("settings")}
        >
          <Settings aria-hidden="true" size={21} />
        </NavButton>
      </nav>

      {editor ? (
        <BehaviorForm
          entry={editor.entry}
          selectedDate={selectedDate}
          tags={dashboard?.tags ?? []}
          onClose={() => setEditor(null)}
          onSave={saveBehavior}
        />
      ) : null}
      {skillEditor ? (
        <SkillForm
          skill={skillEditor.skill}
          onClose={() => setSkillEditor(null)}
          onSave={saveSkill}
          onDelete={skillEditor.skill ? deleteSkill : null}
        />
      ) : null}
      {starForm && stars ? (
        <StarForm
          mode={starForm}
          balance={stars.balance}
          onClose={() => setStarForm(null)}
          onSave={saveStarChange}
        />
      ) : null}
      {passkeyPrompt ? (
        <PasskeyEnrollment
          user={user.slug}
          onClose={() => setPasskeyPrompt(false)}
          onRegistered={(count) => {
            setPasskeyCount(count);
            setPasskeyPrompt(false);
            showToast("Phone unlock is ready for next time");
          }}
        />
      ) : null}

      {celebration ? (
        <HappyCelebration
          key={celebration.id}
          starEarned={celebration.starEarned}
        />
      ) : null}

      {toast ? (
        <div className="toast" role="status">
          <Check aria-hidden="true" size={17} />
          {toast}
        </div>
      ) : null}
    </div>
  );
}

function NavButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className={`nav-button ${active ? "is-active" : ""}`}
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

interface WeekRange {
  start: Date;
  end: Date;
  from: string;
  to: string;
  days: Date[];
}

function CalendarView({
  dashboard,
  week,
  selectedDate,
  selectedEntries,
  onSelectDate,
  onPrevious,
  onNext,
  onToday,
  onRefresh,
  onAdd,
  onEdit,
  onRemove,
  refreshing,
}: {
  dashboard: DashboardPayload | null;
  week: WeekRange;
  selectedDate: Date;
  selectedEntries: BehaviorEntry[];
  onSelectDate: (date: Date) => void;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  onRefresh: () => void;
  onAdd: () => void;
  onEdit: (entry: BehaviorEntry) => void;
  onRemove: (entry: BehaviorEntry) => void;
  refreshing: boolean;
}) {
  const rangeLabel = isSameMonth(week.start, week.end)
    ? `${format(week.start, "d")}–${format(week.end, "d MMMM yyyy")}`
    : `${format(week.start, "d MMM")} – ${format(week.end, "d MMM yyyy")}`;

  return (
    <>
      <section className="calendar-card" aria-label={`Week of ${rangeLabel}`}>
        <div className="week-toolbar">
          <button
            className="icon-button"
            type="button"
            onClick={onPrevious}
            aria-label="Previous week"
          >
            <ChevronLeft aria-hidden="true" size={21} />
          </button>
          <div className="week-range">
            <strong>{rangeLabel}</strong>
            <button type="button" onClick={onToday}>
              Jump to today
            </button>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onNext}
            aria-label="Next week"
          >
            <ChevronRight aria-hidden="true" size={21} />
          </button>
        </div>

        <div className="week-strip">
          {week.days.map((day) => {
            const dayEntries =
              dashboard?.entries.filter((entry) =>
                isSameDay(new Date(entry.occurredAt), day),
              ) ?? [];
            const happyCount = dayEntries.filter(
              (entry) => entry.mood === "happy",
            ).length;
            const sadCount = dayEntries.length - happyCount;
            const selected = isSameDay(day, selectedDate);
            const today = isSameDay(day, new Date());
            return (
              <button
                key={day.toISOString()}
                className={`day-button ${selected ? "is-selected" : ""}`}
                type="button"
                onClick={() => onSelectDate(day)}
                aria-pressed={selected}
                aria-label={`${format(day, "EEEE d MMMM")}, ${happyCount} happy and ${sadCount} tricky`}
              >
                <span className="day-button__weekday">
                  {format(day, "EEEEE")}
                </span>
                <span className="day-button__date">{format(day, "d")}</span>
                <span className="day-button__dots" aria-hidden="true">
                  {happyCount > 0 ? <i className="dot dot--happy" /> : null}
                  {sadCount > 0 ? <i className="dot dot--sad" /> : null}
                </span>
                {today ? (
                  <span className="today-dot" aria-hidden="true" />
                ) : null}
              </button>
            );
          })}
        </div>
      </section>

      <section className="day-section" aria-labelledby="selected-day-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              {isSameDay(selectedDate, new Date())
                ? "Today"
                : format(selectedDate, "EEEE")}
            </p>
            <h2 id="selected-day-heading">{format(selectedDate, "d MMMM")}</h2>
          </div>
          <button
            className="icon-button icon-button--quiet"
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh shared calendar"
          >
            <RefreshCw
              className={refreshing ? "spin" : ""}
              aria-hidden="true"
              size={18}
            />
          </button>
        </div>

        {selectedEntries.length > 0 ? (
          <ul className="entry-list">
            {selectedEntries.map((entry) => (
              <li
                className={`entry-card entry-card--${entry.mood}`}
                key={entry.id}
              >
                <div
                  className={`entry-face entry-face--${entry.mood}`}
                  aria-hidden="true"
                >
                  <MoodAvatar
                    mood={entry.mood}
                    size={49}
                    className="entry-face__image"
                  />
                </div>
                <div className="entry-copy">
                  <div className="entry-title-row">
                    <strong>
                      {entry.mood === "happy"
                        ? "Happy moment"
                        : "Tricky moment"}
                    </strong>
                    <time dateTime={entry.occurredAt}>
                      {format(new Date(entry.occurredAt), "HH:mm")}
                    </time>
                  </div>
                  {entry.tag ? (
                    <span className="tag-chip">{entry.tag.name}</span>
                  ) : (
                    <span className="no-tag">No tag yet</span>
                  )}
                  <p>
                    Added by {entry.createdBy === "edward" ? "Edward" : "Lisa"}
                  </p>
                </div>
                <div className="entry-actions">
                  <button
                    className="icon-button icon-button--quiet"
                    type="button"
                    onClick={() => onEdit(entry)}
                    aria-label={`Edit ${moodName(entry.mood)} behaviour`}
                  >
                    <Pencil aria-hidden="true" size={16} />
                  </button>
                  <button
                    className="icon-button icon-button--quiet icon-button--danger"
                    type="button"
                    onClick={() => onRemove(entry)}
                    aria-label={`Remove ${moodName(entry.mood)} behaviour`}
                  >
                    <Trash2 aria-hidden="true" size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-state">
            <div className="empty-state__faces" aria-hidden="true">
              <MoodAvatar
                mood="happy"
                size={50}
                className="empty-state__face"
              />
              <MoodAvatar mood="sad" size={50} className="empty-state__face" />
            </div>
            <h3>
              No behaviours recorded{" "}
              {isSameDay(selectedDate, new Date()) ? "today" : "on this day"}
            </h3>
            <p>Add a face when there&apos;s a moment you want to remember.</p>
            <button
              className="button button--soft"
              type="button"
              onClick={onAdd}
            >
              <Plus aria-hidden="true" size={18} /> Add the first face
            </button>
          </div>
        )}
      </section>
    </>
  );
}

function StarsView({
  dashboard,
  onOpenForm,
}: {
  dashboard: DashboardPayload | null;
  onOpenForm: (mode: StarFormMode) => void;
}) {
  if (!dashboard) return null;
  const { stars } = dashboard;
  const remaining = stars.target - stars.progress;

  return (
    <>
      <section
        className={`star-hero ${stars.balance < 0 ? "star-hero--negative" : ""}`}
      >
        <div className="star-glow" aria-hidden="true" />
        <div className="star-hero__top">
          <div>
            <p>Available now</p>
            <div className="star-balance">
              <Star aria-hidden="true" fill="currentColor" size={38} />
              <strong>{stars.balance}</strong>
              <span>star{stars.balance === 1 ? "" : "s"}</span>
            </div>
          </div>
          <div className="star-medallion" aria-hidden="true">
            <Sparkles size={30} />
          </div>
        </div>

        <div className="progress-copy">
          <strong>
            {stars.progress} of {stars.target} star-progress points
          </strong>
          <span>{remaining} more to the next star</span>
        </div>
        <div
          className="ten-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={stars.target}
          aria-valuenow={stars.progress}
          aria-label={`${stars.progress} of ${stars.target} points toward the next star`}
        >
          {Array.from({ length: stars.target }, (_, index) => (
            <span
              key={index}
              className={index < stars.progress ? "is-filled" : ""}
            />
          ))}
        </div>
        {stars.balance < 0 ? (
          <p className="balance-warning">
            A progress change or correction left the balance below zero. New
            stars will clear it first.
          </p>
        ) : null}
      </section>

      <section className="star-actions" aria-label="Star actions">
        <button
          type="button"
          className="action-card action-card--reward"
          onClick={() => onOpenForm("reward")}
          disabled={stars.balance < 1}
        >
          <span>
            <Gift aria-hidden="true" size={21} />
          </span>
          <strong>Use for a reward</strong>
          <small>
            {stars.balance < 1
              ? "Collect a star first"
              : "Record a gift or treat"}
          </small>
        </button>
        <button
          type="button"
          className="action-card"
          onClick={() => onOpenForm("add")}
        >
          <span>
            <Plus aria-hidden="true" size={21} />
          </span>
          <strong>Add stars</strong>
          <small>Make a correction</small>
        </button>
        <button
          type="button"
          className="action-card"
          onClick={() => onOpenForm("remove")}
        >
          <span>
            <Trash2 aria-hidden="true" size={19} />
          </span>
          <strong>Remove stars</strong>
          <small>Fix a mistake</small>
        </button>
      </section>

      <section className="info-card auto-stars-card">
        <div className="info-card__icon">
          <Sparkles aria-hidden="true" size={19} />
        </div>
        <div>
          <h2>Stars happen automatically</h2>
          <p>
            Atlas currently has {stars.effectiveHappyCount} happy-face point
            {stars.effectiveHappyCount === 1 ? "" : "s"}. Happy moments add one,
            tricky moments remove one without going below zero, and each learned
            skill adds five. That has earned {stars.automaticEarned} automatic
            star{stars.automaticEarned === 1 ? "" : "s"}.
          </p>
        </div>
      </section>

      <section className="history-section" aria-labelledby="history-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Corrections & rewards</p>
            <h2 id="history-heading">Star history</h2>
          </div>
          <History aria-hidden="true" size={20} />
        </div>
        {dashboard.adjustments.length ? (
          <ul className="history-list">
            {dashboard.adjustments.map((adjustment) => (
              <li key={adjustment.id}>
                <span
                  className={`history-delta ${adjustment.delta > 0 ? "is-positive" : "is-negative"}`}
                >
                  {adjustment.delta > 0 ? "+" : ""}
                  {adjustment.delta}{" "}
                  <Star aria-hidden="true" size={13} fill="currentColor" />
                </span>
                <div>
                  <strong>{adjustment.reason}</strong>
                  <p>
                    {adjustment.kind === "reward" ? "Reward" : "Correction"} ·{" "}
                    {adjustment.createdBy === "edward" ? "Edward" : "Lisa"} ·{" "}
                    {format(new Date(adjustment.createdAt), "d MMM, HH:mm")}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="compact-empty">
            <History aria-hidden="true" size={22} />
            <p>Rewards and manual corrections will appear here.</p>
          </div>
        )}
      </section>
    </>
  );
}

function SettingsView({
  dashboard,
  user,
  standalone,
  canInstall,
  passkeyCount,
  onInstall,
  onAddPasskey,
  onLisaPasswordSaved,
  onLogout,
}: {
  dashboard: DashboardPayload | null;
  user: SessionUser;
  standalone: boolean;
  canInstall: boolean;
  passkeyCount: number | null;
  onInstall: () => void;
  onAddPasskey: () => void;
  onLisaPasswordSaved: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="settings-stack">
      <section className="profile-card">
        <div className="profile-avatar">
          <CircleUserRound aria-hidden="true" size={28} />
        </div>
        <div>
          <p>Signed in as</p>
          <h2>{user.displayName}</h2>
        </div>
        <span className="profile-you">This phone</span>
      </section>

      <LisaPasswordSettings viewer={user.slug} onSaved={onLisaPasswordSaved} />

      <section className="settings-card" aria-labelledby="tags-heading">
        <div className="settings-card__heading">
          <span>
            <Tags aria-hidden="true" size={19} />
          </span>
          <div>
            <h2 id="tags-heading">Behaviour tags</h2>
            <p>Created as you record moments</p>
          </div>
        </div>
        {dashboard?.tags.length ? (
          <div className="tag-cloud">
            {dashboard.tags.map((tag) => (
              <span className="tag-summary" key={tag.id}>
                {tag.name}
                <small>{tag.usageCount}</small>
              </span>
            ))}
          </div>
        ) : (
          <p className="settings-empty">
            No tags yet. Type one when adding a face and it will be ready next
            time.
          </p>
        )}
      </section>

      <section className="settings-card" aria-labelledby="passkey-heading">
        <div className="settings-card__heading">
          <span>
            <Fingerprint aria-hidden="true" size={21} />
          </span>
          <div>
            <h2 id="passkey-heading">Phone unlock</h2>
            <p>
              {passkeyCount === null
                ? "Checking this account…"
                : passkeyCount === 0
                  ? "Not set up yet"
                  : `${passkeyCount} passkey${passkeyCount === 1 ? "" : "s"} registered`}
            </p>
          </div>
        </div>
        <p className="passkey-settings-copy">
          Use Android&apos;s fingerprint, face, screen lock, or saved passkey
          next time. {user.displayName}&apos;s usual sign-in method remains
          available as backup.
        </p>
        <button
          className="button button--soft button--wide"
          type="button"
          onClick={onAddPasskey}
        >
          <Fingerprint aria-hidden="true" size={19} />
          {passkeyCount ? "Add another passkey" : "Set up phone unlock"}
        </button>
      </section>

      <section className="settings-card">
        <div className="settings-card__heading">
          <span>
            <Download aria-hidden="true" size={19} />
          </span>
          <div>
            <h2>Home screen app</h2>
            <p>Open Atlas-o-meter like any Android app</p>
          </div>
        </div>
        {standalone ? (
          <div className="installed-note">
            <Check aria-hidden="true" size={17} /> Installed on this device
          </div>
        ) : canInstall ? (
          <button
            className="button button--soft button--wide"
            type="button"
            onClick={onInstall}
          >
            <Download aria-hidden="true" size={18} /> Add to home screen
          </button>
        ) : (
          <p className="install-help">
            In Chrome, open the browser menu and choose{" "}
            <strong>Add to Home screen</strong> or <strong>Install app</strong>.
          </p>
        )}
      </section>

      <section className="security-note security-note--secure">
        <ShieldAlert aria-hidden="true" size={20} />
        <div>
          <strong>Protected family sign-in</strong>
          <p>
            Edward signs in with Google and Lisa uses her password. A registered
            passkey can be used for phone unlock; fingerprint, face, and
            screen-lock details never leave the authenticator.
          </p>
        </div>
      </section>

      <button
        className="button button--logout button--wide"
        type="button"
        onClick={onLogout}
      >
        <LogOut aria-hidden="true" size={18} /> Sign out {user.displayName}
      </button>
    </div>
  );
}

function LoadingCards() {
  return (
    <div
      className="loading-stack"
      aria-label="Loading shared calendar"
      role="status"
    >
      <div className="skeleton skeleton--calendar" />
      <div className="skeleton skeleton--entry" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
