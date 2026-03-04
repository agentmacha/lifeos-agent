"use client";

import { Bell, Flame, Scale, User, X, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { TDEE, UserProfile } from "@/lib/types";

interface Props {
  userId: string;
  onClose: () => void;
  onSaved: (tdee: TDEE | null) => void;
  addToast?: (n: { id: number; type: string; title: string; message: string; read: boolean; created_at: string }) => void;
}

const ACTIVITY_OPTS = [
  { value: "sedentary", label: "Sedentary (desk job, no exercise)" },
  { value: "light", label: "Light (exercise 1–3x/week)" },
  { value: "moderate", label: "Moderate (exercise 3–5x/week)" },
  { value: "active", label: "Active (hard exercise 6–7x/week)" },
  { value: "very_active", label: "Very Active (athlete / physical job)" },
];

const GOAL_OPTS = [
  { value: "lose", label: "Lose weight (−500 kcal/day)" },
  { value: "maintain", label: "Maintain weight" },
  { value: "gain", label: "Gain muscle (+300 kcal/day)" },
];

export default function ProfileModal({ userId, onClose, onSaved, addToast }: Props) {
  const [form, setForm] = useState<Partial<UserProfile>>({
    name: "", age: undefined, gender: "male",
    weight_kg: undefined, height_cm: undefined,
    activity_level: "moderate", goal: "maintain",
  });
  const [tdee, setTdee] = useState<TDEE | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reminderPrefs, setReminderPrefs] = useState({ phone: "", email: "", reminders_enabled: false });
  const [sendingTest, setSendingTest] = useState(false);

  useEffect(() => {
    api.getProfile(userId).then((res) => {
      if (res.profile) setForm({ ...res.profile });
      if (res.tdee) setTdee(res.tdee);
      setLoading(false);
    }).catch(() => setLoading(false));
    api.getNotificationPrefs(userId).then((res) => {
      setReminderPrefs({
        phone: res.phone ?? "",
        email: res.email ?? "",
        reminders_enabled: res.reminders_enabled ?? false,
      });
    }).catch(() => {});
  }, [userId]);

  function set<K extends keyof UserProfile>(k: K, v: UserProfile[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.saveProfile({ user_id: userId, ...form } as UserProfile & { user_id: string });
      if (res.tdee) setTdee(res.tdee);
      await api.saveNotificationPrefs(userId, {
        phone: reminderPrefs.phone || undefined,
        email: reminderPrefs.email || undefined,
        reminders_enabled: reminderPrefs.reminders_enabled,
      });
      onSaved(res.tdee ?? null);
      onClose();
    } catch {/* silent */} finally {
      setSaving(false);
    }
  }

  const inp = "w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-indigo-500 transition-colors";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="glass rounded-2xl border border-slate-700/60 shadow-2xl w-full max-w-md animate-fade-in overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
              <User size={15} className="text-white" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-100 text-sm">Your Profile</h2>
              <p className="text-[10px] text-slate-500">Used to calculate your personalized calorie & macro targets</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-500 text-sm">Loading…</div>
        ) : (
          <form onSubmit={handleSave} className="p-5 space-y-4 overflow-y-auto max-h-[70vh]">
            {/* Name */}
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider">Name</label>
              <input className={`${inp} mt-1`} placeholder="Your name" value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} />
            </div>

            {/* Age + Gender */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-slate-500 uppercase tracking-wider">Age</label>
                <input type="number" min={10} max={100} className={`${inp} mt-1`} placeholder="25"
                  value={form.age ?? ""} onChange={(e) => set("age", parseInt(e.target.value, 10) || undefined)} />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase tracking-wider">Gender</label>
                <select className={`${inp} mt-1`} value={form.gender ?? "male"} onChange={(e) => set("gender", e.target.value)}>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>

            {/* Weight + Height */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-slate-500 uppercase tracking-wider">Weight (kg)</label>
                <input type="number" min={30} max={300} step={0.1} className={`${inp} mt-1`} placeholder="70"
                  value={form.weight_kg ?? ""} onChange={(e) => set("weight_kg", parseFloat(e.target.value) || undefined)} />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase tracking-wider">Height (cm)</label>
                <input type="number" min={100} max={250} className={`${inp} mt-1`} placeholder="170"
                  value={form.height_cm ?? ""} onChange={(e) => set("height_cm", parseFloat(e.target.value) || undefined)} />
              </div>
            </div>

            {/* Activity */}
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider">Activity level</label>
              <select className={`${inp} mt-1`} value={form.activity_level ?? "moderate"} onChange={(e) => set("activity_level", e.target.value)}>
                {ACTIVITY_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Goal */}
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider">Goal</label>
              <div className="grid grid-cols-3 gap-2 mt-1">
                {GOAL_OPTS.map((o) => (
                  <button key={o.value} type="button"
                    onClick={() => set("goal", o.value)}
                    className={`py-2 rounded-lg text-xs font-medium border transition-all ${
                      form.goal === o.value
                        ? "bg-indigo-600 border-indigo-500 text-white"
                        : "bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600"
                    }`}
                  >
                    {o.value === "lose" ? "Lose" : o.value === "maintain" ? "Maintain" : "Gain"}
                  </button>
                ))}
              </div>
            </div>

            {/* Reminders (SMS / Email) */}
            <div className="border-t border-slate-800 pt-4">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                <Bell size={10} className="text-amber-400" /> Reminders (SMS &amp; email)
              </p>
              <p className="text-[11px] text-slate-400 mb-2">Get 1–3 gentle reminders per day: morning, lunch, sleep. Not more.</p>
              <div className="space-y-2">
                <input className={inp} placeholder="Phone (e.g. +15551234567)" value={reminderPrefs.phone}
                  onChange={(e) => setReminderPrefs((p) => ({ ...p, phone: e.target.value }))} />
                <input type="email" className={inp} placeholder="Email (optional)" value={reminderPrefs.email}
                  onChange={(e) => setReminderPrefs((p) => ({ ...p, email: e.target.value }))} />
                <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={reminderPrefs.reminders_enabled}
                    onChange={(e) => setReminderPrefs((p) => ({ ...p, reminders_enabled: e.target.checked }))}
                    className="rounded border-slate-600 bg-slate-800 text-indigo-500 focus:ring-indigo-500" />
                  Enable daily reminders (Twilio SMS / SendGrid email)
                </label>
                <button
                  type="button"
                  onClick={async () => {
                    const phone = reminderPrefs.phone?.trim();
                    if (!phone) return;
                    setSendingTest(true);
                    try {
                      const res = await api.sendTestSms(userId, phone);
                      if (res.success) {
                        addToast?.({
                          id: Date.now(),
                          type: "default",
                          title: "Test SMS sent",
                          message: "Check your phone for the LifeOS demo message.",
                          read: false,
                          created_at: new Date().toISOString(),
                        });
                      } else {
                        addToast?.({
                          id: Date.now(),
                          type: "default",
                          title: "Test SMS failed",
                          message: res.error ?? "Twilio error",
                          read: false,
                          created_at: new Date().toISOString(),
                        });
                      }
                    } catch (e) {
                      addToast?.({
                        id: Date.now(),
                        type: "default",
                        title: "Test SMS failed",
                        message: String(e),
                        read: false,
                        created_at: new Date().toISOString(),
                      });
                    } finally {
                      setSendingTest(false);
                    }
                  }}
                  disabled={sendingTest || !reminderPrefs.phone?.trim()}
                  className="w-full py-2 rounded-lg text-sm font-medium bg-amber-600/80 hover:bg-amber-600 disabled:opacity-50 text-white flex items-center justify-center gap-2"
                >
                  {sendingTest ? "Sending…" : "Try it – send test SMS now"}
                </button>
                <p className="text-[10px] text-slate-500 text-center">Demo: sends one SMS to the number above</p>
              </div>
            </div>

            {/* TDEE preview */}
            {tdee && (
              <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-3">
                <p className="text-[10px] text-indigo-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                  <Zap size={10} /> Calculated targets
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-1.5">
                    <Flame size={11} className="text-amber-400" />
                    <span className="text-slate-400">Daily cal:</span>
                    <span className="text-amber-400 font-bold">{tdee.target_calories}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Scale size={11} className="text-blue-400" />
                    <span className="text-slate-400">TDEE:</span>
                    <span className="text-blue-400 font-bold">{tdee.tdee}</span>
                  </div>
                  <div className="text-slate-400">Protein: <span className="text-blue-300 font-bold">{tdee.protein_g}g</span></div>
                  <div className="text-slate-400">Carbs: <span className="text-amber-300 font-bold">{tdee.carbs_g}g</span></div>
                  <div className="text-slate-400">Fat: <span className="text-rose-300 font-bold">{tdee.fat_g}g</span></div>
                  <div className="text-slate-400">Water: <span className="text-cyan-300 font-bold">{tdee.water_ml}ml</span></div>
                </div>
              </div>
            )}

            <button type="submit" disabled={saving}
              className="w-full py-3 rounded-xl text-sm font-semibold bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-60 text-white shadow-lg">
              {saving ? "Saving…" : "Save Profile & Recalculate Targets"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
