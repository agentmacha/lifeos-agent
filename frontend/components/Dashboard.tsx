"use client";

import {
  Activity,
  Brain,
  ExternalLink,
  Server,
  User,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, notifStreamUrl } from "@/lib/api";
import type { DailyPlan, Goals, Notification, TDEE, TodaySummary, UserProfile, WeekSummary } from "@/lib/types";
import ChatPanel from "./ChatPanel";
import MealPanel from "./MealPanel";
import NotificationBell from "./NotificationBell";
import ProfileModal from "./ProfileModal";
import StatsPanel from "./StatsPanel";
import ToastNotifications from "./ToastNotifications";
import WaterTracker from "./WaterTracker";

const DEFAULT_USER = "demo_user";

const DEFAULT_GOALS: Goals = {
  daily_calories: 2000,
  protein_g: 150,
  steps_target: 10000,
  sleep_target: 8,
};

const SPONSOR_BADGES = [
  { name: "Render", color: "from-violet-600 to-purple-700", href: "https://render.com", icon: <Server size={11} /> },
  { name: "Tavily", color: "from-blue-600 to-cyan-700", href: "https://tavily.com", icon: <Brain size={11} /> },
  { name: "Reka",   color: "from-pink-600 to-rose-700",  href: "https://reka.ai",   icon: <Activity size={11} /> },
];

export default function Dashboard() {
  const [userId] = useState(DEFAULT_USER);
  const [today, setToday] = useState<TodaySummary | null>(null);
  const [week, setWeek] = useState<WeekSummary | null>(null);
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [tdee, setTdee] = useState<TDEE | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [goals] = useState<Goals>(DEFAULT_GOALS);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [toastQueue, setToastQueue] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const sseRef = useRef<EventSource | null>(null);

  const addToast = useCallback((n: Notification) => {
    setToastQueue((p) => [...p, n]);
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const [t, w, p] = await Promise.all([
        api.todaySummary(userId).catch(() => null),
        api.weekSummary(userId).catch(() => null),
        api.dailyPlan(userId).catch(() => null),
      ]);
      if (t) setToday(t);
      if (w) setWeek(w);
      if (p) setPlan(p);
    } catch {/* silent */}
  }, [userId]);

  const fetchNotifs = useCallback(async () => {
    try {
      const res = await api.listNotifications(userId);
      setNotifications(res.notifications);
      setUnreadCount(res.unread_count);
    } catch {/* silent */}
  }, [userId]);

  // Load profile
  useEffect(() => {
    api.getProfile(userId).then((res) => {
      if (res.profile) setProfile(res.profile);
      if (res.tdee) setTdee(res.tdee);
    }).catch(() => null);
  }, [userId]);

  // Initial load
  useEffect(() => {
    fetchStats();
    fetchNotifs();
  }, [fetchStats, fetchNotifs]);

  // SSE stream
  useEffect(() => {
    const url = notifStreamUrl(userId);
    const es = new EventSource(url);
    sseRef.current = es;

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.connected) return;

        const notif = data as Notification;
        setNotifications((prev) => {
          if (prev.some((n) => n.id === notif.id)) return prev;
          return [notif, ...prev];
        });
        setUnreadCount((c) => c + 1);
        addToast(notif);
      } catch {/* ignore parse errors */}
    };

    es.onerror = () => {
      es.close();
    };

    return () => es.close();
  }, [userId, addToast]);

  function handleSeeded() {
    fetchStats();
    setTimeout(fetchNotifs, 1500);
  }

  function handleMarkRead(id: number) {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
  }

  function handleMarkAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
  }

  function dismissToast(id: number) {
    setToastQueue((p) => p.filter((t) => t.id !== id));
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-950">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="shrink-0 flex items-center gap-3 px-4 py-2.5 bg-gradient-to-r from-slate-900 via-slate-900 to-slate-950 border-b border-slate-800/60 shadow-xl">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/25">
            <Activity size={18} className="text-white" />
          </div>
          <div>
            <h1 className="font-bold text-white text-base leading-tight tracking-tight">LifeOS Agent</h1>
            <p className="text-[10px] text-slate-500 leading-tight">AI-powered health coach</p>
          </div>
        </div>

        {/* Sponsor badges */}
        <div className="hidden sm:flex items-center gap-2 ml-4">
          {SPONSOR_BADGES.map((s) => (
            <a
              key={s.name}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gradient-to-r ${s.color} text-white text-[10px] font-semibold opacity-80 hover:opacity-100 transition-opacity shadow-sm`}
            >
              {s.icon}
              {s.name}
              <ExternalLink size={8} />
            </a>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* User pill */}
          <div className="hidden sm:flex items-center gap-2 bg-slate-800/60 border border-slate-700/60 rounded-xl px-3 py-1.5">
            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-[9px] font-bold text-white flex items-center justify-center">
              {userId.slice(0, 2).toUpperCase()}
            </div>
            <span className="text-xs text-slate-400">{userId}</span>
          </div>

          <button
            onClick={() => setShowProfile(true)}
            className="flex items-center gap-1.5 py-1.5 px-3 rounded-xl text-xs text-slate-400 hover:text-white bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 transition-colors"
          >
            <User size={13} />
            {profile?.name ?? "Profile"}
            {!profile?.weight_kg && <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse ml-1" title="Complete your profile" />}
          </button>

          <NotificationBell
            userId={userId}
            notifications={notifications}
            unreadCount={unreadCount}
            onMarkRead={handleMarkRead}
            onMarkAllRead={handleMarkAllRead}
            onRefresh={fetchNotifs}
          />
        </div>
      </header>

      {/* ── Main 3-column grid ──────────────────────────────────── */}
      <main className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-[240px_1fr_270px] gap-3 p-3">
        {/* Left — Stats */}
        <aside className="hidden lg:block overflow-hidden">
          <StatsPanel
            userId={userId}
            today={today}
            week={week}
            plan={plan}
            goals={goals}
            onSeeded={handleSeeded}
            onRefresh={fetchStats}
            onOpenProfile={() => setShowProfile(true)}
            addToast={addToast}
          />
        </aside>

        {/* Center — Chat */}
        <section className="min-h-0 flex flex-col">
          <ChatPanel userId={userId} />
        </section>

        {/* Right — Meal + Water */}
        <aside className="hidden lg:block overflow-y-auto">
          <div className="flex flex-col gap-4">
            <WaterTracker userId={userId} addToast={addToast} onRefresh={fetchStats} />
            <MealPanel userId={userId} addToast={addToast} onMealsChange={fetchStats} />
          </div>
        </aside>
      </main>

      {/* Mobile bottom strip (stat summary only) */}
      <div className="lg:hidden shrink-0 flex items-center gap-4 px-4 py-2 border-t border-slate-800 bg-slate-900/80 text-xs text-slate-400 overflow-x-auto">
        {today ? (
          <>
            <span>😴 {today.sleep_hrs}h</span>
            <span>👟 {today.steps.toLocaleString()}</span>
            <span>🔥 {today.calories_burned} kcal</span>
            <span>💪 {today.workouts.length} workout{today.workouts.length !== 1 ? "s" : ""}</span>
          </>
        ) : (
          <span className="text-slate-600">Seed data to see stats</span>
        )}
      </div>

      {/* Profile modal */}
      {showProfile && (
        <ProfileModal
          userId={userId}
          onClose={() => setShowProfile(false)}
          onSaved={(t) => {
            if (t) setTdee(t);
            fetchStats();
          }}
          addToast={addToast}
        />
      )}

      {/* Toast notifications */}
      <ToastNotifications toasts={toastQueue} onDismiss={dismissToast} />
    </div>
  );
}
