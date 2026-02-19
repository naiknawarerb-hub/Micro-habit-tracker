import { loadAppData, saveAppData, exportAppData, buildLogEntry, normalizeData } from "./storage.js";
import { setHabitStatus, getTodayKey } from "./tracker.js";
import { bindStaticEvents, renderAll } from "./ui.js";

let state;
let defaults;
let isInitialized = false;
const THEME_KEY = "habitTrackerTheme";
let feedbackTimer;

function showFeedback(message, type = "success") {
  const feedback = document.getElementById("appFeedback");
  if (!feedback) {
    return;
  }

  feedback.textContent = message;
  feedback.className = `app-feedback ${type}`;

  if (feedbackTimer) {
    clearTimeout(feedbackTimer);
  }
  feedbackTimer = setTimeout(() => {
    feedback.textContent = "";
    feedback.className = "app-feedback";
  }, 2400);
}

function persistAndRender() {
  localStorage.setItem(THEME_KEY, state.settings.theme);
  saveAppData(state);
  renderAll(state, handlers);
}

function addActivityEntry(habitId, status) {
  const habit = state.habits.find((item) => item.id === habitId);
  if (!habit) {
    return;
  }

  const date = getTodayKey();
  state.activity = (state.activity || []).filter((entry) => !((entry.habitId === habit.id || entry.habitName === habit.name) && entry.date === date));

  if (status !== "reset") {
    state.activity.push(buildLogEntry(habit, date, status, "daily"));
  }
}

function removeHabitById(habitId) {
  const habit = state.habits.find((item) => item.id === habitId);
  if (!habit) {
    return;
  }

  state.habits = state.habits.filter((item) => item.id !== habitId);

  Object.keys(state.logs).forEach((dateKey) => {
    delete state.logs[dateKey][habitId];
    if (Object.keys(state.logs[dateKey]).length === 0) {
      delete state.logs[dateKey];
    }
  });

  delete state.goals.monthly[habitId];
  delete state.goals.yearly[habitId];

  state.activity = (state.activity || []).filter((entry) => entry.habitId !== habitId && entry.habitName !== habit.name);
}

function editHabit(habit) {
  const newName = prompt("Edit habit name:", habit.name);
  if (newName === null) {
    return;
  }

  const name = newName.trim();
  if (!name) {
    alert("Habit name cannot be empty.");
    return;
  }

  const categoryInput = prompt(`Edit category (must exist):\n${state.categories.join(", ")}`, habit.category);
  if (categoryInput === null) {
    return;
  }

  const category = categoryInput.trim();
  if (!state.categories.includes(category)) {
    alert("Category must match an existing category.");
    return;
  }

  const frequencyInput = prompt("Frequency: daily or weekly", habit.frequency);
  if (frequencyInput === null) {
    return;
  }

  const frequency = frequencyInput.trim().toLowerCase();
  if (frequency !== "daily" && frequency !== "weekly") {
    alert("Frequency must be daily or weekly.");
    return;
  }

  const oldName = habit.name;
  habit.name = name;
  habit.category = category;
  habit.frequency = frequency;

  state.activity = (state.activity || []).map((entry) => {
    if (entry.habitId === habit.id || entry.habitName === oldName) {
      return {
        ...entry,
        habitId: habit.id,
        habitName: habit.name,
        category: habit.category
      };
    }
    return entry;
  });

  persistAndRender();
}

async function importStateFromFile(file) {
  const rawText = await file.text();
  const parsed = JSON.parse(rawText);
  state = normalizeData(parsed, defaults);
  persistAndRender();
}

