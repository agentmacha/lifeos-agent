# LifeOS Agent 🧠

> Unified AI health coach — workouts · sleep · meals · live research

**Hackathon MVP** · Sponsors: **Render** (deploy) · **Tavily** (web search) · **Reka** (meal vision)

---

## Stack

| Layer | Tech |
|-------|------|
| Backend | FastAPI · SQLAlchemy · **SQLite** (zero-setup, works everywhere) |
| Frontend | Next.js 15 · TypeScript · Tailwind CSS · Recharts |
| AI | OpenAI GPT-4o-mini (tool-calling, nutrition lookup) |
| Vision | Reka Vision API |
| Search | Tavily Search API |
| Deploy | Render (2 web services + 1 GB persistent disk) |
| Notifications | Server-Sent Events (real-time push) |

> **Database**: SQLite by default — no Docker, no Postgres, no credentials needed.
> Data is stored in `backend/lifeos.db`. On Render the disk is mounted at `/data/lifeos.db` and survives redeploys.

---

## Local Development

### 1 — Clone & copy env files

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

Edit `backend/.env` with your real API keys (all are optional — stubs work without them):

```
OPENAI_API_KEY=sk-...
TAVILY_API_KEY=tvly-...
REKA_API_KEY=...
```

No database setup needed. `lifeos.db` is created automatically on first run.

### 2 — Start the backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

`lifeos.db` is created automatically in the `backend/` folder. No Postgres or Docker needed.

API docs: http://localhost:8000/docs

### 3 — Start the frontend

```bash
cd frontend
npm install
npm run dev
```

App: http://localhost:3000

---

## Core User Flow

1. **Seed data** — Click "Seed Synthetic Week" in the left panel → generates 7 days of realistic health events
2. **Upload meal** — Drag or pick a photo in the right panel → Reka Vision analyses calories & macros
3. **Chat** — Type in the center panel → Agent uses tool-calling to pull DB stats + Tavily search
4. **Import from iPhone Health** — Click "Import from Apple Health" → upload the export ZIP from the Health app (Profile → Export All Health Data). Steps, sleep, and workouts from the last 30 days are imported and show in Today / Week and in the AI coach.

---

## iPhone Health integration

- **Web (no app):** On iPhone go to **Health → Profile (top right) → Export All Health Data**. Share/save the ZIP. In LifeOS click **Import from Apple Health** and upload that ZIP. The backend parses steps, sleep analysis, and workouts and merges them into your dashboard (last 30 days).
- **Future native app:** The API supports **POST /health/sync** so a small iOS app can read HealthKit and push data automatically: `{ "user_id": "...", "steps": [{ "date": "2024-02-27", "value": 8000 }], "sleep": [{ "date": "2024-02-26", "hours": 7.5 }], "workouts": [{ "start": "ISO8601", "end": "ISO8601", "workout_type": "run", "duration_min": 30, "calories": 240 }] }`.

---

## Demo Chat Prompts

| Prompt | What happens |
|--------|-------------|
| "Summarize my day and tell me what to do next." | Calls `get_today_summary` from DB |
| "I just ate this — how does it affect my goals?" | Calls `get_last_meal` + compares to goals |
| "Can I have coffee now? I slept only 5 hours." | Calls `get_today_summary` + Tavily search |
| "Make a simple plan for tomorrow morning." | Calls week summary + web research |
| "What patterns do you see in my last week?" | Calls `get_week_summary` from DB |

---

## Notifications

The app uses **Server-Sent Events** for real-time push notifications:

- 🎉 Data seeded — highlights from your week
- 😴 Sleep deficit detected — if average < 6.5h
- 💪 Workout achievement / reminder
- 🍽️ Post-meal insights — calories, macros, workout tips
- 🎯 Goal updates

Notifications appear as **toast pop-ups** (top-right) and in the **bell dropdown** (header).

### Scheduled reminders (SMS & email)

- **Twilio** (SMS) and **SendGrid** (email) send up to **3 short messages per day**: morning (9:00 UTC), lunch (13:00 UTC), sleep (22:00 UTC). No more.
- Users opt in in **Profile → Reminders**: add phone (E.164) and/or email, tick "Enable daily reminders".
- Env: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`. If missing, reminders are no-ops.
- Render cron runs at 9:00, 13:00, 22:00 UTC and calls `POST /cron/send-reminders`.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/healthz` | Health check |
| POST | `/seed/synthetic` | Generate 7-day synthetic data |
| GET | `/summary/today?user_id=` | Today's aggregated stats |
| GET | `/summary/week?user_id=` | 7-day summary + daily breakdown |
| POST | `/meal/analyze` | Upload photo → Reka analysis |
| GET | `/meal/last?user_id=` | Last meal record |
| POST | `/chat` | AI coaching with tool-calling |
| GET | `/notifications/stream/{user_id}` | SSE stream |
| GET | `/notifications/list/{user_id}` | All notifications |
| PUT | `/notifications/{id}/read` | Mark single read |
| PUT | `/notifications/user/{user_id}/read-all` | Mark all read |
| GET | `/notifications/preferences/{user_id}` | Reminder prefs (phone, email, on/off) |
| POST | `/notifications/preferences` | Save reminder prefs |
| POST | `/cron/send-reminders?reminder_type=auto` | Cron: send morning/lunch/sleep SMS & email |

---

## Render Deployment

Deploys **3 services** from `render.yaml`:

1. **lifeos-backend** — Python web service (FastAPI)
2. **lifeos-frontend** — Node web service (Next.js standalone)
3. **lifeos-db** — Managed PostgreSQL

**No PostgreSQL needed — uses SQLite with a 1 GB persistent disk on Render (included in render.yaml).**

### Step-by-step Render deploy

```bash
# 1. Push your repo to GitHub
git init && git add . && git commit -m "LifeOS Agent hackathon build"
git remote add origin https://github.com/YOUR_USER/lifeos-agent.git
git push -u origin main

# 2. Go to https://render.com → New → Blueprint
#    Point to your repo → render.yaml is auto-detected
#    Two services deploy: lifeos-backend + lifeos-frontend

# 3. After deploy, copy the backend URL (https://lifeos-backend.onrender.com)
#    Set NEXT_PUBLIC_API_BASE = https://lifeos-backend.onrender.com
#    on the lifeos-frontend service in Render dashboard → Environment

# 4. Set your API keys on lifeos-backend:
#    OPENAI_API_KEY, TAVILY_API_KEY, REKA_API_KEY
```

That's it — the SQLite DB file lives at `/data/lifeos.db` on the persistent disk and survives redeploys.

---

## Project Structure

```
.
├── backend/
│   ├── main.py          # All FastAPI routes + chat tool-calling
│   ├── settings.py      # Pydantic env settings
│   ├── database.py      # SQLAlchemy engine + session
│   ├── models.py        # DB tables: Event, Meal, Goal, Notification
│   ├── tavily_client.py # Tavily web search (with stub)
│   ├── reka_client.py   # Reka Vision (with stub)
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── app/             # Next.js App Router
│   ├── components/
│   │   ├── Dashboard.tsx         # 3-column layout + SSE
│   │   ├── StatsPanel.tsx        # Left: seed + metrics + charts
│   │   ├── ChatPanel.tsx         # Center: AI chat
│   │   ├── MealPanel.tsx         # Right: upload + analysis
│   │   ├── NotificationBell.tsx  # Bell + dropdown
│   │   └── ToastNotifications.tsx# Slide-in toasts
│   └── lib/
│       ├── api.ts        # Typed fetch wrappers
│       └── types.ts      # Shared TypeScript types
├── docker-compose.yml
├── render.yaml
└── README.md
```
