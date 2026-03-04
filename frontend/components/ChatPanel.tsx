"use client";

import { Database, Globe, Send, Sparkles, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ChatMessage } from "@/lib/types";

const TOOL_LABELS: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  get_today_summary: { label: "DB today", icon: <Database size={10} />, color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  get_week_summary:  { label: "DB week",  icon: <Database size={10} />, color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  web_search:        { label: "Tavily",   icon: <Globe size={10} />,    color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  get_last_meal:     { label: "Reka meal", icon: <Sparkles size={10} />, color: "bg-pink-500/20 text-pink-400 border-pink-500/30" },
  get_today_meals:   { label: "Meal list",     icon: <Database size={10} />, color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  get_daily_plan:    { label: "Daily plan",    icon: <Database size={10} />, color: "bg-teal-500/20 text-teal-400 border-teal-500/30" },
  get_user_profile:  { label: "Profile",       icon: <Database size={10} />, color: "bg-sky-500/20 text-sky-400 border-sky-500/30" },
  lookup_nutrition:  { label: "Nutrition AI",  icon: <Sparkles size={10} />, color: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  set_goal:          { label: "Goals",         icon: <Sparkles size={10} />, color: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
};

const QUICK = [
  "Summarize my day and tell me what to do next.",
  "I just ate this — how does it affect my goals?",
  "Can I have coffee now? I slept only 5 hours.",
  "Make a simple plan for tomorrow morning.",
  "What patterns do you see in my last week?",
];

interface Props {
  userId: string;
}

export default function ChatPanel({ userId }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "👋 Hi! I'm your LifeOS Agent. Seed your week's data, upload a meal photo, then ask me anything — from daily summaries to workout plans. I use live web search and your real health data to give precise coaching.",
      ts: Date.now(),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;

    setInput("");
    setMessages((p) => [...p, { role: "user", content: msg, ts: Date.now() }]);
    setLoading(true);

    try {
      const res = await api.chat(userId, msg);
      setMessages((p) => [
        ...p,
        {
          role: "assistant",
          content: res.reply,
          tools_used: res.tools_used,
          actions: res.actions as ChatMessage["actions"],
          ts: Date.now(),
        },
      ]);
    } catch (e) {
      setMessages((p) => [
        ...p,
        {
          role: "assistant",
          content: `⚠️ Error: ${e instanceof Error ? e.message : String(e)}`,
          ts: Date.now(),
        },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="flex flex-col h-full glass rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-800">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg">
          <Sparkles size={17} className="text-white" />
        </div>
        <div>
          <h2 className="font-semibold text-slate-100 text-sm">AI Health Coach</h2>
          <p className="text-[11px] text-slate-500">Powered by GPT-4o-mini + Tavily + Reka</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-slate-500">Live</span>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto chat-scroll px-4 py-4 space-y-4">
        {messages.map((m, i) => (
          <div key={i} className={`msg-enter flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
            {/* Avatar */}
            <div className={`shrink-0 w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold shadow-md ${
              m.role === "user"
                ? "bg-gradient-to-br from-indigo-600 to-violet-600 text-white"
                : "bg-gradient-to-br from-slate-700 to-slate-600 text-slate-300"
            }`}>
              {m.role === "user" ? <User size={14} /> : <Sparkles size={14} />}
            </div>

            {/* Bubble */}
            <div className={`max-w-[85%] ${m.role === "user" ? "items-end" : "items-start"} flex flex-col gap-1.5`}>
              <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                m.role === "user"
                  ? "bg-gradient-to-br from-indigo-600 to-violet-600 text-white rounded-tr-sm"
                  : "bg-slate-800/80 text-slate-200 rounded-tl-sm border border-slate-700/50"
              }`}>
                {m.content}
              </div>

              {/* Tool badges */}
              {m.tools_used && m.tools_used.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {m.tools_used.map((t) => {
                    const cfg = TOOL_LABELS[t];
                    if (!cfg) return null;
                    return (
                      <span key={t} className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-medium ${cfg.color}`}>
                        {cfg.icon}
                        Used {cfg.label}
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Actions */}
              {m.actions && m.actions.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-1">
                  {m.actions.map((a, j) => (
                    <div key={j} className="flex items-center gap-1.5 bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-300">
                      <span>{a.payload.icon}</span>
                      {a.payload.text}
                    </div>
                  ))}
                </div>
              )}

              <span className="text-[10px] text-slate-600 px-1">
                {new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {loading && (
          <div className="msg-enter flex gap-3">
            <div className="shrink-0 w-8 h-8 rounded-xl bg-gradient-to-br from-slate-700 to-slate-600 flex items-center justify-center">
              <Sparkles size={14} className="text-slate-300" />
            </div>
            <div className="bg-slate-800/80 border border-slate-700/50 px-4 py-3 rounded-2xl rounded-tl-sm flex items-center gap-1.5">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
          </div>
        )}
      </div>

      {/* Quick prompts */}
      <div className="px-4 py-2 border-t border-slate-800/50 flex gap-2 overflow-x-auto scrollbar-hide">
        {QUICK.map((q, i) => (
          <button
            key={i}
            onClick={() => send(q)}
            disabled={loading}
            className="shrink-0 text-[11px] text-slate-400 hover:text-indigo-400 bg-slate-800/60 hover:bg-slate-800 border border-slate-700/50 hover:border-indigo-500/50 px-3 py-1.5 rounded-xl transition-all duration-150 whitespace-nowrap"
          >
            {q.length > 40 ? q.slice(0, 38) + "…" : q}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="px-4 pb-4 pt-2">
        <div className="flex gap-2 bg-slate-800/60 border border-slate-700/60 rounded-xl p-2 focus-within:border-indigo-500/50 transition-colors">
          <textarea
            ref={inputRef}
            rows={1}
            className="flex-1 bg-transparent resize-none text-sm text-slate-200 placeholder-slate-600 outline-none py-1 px-2 leading-relaxed"
            placeholder="Ask me anything about your health…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            style={{ maxHeight: "120px" }}
          />
          <button
            onClick={() => send()}
            disabled={!input.trim() || loading}
            className="shrink-0 w-9 h-9 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center transition-all duration-150 active:scale-95 shadow-md"
          >
            <Send size={15} />
          </button>
        </div>
        <p className="text-[10px] text-slate-700 mt-1.5 text-center">Enter ↵ to send · Shift+Enter for newline</p>
      </div>
    </div>
  );
}
