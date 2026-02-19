function getLocalDateParts(date = new Date()) {
  return {
    year: date.getFullYear(),
    month: date.getMonth(),
    day: date.getDate()
  };
}

export function getTodayKey() {
  const { year, month, day } = getLocalDateParts();
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function setHabitStatus(state, habitId, status, dateKey = getTodayKey()) {
  if (!state.logs[dateKey]) {
    state.logs[dateKey] = {};
  }

  if (status === "reset") {
    delete state.logs[dateKey][habitId];
    if (Object.keys(state.logs[dateKey]).length === 0) {
      delete state.logs[dateKey];
    }
    return;
  }

  state.logs[dateKey][habitId] = status;
}

export function getHabitStatus(state, habitId, dateKey = getTodayKey()) {
  return state.logs[dateKey]?.[habitId] ?? "pending";
}

export function getTodayProgress(state) {
  const todayKey = getTodayKey();
  const total = state.habits.length;
  const todayLog = state.logs[todayKey] || {};
  const done = Object.values(todayLog).filter((status) => status === "done").length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  return { total, done, percent };
}

function dateKeyFromDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function daysInCurrentMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
}

export function getMonthlyProgress(state) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const elapsedDays = now.getDate();
  const totalHabits = state.habits.length;

  // Sum all "done" marks from day 1 of the current month to today.
  let completed = 0;
  for (let day = 1; day <= elapsedDays; day += 1) {
    const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const log = state.logs[key] || {};
    completed += Object.values(log).filter((status) => status === "done").length;
  }

  const possible = totalHabits * elapsedDays;
  const percent = possible === 0 ? 0 : Math.round((completed / possible) * 100);

  return {
    completed,
    percent,
    elapsedDays,
    totalDaysInMonth: daysInCurrentMonth()
  };
}

export function getYearlyProgress(state) {
  const now = new Date();
  const year = now.getFullYear();
  const start = new Date(year, 0, 1);
  const today = new Date(year, now.getMonth(), now.getDate());
  const dayCount = Math.floor((today.getTime() - start.getTime()) / 86400000) + 1;
  const totalHabits = state.habits.length;

  // Calculate done marks from Jan 1 to today for overall consistency.
  let completed = 0;
  for (let i = 0; i < dayCount; i += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const key = dateKeyFromDate(date);
    const log = state.logs[key] || {};
    completed += Object.values(log).filter((status) => status === "done").length;
  }

  const possible = dayCount * totalHabits;
  const percent = possible === 0 ? 0 : Math.round((completed / possible) * 100);

  return { completed, percent, dayCount };
}

export function getHabitStreak(state, habitId) {
  let streak = 0;
  const cursor = new Date();

  // Walk backward day-by-day until a non-done status is found.
  while (true) {
    const key = dateKeyFromDate(cursor);
    if (state.logs[key]?.[habitId] === "done") {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

export function getGoalProgress(state) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const results = [];

  const countDoneForHabit = (habitId, scope) => {
    let count = 0;
    for (const [dateKey, dayLog] of Object.entries(state.logs)) {
      const status = dayLog[habitId];
      if (status !== "done") {
        continue;
      }

      const [y, m] = dateKey.split("-").map(Number);
      if (scope === "monthly" && y === currentYear && m - 1 === currentMonth) {
        count += 1;
      }
      if (scope === "yearly" && y === currentYear) {
        count += 1;
      }
    }
    return count;
  };

  for (const [habitId, target] of Object.entries(state.goals.monthly)) {
    const habit = state.habits.find((item) => item.id === habitId);
    if (!habit) {
      continue;
    }
    const achieved = countDoneForHabit(habitId, "monthly");
    results.push({
      type: "monthly",
      habitName: habit.name,
      target,
      achieved,
      percent: target === 0 ? 0 : Math.min(100, Math.round((achieved / target) * 100))
    });
  }

  for (const [habitId, target] of Object.entries(state.goals.yearly)) {
    const habit = state.habits.find((item) => item.id === habitId);
    if (!habit) {
      continue;
    }
    const achieved = countDoneForHabit(habitId, "yearly");
    results.push({
      type: "yearly",
      habitName: habit.name,
      target,
      achieved,
      percent: target === 0 ? 0 : Math.min(100, Math.round((achieved / target) * 100))
    });
  }

  return results;
}

export function getMonthlyCalendarData(state) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const totalHabits = state.habits.length;
  const totalDays = new Date(year, month + 1, 0).getDate();
  const firstWeekday = new Date(year, month, 1).getDay();
  const days = [];

  for (let day = 1; day <= totalDays; day += 1) {
    const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const log = state.logs[key] || {};
    const done = Object.values(log).filter((status) => status === "done").length;
    const ratio = totalHabits === 0 ? 0 : done / totalHabits;
    days.push({
      day,
      key,
      done,
      total: totalHabits,
      ratio
    });
  }

  return {
    year,
    month,
    totalDays,
    firstWeekday,
    days
  };
}
