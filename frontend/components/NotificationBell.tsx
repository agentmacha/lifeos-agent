"use client";

import { Bell, Check, CheckCheck, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Notification } from "@/lib/types";

const TYPE_ICON: Record<string, string> = {
  meal_high_cal: "🍽️", meal_low_cal: "🥗", meal_logged: "✅",
  workout_complete: "💪", workout_reminder: "🏃", workout_great: "🏆",
  workout_tip: "⚡", sleep_warning: "😴", steps_low: "👟",
  seed_complete: "🎉", goal_update: "🎯", protein_tip: "🥩",
};

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

interface Props {
  userId: string;
  notifications: Notification[];
  unreadCount: number;
  onMarkRead: (id: number) => void;
  onMarkAllRead: () => void;
  onRefresh: () => void;
}

export default function NotificationBell({
  userId,
  notifications,
  unreadCount,
  onMarkRead,
  onMarkAllRead,
  onRefresh,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  async function handleMarkRead(id: number) {
    await api.markNotifRead(id).catch(() => null);
    onMarkRead(id);
  }

  async function handleMarkAll() {
    await api.markAllRead(userId).catch(() => null);
    onMarkAllRead();
    onRefresh();
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 rounded-xl hover:bg-slate-800 transition-colors"
        aria-label="Notifications"
      >
        <Bell size={20} className={unreadCount > 0 ? "text-indigo-400 animate-pulse-soft" : "text-slate-400"} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-indigo-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center animate-bounce-in">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-12 w-96 glass rounded-2xl border border-slate-700/60 shadow-2xl z-50 animate-fade-in overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Bell size={15} className="text-indigo-400" />
              <span className="font-semibold text-sm text-slate-200">Notifications</span>
              {unreadCount > 0 && (
                <span className="bg-indigo-500/20 text-indigo-400 text-xs px-2 py-0.5 rounded-full">
                  {unreadCount} new
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAll}
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-emerald-400 transition-colors"
              >
                <CheckCheck size={13} />
                All read
              </button>
            )}
          </div>

          {/* List */}
          <div className="overflow-y-auto max-h-[420px]">
            {notifications.length === 0 ? (
              <div className="py-10 text-center text-slate-500 text-sm">
                <Bell size={28} className="mx-auto mb-2 opacity-30" />
                No notifications yet
              </div>
            ) : (
              notifications.map((n) => {
                const icon = TYPE_ICON[n.type] ?? "💡";
                return (
                  <div
                    key={n.id}
                    className={`flex gap-3 p-4 border-b border-slate-800/50 transition-colors ${
                      n.read ? "opacity-50" : "hover:bg-slate-800/40"
                    }`}
                  >
                    <span className="text-xl shrink-0 mt-0.5">{icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm font-medium leading-tight ${n.read ? "text-slate-400" : "text-slate-100"}`}>
                          {n.title}
                        </p>
                        <span className="text-[10px] text-slate-600 shrink-0">{timeAgo(n.created_at)}</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1 leading-snug">{n.message}</p>
                    </div>
                    {!n.read && (
                      <button
                        onClick={() => handleMarkRead(n.id)}
                        className="shrink-0 text-slate-600 hover:text-emerald-400 transition-colors mt-0.5"
                        title="Mark read"
                      >
                        <Check size={14} />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {notifications.length > 0 && (
            <div className="px-4 py-2 border-t border-slate-800 text-center">
              <span className="text-xs text-slate-600">Showing last {notifications.length} notifications</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
