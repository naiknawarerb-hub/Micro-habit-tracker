import {
  getTodayProgress,
  getMonthlyProgress,
  getYearlyProgress,
  getHabitStatus,
  getHabitStreak,
  getGoalProgress,
  getMonthlyCalendarData
} from "./tracker.js";

function setProgressBar(element, percent) {
  element.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function optionMarkup(value, text) {
  return `<option value="${value}">${text}</option>`;
}

function getHeatLevel(ratio) {
  if (ratio === 0) {
    return 0;
  }
  if (ratio < 0.34) {
    return 1;
  }
  if (ratio < 0.67) {
    return 2;
  }
  return 3;
}

export function syncTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.body.setAttribute("data-theme", theme);
  const toggleBtn = document.getElementById("darkModeToggle");
  if (toggleBtn) {
    toggleBtn.textContent = theme === "dark" ? "Switch To Light Mode" : "Switch To Dark Mode";
  }
}

export function renderCategoryList(state, onDeleteCategory) {
  const categoryList = document.getElementById("categoryList");
  if (!categoryList) {
    return;
  }
  categoryList.innerHTML = "";

  state.categories.forEach((category) => {
    const li = document.createElement("li");
    li.className = "category-item";

    const name = document.createElement("span");
    name.textContent = category;

    const button = document.createElement("button");
    button.className = "btn btn-danger";
    button.type = "button";
    button.textContent = "Delete";
    button.addEventListener("click", () => onDeleteCategory(category));

    li.append(name, button);
    categoryList.appendChild(li);
  });
}

export function renderCategoryOptions(state) {
  const categorySelect = document.getElementById("habitCategory");
  const saveHabitBtn = document.getElementById("saveHabitBtn");
  if (!categorySelect) {
    return;
  }
  const previous = categorySelect.value;

  if (!state.categories.length) {
    categorySelect.innerHTML = "<option value=\"\">No categories available</option>";
    categorySelect.disabled = true;
    if (saveHabitBtn) {
      saveHabitBtn.disabled = true;
    }
    return;
  }

  categorySelect.innerHTML = state.categories.map((item) => optionMarkup(item, item)).join("");
  categorySelect.disabled = false;
  if (saveHabitBtn) {
    saveHabitBtn.disabled = false;
  }

  if (state.categories.includes(previous)) {
    categorySelect.value = previous;
  } else {
    categorySelect.value = state.categories[0];
  }
}

export function renderGoalHabitOptions(state) {
  const goalHabitSelect = document.getElementById("goalHabit");
  const setGoalBtn = document.getElementById("setGoalBtn");
  if (!goalHabitSelect) {
    return;
  }

  const previous = goalHabitSelect.value;
  if (!state.habits.length) {
    goalHabitSelect.innerHTML = "<option value=\"\">No habits available</option>";
    goalHabitSelect.disabled = true;
    if (setGoalBtn) {
      setGoalBtn.disabled = true;
    }
    return;
  }

  goalHabitSelect.innerHTML = state.habits.map((habit) => optionMarkup(habit.id, `${habit.name} (${habit.category})`)).join("");
  goalHabitSelect.disabled = false;
  if (setGoalBtn) {
    setGoalBtn.disabled = false;
  }

  if (state.habits.some((habit) => habit.id === previous)) {
    goalHabitSelect.value = previous;
  } else {
    goalHabitSelect.value = state.habits[0].id;
  }
}

export function renderHabits(state, onHabitAction) {
  const habitList = document.getElementById("habitList");
  if (!habitList) {
    return;
  }
  habitList.innerHTML = "";

  if (state.habits.length === 0) {
    habitList.innerHTML = "<p>No habits yet. Add one from the panel above.</p>";
    return;
  }

  const template = document.getElementById("habitCardTemplate");

  state.categories.forEach((category) => {
    const habits = state.habits.filter((habit) => habit.category === category);
    if (habits.length === 0) {
      return;
    }

    const group = document.createElement("section");
    group.className = "habit-group";

    const title = document.createElement("h3");
    title.textContent = category;
    group.appendChild(title);

    habits.forEach((habit) => {
      const fragment = template.content.cloneNode(true);
      const card = fragment.querySelector(".habit-card");
      const status = getHabitStatus(state, habit.id);
      const streak = getHabitStreak(state, habit.id);

      card.querySelector(".habit-name").textContent = habit.name;
      card.querySelector(".habit-meta").textContent = `Frequency: ${habit.frequency}`;
      card.querySelector(".habit-status").textContent = `Today: ${status}`;
      card.querySelector(".habit-streak").textContent = `Streak: ${streak} day(s)`;
      if (status === "done" || status === "skip") {
        card.classList.add(status);
      }

      card.querySelectorAll("button[data-action]").forEach((btn) => {
        btn.addEventListener("click", () => onHabitAction(habit, btn.dataset.action));
      });

      group.appendChild(fragment);
    });

    habitList.appendChild(group);
  });
}

