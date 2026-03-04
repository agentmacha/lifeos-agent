"use client";

import { ChevronDown, ChevronUp, Droplets, Flame, Sparkles, Target, Utensils } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import type { DailyPlan } from "@/lib/types";

interface Props {
  userId: string;
  plan: DailyPlan | null;
  onRefresh: () => void;
}

export default function TodayPlanCard({ userId, plan, onRefresh }: Props) {
  const [aiPlan, setAiPlan] = useState<string | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [expanded, setExpanded] = useState(true);

  async function getAIPlan() {
    setLoadingPlan(true);
    setAiPlan(null);
    try {
      const res = await api.chat(
        userId,
        "Give me my plan for the rest of today. Consider: what I've eaten so far (calories and macros), my workouts, steps, and sleep. Tell me exactly what to eat next (with protein/carbs if possible), whether to workout or rest, and one concrete action. Be specific and short."
      );
      setAiPlan(res.reply);
    } catch {
      setAiPlan("Could not load plan. Try again.");
    } finally {
      setLoadingPlan(false);
    }
  }

  if (!plan) return null;

  const { eaten, burned, remaining, targets, suggestions, water, step_calories } = plan;

  function MacroBar({ label, val, target, color }: { label: string; val: number; target: number; color: string }) {
    const pct = target > 0 ? Math.min(Math.round((val / target) * 100), 100) : 0;
    return (
      <div>
        <div className="flex justify-between text-[10px] mb-0.5">
          <span className="text-slate-500">{label}</span>
          <span className="text-slate-400">{val}g / {target}g</span>
        </div>
        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  return (
    <div className="glass rounded-2xl p-4">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between text-left mb-2"
      >
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
          <Target size={13} className="text-amber-400" />
          Today&apos;s plan
          {targets?.target_calories && (
            <span className="ml-1 text-[10px] text-slate-600 font-normal normal-case">
              · {targets.target_calories} kcal budget
            </span>
          )}
        </h3>
        {expanded ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
      </button>

      {expanded && (
        <>
          {/* Calories row */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="bg-slate-800/50 rounded-lg p-2.5 text-center">
              <div className="flex items-center justify-center gap-1 text-[10px] text-slate-500 mb-0.5">
                <Utensils size={9} /> Eaten
              </div>
              <p className="text-base font-bold text-slate-100">{eaten.calories}</p>
              <p className="text-[9px] text-slate-600">kcal</p>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-2.5 text-center">
              <div className="flex items-center justify-center gap-1 text-[10px] text-slate-500 mb-0.5">
                <Flame size={9} /> Burned
              </div>
              <p className="text-base font-bold text-amber-400">{burned + (step_calories ?? 0)}</p>
              <p className="text-[9px] text-slate-600">kcal</p>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-2.5 text-center">
              <div className="flex items-center justify-center gap-1 text-[10px] text-slate-500 mb-0.5">
                <Target size={9} /> Left
              </div>
              <p className={`text-base font-bold ${remaining.calories > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {remaining.calories}
              </p>
              <p className="text-[9px] text-slate-600">kcal</p>
            </div>
          </div>

          {/* Macro progress bars */}
          {targets && (
            <div className="space-y-2 mb-3">
              <MacroBar label="Protein" val={eaten.protein_g} target={targets.protein_g} color="bg-blue-500" />
              <MacroBar label="Carbs" val={eaten.carbs_g} target={targets.carbs_g} color="bg-amber-500" />
              <MacroBar label="Fat" val={eaten.fat_g} target={targets.fat_g} color="bg-rose-500" />
            </div>
          )}

          {/* Water row */}
          {water && (
            <div className="flex items-center gap-2 mb-3 bg-slate-800/40 rounded-lg px-3 py-2">
              <Droplets size={13} className="text-cyan-400" />
              <div className="flex-1">
                <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full bg-cyan-500 rounded-full transition-all duration-700"
                    style={{ width: `${Math.min((water.drunk_ml / water.target_ml) * 100, 100)}%` }} />
                </div>
              </div>
              <span className="text-[10px] text-cyan-400 shrink-0">{water.drunk_ml}/{water.target_ml}ml</span>
            </div>
          )}

          {/* Remaining pill */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            <span className="bg-blue-500/20 text-blue-400 text-[10px] px-2 py-0.5 rounded-full">
              {remaining.protein_g}g protein left
            </span>
          </div>

          {/* Rule-based suggestions */}
          {suggestions.length > 0 && (
            <ul className="space-y-1 mb-3">
              {suggestions.map((s, i) => (
                <li key={i} className="text-[11px] text-slate-400 flex gap-1.5">
                  <span className="text-emerald-500 shrink-0">•</span>
                  {s}
                </li>
              ))}
            </ul>
          )}

          {/* AI plan */}
          <div className="border-t border-slate-800 pt-3">
            <button
              type="button"
              onClick={getAIPlan}
              disabled={loadingPlan}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-medium bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-60 text-white"
            >
              <Sparkles size={14} />
              {loadingPlan ? "Getting plan…" : "Get today's plan from AI"}
            </button>
            {aiPlan && (
              <div className="mt-3 p-3 bg-slate-800/50 rounded-xl border border-slate-700/50">
                <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">{aiPlan}</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
