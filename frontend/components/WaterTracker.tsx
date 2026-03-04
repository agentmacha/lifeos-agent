"use client";

import { Droplets, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Notification, WaterStatus } from "@/lib/types";

const QUICK_ML = [150, 250, 350, 500];

interface Props {
  userId: string;
  addToast: (n: Notification) => void;
  onRefresh?: () => void;
}

export default function WaterTracker({ userId, addToast, onRefresh }: Props) {
  const [status, setStatus] = useState<WaterStatus | null>(null);
  const [logging, setLogging] = useState(false);

  const loadWater = useCallback(async () => {
    try {
      const res = await api.waterToday(userId);
      setStatus(res);
    } catch {/* silent */}
  }, [userId]);

  useEffect(() => { loadWater(); }, [loadWater]);

  async function logWater(ml: number) {
    if (logging) return;
    setLogging(true);
    try {
      const res = await api.logWater(userId, ml);
      setStatus((s) => s ? { ...s, total_ml: res.total_ml, pct: s.target_ml ? Math.round(res.total_ml / s.target_ml * 100) : 0 } : null);
      onRefresh?.();
    } catch {
      addToast({ id: Date.now(), type: "default", title: "Water log failed", message: "Try again", read: false, created_at: new Date().toISOString() });
    } finally {
      setLogging(false);
    }
  }

  const pct = Math.min(status?.pct ?? 0, 100);
  const total = status?.total_ml ?? 0;
  const target = status?.target_ml ?? 2500;

  return (
    <div className="glass rounded-2xl p-4">
      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
        <Droplets size={13} className="text-cyan-400" />
        Water intake
      </h3>

      {/* Wave progress */}
      <div className="relative h-14 bg-slate-800/50 rounded-xl overflow-hidden mb-3">
        <div
          className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-cyan-600/60 to-cyan-400/30 transition-all duration-700"
          style={{ height: `${pct}%` }}
        />
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <p className="text-lg font-bold text-cyan-300">{total}<span className="text-xs font-normal text-slate-400 ml-1">ml</span></p>
          <p className="text-[10px] text-slate-500">of {target}ml goal · {pct}%</p>
        </div>
      </div>

      {/* Quick-add buttons */}
      <div className="grid grid-cols-4 gap-1.5">
        {QUICK_ML.map((ml) => (
          <button
            key={ml}
            onClick={() => logWater(ml)}
            disabled={logging}
            className="py-1.5 rounded-lg text-xs font-medium text-cyan-400 bg-slate-800 hover:bg-cyan-900/30 hover:text-cyan-300 border border-slate-700 hover:border-cyan-700 transition-all disabled:opacity-50 flex items-center justify-center gap-0.5"
          >
            <Plus size={10} />{ml}ml
          </button>
        ))}
      </div>
      <p className="text-[10px] text-slate-600 mt-2 text-center">Target based on your body weight from profile</p>
    </div>
  );
}
