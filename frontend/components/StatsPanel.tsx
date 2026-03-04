"use client";

import { Activity, Bell, Flame, Footprints, Moon, Plus, RefreshCw, Sparkles, Target, Trash2, TrendingUp, Upload, Zap } from "lucide-react";
import { useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/lib/api";
import type { DailyPlan, Goals, TodaySummary, WeekSummary } from "@/lib/types";
import TodayPlanCard from "./TodayPlanCard";

const WORKOUT_COLORS: Record<string, string> = {
  run: "text-orange-400", weights: "text-purple-400", walk: "text-emerald-400",
  cycling: "text-blue-400", yoga: "text-pink-400", hiit: "text-red-400",
};

function Ring({ pct, color, size = 64 }: { pct: number; color: string; size?: number }) {
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(pct, 100) / 100) * circ;
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={6} fill="none" className="stroke-slate-800" />
      <circle
        cx={size / 2} cy={size / 2} r={r} strokeWidth={6} fill="none"
        stroke={color} strokeLinecap="round"
        strokeDasharray={circ} strokeDashoffset={offset}
        style={{ transition: "stroke-dashoffset 0.8s ease-out" }}
      />
    </svg>
  );
}

function MetricCard({
  icon, label, value, unit, pct, color, sub,
}: {
  icon: React.ReactNode; label: string; value: string | number; unit: string;
  pct?: number; color: string; sub?: string;
}) {
  return (
    <div className={`metric-card glass rounded-xl p-4 glow-${color} relative overflow-hidden`}>
      <div className={`absolute -right-4 -top-4 w-20 h-20 rounded-full opacity-10 bg-${color}-500`} />
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
            {icon}
            <span>{label}</span>
          </div>
          <p className="text-2xl font-bold text-slate-100">
            {value}
            <span className="text-sm font-normal text-slate-400 ml-1">{unit}</span>
          </p>
          {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
        </div>
        {pct !== undefined && (
          <div className="relative shrink-0">
            <Ring pct={pct} color={color === "indigo" ? "#818cf8" : color === "emerald" ? "#34d399" : color === "amber" ? "#fbbf24" : "#f472b6"} />
            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-slate-300">
              {Math.round(pct)}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

const WORKOUT_TYPES = ["run", "walk", "weights", "cycling", "yoga", "hiit"];
const INTENSITIES = ["light", "moderate", "intense"];

interface Props {
  userId: string;
  today: TodaySummary | null;
  week: WeekSummary | null;
  plan: DailyPlan | null;
  goals: Goals;
  onSeeded: () => void;
  onRefresh?: () => void;
  onOpenProfile?: () => void;
  addToast: (n: import("@/lib/types").Notification) => void;
}

export default function StatsPanel({ userId, today, week, plan, goals, onSeeded, onRefresh, onOpenProfile, addToast }: Props) {
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState("");
  const [workoutForm, setWorkoutForm] = useState({ workout_type: "walk", duration_min: 30, intensity: "moderate" });
  const [loggingWorkout, setLoggingWorkout] = useState(false);
  const [showLogWorkout, setShowLogWorkout] = useState(false);
  const [deletingEventId, setDeletingEventId] = useState<number | null>(null);
  const [importingHealth, setImportingHealth] = useState(false);
  const healthFileRef = useRef<HTMLInputElement>(null);

  async function handleSeed() {
    setSeeding(true);
    setSeedMsg("");
    try {
      const res = await api.seedSynthetic(userId, 7);
      setSeedMsg(`✓ Seeded ${res.events_created} events`);
      onSeeded();
    } catch (e) {
      setSeedMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSeeding(false);
    }
  }

  async function handleLogWorkout(e: React.FormEvent) {
    e.preventDefault();
    if (loggingWorkout) return;
    setLoggingWorkout(true);
    try {
      await api.logWorkout(userId, {
        workout_type: workoutForm.workout_type,
        duration_min: workoutForm.duration_min,
        intensity: workoutForm.intensity,
      });
      setShowLogWorkout(false);
      onRefresh?.();
      onSeeded();
    } catch (err) {
      addToast({
        id: Date.now(),
        type: "default",
        title: "Could not log workout",
        message: String(err),
        read: false,
        created_at: new Date().toISOString(),
      });
    } finally {
      setLoggingWorkout(false);
    }
  }

  async function handleAppleHealthFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || importingHealth) return;
    setImportingHealth(true);
    e.target.value = "";
    try {
      const res = await api.importAppleHealth(userId, file, 30);
      onRefresh?.();
      onSeeded();
      addToast({
        id: Date.now(),
        type: "default",
        title: "Apple Health imported",
        message: `${res.events_created} events: ${res.steps_days} days steps, ${res.sleep_nights} nights sleep, ${res.workouts} workouts.`,
        read: false,
        created_at: new Date().toISOString(),
      });
    } catch (err) {
      addToast({
        id: Date.now(),
        type: "default",
        title: "Import failed",
        message: String(err),
        read: false,
        created_at: new Date().toISOString(),
      });
    } finally {
      setImportingHealth(false);
    }
  }

  async function handleDeleteWorkout(eventId: number, workoutType: string) {
    if (!confirm(`Remove "${workoutType}" workout?`)) return;
    setDeletingEventId(eventId);
    try {
      await api.deleteEvent(userId, eventId);
      onRefresh?.();
      onSeeded();
      addToast({
        id: Date.now(),
        type: "default",
        title: "Workout removed",
        message: `"${workoutType}" deleted from today's log.`,
        read: false,
        created_at: new Date().toISOString(),
      });
    } catch (err) {
      addToast({ id: Date.now(), type: "default", title: "Could not delete workout", message: String(err), read: false, created_at: new Date().toISOString() });
    } finally {
      setDeletingEventId(null);
    }
  }

  const sleepPct = today ? (today.sleep_hrs / goals.sleep_target) * 100 : 0;
  const stepsPct = today ? (today.steps / goals.steps_target) * 100 : 0;
  const calPct = today ? (today.calories_burned / 600) * 100 : 0;

  const chartData = (week?.daily_breakdown ?? []).map((d) => ({
    day: new Date(d.date + "T00:00").toLocaleDateString("en", { weekday: "short" }),
    sleep: d.sleep,
    steps: Math.round(d.steps / 1000 * 10) / 10,
    cal: d.calories,
  }));

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto pr-1">
      {/* Seed button */}
      <div className="glass rounded-2xl p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Sparkles size={13} className="text-indigo-400" />
          Quick Actions
        </h3>
        <button
          onClick={handleSeed}
          disabled={seeding}
          className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-semibold text-sm
            bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500
            text-white shadow-lg shadow-indigo-500/20 transition-all duration-200
            disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.98]"
        >
          {seeding ? (
            <RefreshCw size={16} className="animate-spin" />
          ) : (
            <Zap size={16} />
          )}
          {seeding ? "Seeding…" : "Seed Synthetic Week"}
        </button>
        {seedMsg && (
          <p className={`text-xs mt-2 text-center ${seedMsg.startsWith("✓") ? "text-emerald-400" : "text-red-400"}`}>
            {seedMsg}
          </p>
        )}
        <input
          ref={healthFileRef}
          type="file"
          accept=".zip,.xml"
          className="hidden"
          onChange={handleAppleHealthFile}
        />
        <button
          type="button"
          onClick={() => healthFileRef.current?.click()}
          disabled={importingHealth}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-medium
            text-slate-300 hover:text-white bg-slate-800/60 hover:bg-slate-800 border border-slate-700
            disabled:opacity-60 disabled:cursor-not-allowed mt-2"
        >
          {importingHealth ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
          {importingHealth ? "Importing…" : "Import from Apple Health"}
        </button>
        <p className="text-[10px] text-slate-600 mt-1.5">Health app → Export All Health Data → upload ZIP</p>

        {/* Reminders (SMS) – demo */}
        {onOpenProfile && (
          <button
            type="button"
            onClick={onOpenProfile}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-xl text-sm font-medium text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 mt-2"
          >
            <Bell size={14} />
            Reminders: set phone & try SMS (Profile)
          </button>
        )}
      </div>

      {/* Log workout */}
      <div className="glass rounded-2xl p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Target size={13} className="text-purple-400" />
          Log workout
        </h3>
        {showLogWorkout ? (
          <form onSubmit={handleLogWorkout} className="space-y-2">
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider">Type</label>
              <select
                value={workoutForm.workout_type}
                onChange={(e) => setWorkoutForm((f) => ({ ...f, workout_type: e.target.value }))}
                className="w-full mt-0.5 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500"
              >
                {WORKOUT_TYPES.map((t) => (
                  <option key={t} value={t} className="capitalize">{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider">Duration (min)</label>
              <input
                type="number"
                min={5}
                max={180}
                value={workoutForm.duration_min}
                onChange={(e) => setWorkoutForm((f) => ({ ...f, duration_min: parseInt(e.target.value, 10) || 30 }))}
                className="w-full mt-0.5 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider">Intensity</label>
              <select
                value={workoutForm.intensity}
                onChange={(e) => setWorkoutForm((f) => ({ ...f, intensity: e.target.value }))}
                className="w-full mt-0.5 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500"
              >
                {INTENSITIES.map((i) => (
                  <option key={i} value={i} className="capitalize">{i}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={loggingWorkout} className="flex-1 py-2 rounded-lg text-sm font-medium bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white">
                {loggingWorkout ? "Logging…" : "Save"}
              </button>
              <button type="button" onClick={() => setShowLogWorkout(false)} className="py-2 px-3 rounded-lg text-sm text-slate-400 hover:text-slate-200">
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setShowLogWorkout(true)}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium text-purple-400 hover:text-purple-300 bg-slate-800/60 hover:bg-slate-800 border border-slate-700"
          >
            <Plus size={14} />
            I did a workout
          </button>
        )}
        <p className="text-[10px] text-slate-600 mt-2">Chat uses this to suggest next steps.</p>
      </div>

      {/* Today's plan (nutrition + workouts + remaining + AI) */}
      {onRefresh && <TodayPlanCard userId={userId} plan={plan} onRefresh={onRefresh} />}

      {/* Today stats */}
      <div className="glass rounded-2xl p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Activity size={13} className="text-emerald-400" />
          Today
        </h3>
        {today ? (
          <div className="grid grid-cols-1 gap-3">
            <MetricCard
              icon={<Moon size={12} />} label="Sleep" value={today.sleep_hrs} unit="hrs"
              pct={sleepPct} color="indigo"
              sub={today.sleep_hrs >= goals.sleep_target ? "Goal met 🎉" : `${(goals.sleep_target - today.sleep_hrs).toFixed(1)}h to goal`}
            />
            <MetricCard
              icon={<Footprints size={12} />} label="Steps" value={today.steps.toLocaleString()} unit="steps"
              pct={stepsPct} color="emerald"
              sub={today.steps >= goals.steps_target ? "Goal met 🎉" : `${(goals.steps_target - today.steps).toLocaleString()} to go`}
            />
            <MetricCard
              icon={<Flame size={12} />} label="Burned" value={today.calories_burned} unit="kcal"
              pct={calPct} color="amber"
            />
          </div>
        ) : (
          <p className="text-slate-500 text-sm text-center py-4">Seed data to see today&apos;s stats</p>
        )}
      </div>

      {/* Workouts */}
      {today?.workouts && today.workouts.length > 0 && (
        <div className="glass rounded-2xl p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Target size={13} className="text-purple-400" />
            Today&apos;s Workouts
          </h3>
          <div className="space-y-2">
            {today.workouts.map((w, i) => (
              <div key={w.id ?? i} className="flex items-center justify-between bg-slate-800/50 rounded-lg px-3 py-2 group">
                <span className={`capitalize text-sm font-medium ${WORKOUT_COLORS[w.type] ?? "text-slate-300"}`}>
                  {w.type}
                </span>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span>{w.duration_min}min</span>
                  <span className="text-slate-600">·</span>
                  <span className="text-amber-400">{w.calories} kcal</span>
                  <span className="text-slate-600">·</span>
                  <span className="capitalize text-slate-500">{w.intensity}</span>
                  {w.id != null && (
                    <button
                      onClick={() => handleDeleteWorkout(w.id!, w.type)}
                      disabled={deletingEventId === w.id}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-600 hover:text-rose-400 hover:bg-rose-400/10 transition-all ml-1"
                      title="Remove workout"
                    >
                      {deletingEventId === w.id
                        ? <RefreshCw size={11} className="animate-spin" />
                        : <Trash2 size={11} />}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Week summary */}
      {week && (
        <div className="glass rounded-2xl p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <TrendingUp size={13} className="text-blue-400" />
            7-Day Averages
          </h3>
          <div className="grid grid-cols-2 gap-2 mb-4">
            {[
              { label: "Avg Sleep", val: `${week.avg_sleep_hrs}h`, color: "text-indigo-400" },
              { label: "Avg Steps", val: `${(week.avg_steps / 1000).toFixed(1)}k`, color: "text-emerald-400" },
              { label: "Workouts", val: week.workout_count, color: "text-purple-400" },
              { label: "Cal Burned", val: `${week.total_calories_burned}`, color: "text-amber-400" },
            ].map((s) => (
              <div key={s.label} className="bg-slate-800/50 rounded-lg p-2.5 text-center">
                <p className={`text-lg font-bold ${s.color}`}>{s.val}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Mini bar charts */}
          {chartData.length > 0 && (
            <>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Sleep (hrs)</p>
              <ResponsiveContainer width="100%" height={60}>
                <BarChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: -30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="day" tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                    cursor={{ fill: "#1e293b" }}
                  />
                  <Bar dataKey="sleep" fill="#818cf8" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>

              <p className="text-[10px] text-slate-500 uppercase tracking-wider mt-3 mb-1">Steps (k)</p>
              <ResponsiveContainer width="100%" height={60}>
                <BarChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: -30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="day" tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                    cursor={{ fill: "#1e293b" }}
                  />
                  <Bar dataKey="steps" fill="#34d399" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </>
          )}

          {/* Workout breakdown */}
          {Object.keys(week.workout_breakdown).length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Workout types</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(week.workout_breakdown).map(([t, cnt]) => (
                  <span key={t} className="bg-slate-800 text-xs px-2 py-0.5 rounded-full text-slate-300 capitalize">
                    {t} × {cnt}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
