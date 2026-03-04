import type { Goals, MealAnalysis, TodaySummary, WeekSummary } from "./types";

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${path}: ${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  healthz: () => req<{ ok: boolean }>("/healthz"),

  seedSynthetic: (userId: string, days = 7) =>
    req<{ success: boolean; events_created: number }>("/seed/synthetic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, days }),
    }),

  importAppleHealth: (userId: string, file: File, daysBack = 30) => {
    const form = new FormData();
    form.append("user_id", userId);
    form.append("days_back", String(daysBack));
    form.append("file", file);
    return req<{ success: boolean; events_created: number; steps_days: number; sleep_nights: number; workouts: number }>(
      "/health/import",
      { method: "POST", body: form }
    );
  },

  todaySummary: (userId: string) =>
    req<TodaySummary>(`/summary/today?user_id=${userId}`),

  weekSummary: (userId: string) =>
    req<WeekSummary>(`/summary/week?user_id=${userId}`),

  dailyPlan: (userId: string) =>
    req<import("./types").DailyPlan>(`/summary/daily-plan?user_id=${userId}`),

  analyzeMeal: async (userId: string, file: File): Promise<{ id: number; analysis: MealAnalysis }> => {
    const form = new FormData();
    form.append("image", file);
    form.append("user_id", userId);
    return req("/meal/analyze", { method: "POST", body: form });
  },

  lastMeal: (userId: string) =>
    req<{ meal: { id: number; ts: string; analysis: MealAnalysis; confirmed: null } | null }>(
      `/meal/last?user_id=${userId}`
    ),

  todayMeals: (userId: string) =>
    req<{ meals: import("./types").MealEntry[] }>(`/meals/today?user_id=${userId}`),

  logMeal: (userId: string, body: { name: string; calories?: number; protein_g?: number; carbs_g?: number; fat_g?: number; fiber_g?: number; sugar_g?: number }) =>
    req<{ success: boolean; id: number; analysis: import("./types").MealAnalysis }>("/meal/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, ...body }),
    }),

  logWorkout: (userId: string, body: { workout_type: string; duration_min: number; calories?: number; intensity?: string }) =>
    req<{ success: boolean }>("/workout/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, intensity: body.intensity ?? "moderate", ...body }),
    }),

  chat: (userId: string, message: string) =>
    req<{ reply: string; tools_used: string[]; actions: unknown[] }>("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, message }),
    }),

  getGoals: (userId: string) =>
    req<{ goals: Goals | null }>(`/goals/${userId}`),

  setGoals: (userId: string, goal_json: Goals) =>
    req<{ success: boolean }>("/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, goal_json }),
    }),

  getProfile: (userId: string) =>
    req<{ profile: import("./types").UserProfile | null; tdee: import("./types").TDEE | null }>(`/profile/${userId}`),

  saveProfile: (profile: import("./types").UserProfile & { user_id: string }) =>
    req<{ success: boolean; tdee: import("./types").TDEE | null }>("/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    }),

  logWater: (userId: string, amount_ml: number) =>
    req<{ success: boolean; total_ml: number }>("/water/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, amount_ml }),
    }),

  waterToday: (userId: string) =>
    req<import("./types").WaterStatus>(`/water/today?user_id=${userId}`),

  deleteMeal: (userId: string, mealId: number) =>
    req<{ success: boolean; deleted_id: number }>(`/meal/${mealId}?user_id=${userId}`, { method: "DELETE" }),

  deleteEvent: (userId: string, eventId: number) =>
    req<{ success: boolean; deleted_id: number }>(`/event/${eventId}?user_id=${userId}`, { method: "DELETE" }),

  listNotifications: (userId: string) =>
    req<{ notifications: import("./types").Notification[]; unread_count: number }>(
      `/notifications/list/${userId}`
    ),

  markNotifRead: (id: number) =>
    req<{ success: boolean }>(`/notifications/${id}/read`, { method: "PUT" }),

  markAllRead: (userId: string) =>
    req<{ success: boolean }>(`/notifications/user/${userId}/read-all`, { method: "PUT" }),

  getNotificationPrefs: (userId: string) =>
    req<{ phone: string | null; email: string | null; reminders_enabled: boolean; timezone: string }>(
      `/notifications/preferences/${userId}`
    ),

  saveNotificationPrefs: (userId: string, prefs: { phone?: string; email?: string; reminders_enabled?: boolean; timezone?: string }) =>
    req<{ success: boolean; reminders_enabled: boolean }>("/notifications/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, ...prefs }),
    }),

  sendTestSms: (userId: string, phone?: string) =>
    req<{ success: boolean; message?: string; error?: string }>("/notifications/test-sms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, phone: phone || undefined }),
    }),
};

export function notifStreamUrl(userId: string) {
  return `${BASE}/notifications/stream/${userId}`;
}
