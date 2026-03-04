"use client";

import { Camera, CheckCircle, Eye, Plus, RefreshCw, Trash2, Upload, Utensils, Zap } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { MealAnalysis, MealEntry, Notification } from "@/lib/types";

const MACRO_COLORS = {
  protein: { bar: "bg-blue-500",   text: "text-blue-400",   label: "Protein" },
  carbs:   { bar: "bg-amber-500",  text: "text-amber-400",  label: "Carbs" },
  fat:     { bar: "bg-rose-500",   text: "text-rose-400",   label: "Fat" },
};

function MacroBar({ label, g, maxG, color }: { label: string; g: number; maxG: number; color: typeof MACRO_COLORS.protein }) {
  const pct = maxG > 0 ? Math.min((g / maxG) * 100, 100) : 0;
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className={`text-xs font-medium ${color.text}`}>{color.label}</span>
        <span className="text-xs text-slate-400">{g}g</span>
      </div>
      <div className="progress-bar">
        <div className={`progress-fill ${color.bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

interface Props {
  userId: string;
  addToast: (n: Notification) => void;
  onMealsChange?: () => void;
}

export default function MealPanel({ userId, addToast, onMealsChange }: Props) {
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<MealAnalysis | null>(null);
  const [mealId, setMealId] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [mealList, setMealList] = useState<MealEntry[]>([]);
  const [mealForm, setMealForm] = useState({ name: "", calories: "", protein_g: "", carbs_g: "", fat_g: "" });
  const [addingMeal, setAddingMeal] = useState(false);
  const [showAddMeal, setShowAddMeal] = useState(false);
  const [aiEstimating, setAiEstimating] = useState(false);
  const [deletingMealId, setDeletingMealId] = useState<number | null>(null);

  const loadMeals = useCallback(async () => {
    try {
      const res = await api.todayMeals(userId);
      setMealList(res.meals);
      onMealsChange?.();
    } catch {
      setMealList([]);
    }
  }, [userId, onMealsChange]);

  useEffect(() => {
    loadMeals();
  }, [loadMeals]);

  const processFile = useCallback(
    async (file: File) => {
      const url = URL.createObjectURL(file);
      setPreview(url);
      setAnalysis(null);
      setConfirmed(false);
      setLoading(true);

      try {
        const res = await api.analyzeMeal(userId, file);
        setAnalysis(res.analysis);
        setMealId(res.id);
        addToast({
          id: Date.now(),
          type: "meal_logged",
          title: res.analysis.stub ? "Reka stub — add API key" : "Meal analysed! ✅",
          message: res.analysis.notes || "Check the right panel for full breakdown.",
          read: false,
          created_at: new Date().toISOString(),
        });
        loadMeals();
      } catch (e) {
        addToast({
          id: Date.now(),
          type: "default",
          title: "Meal analysis failed",
          message: String(e),
          read: false,
          created_at: new Date().toISOString(),
        });
      } finally {
        setLoading(false);
      }
    },
    [userId, addToast, loadMeals]
  );

  async function handleDeleteMeal(mealId: number, mealName: string) {
    if (!confirm(`Remove "${mealName}" from today's log?`)) return;
    setDeletingMealId(mealId);
    try {
      await api.deleteMeal(userId, mealId);
      loadMeals();
      addToast({
        id: Date.now(),
        type: "default",
        title: "Meal removed",
        message: `"${mealName}" deleted from today's log.`,
        read: false,
        created_at: new Date().toISOString(),
      });
    } catch (err) {
      addToast({ id: Date.now(), type: "default", title: "Could not delete meal", message: String(err), read: false, created_at: new Date().toISOString() });
    } finally {
      setDeletingMealId(null);
    }
  }

  async function handleLogMeal(e: React.FormEvent) {
    e.preventDefault();
    const name = mealForm.name.trim();
    if (!name || addingMeal) return;
    setAddingMeal(true);
    try {
      const res = await api.logMeal(userId, {
        name,
        calories: mealForm.calories ? parseInt(mealForm.calories, 10) : undefined,
        protein_g: mealForm.protein_g ? parseInt(mealForm.protein_g, 10) : undefined,
        carbs_g: mealForm.carbs_g ? parseInt(mealForm.carbs_g, 10) : undefined,
        fat_g: mealForm.fat_g ? parseInt(mealForm.fat_g, 10) : undefined,
      });
      setMealForm({ name: "", calories: "", protein_g: "", carbs_g: "", fat_g: "" });
      setShowAddMeal(false);
      loadMeals();
      const cal = res.analysis?.estimated_calories;
      const m = res.analysis?.estimated_macros;
      const parts: string[] = [`Added: ${name}`];
      if (cal) parts.push(`~${cal} kcal`);
      if (m?.protein_g) parts.push(`P ${m.protein_g}g`);
      if (m?.carbs_g) parts.push(`C ${m.carbs_g}g`);
      if (m?.fat_g) parts.push(`F ${m.fat_g}g`);
      addToast({
        id: Date.now(),
        type: "meal_logged",
        title: "Meal logged ✅",
        message: parts.join(" · "),
        read: false,
        created_at: new Date().toISOString(),
      });
    } catch (err) {
      addToast({
        id: Date.now(),
        type: "default",
        title: "Could not add meal",
        message: String(err),
        read: false,
        created_at: new Date().toISOString(),
      });
    } finally {
      setAddingMeal(false);
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file?.type.startsWith("image/")) processFile(file);
  }

  const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

  async function confirmMeal() {
    if (!mealId || !analysis) return;
    try {
      await fetch(
        `${apiBase}/meal/${mealId}/confirm`,
        { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true }) }
      );
      setConfirmed(true);
      loadMeals();
    } catch {/* silent */}
  }

  const macros = analysis?.estimated_macros;
  const maxG = macros ? Math.max(macros.protein_g, macros.carbs_g, macros.fat_g, 1) : 1;

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto">
      {/* ── My meal list (dedicated list + add) ───────────────────────── */}
      <div className="glass rounded-2xl p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Utensils size={13} className="text-emerald-400" />
          My meals today
        </h3>
        {mealList.length > 0 ? (
          <ul className="space-y-1.5 mb-3 max-h-48 overflow-y-auto">
            {mealList.map((m) => {
              const hasMacros = [m.protein_g, m.carbs_g, m.fat_g].some((v) => v != null && v > 0);
              return (
                <li key={m.id} className="bg-slate-800/50 rounded-lg px-3 py-2 text-sm group">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-200 capitalize truncate flex-1">{m.name}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-slate-500 text-xs">
                        {m.calories != null ? `${m.calories} kcal` : "—"}
                        {m.source === "photo" && " 📷"}
                      </span>
                      <button
                        onClick={() => handleDeleteMeal(m.id, m.name)}
                        disabled={deletingMealId === m.id}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-600 hover:text-rose-400 hover:bg-rose-400/10 transition-all"
                        title="Remove meal"
                      >
                        {deletingMealId === m.id
                          ? <RefreshCw size={11} className="animate-spin" />
                          : <Trash2 size={11} />}
                      </button>
                    </div>
                  </div>
                  {hasMacros && (
                    <div className="flex gap-2 mt-1 text-[10px] text-slate-500">
                      <span className={MACRO_COLORS.protein.text}>P {m.protein_g ?? "—"}g</span>
                      <span className={MACRO_COLORS.carbs.text}>C {m.carbs_g ?? "—"}g</span>
                      <span className={MACRO_COLORS.fat.text}>F {m.fat_g ?? "—"}g</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-slate-500 text-sm mb-3">No meals logged yet today.</p>
        )}
        {showAddMeal ? (
          <form onSubmit={handleLogMeal} className="space-y-2">
            <input
              type="text"
              value={mealForm.name}
              onChange={(e) => setMealForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Chipotle bowl"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-indigo-500"
              autoFocus
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                min={0}
                value={mealForm.calories}
                onChange={(e) => setMealForm((f) => ({ ...f, calories: e.target.value }))}
                placeholder="Cal (kcal)"
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-indigo-500"
              />
              <input
                type="number"
                min={0}
                value={mealForm.protein_g}
                onChange={(e) => setMealForm((f) => ({ ...f, protein_g: e.target.value }))}
                placeholder="Protein (g)"
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-indigo-500"
              />
              <input
                type="number"
                min={0}
                value={mealForm.carbs_g}
                onChange={(e) => setMealForm((f) => ({ ...f, carbs_g: e.target.value }))}
                placeholder="Carbs (g)"
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-indigo-500"
              />
              <input
                type="number"
                min={0}
                value={mealForm.fat_g}
                onChange={(e) => setMealForm((f) => ({ ...f, fat_g: e.target.value }))}
                placeholder="Fat (g)"
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-indigo-500"
              />
            </div>
            <p className="text-[10px] text-indigo-400 text-center">
              💡 Leave fields blank → AI estimates nutrients automatically
            </p>
            <div className="flex gap-2">
              <button type="submit" disabled={addingMeal || !mealForm.name.trim()} className="flex-1 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white flex items-center justify-center gap-1.5">
                {addingMeal ? (
                  <><RefreshCw size={13} className="animate-spin" /> Estimating…</>
                ) : "Add & Estimate"}
              </button>
              <button type="button" onClick={() => setShowAddMeal(false)} className="py-2 px-3 rounded-lg text-sm text-slate-400 hover:text-slate-200">
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setShowAddMeal(true)}
            className="w-full py-2 rounded-xl text-sm font-medium text-indigo-400 hover:text-indigo-300 bg-slate-800/60 hover:bg-slate-800 border border-slate-700 flex items-center justify-center gap-2"
          >
            <Plus size={14} />
            Add meal
          </button>
        )}
        <p className="text-[10px] text-slate-600 mt-2">Chat uses this list to suggest what to eat next.</p>
      </div>

      {/* Upload zone (photo analysis) */}
      <div className="glass rounded-2xl p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Camera size={13} className="text-pink-400" />
          Meal Analysis
          <span className="ml-auto text-[10px] text-slate-600 font-normal normal-case">Powered by Reka Vision</span>
        </h3>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          className={`
            relative cursor-pointer rounded-xl border-2 border-dashed transition-all duration-200
            flex flex-col items-center justify-center overflow-hidden
            ${dragging ? "border-indigo-400 bg-indigo-500/10" : "border-slate-700 hover:border-slate-600 hover:bg-slate-800/30"}
            ${preview ? "h-48" : "h-36"}
          `}
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Meal" className="w-full h-full object-cover" />
          ) : (
            <div className="text-center p-4">
              <Upload size={24} className="mx-auto text-slate-600 mb-2" />
              <p className="text-sm text-slate-400">Drop a meal photo here</p>
              <p className="text-xs text-slate-600 mt-1">or click to browse</p>
            </div>
          )}
          {loading && (
            <div className="absolute inset-0 bg-slate-950/70 flex flex-col items-center justify-center gap-2">
              <RefreshCw size={22} className="text-indigo-400 animate-spin" />
              <p className="text-xs text-indigo-400">Analysing with Reka…</p>
            </div>
          )}
        </div>

        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />

        <button
          onClick={() => fileRef.current?.click()}
          disabled={loading}
          className="w-full mt-3 py-2 rounded-xl text-sm font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors border border-slate-700 flex items-center justify-center gap-2"
        >
          <Camera size={14} />
          {preview ? "Upload different photo" : "Choose Photo"}
        </button>
      </div>

      {/* Analysis results */}
      {analysis && (
        <div className="glass rounded-2xl p-4 animate-fade-in">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Utensils size={13} className="text-emerald-400" />
            Analysis Results
            {analysis.stub && (
              <span className="ml-auto text-[10px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">Stub mode</span>
            )}
          </h3>

          {/* Calorie display */}
          {analysis.estimated_calories !== null && (
            <div className="flex items-center justify-center gap-3 mb-4 bg-slate-800/50 rounded-xl p-3">
              <Zap size={20} className="text-amber-400" />
              <div className="text-center">
                <p className="text-3xl font-bold text-amber-400">{analysis.estimated_calories}</p>
                <p className="text-xs text-slate-500">estimated kcal</p>
              </div>
            </div>
          )}

          {/* Food items */}
          <div className="space-y-1.5 mb-4">
            {analysis.items.map((item, i) => (
              <div key={i} className="flex items-center justify-between bg-slate-800/50 rounded-lg px-3 py-2">
                <span className="text-sm text-slate-200 capitalize">{item.name}</span>
                <div className="flex items-center gap-1.5">
                  <div className="w-16 progress-bar">
                    <div
                      className="progress-fill bg-emerald-500"
                      style={{ width: `${Math.round(item.confidence * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-slate-500 w-8 text-right">{Math.round(item.confidence * 100)}%</span>
                </div>
              </div>
            ))}
          </div>

          {/* Macros */}
          {macros && (
            <div className="space-y-2.5 mb-4">
              <p className="text-xs text-slate-500 uppercase tracking-wider">Macros</p>
              <MacroBar label="Protein" g={macros.protein_g} maxG={maxG} color={MACRO_COLORS.protein} />
              <MacroBar label="Carbs" g={macros.carbs_g} maxG={maxG} color={MACRO_COLORS.carbs} />
              <MacroBar label="Fat" g={macros.fat_g} maxG={maxG} color={MACRO_COLORS.fat} />
            </div>
          )}

          {/* Notes */}
          {analysis.notes && (
            <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-3 mb-3">
              <div className="flex gap-2">
                <Eye size={14} className="text-indigo-400 shrink-0 mt-0.5" />
                <p className="text-xs text-indigo-300 leading-relaxed">{analysis.notes}</p>
              </div>
            </div>
          )}

          {/* Confirm */}
          {!confirmed ? (
            <button
              onClick={confirmMeal}
              className="w-full py-2.5 rounded-xl text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors flex items-center justify-center gap-2 shadow-md shadow-emerald-500/20"
            >
              <CheckCircle size={15} />
              Confirm & Save to Log
            </button>
          ) : (
            <div className="flex items-center justify-center gap-2 py-2.5 text-sm text-emerald-400">
              <CheckCircle size={15} />
              Saved to your food log
            </div>
          )}
        </div>
      )}

      {/* Placeholder */}
      {!analysis && !loading && (
        <div className="glass rounded-2xl p-5 text-center">
          <Utensils size={32} className="mx-auto text-slate-700 mb-2" />
          <p className="text-sm text-slate-500">Upload a meal photo to get instant nutrition insights</p>
          <p className="text-xs text-slate-700 mt-1">AI identifies foods + estimates calories & macros</p>
        </div>
      )}
    </div>
  );
}
