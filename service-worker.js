const CACHE_NAME = "habit-tracker-cache-v2";
const REMINDER_CACHE = "habit-reminder-cache-v1";
const REMINDER_KEY = "/__habit_reminders__.json";

const APP_ASSETS = [
  "./",
  "index.html",
  "style.css",
  "script.js",
  "manifest.json",
  "assets/icons/icon-16.png",
  "assets/icons/icon-32.png",
  "assets/icons/icon-180.png",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/icon.svg"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(APP_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (key) {
          if (key !== CACHE_NAME && key !== REMINDER_CACHE) {
            return caches.delete(key);
          }
          return Promise.resolve();
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) {
        return cached;
      }
      return fetch(event.request).then(function (response) {
        const cloned = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(event.request, cloned);
        }).catch(function () {
          return null;
        });
        return response;
      }).catch(function () {
        return caches.match("index.html");
      });
    })
  );
});

self.addEventListener("message", function (event) {
  const data = event.data || {};
  if (data.type === "SYNC_REMINDERS") {
    event.waitUntil(saveReminderPayload(data.payload));
    return;
  }
  if (data.type === "CHECK_NOW") {
    event.waitUntil(checkAndNotify());
  }
});

self.addEventListener("sync", function (event) {
  if (event.tag === "habit-reminder-check") {
    event.waitUntil(checkAndNotify());
  }
});

self.addEventListener("periodicsync", function (event) {
  if (event.tag === "habit-reminder-periodic") {
    event.waitUntil(checkAndNotify());
  }
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "./";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (windowClients) {
      for (let i = 0; i < windowClients.length; i += 1) {
        const client = windowClients[i];
        if (client.url && client.url.indexOf(targetUrl) !== -1) {
          return client.focus();
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});

async function saveReminderPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return;
  }

  const cache = await caches.open(REMINDER_CACHE);
  const safePayload = {
    appUrl: String(payload.appUrl || "./"),
    reminders: Array.isArray(payload.reminders) ? payload.reminders : [],
    sentMap: payload.sentMap && typeof payload.sentMap === "object" ? payload.sentMap : {},
    updatedAt: Date.now()
  };

  await cache.put(
    REMINDER_KEY,
    new Response(JSON.stringify(safePayload), {
      headers: { "content-type": "application/json" }
    })
  );
}

async function loadReminderPayload() {
  const cache = await caches.open(REMINDER_CACHE);
  const response = await cache.match(REMINDER_KEY);
  if (!response) {
    return {
      appUrl: "./",
      reminders: [],
      sentMap: {}
    };
  }

  try {
    return await response.json();
  } catch (error) {
    return {
      appUrl: "./",
      reminders: [],
      sentMap: {}
    };
  }
}

async function checkAndNotify() {
  const payload = await loadReminderPayload();
  const reminders = Array.isArray(payload.reminders) ? payload.reminders : [];
  const sentMap = payload.sentMap && typeof payload.sentMap === "object" ? payload.sentMap : {};

  if (!reminders.length) {
    return;
  }

  const now = new Date();
  const dateKey = toDateKey(now);
  const timeKey = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
  const todayDay = now.getDay();

  for (let i = 0; i < reminders.length; i += 1) {
    const item = reminders[i];
    if (!item || !item.enabled) {
      continue;
    }

    if (String(item.time || "") !== timeKey) {
      continue;
    }

    if (item.frequency === "weekly" && Number(item.day) !== todayDay) {
      continue;
    }

    const slot = String(item.habitId || "") + "::" + dateKey + "::" + timeKey;
    if (sentMap[slot]) {
      continue;
    }

    await self.registration.showNotification("Habit Reminder", {
      body: "Reminder: Time to complete your habit – " + String(item.name || "habit") + ".",
      tag: "habit-" + String(item.habitId || ""),
      data: { url: payload.appUrl || "./" }
    });

    sentMap[slot] = String(item.habitId || "");
  }

  trimMap(sentMap);
  await saveReminderPayload({
    appUrl: payload.appUrl,
    reminders: reminders,
    sentMap: sentMap
  });
}

function trimMap(sentMap) {
  const keys = Object.keys(sentMap || {});
  if (keys.length <= 700) {
    return;
  }

  keys.sort();
  const removeCount = keys.length - 550;
  for (let i = 0; i < removeCount; i += 1) {
    delete sentMap[keys[i]];
  }
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}
