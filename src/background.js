const RETENTION_DAYS = 30;
const IDLE_SECONDS = 60;
const HEARTBEAT_ALARM = "heartbeat";
const CLEANUP_ALARM = "cleanup";
const HEARTBEAT_MINUTES = 0.5;
const MAX_GAP_MS = 2 * 60 * 1000;
const STATE_KEY = "tracking";
const EMPTY_STATE = { tabId: null, domain: null, startTime: null };

function pad(n) {
  return String(n).padStart(2, "0");
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function extractDomain(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.replace(/^www\./, "") || null;
  } catch (e) {
    return null;
  }
}

let queue = Promise.resolve();

function enqueue(task) {
  queue = queue.then(task).catch(function (err) {
    console.error(err);
  });
  return queue;
}

async function getState() {
  const result = await chrome.storage.session.get(STATE_KEY);
  return result[STATE_KEY] || { ...EMPTY_STATE };
}

async function setState(state) {
  await chrome.storage.session.set({ [STATE_KEY]: state });
}

function splitByDay(start, end) {
  const parts = {};
  let cursor = start;
  while (cursor < end) {
    const d = new Date(cursor);
    const nextMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    const segmentEnd = Math.min(end, nextMidnight);
    const key = formatDate(d);
    parts[key] = (parts[key] || 0) + (segmentEnd - cursor);
    cursor = segmentEnd;
  }
  return parts;
}

async function commit(state, now) {
  if (!state.domain || !state.startTime) return;

  const elapsed = now - state.startTime;
  if (elapsed <= 0 || elapsed > MAX_GAP_MS) return;

  const parts = splitByDay(state.startTime, now);
  const keys = Object.keys(parts);
  const stored = await chrome.storage.local.get(keys);
  const updates = {};

  keys.forEach(function (key) {
    const day = stored[key] || { date: key, sites: {} };
    if (!day.sites) day.sites = {};
    day.sites[state.domain] = (day.sites[state.domain] || 0) + parts[key];
    updates[key] = day;
  });

  await chrome.storage.local.set(updates);
}

async function switchTo(tabId) {
  const now = Date.now();

  await commit(await getState(), now);

  if (tabId === null || tabId === undefined) {
    await setState({ ...EMPTY_STATE });
    return;
  }

  let domain = null;
  try {
    const tab = await chrome.tabs.get(tabId);
    domain = extractDomain(tab.url);
  } catch (e) {
  }
  await setState({ tabId: tabId, domain: domain, startTime: now });
}

async function resumeTracking() {
  try {
    const idleState = await chrome.idle.queryState(IDLE_SECONDS);
    if (idleState !== "active") return switchTo(null);

    const win = await chrome.windows.getLastFocused();
    if (!win.focused) return switchTo(null);

    const tabs = await chrome.tabs.query({ active: true, windowId: win.id });
    return switchTo(tabs[0] ? tabs[0].id : null);
  } catch (e) {
    return switchTo(null);
  }
}

async function cleanOldData() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const cutoffKey = formatDate(cutoff);

  const all = await chrome.storage.local.get(null);
  const oldKeys = Object.keys(all).filter(function (key) {
    return /^\d{4}-\d{2}-\d{2}$/.test(key) && key < cutoffKey;
  });

  if (oldKeys.length > 0) {
    await chrome.storage.local.remove(oldKeys);
  }
}

chrome.tabs.onActivated.addListener(function (activeInfo) {
  enqueue(() => switchTo(activeInfo.tabId));
});

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
  if (!changeInfo.url && changeInfo.status !== "complete") return;
  enqueue(async function () {
    const state = await getState();
    if (state.tabId === tabId) await switchTo(tabId);
  });
});

chrome.tabs.onRemoved.addListener(function (tabId) {
  enqueue(async function () {
    const state = await getState();
    if (state.tabId === tabId) await switchTo(null);
  });
});

chrome.windows.onFocusChanged.addListener(function (windowId) {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    enqueue(() => switchTo(null));
  } else {
    enqueue(resumeTracking);
  }
});

chrome.idle.setDetectionInterval(IDLE_SECONDS);
chrome.idle.onStateChanged.addListener(function (newState) {
  if (newState === "active") {
    enqueue(resumeTracking);
  } else {
    enqueue(() => switchTo(null));
  }
});

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name === HEARTBEAT_ALARM) {
    enqueue(async function () {
      const state = await getState();
      if (!state.startTime) return resumeTracking();
      if (state.domain) {
        const now = Date.now();
        await commit(state, now);
        await setState({ ...state, startTime: now });
      }
    });
  } else if (alarm.name === CLEANUP_ALARM) {
    enqueue(cleanOldData);
  }
});

async function ensureAlarm(name, periodInMinutes) {
  const existing = await chrome.alarms.get(name);
  if (!existing) chrome.alarms.create(name, { periodInMinutes: periodInMinutes });
}
ensureAlarm(HEARTBEAT_ALARM, HEARTBEAT_MINUTES);
ensureAlarm(CLEANUP_ALARM, 24 * 60);

chrome.runtime.onInstalled.addListener(function () {
  enqueue(resumeTracking);
  enqueue(cleanOldData);
});
chrome.runtime.onStartup.addListener(function () {
  enqueue(resumeTracking);
  enqueue(cleanOldData);
});