export function renderDashboard(state) {
  const daily = getTodayProgress(state);
  const monthly = getMonthlyProgress(state);
  const yearly = getYearlyProgress(state);

  const dailyProgressText = document.getElementById("dailyProgressText");
  const dailyProgressBar = document.getElementById("dailyProgressBar");
  const monthlyProgressText = document.getElementById("monthlyProgressText");
  const monthlyProgressBar = document.getElementById("monthlyProgressBar");
  const yearlyProgressText = document.getElementById("yearlyProgressText");
  const yearlyProgressBar = document.getElementById("yearlyProgressBar");
  const totalCompletedText = document.getElementById("totalCompletedText");
  const monthlySummaryText = document.getElementById("monthlySummaryText");

  if (dailyProgressText) {
    dailyProgressText.textContent = `${daily.done}/${daily.total} completed (${daily.percent}%)`;
  }
  if (dailyProgressBar) {
    setProgressBar(dailyProgressBar, daily.percent);
  }

  if (monthlyProgressText) {
    monthlyProgressText.textContent = `${monthly.percent}% (${monthly.completed} completions)`;
  }
  if (monthlyProgressBar) {
    setProgressBar(monthlyProgressBar, monthly.percent);
  }

  if (yearlyProgressText) {
    yearlyProgressText.textContent = `${yearly.percent}% consistency`;
  }
  if (yearlyProgressBar) {
    setProgressBar(yearlyProgressBar, yearly.percent);
  }
  if (totalCompletedText) {
    totalCompletedText.textContent = `Total completed this year: ${yearly.completed}`;
  }
  if (monthlySummaryText) {
    monthlySummaryText.textContent = `This month summary: ${monthly.completed} done over ${monthly.elapsedDays}/${monthly.totalDaysInMonth} days`;
  }
}

export function renderGoals(state) {
  const container = document.getElementById("goalProgress");
  if (!container) {
    return;
  }
  const goals = getGoalProgress(state);
  container.innerHTML = "";

  if (goals.length === 0) {
    container.innerHTML = "<p>No goals set yet.</p>";
    return;
  }

  goals.forEach((goal) => {
    const wrap = document.createElement("article");
    wrap.className = "goal-item";

    const title = document.createElement("p");
    title.textContent = `${goal.type.toUpperCase()} goal - ${goal.habitName}`;

    const detail = document.createElement("p");
    detail.textContent = `Achieved ${goal.achieved} / ${goal.target} (${goal.percent}%)`;

    const progress = document.createElement("div");
    progress.className = "progress-bar";
    const inner = document.createElement("span");
    inner.style.width = `${goal.percent}%`;
    progress.appendChild(inner);

    wrap.append(title, detail, progress);
    container.appendChild(wrap);
  });
}

export function renderMonthlyHeatmap(state) {
  const legend = document.getElementById("calendarLegend");
  const container = document.getElementById("monthlyHeatmap");
  if (!legend || !container) {
    return;
  }
  const calendar = getMonthlyCalendarData(state);
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  legend.innerHTML = [
    "<span>Less</span>",
    "<span class=\"legend-dot level-0\"></span>",
    "<span class=\"legend-dot level-1\"></span>",
    "<span class=\"legend-dot level-2\"></span>",
    "<span class=\"legend-dot level-3\"></span>",
    "<span>More</span>"
  ].join("");

  container.innerHTML = "";

  labels.forEach((label) => {
    const cell = document.createElement("div");
    cell.className = "calendar-label";
    cell.textContent = label;
    container.appendChild(cell);
  });

  for (let i = 0; i < calendar.firstWeekday; i += 1) {
    const empty = document.createElement("div");
    empty.className = "calendar-cell empty";
    container.appendChild(empty);
  }

  calendar.days.forEach((day) => {
    const cell = document.createElement("div");
    const level = getHeatLevel(day.ratio);
    cell.className = `calendar-cell level-${level}`;
    cell.textContent = String(day.day);
    cell.title = `${day.key}: ${day.done}/${day.total} done`;
    container.appendChild(cell);
  });
}

export function bindStaticEvents(handlers) {
  const categoryForm = document.getElementById("categoryForm");
  const habitForm = document.getElementById("habitForm");
  const goalForm = document.getElementById("goalForm");
  const darkModeToggle = document.getElementById("darkModeToggle");
  const exportBtn = document.getElementById("exportDataBtn");
  const importBtn = document.getElementById("importDataBtn");
  const importInput = document.getElementById("importFileInput");

  if (categoryForm) {
    categoryForm.addEventListener("submit", handlers.onCategorySubmit);
  }
  if (habitForm) {
    habitForm.addEventListener("submit", handlers.onHabitSubmit);
  }
  if (goalForm) {
    goalForm.addEventListener("submit", handlers.onGoalSubmit);
  }
  if (darkModeToggle) {
    darkModeToggle.addEventListener("click", handlers.onToggleTheme);
  }
  if (exportBtn) {
    exportBtn.addEventListener("click", handlers.onExportData);
  }
  if (importBtn) {
    importBtn.addEventListener("click", handlers.onImportClick);
  }
  if (importInput) {
    importInput.addEventListener("change", handlers.onImportFileSelected);
  }
}

export function renderAll(state, handlers) {
  syncTheme(state.settings.theme);
  renderCategoryList(state, handlers.onDeleteCategory);
  renderCategoryOptions(state);
  renderGoalHabitOptions(state);
  renderHabits(state, handlers.onHabitAction);
  renderDashboard(state);
  renderGoals(state);
  renderMonthlyHeatmap(state);
}
