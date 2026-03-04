"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Notification } from "@/lib/types";

const TYPE_CONFIG: Record<string, { icon: string; bar: string; bg: string }> = {
  meal_high_cal:   { icon: "🍽️", bar: "bg-orange-500", bg: "border-orange-500/30" },
  meal_low_cal:    { icon: "🥗", bar: "bg-blue-500",   bg: "border-blue-500/30" },
  meal_logged:     { icon: "✅", bar: "bg-emerald-500", bg: "border-emerald-500/30" },
  workout_complete:{ icon: "💪", bar: "bg-purple-500",  bg: "border-purple-500/30" },
  workout_reminder:{ icon: "🏃", bar: "bg-amber-500",   bg: "border-amber-500/30" },
  workout_great:   { icon: "🏆", bar: "bg-emerald-500", bg: "border-emerald-500/30" },
  workout_tip:     { icon: "⚡", bar: "bg-yellow-500",  bg: "border-yellow-500/30" },
  sleep_warning:   { icon: "😴", bar: "bg-red-500",     bg: "border-red-500/30" },
  steps_low:       { icon: "👟", bar: "bg-orange-500",  bg: "border-orange-500/30" },
  seed_complete:   { icon: "🎉", bar: "bg-indigo-500",  bg: "border-indigo-500/30" },
  goal_update:     { icon: "🎯", bar: "bg-indigo-500",  bg: "border-indigo-500/30" },
  protein_tip:     { icon: "🥩", bar: "bg-rose-500",    bg: "border-rose-500/30" },
  default:         { icon: "💡", bar: "bg-slate-500",   bg: "border-slate-500/30" },
};

interface Toast extends Notification {
  exiting?: boolean;
}

interface Props {
  toasts: Notification[];
  onDismiss: (id: number) => void;
}

export default function ToastNotifications({ toasts, onDismiss }: Props) {
  const [items, setItems] = useState<Toast[]>([]);
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    setItems((prev) => {
      const prevIds = new Set(prev.map((t) => t.id));
      const fresh = toasts.filter((t) => !prevIds.has(t.id));
      if (!fresh.length) return prev;

      fresh.forEach((t) => {
        timers.current[t.id] = setTimeout(() => dismiss(t.id), 6000);
      });
      return [...prev, ...fresh];
    });
  }, [toasts]); // eslint-disable-line

  function dismiss(id: number) {
    clearTimeout(timers.current[id]);
    delete timers.current[id];
    setItems((p) => p.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    setTimeout(() => {
      setItems((p) => p.filter((t) => t.id !== id));
      onDismiss(id);
    }, 280);
  }

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-3 w-80 pointer-events-none">
      {items.map((t) => {
        const cfg = TYPE_CONFIG[t.type] ?? TYPE_CONFIG.default;
        return (
          <div
            key={t.id}
            className={`
              pointer-events-auto glass rounded-xl border overflow-hidden shadow-2xl
              ${cfg.bg} ${t.exiting ? "toast-exit" : "toast-enter"}
            `}
          >
            {/* Progress bar */}
            <div className={`h-1 ${cfg.bar} animate-[shrink_6s_linear_forwards]`} />

            <div className="p-4 flex gap-3">
              <span className="text-2xl mt-0.5 shrink-0">{cfg.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-100 text-sm leading-tight">{t.title}</p>
                <p className="text-slate-400 text-xs mt-1 leading-snug line-clamp-3">{t.message}</p>
              </div>
              <button
                onClick={() => dismiss(t.id)}
                className="shrink-0 text-slate-500 hover:text-slate-300 transition-colors mt-0.5"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        );
      })}

      <style jsx>{`
        @keyframes shrink {
          from { width: 100%; }
          to   { width: 0%; }
        }
      `}</style>
    </div>
  );
}
