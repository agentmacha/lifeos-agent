export interface TodaySummary {
  date: string;
  sleep_hrs: number;
  steps: number;
  calories_burned: number;
  workouts: Workout[];
  last_meal: MealRef | null;
}

export interface Workout {
  id?: number;
  type: string;
  duration_min: number;
  calories: number;
  intensity: string;
}

export interface MealRef {
  id: number;
  items: FoodItem[];
  estimated_calories: number | null;
  ts: string;
}

export interface WeekSummary {
  days_tracked: number;
  avg_sleep_hrs: number;
  avg_steps: number;
  total_calories_burned: number;
  workout_count: number;
  workout_breakdown: Record<string, number>;
  daily_breakdown: DailyEntry[];
}

export interface DailyEntry {
  date: string;
  sleep: number;
  steps: number;
  calories: number;
  workouts: number;
}

export interface FoodItem {
  name: string;
  confidence: number;
}

export interface Macros {
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface MealAnalysis {
  items: FoodItem[];
  estimated_calories: number | null;
  estimated_macros: Macros | null;
  notes: string;
  stub?: boolean;
}

export interface MealRecord {
  id: number;
  ts: string;
  analysis: MealAnalysis;
  confirmed: Record<string, unknown> | null;
}

/** One row in "today's meals" list (manual or photo). */
export interface MealEntry {
  id: number;
  name: string;
  calories: number | null;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  ts: string;
  source: "manual" | "photo";
}

export interface Notification {
  id: number;
  type: string;
  title: string;
  message: string;
  read: boolean;
  created_at: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  tools_used?: string[];
  actions?: Action[];
  ts: number;
}

export interface Action {
  type: "suggestion" | "reminder" | "plan";
  payload: { text: string; icon: string };
}

export interface Goals {
  daily_calories: number;
  protein_g: number;
  steps_target: number;
  sleep_target: number;
}

export interface UserProfile {
  user_id: string;
  name?: string;
  age?: number;
  gender?: string;
  weight_kg?: number;
  height_cm?: number;
  activity_level?: string;
  goal?: string;
}

export interface TDEE {
  bmr: number;
  tdee: number;
  target_calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  water_ml: number;
}

export interface WaterStatus {
  total_ml: number;
  target_ml: number;
  pct: number;
}

/** Combined nutrition + activity + goals for today's plan. */
export interface DailyPlan {
  date: string;
  meals: MealEntry[];
  eaten: { calories: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number; sugar_g: number };
  burned: number;
  step_calories: number;
  net_calories: number;
  workouts: Workout[];
  steps: number;
  sleep_hrs: number;
  water: { drunk_ml: number; target_ml: number; remaining_ml: number };
  targets: TDEE | { target_calories: number; protein_g: number; carbs_g: number; fat_g: number; water_ml: number; bmr: null; tdee: null };
  remaining: { calories: number; protein_g: number };
  suggestions: string[];
}