const handlers = {
  onCategorySubmit(event) {
    event.preventDefault();
    const input = document.getElementById("categoryName");
    if (!input) {
      return;
    }
    const name = input.value.trim().replace(/\s+/g, " ");

    if (!name) {
      alert("Category name is required.");
      input.focus();
      return;
    }

    if (name.length < 2) {
      alert("Category name should be at least 2 characters.");
      input.focus();
      return;
    }

    const exists = state.categories.some((category) => String(category).toLowerCase() === name.toLowerCase());
    if (exists) {
      alert("Category already exists.");
      input.focus();
      return;
    }

    state.categories.push(name);
    input.value = "";
    persistAndRender();
    const categorySelect = document.getElementById("habitCategory");
    if (categorySelect) {
      categorySelect.value = name;
    }
    input.focus();
  },

  onDeleteCategory(category) {
    const relatedHabits = state.habits.filter((habit) => habit.category === category);
    if (relatedHabits.length > 0) {
      const ok = confirm(`Delete category \"${category}\" and ${relatedHabits.length} related habit(s)?`);
      if (!ok) {
        return;
      }

      relatedHabits.forEach((habit) => removeHabitById(habit.id));
    }

    state.categories = state.categories.filter((item) => item !== category);
    persistAndRender();
  },

  onHabitSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const habitNameInput = document.getElementById("habitName");
    const habitCategoryInput = document.getElementById("habitCategory");
    const habitFrequencyInput = document.getElementById("habitFrequency");
    if (!habitNameInput || !habitCategoryInput || !habitFrequencyInput) {
      return;
    }

    const habitName = habitNameInput.value.trim().replace(/\s+/g, " ");
    const habitCategory = habitCategoryInput.value;
    const habitFrequency = habitFrequencyInput.value === "weekly" ? "weekly" : "daily";

    if (!habitName) {
      showFeedback("Habit name is required.", "error");
      habitNameInput.focus();
      return;
    }

    if (!state.categories.length) {
      showFeedback("Add at least one category first.", "error");
      return;
    }

    if (!state.categories.includes(habitCategory)) {
      showFeedback("Please select a valid category.", "error");
      return;
    }

    const duplicateExists = state.habits.some(
      (habit) =>
        habit.category.toLowerCase() === habitCategory.toLowerCase() &&
        habit.name.trim().toLowerCase() === habitName.toLowerCase()
    );
    if (duplicateExists) {
      showFeedback("This habit already exists in the selected category.", "error");
      habitNameInput.focus();
      return;
    }

    state.habits.push({
      id: `habit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      name: habitName,
      category: habitCategory,
      frequency: habitFrequency,
      createdAt: new Date().toISOString()
    });

    form.reset();
    persistAndRender();
    const categorySelect = document.getElementById("habitCategory");
    if (categorySelect && state.categories.includes(habitCategory)) {
      categorySelect.value = habitCategory;
    }
    showFeedback(`Habit "${habitName}" added successfully.`, "success");
    habitNameInput.focus();
  },

  onHabitAction(habit, action) {
    if (action === "edit") {
      editHabit(habit);
      return;
    }

    if (action === "delete") {
      const ok = confirm(`Delete habit \"${habit.name}\"?`);
      if (!ok) {
        return;
      }
      removeHabitById(habit.id);
      persistAndRender();
      return;
    }

    setHabitStatus(state, habit.id, action);
    addActivityEntry(habit.id, action);
    persistAndRender();
  },

  onGoalSubmit(event) {
    event.preventDefault();
    const habitId = document.getElementById("goalHabit").value;
    const goalType = document.getElementById("goalType").value;
    const goalTarget = Number(document.getElementById("goalTarget").value);

    if (!habitId || !Number.isFinite(goalTarget) || goalTarget <= 0) {
      return;
    }
    if (!state.habits.some((habit) => habit.id === habitId)) {
      showFeedback("Select a valid habit before setting a goal.", "error");
      return;
    }

    state.goals[goalType][habitId] = goalTarget;
    event.target.reset();
    persistAndRender();
    showFeedback("Goal saved successfully.", "success");
  },

  onToggleTheme() {
    state.settings.theme = state.settings.theme === "light" ? "dark" : "light";
    persistAndRender();
  },

  onExportData() {
    const json = exportAppData(state);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `habit-tracker-export-${getTodayKey()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },

  onImportClick() {
    const importInput = document.getElementById("importFileInput");
    if (importInput) {
      importInput.click();
    }
  },

  async onImportFileSelected(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    try {
      await importStateFromFile(file);
      showFeedback("Data imported successfully.", "success");
    } catch {
      showFeedback("Invalid JSON file. Import failed.", "error");
    }
  }
};

async function init() {
  if (isInitialized) {
    return;
  }
  isInitialized = true;
  const defaultsResponse = await fetch("./data/defaultHabits.json");
  defaults = await defaultsResponse.json();
  state = await loadAppData("./data/defaultHabits.json");
  const storedTheme = localStorage.getItem(THEME_KEY);
  if (storedTheme === "dark" || storedTheme === "light") {
    state.settings.theme = storedTheme;
  }
  bindStaticEvents(handlers);
  renderAll(state, handlers);
  showFeedback("Habits loaded successfully.", "success");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    init().catch(() => alert("Failed to initialize the app."));
  });
} else {
  init().catch(() => alert("Failed to initialize the app."));
}
