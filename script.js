/*
  Habit Tracker App
  - Auto day tracking
  - Editable date summary
  - Smart yearly goal breakdown
  - Consistent percentage formulas
  - Reminder notifications (in-app + service worker support)
*/

(function () {
  "use strict";

  const STORAGE_KEY = "habitTrackerAppV5";
  const LEGACY_KEYS = ["habitTrackerAppV4", "habitTrackerAppV3"];
  const REMINDER_CHECK_INTERVAL_MS = 30000;

  const defaultState = {
    categories: ["Walking", "Meditation", "Study"],
    habits: [],
    logs: {},
    goals: { monthly: {}, yearly: {} },
    derivedGoals: {},
    reminderMeta: { sentMap: {} }
  };

  const state = loadState();
  const els = getElements();
  let activeDateKey = todayKey();
  let dayWatcherId = null;
  let openEditDateKey = null;
  let reminderWatcherId = null;
  let swRegistration = null;
  let deferredInstallPrompt = null;

  ensureManifestLink();
  bindEvents();
  setupInstallPrompt();
  initializeDate();
  setupDailyAutoTrigger();
  setupNotificationFeatures();
  renderAll();
  startReminderWatcher();

  function getElements() {
    return {
      feedback: document.getElementById("feedback"),
      installAppBtn: document.getElementById("installAppBtn"),
      installHint: document.getElementById("installHint"),
      notifyPermissionBtn: document.getElementById("notifyPermissionBtn"),
      notifyStatus: document.getElementById("notifyStatus"),

      categoryForm: document.getElementById("categoryForm"),
      categoryName: document.getElementById("categoryName"),
      categoryList: document.getElementById("categoryList"),

      habitForm: document.getElementById("habitForm"),
      habitName: document.getElementById("habitName"),
      habitCategory: document.getElementById("habitCategory"),
      habitFrequency: document.getElementById("habitFrequency"),
      saveHabitBtn: document.getElementById("saveHabitBtn"),

      goalForm: document.getElementById("goalForm"),
      goalHabit: document.getElementById("goalHabit"),
      goalType: document.getElementById("goalType"),
      goalTarget: document.getElementById("goalTarget"),
      saveGoalBtn: document.getElementById("saveGoalBtn"),
      goalsView: document.getElementById("goalsView"),

      currentDateLabel: document.getElementById("currentDateLabel"),
      habitList: document.getElementById("habitList"),
      dateSummary: document.getElementById("dateSummary"),

      dailyText: document.getElementById("dailyText"),
      monthlyText: document.getElementById("monthlyText"),
      yearlyText: document.getElementById("yearlyText"),
      dailyBar: document.getElementById("dailyBar"),
      monthlyBar: document.getElementById("monthlyBar"),
      yearlyBar: document.getElementById("yearlyBar"),
      goalInsights: document.getElementById("goalInsights"),

      exportBtn: document.getElementById("exportBtn"),
      importBtn: document.getElementById("importBtn"),
      importInput: document.getElementById("importInput")
    };
  }

  function bindEvents() {
    if (els.categoryForm) {
      els.categoryForm.addEventListener("submit", onCategorySubmit);
    }
    if (els.habitForm) {
      els.habitForm.addEventListener("submit", onHabitSubmit);
    }
    if (els.goalForm) {
      els.goalForm.addEventListener("submit", onGoalSubmit);
    }
    if (els.exportBtn) {
      els.exportBtn.addEventListener("click", onExport);
    }
    if (els.importBtn) {
      els.importBtn.addEventListener("click", function () {
        if (els.importInput) {
          els.importInput.click();
        }
      });
    }
    if (els.importInput) {
      els.importInput.addEventListener("change", onImport);
    }
    if (els.notifyPermissionBtn) {
      els.notifyPermissionBtn.addEventListener("click", onRequestNotificationPermission);
    }
    if (els.installAppBtn) {
      els.installAppBtn.addEventListener("click", onInstallAppClick);
    }

    window.addEventListener("beforeunload", function () {
      if (dayWatcherId) {
        window.clearInterval(dayWatcherId);
      }
      if (reminderWatcherId) {
        window.clearInterval(reminderWatcherId);
      }
    });
  }

  function initializeDate() {
    activeDateKey = todayKey();
    ensureDayLog(activeDateKey);
    updateCurrentDateLabel();
  }

  function setupDailyAutoTrigger() {
    if (dayWatcherId) {
      window.clearInterval(dayWatcherId);
    }

    dayWatcherId = window.setInterval(function () {
      const nowKey = todayKey();
      if (nowKey !== activeDateKey) {
        activeDateKey = nowKey;
        ensureDayLog(activeDateKey);
        updateCurrentDateLabel();
        openEditDateKey = null;
        renderAll();
        showFeedback("New day started. Fresh tracking ready.", "success");
      }
    }, 60000);
  }

  function ensureManifestLink() {
    const isHttp = window.location.protocol === "http:" || window.location.protocol === "https:";
    if (!isHttp) {
      return;
    }

    if (document.querySelector("link[rel='manifest']")) {
      return;
    }

    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = "manifest.json";
    document.head.appendChild(link);
  }

  async function setupNotificationFeatures() {
    updateNotificationStatus();

    if (window.location.protocol === "file:") {
      showFeedback("Service worker needs a local server (http://localhost).", "error");
      return;
    }

    if (!("serviceWorker" in navigator)) {
      return;
    }

    try {
      swRegistration = await navigator.serviceWorker.register("service-worker.js", { scope: "./" });
      await navigator.serviceWorker.ready;
      navigator.serviceWorker.addEventListener("controllerchange", function () {
        syncRemindersToServiceWorker();
      });
      syncRemindersToServiceWorker();
      registerBackgroundReminderTask();
    } catch (error) {
      console.error(error);
    }
  }

  function setupInstallPrompt() {
    const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent || "");
    const standalone = window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;
    const iosStandalone = window.navigator.standalone === true;
    const isInstalled = Boolean(standalone || iosStandalone);

    if (els.installAppBtn) {
      els.installAppBtn.hidden = true;
    }
    if (els.installHint) {
      els.installHint.hidden = true;
      els.installHint.textContent = "";
    }

    window.addEventListener("beforeinstallprompt", function (event) {
      event.preventDefault();
      deferredInstallPrompt = event;
      if (els.installAppBtn && !isInstalled) {
        els.installAppBtn.hidden = false;
      }
    });

    window.addEventListener("appinstalled", function () {
      deferredInstallPrompt = null;
      if (els.installAppBtn) {
        els.installAppBtn.hidden = true;
      }
      if (els.installHint) {
        els.installHint.hidden = true;
      }
      showFeedback("App installed successfully.", "success");
    });

    if (isIos && !isInstalled && els.installHint) {
      els.installHint.hidden = false;
      els.installHint.textContent = "iPhone: Open in Safari, tap Share, then Add to Home Screen.";
    }
  }

  async function onInstallAppClick() {
    if (!deferredInstallPrompt) {
      if (els.installHint && !els.installHint.hidden) {
        showFeedback("Use Safari Share menu to install on iPhone.", "success");
      } else {
        showFeedback("Install prompt unavailable right now.", "error");
      }
      return;
    }

    try {
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      if (choice && choice.outcome === "accepted") {
        showFeedback("Install accepted.", "success");
      } else {
        showFeedback("Install dismissed.", "error");
      }
    } catch (error) {
      console.error(error);
      showFeedback("Unable to show install prompt.", "error");
    } finally {
      deferredInstallPrompt = null;
      if (els.installAppBtn) {
        els.installAppBtn.hidden = true;
      }
    }
  }

  async function registerBackgroundReminderTask() {
    if (!swRegistration) {
      return;
    }

    try {
      if ("sync" in swRegistration) {
        await swRegistration.sync.register("habit-reminder-check");
      }

      if ("periodicSync" in swRegistration) {
        const status = await navigator.permissions.query({ name: "periodic-background-sync" });
        if (status.state === "granted") {
          await swRegistration.periodicSync.register("habit-reminder-periodic", {
            minInterval: 6 * 60 * 60 * 1000
          });
        }
      }
    } catch (error) {
      console.error(error);
    }
  }

  function startReminderWatcher() {
    if (reminderWatcherId) {
      window.clearInterval(reminderWatcherId);
    }

    reminderWatcherId = window.setInterval(function () {
      checkDueReminders();
    }, REMINDER_CHECK_INTERVAL_MS);

    checkDueReminders();
  }

  function updateCurrentDateLabel() {
    if (els.currentDateLabel) {
      els.currentDateLabel.textContent = activeDateKey;
    }
  }

  function ratioPercent(numerator, denominator) {
    if (!denominator || denominator <= 0) {
      return 0;
    }
    return roundTo((numerator / denominator) * 100, 1);
  }

  function roundTo(value, decimals) {
    const base = Math.pow(10, decimals || 0);
    return Math.round((Number(value) + Number.EPSILON) * base) / base;
  }

  function formatPercent(value) {
    const safe = Number.isFinite(value) ? value : 0;
    const rounded = roundTo(safe, 1);
    return (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)) + "%";
  }

  function clampPercent(value) {
    const safe = Number.isFinite(value) ? value : 0;
    return Math.max(0, Math.min(100, safe));
  }

  function onCategorySubmit(event) {
    event.preventDefault();

    const name = normalizeText(els.categoryName.value);
    if (!name) {
      showFeedback("Category name is required.", "error");
      return;
    }

    const exists = state.categories.some(function (category) {
      return category.toLowerCase() === name.toLowerCase();
    });

    if (exists) {
      showFeedback("Category already exists.", "error");
      return;
    }

    state.categories.push(name);
    persistState();
    renderAll();

    els.categoryName.value = "";
    els.habitCategory.value = name;
    showFeedback("Category added.", "success");
  }

  function onHabitSubmit(event) {
    event.preventDefault();

    const name = normalizeText(els.habitName.value);
    const category = String(els.habitCategory.value || "");
    const frequency = els.habitFrequency.value === "weekly" ? "weekly" : "daily";

    if (!name) {
      showFeedback("Habit name is required.", "error");
      return;
    }

    if (!category || !state.categories.includes(category)) {
      showFeedback("Please select a valid category.", "error");
      return;
    }

    const duplicate = state.habits.some(function (habit) {
      return habit.category.toLowerCase() === category.toLowerCase() && habit.name.toLowerCase() === name.toLowerCase();
    });

    if (duplicate) {
      showFeedback("Habit already exists in selected category.", "error");
      return;
    }

    const createdAt = new Date().toISOString();
    state.habits.push({
      id: generateId(),
      name: name,
      category: category,
      frequency: frequency,
      createdAt: createdAt,
      reminder: buildDefaultReminder(frequency, createdAt)
    });

    persistState();
    renderAll();
    syncRemindersToServiceWorker();

    els.habitForm.reset();
    els.habitCategory.value = category;
    showFeedback("Habit added successfully.", "success");
  }

  function onGoalSubmit(event) {
    event.preventDefault();

    const habitId = String(els.goalHabit.value || "");
    const goalType = els.goalType.value === "yearly" ? "yearly" : "monthly";
    const target = Number(els.goalTarget.value);

    if (!state.habits.some(function (habit) { return habit.id === habitId; })) {
      showFeedback("Please select a valid habit.", "error");
      return;
    }

    if (!Number.isFinite(target) || target <= 0) {
      showFeedback("Goal target must be greater than 0.", "error");
      return;
    }

    state.goals[goalType][habitId] = target;

    if (goalType === "yearly") {
      const derived = buildDerivedFromYearly(target);
      state.derivedGoals[habitId] = {
        fromYearly: target,
        monthlyTarget: derived.monthlyTarget,
        dailyRaw: derived.dailyRaw,
        dailySuggested: derived.dailySuggested,
        manualMonthlyOverride: state.derivedGoals[habitId]?.manualMonthlyOverride || null
      };
    }

    if (goalType === "monthly" && !state.derivedGoals[habitId]) {
      state.derivedGoals[habitId] = {
        fromYearly: null,
        monthlyTarget: target,
        dailyRaw: target / 30,
        dailySuggested: Math.max(1, Math.round(target / 30)),
        manualMonthlyOverride: null
      };
    }

    persistState();
    renderAll();

    els.goalForm.reset();
    showFeedback("Goal saved with smart schedule.", "success");
  }

  async function onRequestNotificationPermission() {
    if (!("Notification" in window)) {
      showFeedback("This browser does not support notifications.", "error");
      return;
    }

    if (window.location.protocol === "file:") {
      showFeedback("Use a local server to enable reminders reliably.", "error");
      return;
    }

    try {
      const result = await Notification.requestPermission();
      updateNotificationStatus();
      if (result === "granted") {
        syncRemindersToServiceWorker();
        showFeedback("Notifications enabled.", "success");
      } else if (result === "denied") {
        showFeedback("Notifications denied. Enable from browser settings.", "error");
      } else {
        showFeedback("Notifications not enabled.", "error");
      }
    } catch (error) {
      console.error(error);
      showFeedback("Failed to request notification permission.", "error");
    }
  }

  function updateNotificationStatus() {
    if (!els.notifyStatus) {
      return;
    }

    if (!("Notification" in window)) {
      els.notifyStatus.textContent = "Notifications: Not supported in this browser";
      return;
    }
    if (window.location.protocol === "file:") {
      els.notifyStatus.textContent = "Notifications: Use local server for reminders";
      return;
    }

    const permission = Notification.permission;
    if (permission === "granted") {
      els.notifyStatus.textContent = "Notifications: Enabled";
    } else if (permission === "denied") {
      els.notifyStatus.textContent = "Notifications: Denied";
    } else {
      els.notifyStatus.textContent = "Notifications: Not enabled";
    }
  }

  function onExport() {
    try {
      const json = JSON.stringify(state, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");

      anchor.href = url;
      anchor.download = "ramans-micro-habit-tracker-export-" + todayKey() + ".json";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      showFeedback("Export completed.", "success");
    } catch (error) {
      console.error(error);
      showFeedback("Export failed.", "error");
    }
  }

  async function onImport(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const normalized = normalizeState(parsed);

      state.categories = normalized.categories;
      state.habits = normalized.habits;
      state.logs = normalized.logs;
      state.goals = normalized.goals;
      state.derivedGoals = normalized.derivedGoals;
      state.reminderMeta = normalized.reminderMeta;

      activeDateKey = todayKey();
      ensureDayLog(activeDateKey);
      updateCurrentDateLabel();
      openEditDateKey = null;

      persistState();
      renderAll();
      syncRemindersToServiceWorker();
      showFeedback("Import completed.", "success");
    } catch (error) {
      console.error(error);
      showFeedback("Invalid JSON file.", "error");
    }
  }

  function renderAll() {
    renderCategoryList();
    renderCategoryDropdown();
    renderGoalDropdown();
    renderHabitList();
    renderGoals();
    renderDateSummary();
    renderDashboard();
    renderGoalInsights();
    updateNotificationStatus();
  }

  function renderCategoryList() {
    if (!els.categoryList) {
      return;
    }

    els.categoryList.innerHTML = "";

    state.categories.forEach(function (category) {
      const item = document.createElement("li");
      const label = document.createElement("span");
      const button = document.createElement("button");

      label.textContent = category;
      button.type = "button";
      button.className = "btn danger";
      button.textContent = "Delete";

      button.addEventListener("click", function () {
        deleteCategory(category);
      });

      item.appendChild(label);
      item.appendChild(button);
      els.categoryList.appendChild(item);
    });
  }

  function renderCategoryDropdown() {
    if (!els.habitCategory) {
      return;
    }

    const previous = els.habitCategory.value;

    if (!state.categories.length) {
      els.habitCategory.innerHTML = "<option value=''>No categories</option>";
      els.habitCategory.disabled = true;
      if (els.saveHabitBtn) {
        els.saveHabitBtn.disabled = true;
      }
      return;
    }

    els.habitCategory.innerHTML = state.categories.map(function (category) {
      return "<option value='" + escapeHtml(category) + "'>" + escapeHtml(category) + "</option>";
    }).join("");

    els.habitCategory.disabled = false;
    if (els.saveHabitBtn) {
      els.saveHabitBtn.disabled = false;
    }

    els.habitCategory.value = state.categories.includes(previous) ? previous : state.categories[0];
  }

  function renderGoalDropdown() {
    if (!els.goalHabit) {
      return;
    }

    const previous = els.goalHabit.value;

    if (!state.habits.length) {
      els.goalHabit.innerHTML = "<option value=''>No habits</option>";
      els.goalHabit.disabled = true;
      if (els.saveGoalBtn) {
        els.saveGoalBtn.disabled = true;
      }
      return;
    }

    els.goalHabit.innerHTML = state.habits.map(function (habit) {
      return "<option value='" + habit.id + "'>" + escapeHtml(habit.name) + " (" + escapeHtml(habit.category) + ")</option>";
    }).join("");

    els.goalHabit.disabled = false;
    if (els.saveGoalBtn) {
      els.saveGoalBtn.disabled = false;
    }

    els.goalHabit.value = state.habits.some(function (habit) { return habit.id === previous; }) ? previous : state.habits[0].id;
  }

  function renderHabitList() {
    if (!els.habitList) {
      return;
    }

    const selectedDate = getSelectedDate();
    els.habitList.innerHTML = "";

    if (!state.habits.length) {
      els.habitList.innerHTML = "<p>No habits yet. Add one above.</p>";
      return;
    }

    state.categories.forEach(function (category) {
      const categoryHabits = getScheduledHabitsForDate(selectedDate).filter(function (habit) {
        return habit.category === category;
      });

      if (!categoryHabits.length) {
        return;
      }

      const pendingHabits = [];
      const completedHabits = [];

      categoryHabits.forEach(function (habit) {
        const status = getHabitStatus(habit.id, selectedDate);
        if (status === "done") {
          completedHabits.push({ habit: habit, status: status });
        } else {
          pendingHabits.push({ habit: habit, status: status });
        }
      });

      const group = document.createElement("section");
      group.className = "habit-group";

      const title = document.createElement("h3");
      title.textContent = category;
      group.appendChild(title);

      if (pendingHabits.length) {
        const pendingTitle = document.createElement("h4");
        pendingTitle.className = "section-title";
        pendingTitle.textContent = "Pending";
        group.appendChild(pendingTitle);

        pendingHabits.forEach(function (item) {
          group.appendChild(buildHabitCard(item.habit, item.status, selectedDate));
        });
      }

      const completedWrap = document.createElement("div");
      completedWrap.className = "completed-wrap";
      const completedTitle = document.createElement("h4");
      completedTitle.className = "section-title";
      completedTitle.textContent = "Completed";
      completedWrap.appendChild(completedTitle);

      if (completedHabits.length) {
        completedHabits.forEach(function (item) {
          completedWrap.appendChild(buildHabitCard(item.habit, item.status, selectedDate));
        });
      } else {
        const empty = document.createElement("p");
        empty.className = "habit-status";
        empty.textContent = "No completed habits yet.";
        completedWrap.appendChild(empty);
      }

      group.appendChild(completedWrap);
      els.habitList.appendChild(group);
    });
  }

  function buildHabitCard(habit, status, selectedDate) {
    const card = document.createElement("article");
    card.className = "habit-card" + ((status === "done" || status === "skip") ? " " + status : "");

    const top = document.createElement("div");
    top.className = "habit-top";

    const name = document.createElement("strong");
    name.className = "habit-name" + (status === "done" ? " done" : "");
    name.textContent = habit.name;

    const meta = document.createElement("span");
    meta.className = "habit-meta";
    meta.textContent = habit.frequency;

    top.appendChild(name);
    top.appendChild(meta);

    const stat = document.createElement("p");
    stat.className = "habit-status";
    stat.textContent = "Date " + selectedDate + ": " + status;

    const actions = document.createElement("div");
    actions.className = "habit-actions";

    actions.appendChild(makeActionButton("Done", "btn", function () {
      setHabitStatus(habit.id, selectedDate, "done");
    }));
    actions.appendChild(makeActionButton("Skip", "btn danger", function () {
      setHabitStatus(habit.id, selectedDate, "skip");
    }));
    actions.appendChild(makeActionButton("Reset", "btn secondary", function () {
      setHabitStatus(habit.id, selectedDate, "reset");
    }));
    actions.appendChild(makeActionButton("Delete", "btn danger", function () {
      deleteHabit(habit.id);
    }));

    const reminderBox = buildReminderControls(habit);

    card.appendChild(top);
    card.appendChild(stat);
    card.appendChild(actions);
    card.appendChild(reminderBox);
    return card;
  }

  function buildReminderControls(habit) {
    const reminder = getHabitReminder(habit);

    const wrapper = document.createElement("div");
    wrapper.className = "reminder-box";

    const top = document.createElement("div");
    top.className = "reminder-top";

    const title = document.createElement("strong");
    title.textContent = habit.frequency === "weekly" ? "Weekly Reminder" : "Daily Reminder";

    const toggleLabel = document.createElement("label");
    toggleLabel.className = "reminder-toggle";

    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = Boolean(reminder.enabled);

    const toggleText = document.createElement("span");
    toggleText.textContent = reminder.enabled ? "On" : "Off";

    toggle.addEventListener("change", function () {
      updateHabitReminder(habit.id, {
        enabled: toggle.checked
      });
      renderAll();
      syncRemindersToServiceWorker();
      showFeedback(toggle.checked ? "Reminder enabled." : "Reminder disabled.", "success");
    });

    toggleLabel.appendChild(toggle);
    toggleLabel.appendChild(toggleText);

    top.appendChild(title);
    top.appendChild(toggleLabel);

    const inputs = document.createElement("div");
    inputs.className = "reminder-inputs";

    const timeInput = document.createElement("input");
    timeInput.type = "time";
    timeInput.value = reminder.time || "08:00";
    timeInput.disabled = !reminder.enabled;
    timeInput.addEventListener("change", function () {
      if (!/^\d{2}:\d{2}$/.test(timeInput.value)) {
        showFeedback("Please set valid reminder time.", "error");
        return;
      }
      updateHabitReminder(habit.id, { time: timeInput.value });
      syncRemindersToServiceWorker();
      showFeedback("Reminder time updated.", "success");
    });

    inputs.appendChild(timeInput);

    if (habit.frequency === "weekly") {
      const daySelect = document.createElement("select");
      daySelect.disabled = !reminder.enabled;
      daySelect.innerHTML = weekdayOptionsHtml();
      daySelect.value = String(reminder.day);
      daySelect.addEventListener("change", function () {
        updateHabitReminder(habit.id, { day: Number(daySelect.value) });
        syncRemindersToServiceWorker();
        showFeedback("Weekly reminder day updated.", "success");
      });
      inputs.appendChild(daySelect);
    }

    const presets = document.createElement("div");
    presets.className = "reminder-presets";
    presets.appendChild(makeReminderPresetButton("Morning", "08:00", habit.id, reminder.enabled));
    presets.appendChild(makeReminderPresetButton("Evening", "18:00", habit.id, reminder.enabled));
    presets.appendChild(makeReminderPresetButton("Night", "21:00", habit.id, reminder.enabled));

    const hint = document.createElement("p");
    hint.className = "reminder-hint";
    hint.textContent = habit.frequency === "weekly"
      ? "Weekly reminder triggers on selected day/time."
      : "Daily reminder triggers at selected time.";

    wrapper.appendChild(top);
    wrapper.appendChild(inputs);
    wrapper.appendChild(presets);
    wrapper.appendChild(hint);

    return wrapper;
  }

  function weekdayOptionsHtml() {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return days.map(function (day, index) {
      return "<option value='" + index + "'>" + day + "</option>";
    }).join("");
  }

  function makeReminderPresetButton(label, timeValue, habitId, enabled) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn secondary reminder-preset-btn";
    button.textContent = label;
    button.disabled = !enabled;
    button.addEventListener("click", function () {
      updateHabitReminder(habitId, { time: timeValue });
      syncRemindersToServiceWorker();
      renderAll();
      showFeedback("Reminder set for " + timeValue + ".", "success");
    });
    return button;
  }

  function renderGoals() {
    if (!els.goalsView) {
      return;
    }

    els.goalsView.innerHTML = "";

    const rows = [];
    Object.keys(state.goals.monthly || {}).forEach(function (habitId) {
      rows.push({ type: "monthly", habitId: habitId, target: Number(state.goals.monthly[habitId]) });
    });
    Object.keys(state.goals.yearly || {}).forEach(function (habitId) {
      rows.push({ type: "yearly", habitId: habitId, target: Number(state.goals.yearly[habitId]) });
    });

    if (!rows.length) {
      els.goalsView.innerHTML = "<p>No goals set.</p>";
      return;
    }

    rows.forEach(function (goal) {
      const habit = state.habits.find(function (item) { return item.id === goal.habitId; });
      if (!habit) {
        return;
      }

      const achieved = goal.type === "yearly"
        ? countHabitDoneInYear(goal.habitId)
        : countHabitDoneInCurrentMonth(goal.habitId);
      const percent = ratioPercent(achieved, goal.target);

      const card = document.createElement("article");
      card.className = "goal-item";

      let breakdownHtml = "";
      if (goal.type === "yearly") {
        const derived = getDerivedGoal(goal.habitId, goal.target);
        const effectiveMonthly = getEffectiveMonthlyTarget(goal.habitId, derived.monthlyTarget);
        breakdownHtml = "<div class='breakdown'>" +
          "<p><strong>Yearly Goal:</strong> " + goal.target + "</p>" +
          "<p><strong>Monthly Target:</strong> ~" + effectiveMonthly + "</p>" +
          "<p><strong>Daily Target:</strong> ~" + roundTo(derived.dailyRaw, 2).toFixed(2) + " (suggested " + derived.dailySuggested + "/day)</p>" +
          "</div>" +
          "<div class='adjust-row'>" +
          "<label>Monthly Override</label>" +
          "<input type='number' min='1' data-adjust-monthly='" + goal.habitId + "' value='" + effectiveMonthly + "' />" +
          "<button type='button' class='btn secondary' data-save-adjust='" + goal.habitId + "'>Save</button>" +
          "</div>";
      }

      card.innerHTML = "<strong>" + goal.type.toUpperCase() + " - " + escapeHtml(habit.name) + "</strong>" +
        "<p>Progress: " + achieved + " / " + goal.target + " (" + formatPercent(percent) + ")</p>" +
        "<div class='bar'><span style='width:" + clampPercent(percent) + "%'></span></div>" +
        breakdownHtml;

      els.goalsView.appendChild(card);
    });

    wireGoalAdjustmentButtons();
  }

  function renderDateSummary() {
    if (!els.dateSummary) {
      return;
    }

    els.dateSummary.innerHTML = "";

    for (let i = 0; i < 14; i += 1) {
      const dateObj = new Date();
      dateObj.setDate(dateObj.getDate() - i);
      const key = dateToKey(dateObj);
      const dailyStats = getDailyStats(key);

      const wrapper = document.createElement("div");
      wrapper.className = "date-summary-item";

      const row = document.createElement("div");
      row.className = "date-row";
      const progressLabel = dailyStats.scheduled === 0
        ? "No habit scheduled"
        : (dailyStats.done + "/" + dailyStats.scheduled + " (" + formatPercent(dailyStats.percent) + ")");

      row.innerHTML = "<span class='date-value'>" + key + "</span>" +
        "<span class='date-progress'>" + progressLabel + "</span>";

      const actions = document.createElement("div");
      actions.className = "date-row-actions";

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn secondary";
      editBtn.textContent = openEditDateKey === key ? "Close" : "Edit";
      editBtn.addEventListener("click", function () {
        openEditDateKey = openEditDateKey === key ? null : key;
        renderDateSummary();
      });

      actions.appendChild(editBtn);
      row.appendChild(actions);
      wrapper.appendChild(row);

      if (openEditDateKey === key) {
        wrapper.appendChild(buildDateEditPanel(key));
      }

      els.dateSummary.appendChild(wrapper);
    }
  }

  function buildDateEditPanel(dateKey) {
    const panel = document.createElement("div");
    panel.className = "date-editor";

    const habits = getScheduledHabitsForDate(dateKey);

    if (!habits.length) {
      panel.innerHTML = "<p class='habit-status'>No scheduled habits for this date.</p>";
      return panel;
    }

    habits.forEach(function (habit) {
      const line = document.createElement("div");
      line.className = "editor-row";

      const label = document.createElement("span");
      label.textContent = habit.name + " (" + habit.category + ")";

      const select = document.createElement("select");
      const status = getHabitStatus(habit.id, dateKey);
      select.innerHTML =
        "<option value='done'>Done</option>" +
        "<option value='skip'>Skipped/Missed</option>" +
        "<option value='reset'>Pending/Reset</option>";
      select.value = status === "pending" ? "reset" : status;

      select.addEventListener("change", function () {
        setHabitStatus(habit.id, dateKey, select.value);
        showFeedback("Date summary updated.", "success");
      });

      line.appendChild(label);
      line.appendChild(select);
      panel.appendChild(line);
    });

    return panel;
  }

  function renderDashboard() {
    const daily = getDailyStats(getSelectedDate());
    const monthly = getMonthlyStats();
    const yearly = getYearlyStats();

    if (els.dailyText) {
      els.dailyText.textContent = daily.scheduled === 0
        ? "No habit scheduled"
        : (daily.done + "/" + daily.scheduled + " (" + formatPercent(daily.percent) + ")");
    }
    if (els.monthlyText) {
      els.monthlyText.textContent = monthly.scheduledDays === 0
        ? "No habit scheduled"
        : (monthly.completedDays + "/" + monthly.scheduledDays + " days (" + formatPercent(monthly.percent) + ")");
    }
    if (els.yearlyText) {
      els.yearlyText.textContent = yearly.denominator === 0
        ? "No habit scheduled"
        : (yearly.numerator + "/" + yearly.denominator + " (" + formatPercent(yearly.percent) + ")");
    }

    if (els.dailyBar) {
      els.dailyBar.style.width = clampPercent(daily.percent) + "%";
    }
    if (els.monthlyBar) {
      els.monthlyBar.style.width = clampPercent(monthly.percent) + "%";
    }
    if (els.yearlyBar) {
      els.yearlyBar.style.width = clampPercent(yearly.percent) + "%";
    }
  }

  function renderGoalInsights() {
    if (!els.goalInsights) {
      return;
    }

    els.goalInsights.innerHTML = "";

    const yearlyGoalIds = Object.keys(state.goals.yearly || {});
    if (!yearlyGoalIds.length) {
      els.goalInsights.innerHTML = "<p>No yearly goals yet.</p>";
      return;
    }

    yearlyGoalIds.forEach(function (habitId) {
      const yearlyTarget = Number(state.goals.yearly[habitId]);
      const habit = state.habits.find(function (item) { return item.id === habitId; });
      if (!habit || !yearlyTarget) {
        return;
      }

      const derived = getDerivedGoal(habitId, yearlyTarget);
      const monthlyTarget = getEffectiveMonthlyTarget(habitId, derived.monthlyTarget);

      const yearlyDone = countHabitDoneInYear(habitId);
      const yearlyPct = ratioPercent(yearlyDone, yearlyTarget);

      const monthlyDone = countHabitDoneInCurrentMonth(habitId);
      const monthlyPct = ratioPercent(monthlyDone, monthlyTarget);

      const consistency = getHabitMonthlyConsistency(habitId);

      const card = document.createElement("article");
      card.className = "insight-item";
      card.innerHTML =
        "<strong>" + escapeHtml(habit.name) + "</strong>" +
        "<p>Yearly Goal: " + yearlyDone + " / " + yearlyTarget + " (" + formatPercent(yearlyPct) + ")</p>" +
        "<div class='bar'><span style='width:" + clampPercent(yearlyPct) + "%'></span></div>" +
        "<p>Monthly Target: " + monthlyDone + " / " + monthlyTarget + " (" + formatPercent(monthlyPct) + ")</p>" +
        "<div class='bar'><span style='width:" + clampPercent(monthlyPct) + "%'></span></div>" +
        "<p>Daily Consistency (this month): " + formatPercent(consistency) + "</p>";

      els.goalInsights.appendChild(card);
    });
  }

  function wireGoalAdjustmentButtons() {
    const buttons = document.querySelectorAll("[data-save-adjust]");
    buttons.forEach(function (button) {
      button.addEventListener("click", function () {
        const habitId = String(button.getAttribute("data-save-adjust") || "");
        const input = document.querySelector("[data-adjust-monthly='" + habitId + "']");
        if (!input) {
          return;
        }

        const value = Number(input.value);
        if (!Number.isFinite(value) || value <= 0) {
          showFeedback("Monthly override must be greater than 0.", "error");
          return;
        }

        if (!state.derivedGoals[habitId]) {
          state.derivedGoals[habitId] = {
            fromYearly: Number(state.goals.yearly[habitId]) || null,
            monthlyTarget: value,
            dailyRaw: value / 30,
            dailySuggested: Math.max(1, Math.round(value / 30)),
            manualMonthlyOverride: value
          };
        } else {
          state.derivedGoals[habitId].monthlyTarget = value;
          state.derivedGoals[habitId].dailyRaw = value / 30;
          state.derivedGoals[habitId].dailySuggested = Math.max(1, Math.round(value / 30));
          state.derivedGoals[habitId].manualMonthlyOverride = value;
        }

        persistState();
        renderAll();
        showFeedback("Monthly target override saved.", "success");
      });
    });
  }

  function ensureDayLog(dateKey) {
    if (!state.logs[dateKey]) {
      state.logs[dateKey] = {};
      persistState();
    }
  }

  function setHabitStatus(habitId, dateKey, status) {
    ensureDayLog(dateKey);

    if (status === "reset") {
      delete state.logs[dateKey][habitId];
      if (!Object.keys(state.logs[dateKey]).length) {
        delete state.logs[dateKey];
      }
    } else {
      state.logs[dateKey][habitId] = status;
    }

    persistState();
    renderAll();
  }

  function getHabitStatus(habitId, dateKey) {
    if (!state.logs[dateKey]) {
      return "pending";
    }
    return state.logs[dateKey][habitId] || "pending";
  }

  function getScheduledHabitsForDate(dateKey) {
    return state.habits.filter(function (habit) {
      return isHabitScheduledOnDate(habit, dateKey);
    });
  }

  function isHabitScheduledOnDate(habit, dateKey) {
    if (habit.frequency !== "weekly") {
      return true;
    }

    const target = new Date(dateKey + "T00:00:00");
    const created = habit.createdAt ? new Date(habit.createdAt) : target;
    return target.getDay() === created.getDay();
  }

  function getDailyStats(dateKey) {
    const scheduledHabits = getScheduledHabitsForDate(dateKey);
    const scheduled = scheduledHabits.length;

    let done = 0;
    scheduledHabits.forEach(function (habit) {
      if (getHabitStatus(habit.id, dateKey) === "done") {
        done += 1;
      }
    });

    return {
      scheduled: scheduled,
      done: done,
      percent: ratioPercent(done, scheduled)
    };
  }

  function getMonthlyStats() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const lastDay = now.getDate();

    let scheduledDays = 0;
    let completedDays = 0;

    for (let day = 1; day <= lastDay; day += 1) {
      const key = year + "-" + String(month + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
      const daily = getDailyStats(key);
      if (daily.scheduled > 0) {
        scheduledDays += 1;
        if (daily.done === daily.scheduled) {
          completedDays += 1;
        }
      }
    }

    return {
      scheduledDays: scheduledDays,
      completedDays: completedDays,
      percent: ratioPercent(completedDays, scheduledDays)
    };
  }

  function getYearlyStats() {
    const now = new Date();
    const year = now.getFullYear();

    const yearlyGoalIds = Object.keys(state.goals.yearly || {}).filter(function (habitId) {
      return state.habits.some(function (h) { return h.id === habitId; });
    });

    let numerator = 0;
    let denominator = 0;

    if (yearlyGoalIds.length) {
      yearlyGoalIds.forEach(function (habitId) {
        numerator += countHabitDoneInYear(habitId);
        denominator += Number(state.goals.yearly[habitId]) || 0;
      });
    } else {
      const yearStart = new Date(year, 0, 1);
      const today = new Date(year, now.getMonth(), now.getDate());
      const days = Math.floor((today.getTime() - yearStart.getTime()) / 86400000) + 1;

      for (let i = 0; i < days; i += 1) {
        const date = new Date(yearStart);
        date.setDate(yearStart.getDate() + i);
        const key = dateToKey(date);
        const daily = getDailyStats(key);
        numerator += daily.done;
        denominator += daily.scheduled;
      }
    }

    return {
      numerator: numerator,
      denominator: denominator,
      percent: ratioPercent(numerator, denominator)
    };
  }

  function countHabitDoneInCurrentMonth(habitId) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    let done = 0;
    Object.keys(state.logs).forEach(function (dateKey) {
      const parts = dateKey.split("-").map(Number);
      if (parts.length !== 3) {
        return;
      }
      if (parts[0] === year && parts[1] - 1 === month && state.logs[dateKey][habitId] === "done") {
        done += 1;
      }
    });
    return done;
  }

  function countHabitDoneInYear(habitId) {
    const year = new Date().getFullYear();

    let done = 0;
    Object.keys(state.logs).forEach(function (dateKey) {
      const yearPart = Number(dateKey.split("-")[0]);
      if (yearPart === year && state.logs[dateKey][habitId] === "done") {
        done += 1;
      }
    });

    return done;
  }

  function getHabitMonthlyConsistency(habitId) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const elapsed = now.getDate();

    const habit = state.habits.find(function (item) { return item.id === habitId; });
    if (!habit) {
      return 0;
    }

    let scheduledDays = 0;
    let doneDays = 0;

    for (let day = 1; day <= elapsed; day += 1) {
      const key = year + "-" + String(month + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
      if (isHabitScheduledOnDate(habit, key)) {
        scheduledDays += 1;
        if (getHabitStatus(habitId, key) === "done") {
          doneDays += 1;
        }
      }
    }

    return ratioPercent(doneDays, scheduledDays);
  }

  function buildDerivedFromYearly(yearlyTarget) {
    const monthlyTarget = Math.max(1, Math.round(yearlyTarget / 12));
    const dailyRaw = yearlyTarget / 365;
    const dailySuggested = Math.max(1, Math.round(dailyRaw));

    return {
      monthlyTarget: monthlyTarget,
      dailyRaw: dailyRaw,
      dailySuggested: dailySuggested
    };
  }

  function getDerivedGoal(habitId, yearlyTarget) {
    if (!state.derivedGoals[habitId]) {
      const derived = buildDerivedFromYearly(yearlyTarget);
      state.derivedGoals[habitId] = {
        fromYearly: yearlyTarget,
        monthlyTarget: derived.monthlyTarget,
        dailyRaw: derived.dailyRaw,
        dailySuggested: derived.dailySuggested,
        manualMonthlyOverride: null
      };
      persistState();
    }
    return state.derivedGoals[habitId];
  }

  function getEffectiveMonthlyTarget(habitId, fallbackMonthly) {
    const derived = state.derivedGoals[habitId];
    if (!derived) {
      return fallbackMonthly;
    }
    return Number(derived.manualMonthlyOverride || derived.monthlyTarget || fallbackMonthly);
  }

  function deleteHabit(habitId) {
    const habit = state.habits.find(function (item) { return item.id === habitId; });
    if (!habit) {
      return;
    }

    const ok = window.confirm("Delete habit \"" + habit.name + "\"?");
    if (!ok) {
      return;
    }

    state.habits = state.habits.filter(function (item) { return item.id !== habitId; });

    Object.keys(state.logs).forEach(function (dateKey) {
      delete state.logs[dateKey][habitId];
      if (!Object.keys(state.logs[dateKey]).length) {
        delete state.logs[dateKey];
      }
    });

    delete state.goals.monthly[habitId];
    delete state.goals.yearly[habitId];
    delete state.derivedGoals[habitId];

    Object.keys(state.reminderMeta.sentMap || {}).forEach(function (slot) {
      if (state.reminderMeta.sentMap[slot] === habitId) {
        delete state.reminderMeta.sentMap[slot];
      }
    });

    persistState();
    renderAll();
    syncRemindersToServiceWorker();
    showFeedback("Habit deleted.", "success");
  }

  function deleteCategory(category) {
    const linkedHabits = state.habits.filter(function (habit) { return habit.category === category; });

    if (linkedHabits.length) {
      const ok = window.confirm("Delete category \"" + category + "\" and " + linkedHabits.length + " related habit(s)?");
      if (!ok) {
        return;
      }
    }

    linkedHabits.forEach(function (habit) {
      const id = habit.id;
      state.habits = state.habits.filter(function (item) { return item.id !== id; });
      delete state.goals.monthly[id];
      delete state.goals.yearly[id];
      delete state.derivedGoals[id];

      Object.keys(state.logs).forEach(function (dateKey) {
        delete state.logs[dateKey][id];
        if (!Object.keys(state.logs[dateKey]).length) {
          delete state.logs[dateKey];
        }
      });
    });

    state.categories = state.categories.filter(function (item) { return item !== category; });

    if (!state.categories.length) {
      state.categories.push("General");
    }

    persistState();
    renderAll();
    syncRemindersToServiceWorker();
    showFeedback("Category deleted.", "success");
  }

  function buildDefaultReminder(frequency, createdAtIso) {
    const createdDate = createdAtIso ? new Date(createdAtIso) : new Date();
    return {
      enabled: false,
      time: "08:00",
      day: createdDate.getDay(),
      lastNotifiedSlot: "",
      frequency: frequency === "weekly" ? "weekly" : "daily"
    };
  }

  function getHabitReminder(habit) {
    if (!habit.reminder || typeof habit.reminder !== "object") {
      habit.reminder = buildDefaultReminder(habit.frequency, habit.createdAt);
    }

    habit.reminder.frequency = habit.frequency === "weekly" ? "weekly" : "daily";
    if (!/^\d{2}:\d{2}$/.test(String(habit.reminder.time || ""))) {
      habit.reminder.time = "08:00";
    }

    if (!Number.isInteger(habit.reminder.day) || habit.reminder.day < 0 || habit.reminder.day > 6) {
      habit.reminder.day = new Date(habit.createdAt || Date.now()).getDay();
    }

    if (typeof habit.reminder.enabled !== "boolean") {
      habit.reminder.enabled = false;
    }

    if (typeof habit.reminder.lastNotifiedSlot !== "string") {
      habit.reminder.lastNotifiedSlot = "";
    }

    return habit.reminder;
  }

  function updateHabitReminder(habitId, updates) {
    const habit = state.habits.find(function (item) { return item.id === habitId; });
    if (!habit) {
      return;
    }

    const reminder = getHabitReminder(habit);
    const patch = updates && typeof updates === "object" ? updates : {};

    if (Object.prototype.hasOwnProperty.call(patch, "enabled")) {
      reminder.enabled = Boolean(patch.enabled);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "time") && /^\d{2}:\d{2}$/.test(String(patch.time))) {
      reminder.time = String(patch.time);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "day")) {
      const day = Number(patch.day);
      if (Number.isInteger(day) && day >= 0 && day <= 6) {
        reminder.day = day;
      }
    }

    persistState();
  }

  function checkDueReminders() {
    if (!("Notification" in window) || Notification.permission !== "granted") {
      return;
    }

    const now = new Date();
    const hour = String(now.getHours()).padStart(2, "0");
    const minute = String(now.getMinutes()).padStart(2, "0");
    const currentTime = hour + ":" + minute;
    const dateKey = dateToKey(now);

    state.habits.forEach(function (habit) {
      const reminder = getHabitReminder(habit);
      if (!reminder.enabled) {
        return;
      }
      if (reminder.time !== currentTime) {
        return;
      }
      if (habit.frequency === "weekly" && now.getDay() !== Number(reminder.day)) {
        return;
      }
      if (getHabitStatus(habit.id, dateKey) === "done") {
        return;
      }

      const slot = habit.id + "::" + dateKey + "::" + currentTime;
      if (state.reminderMeta.sentMap[slot]) {
        return;
      }

      fireNotification(habit);
      state.reminderMeta.sentMap[slot] = habit.id;
    });

    trimSentMap();
    persistState();
    syncRemindersToServiceWorker();
  }

  function trimSentMap() {
    const keys = Object.keys(state.reminderMeta.sentMap || {});
    if (keys.length <= 600) {
      return;
    }

    keys.sort();
    const removeCount = keys.length - 500;
    for (let i = 0; i < removeCount; i += 1) {
      delete state.reminderMeta.sentMap[keys[i]];
    }
  }

  function fireNotification(habit) {
    const title = "Habit Reminder";
    const body = "Reminder: Time to complete your habit – " + habit.name + ".";

    if (swRegistration && typeof swRegistration.showNotification === "function") {
      swRegistration.showNotification(title, {
        body: body,
        tag: "habit-" + habit.id,
        data: { url: getAppUrl() }
      }).catch(function (error) {
        console.error(error);
      });
      return;
    }

    try {
      const notification = new Notification(title, {
        body: body,
        tag: "habit-" + habit.id
      });
      notification.onclick = function () {
        window.focus();
      };
    } catch (error) {
      console.error(error);
    }
  }

  function buildReminderPayload() {
    return state.habits.map(function (habit) {
      const reminder = getHabitReminder(habit);
      return {
        habitId: habit.id,
        name: habit.name,
        frequency: habit.frequency,
        enabled: reminder.enabled,
        time: reminder.time,
        day: reminder.day
      };
    });
  }

  function syncRemindersToServiceWorker() {
    if (!navigator.serviceWorker) {
      return;
    }

    const messageTarget = navigator.serviceWorker.controller
      || (swRegistration && (swRegistration.active || swRegistration.waiting || swRegistration.installing));

    if (!messageTarget) {
      return;
    }

    messageTarget.postMessage({
      type: "SYNC_REMINDERS",
      payload: {
        appUrl: getAppUrl(),
        reminders: buildReminderPayload(),
        sentMap: state.reminderMeta.sentMap || {}
      }
    });

    messageTarget.postMessage({ type: "CHECK_NOW" });
  }

  function getAppUrl() {
    return window.location.href;
  }

  function makeActionButton(label, className, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function getSelectedDate() {
    return activeDateKey;
  }

  function generateId() {
    return "habit_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
  }

  function normalizeText(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  function showFeedback(message, type) {
    if (!els.feedback) {
      return;
    }

    els.feedback.textContent = message;
    els.feedback.className = "feedback " + (type || "");

    window.setTimeout(function () {
      if (els.feedback && els.feedback.textContent === message) {
        els.feedback.textContent = "";
        els.feedback.className = "feedback";
      }
    }, 2200);
  }

  function todayKey() {
    return dateToKey(new Date());
  }

  function dateToKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function persistState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error(error);
      showFeedback("Unable to save data in browser storage.", "error");
    }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || loadFromLegacyKey();
      if (!raw) {
        return normalizeState(defaultState);
      }
      return normalizeState(JSON.parse(raw));
    } catch (error) {
      console.error(error);
      return normalizeState(defaultState);
    }
  }

  function loadFromLegacyKey() {
    for (let i = 0; i < LEGACY_KEYS.length; i += 1) {
      const key = LEGACY_KEYS[i];
      const value = localStorage.getItem(key);
      if (value) {
        return value;
      }
    }
    return "";
  }

  function normalizeState(rawState) {
    const base = JSON.parse(JSON.stringify(defaultState));
    const src = rawState && typeof rawState === "object" ? rawState : {};

    const categorySet = new Set();
    const categories = (Array.isArray(src.categories) ? src.categories : base.categories)
      .map(function (item) { return normalizeText(item); })
      .filter(function (item) {
        const key = item.toLowerCase();
        if (!item || categorySet.has(key)) {
          return false;
        }
        categorySet.add(key);
        return true;
      });

    const safeCategories = categories.length ? categories : base.categories;

    const habitSet = new Set();
    const habits = (Array.isArray(src.habits) ? src.habits : base.habits)
      .filter(function (habit) { return habit && typeof habit === "object"; })
      .map(function (habit) {
        const createdAt = habit.createdAt || new Date().toISOString();
        const frequency = habit.frequency === "weekly" ? "weekly" : "daily";
        const reminder = habit.reminder && typeof habit.reminder === "object"
          ? habit.reminder
          : buildDefaultReminder(frequency, createdAt);

        const normalizedReminder = {
          enabled: Boolean(reminder.enabled),
          time: /^\d{2}:\d{2}$/.test(String(reminder.time || "")) ? String(reminder.time) : "08:00",
          day: Number.isInteger(reminder.day) && reminder.day >= 0 && reminder.day <= 6
            ? reminder.day
            : new Date(createdAt).getDay(),
          lastNotifiedSlot: typeof reminder.lastNotifiedSlot === "string" ? reminder.lastNotifiedSlot : "",
          frequency: frequency
        };

        return {
          id: String(habit.id || generateId()),
          name: normalizeText(habit.name),
          category: safeCategories.includes(habit.category) ? habit.category : safeCategories[0],
          frequency: frequency,
          createdAt: createdAt,
          reminder: normalizedReminder
        };
      })
      .filter(function (habit) {
        if (!habit.name) {
          return false;
        }
        const key = habit.category.toLowerCase() + "::" + habit.name.toLowerCase();
        if (habitSet.has(key)) {
          return false;
        }
        habitSet.add(key);
        return true;
      });

    const logs = src.logs && typeof src.logs === "object" ? src.logs : {};
    const goals = src.goals && typeof src.goals === "object" ? src.goals : {};
    const derivedGoals = src.derivedGoals && typeof src.derivedGoals === "object" ? src.derivedGoals : {};
    const reminderMeta = src.reminderMeta && typeof src.reminderMeta === "object" ? src.reminderMeta : {};

    return {
      categories: safeCategories,
      habits: habits,
      logs: logs,
      goals: {
        monthly: goals.monthly && typeof goals.monthly === "object" ? goals.monthly : {},
        yearly: goals.yearly && typeof goals.yearly === "object" ? goals.yearly : {}
      },
      derivedGoals: derivedGoals,
      reminderMeta: {
        sentMap: reminderMeta.sentMap && typeof reminderMeta.sentMap === "object" ? reminderMeta.sentMap : {}
      }
    };
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})();
