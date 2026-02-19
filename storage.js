const STORAGE_KEY = "habitTrackerDataV1";

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function normalizeData(data, defaults) {
  const base = clone(defaults);
  const dedupe = new Set();
  const categories = (Array.isArray(data?.categories) ? data.categories : base.categories)
    .map((item) => String(item || "").trim())
    .filter((item) => {
      const key = item.toLowerCase();
      if (!item || dedupe.has(key)) {
        return false;
      }
      dedupe.add(key);
      return true;
    });

  const fallbackCategories = categories.length > 0 ? categories : clone(base.categories);
  const habitSeen = new Set();
  const habits = (Array.isArray(data?.habits) ? data.habits : base.habits)
    .filter((habit) => habit && typeof habit === "object")
    .map((habit) => ({
      id: String(habit.id || `habit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`),
      name: String(habit.name || "").trim(),
      category: fallbackCategories.includes(habit.category) ? habit.category : fallbackCategories[0],
      frequency: habit.frequency === "weekly" ? "weekly" : "daily",
      createdAt: habit.createdAt || new Date().toISOString()
    }))
    .filter((habit) => {
      if (!habit.name) {
        return false;
      }
      const dedupeKey = `${habit.category.toLowerCase()}::${habit.name.toLowerCase()}`;
      if (habitSeen.has(dedupeKey)) {
        return false;
      }
      habitSeen.add(dedupeKey);
      return true;
    });

  const merged = {
    categories: fallbackCategories,
    habits,
    logs: data?.logs && typeof data.logs === "object" ? data.logs : base.logs,
    activity: Array.isArray(data?.activity) ? data.activity : base.activity,
    goals: {
      monthly: data?.goals?.monthly && typeof data.goals.monthly === "object" ? data.goals.monthly : base.goals.monthly,
      yearly: data?.goals?.yearly && typeof data.goals.yearly === "object" ? data.goals.yearly : base.goals.yearly
    },
    settings: {
      theme: data?.settings?.theme === "dark" ? "dark" : "light"
    }
  };

  return merged;
}

export async function loadAppData(defaultsUrl) {
  const defaultResponse = await fetch(defaultsUrl);
  const defaults = await defaultResponse.json();

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const fresh = clone(defaults);
    saveAppData(fresh);
    return fresh;
  }

  try {
    const parsed = JSON.parse(raw);
    const normalized = normalizeData(parsed, defaults);
    saveAppData(normalized);
    return normalized;
  } catch {
    const fallback = clone(defaults);
    saveAppData(fallback);
    return fallback;
  }
}

export function saveAppData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function exportAppData(data) {
  return JSON.stringify(data, null, 2);
}

export function buildLogEntry(habit, date, status, goalType = "daily") {
  return {
    habitId: habit.id,
    habitName: habit.name,
    category: habit.category,
    date,
    status,
    goalType
  };
}
