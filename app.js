/* ===========================================================
   Day — a calm 30-minute-block time tracker (offline-first PWA)
   Data model (one object per block, LLM-friendly):
     { date:"2026-07-19", start_time:"08:30", category:"work", note:"..." }
   =========================================================== */

const BUILTIN_CATEGORIES = [
  { id: "sleep",    label: "Sleep",    color: "#7b8cde" },
  { id: "work",     label: "Work",     color: "#4a5d4e" },
  { id: "exercise", label: "Exercise", color: "#e08a4a" },
  { id: "gym",      label: "Gym",      color: "#c0693e" },
  { id: "food",     label: "Food",     color: "#d1a13a" },
  { id: "learn",    label: "Learn",    color: "#5aa0a8" },
  { id: "social",   label: "Social",   color: "#c76b98" },
  { id: "chores",   label: "Chores",   color: "#9a8c7a" },
  { id: "travel",   label: "Travel",   color: "#6a7fd0" },
  { id: "relax",    label: "Relax",    color: "#6aa86a" },
  { id: "other",    label: "Other",    color: "#9b9793" },
];
// Palette used to auto-assign colors to custom categories.
const AUTO_COLORS = [
  "#c0693e", "#4f8a8b", "#a86bb0", "#5a8f4a", "#c99a3a", "#b45d7a",
  "#6a7fd0", "#7a9e5e", "#c65f5f", "#4a8fb0", "#9a7f4a", "#8a6fb0",
];
const DEFAULT_GYM_SUBS = ["Strength", "Cardio", "Mobility", "Upper", "Lower"];
const DEFAULT_GYM_EXERCISES = [
  "Dumbbell press", "Incline dumbbell press", "Chest flys", "Bench press", "Squat", "Deadlift", "Lat pulldown",
  "Shoulder press", "Shoulder flys", "Row", "Leg press", "Bicep curl", "Tricep pushdown", "1 min hang",
];
const GYM_NOTE_PREFIX = "__gym_workout_v1__";

let customCats = [];                 // [{id,label,color}], user-created, synced
let customSubs = {};                 // { catId: [label,...] }, remembered subcategories
let activityAreas = {};              // { normalized activity label: builtin category id }
let categoryMigrationVersion = 0;    // last completed historical recategorisation
let shortTermObjectives = "";
let longTermObjectives = "";
let activeObjectiveHorizon = "today";
let diaryTargetSlot = null;
let diaryTargetEditingIndex = -1;
let diaryTargetSelected = -1;
let gymExercises = DEFAULT_GYM_EXERCISES.slice();
let CATEGORIES = BUILTIN_CATEGORIES.slice();
let CAT = {};
function rebuildCats() {
  const builtinLabels = new Set(BUILTIN_CATEGORIES.map((c) => c.label.toLowerCase()));
  const visibleCustomCats = customCats.filter((c) => !builtinLabels.has(c.label.toLowerCase()));
  CATEGORIES = BUILTIN_CATEGORIES.concat(visibleCustomCats);
  CAT = Object.fromEntries(BUILTIN_CATEGORIES.concat(customCats).map((c) => [c.id, c]));
}
rebuildCats();

// Special "slot" keys stored in the same table (never real times).
const REFLECT_KEY = "__reflect__";
const PLAN_KEY = "__plan__";
const GYM_KEY = "__gym__";
const DAY_STATUS_KEY = "__day_status__";
const ROUGH_PLAN_KEY = "__rough_plan__";
const EVENT_REMINDER_KEY = "__event_reminders__";
const SETTINGS_DATE = "2000-01-01";  // sentinel row for synced settings
const DAY_STATUS_TYPES = {
  holiday: { label: "Holiday", emoji: "🏖" },
  travel: { label: "Travel day", emoji: "✈️" },
  sick: { label: "Sick day", emoji: "🤒" },
  off: { label: "Day off", emoji: "🌿" },
};

// ---- Authenticated user id (set after Supabase magic-link login) ----
let USER_ID = null;

// ---- Supabase (optional) ----
let sb = null;
const RECOVERY_MODE = new URLSearchParams(window.location.search).get("recovery") === "1";
function loadSavedSupabaseConfig() {
  try { return JSON.parse(localStorage.getItem("day_supabase_config")) || {}; }
  catch { return {}; }
}
function getSupabaseConfig() {
  const saved = loadSavedSupabaseConfig();
  return {
    SUPABASE_URL: (window.APP_CONFIG && window.APP_CONFIG.SUPABASE_URL) || saved.SUPABASE_URL || "",
    SUPABASE_ANON_KEY: (window.APP_CONFIG && window.APP_CONFIG.SUPABASE_ANON_KEY) || saved.SUPABASE_ANON_KEY || "",
  };
}
function configureSupabase() {
  const cfg = getSupabaseConfig();
  if (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase) {
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  }
}
configureSupabase();

// ---- Date helpers ----
function ymd(d) {
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}
function slots() {
  const out = [];
  for (let h = 0; h < 24; h++)
    for (let m = 0; m < 60; m += 30)
      out.push(String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0"));
  return out; // 48 slots "00:00" .. "23:30"
}
const SLOTS = slots();

// ---- State ----
let current = new Date();
let data = {};          // { "08:30": {category, note}, ... } for current day
let editing = null;     // array of slot strings being edited
let eventMode = false;  // true when the sheet was opened through Plan event
let activeEventPreset = "all";
let customEventStart = "09:00";
let customEventEnd = "10:00";
let plannerDate = new Date();
let plannerSelectedTask = -1;
let plannerSlotMode = false;
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedCalendarDate = null;
let calendarMultiMode = false;
let selectedCalendarDates = new Set();
let calendarDragAnchor = null;
let calendarDragging = false;
let calendarLongPressTimer = null;
let suppressCalendarClick = false;
let selectedCat = null;
let selectedSub = null; // chosen subcategory label (optional)
let selectedActivityLabel = null;
let rangeAnchor = null; // slot where a press-and-hold range started

// ---- Local persistence ----
function localKey(dateStr) { return "day_data_" + dateStr; }
function loadLocal(dateStr) {
  try { return JSON.parse(localStorage.getItem(localKey(dateStr))) || {}; }
  catch { return {}; }
}
function saveLocal(dateStr, obj) {
  localStorage.setItem(localKey(dateStr), JSON.stringify(obj));
}

// ---- Settings (custom categories), synced via a sentinel row ----
function slugify(s) {
  return "c_" + s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24);
}
function loadSettingsLocal() {
  try {
    const s = JSON.parse(localStorage.getItem("day_settings")) || {};
    customCats = Array.isArray(s.customCats) ? s.customCats : [];
    customSubs = (s.subs && typeof s.subs === "object") ? s.subs : {};
    activityAreas = (s.activityAreas && typeof s.activityAreas === "object") ? s.activityAreas : {};
    categoryMigrationVersion = Number(s.categoryMigrationVersion) || 0;
    shortTermObjectives = typeof s.shortTermObjectives === "string" ? s.shortTermObjectives : "";
    longTermObjectives = typeof s.longTermObjectives === "string" ? s.longTermObjectives : "";
    gymExercises = mergeGymExercises(s.gymExercises);
  } catch { customCats = []; customSubs = {}; activityAreas = {}; categoryMigrationVersion = 0; shortTermObjectives = ""; longTermObjectives = ""; gymExercises = DEFAULT_GYM_EXERCISES.slice(); }
  rebuildCats();
}
async function pullSettings() {
  loadSettingsLocal();
  if (!sb) return;
  try {
    const { data: rows } = await sb.from("blocks")
      .select("note").eq("user_id", USER_ID)
      .eq("date", SETTINGS_DATE).eq("start_time", "__settings__");
    if (rows && rows[0]) {
      const s = JSON.parse(rows[0].note || "{}");
      if (Array.isArray(s.customCats)) customCats = s.customCats;
      if (s.subs && typeof s.subs === "object") customSubs = s.subs;
      if (s.activityAreas && typeof s.activityAreas === "object") activityAreas = s.activityAreas;
      if (s.categoryMigrationVersion != null) categoryMigrationVersion = Number(s.categoryMigrationVersion) || 0;
      if (typeof s.shortTermObjectives === "string") shortTermObjectives = s.shortTermObjectives;
      if (typeof s.longTermObjectives === "string") longTermObjectives = s.longTermObjectives;
      gymExercises = mergeGymExercises(s.gymExercises);
      localStorage.setItem("day_settings", JSON.stringify({ customCats, subs: customSubs, activityAreas, categoryMigrationVersion, shortTermObjectives, longTermObjectives, gymExercises }));
      rebuildCats();
    }
  } catch (e) { console.warn(e); }
}
async function saveSettings() {
  localStorage.setItem("day_settings", JSON.stringify({ customCats, subs: customSubs, activityAreas, categoryMigrationVersion, shortTermObjectives, longTermObjectives, gymExercises }));
  if (!sb) return;
  try {
    await sb.from("blocks").upsert({
      user_id: USER_ID, date: SETTINGS_DATE, start_time: "__settings__",
      category: "settings", note: JSON.stringify({ customCats, subs: customSubs, activityAreas, categoryMigrationVersion, shortTermObjectives, longTermObjectives, gymExercises }),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,date,start_time" });
  } catch (e) { console.warn(e); }
}
function mergeGymExercises(items) {
  const seen = new Set();
  return DEFAULT_GYM_EXERCISES.concat(Array.isArray(items) ? items : [])
    .map((s) => (s || "").trim())
    .filter((s) => {
      const key = s.toLowerCase();
      if (!s || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
function rememberGymExercise(label) {
  label = (label || "").trim();
  if (!label) return;
  if (!gymExercises.some((s) => s.toLowerCase() === label.toLowerCase())) {
    gymExercises.push(label);
    saveSettings();
  }
}
function rememberSub(catId, label) {
  label = (label || "").trim();
  if (!catId || !label) return;
  const arr = customSubs[catId] || (customSubs[catId] = []);
  if (!arr.includes(label)) { arr.push(label); saveSettings(); }
}
function normalizeActivityLabel(label) {
  return (label || "").trim().toLowerCase().replace(/\s+/g, " ");
}
function rememberActivityArea(label, catId) {
  const key = normalizeActivityLabel(label);
  if (isGymCategoryId(catId)) catId = "exercise";
  if (!key || !BUILTIN_CATEGORIES.some((c) => c.id === catId)) return;
  if (activityAreas[key] !== catId) {
    activityAreas[key] = catId;
    saveSettings();
  }
}
function addCustomCategory(label) {
  label = (label || "").trim();
  if (!label) return null;
  let id = slugify(label);
  if (!id || id === "c_") id = "c_" + Date.now().toString(36);
  if (CAT[id]) return id; // already exists
  const color = AUTO_COLORS[customCats.length % AUTO_COLORS.length];
  customCats.push({ id, label, color });
  rebuildCats();
  saveSettings();
  return id;
}
function renameCustomCategory(id, label) {
  const c = customCats.find((c) => c.id === id);
  if (c) { c.label = label; rebuildCats(); saveSettings(); }
}
function removeCustomCategory(id) {
  customCats = customCats.filter((c) => c.id !== id);
  rebuildCats();
  saveSettings();
}
// Long-press handler: rename, or clear the text to delete.
function manageCategory(c) {
  const name = window.prompt(
    `Rename "${c.label}" — or clear the text and press OK to delete it.`, c.label);
  if (name === null) return; // cancelled
  const t = name.trim();
  if (!t) {
    if (window.confirm(`Delete "${c.label}"? Past entries in this category will show as “Other”.`)) {
      removeCustomCategory(c.id);
      if (selectedCat === c.id) selectedCat = null;
      renderCatGrid();
    }
    return;
  }
  renameCustomCategory(c.id, t);
  renderCatGrid();
  if (editing) render(); // refresh timeline labels if a block was open
}

// ---- Sync ----
const statusEl = () => document.getElementById("syncStatus");
function setStatus(kind, text) {
  const el = statusEl();
  el.className = "sync-status " + kind;
  el.textContent = text;
}

async function pullDay(dateStr) {
  if (!sb) { setStatus("", "Local only"); return; }
  setStatus("syncing", "Syncing…");
  try {
    const { data: rows, error } = await sb
      .from("blocks").select("start_time,category,note,subcategory")
      .eq("user_id", USER_ID).eq("date", dateStr);
    if (error) throw error;
    const remote = {};
    for (const r of rows) remote[r.start_time] = { category: r.category, note: r.note || "", sub: r.subcategory || "" };
    // Remote is source of truth once synced.
    data = remote;
    saveLocal(dateStr, data);
    render();
    setStatus("ok", "Synced");
  } catch (e) {
    console.warn(e);
    setStatus("err", "Offline");
  }
}

// Save/delete one or more slots at once. `block` null = delete those slots.
async function pushBlocks(dateStr, slotList, block) {
  saveLocal(dateStr, data);
  if (!sb) return;
  setStatus("syncing", "Saving…");
  try {
    if (block) {
      const rows = slotList.map((s) => ({
        user_id: USER_ID, date: dateStr, start_time: s,
        category: block.category, note: block.note || "", subcategory: block.sub || "",
        updated_at: new Date().toISOString(),
      }));
      const { error } = await sb.from("blocks").upsert(rows, { onConflict: "user_id,date,start_time" });
      if (error) throw error;
    } else {
      const { error } = await sb.from("blocks").delete()
        .eq("user_id", USER_ID).eq("date", dateStr).in("start_time", slotList);
      if (error) throw error;
    }
    setStatus("ok", "Synced");
  } catch (e) {
    console.warn(e);
    setStatus("err", "Saved offline");
  }
}

// ---- Rendering ----
function prettyDate(d) {
  const today = ymd(new Date());
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (ymd(d) === today) return "Today";
  if (ymd(d) === ymd(y)) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long" });
}

function togglePlanBannerCollapse(e) {
  if (e) e.stopPropagation();
  const pb = document.getElementById("planBanner");
  if (!pb) return;
  const isCollapsed = pb.classList.contains("collapsed");
  if (isCollapsed) {
    pb.classList.remove("collapsed");
    localStorage.setItem("day_plan_banner_collapsed", "false");
  } else {
    pb.classList.add("collapsed");
    localStorage.setItem("day_plan_banner_collapsed", "true");
  }
}

function renderPlanBanner() {
  const pb = document.getElementById("planBanner");
  if (!pb) return;
  const todaysPlan = data[PLAN_KEY] && data[PLAN_KEY].note;
  if (todaysPlan && todaysPlan.trim()) {
    const lines = todaysPlan.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length > 0) {
      pb.hidden = false;
      let totalCount = 0;
      let completedCount = 0;

      const items = lines.map((line, idx) => {
        totalCount++;
        let isChecked = false;
        let cleanText = line;
        
        let bulletMatch = line.match(/^([•\-\*\d+\.\s]*)(.*)$/);
        let prefix = bulletMatch ? bulletMatch[1] : "";
        let remainder = bulletMatch ? bulletMatch[2] : line;
        
        let checkMatch = remainder.match(/^\[([ xX])\]\s*(.*)$/);
        if (checkMatch) {
          isChecked = checkMatch[1].toLowerCase() === "x";
          cleanText = checkMatch[2];
        } else {
          cleanText = remainder;
        }
        
        if (isChecked) completedCount++;

        return { idx, isChecked, cleanText };
      });

      const pct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

      pb.innerHTML = `
        <div class="plan-banner-title" id="planBannerTitle">
          <div class="plan-banner-title-left">
            <span class="plan-banner-icon">🎯</span>
            <span>Today's Objectives</span>
            <span class="plan-banner-badge">${completedCount}/${totalCount}</span>
          </div>
          <button class="plan-banner-toggle" id="planBannerToggle" aria-label="Toggle objectives view">
            <svg class="plan-banner-chevron" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="18 15 12 9 6 15"></polyline>
            </svg>
          </button>
        </div>
        <div class="plan-banner-progress-track">
          <div class="plan-banner-progress-fill" style="width: ${pct}%"></div>
        </div>
        <div class="plan-banner-list" id="planBannerList"></div>
      `;
      
      const isCollapsed = localStorage.getItem("day_plan_banner_collapsed") === "true";
      if (isCollapsed) pb.classList.add("collapsed");
      else pb.classList.remove("collapsed");

      document.getElementById("planBannerToggle").addEventListener("click", togglePlanBannerCollapse);
      document.getElementById("planBannerTitle").addEventListener("click", togglePlanBannerCollapse);

      const listEl = document.getElementById("planBannerList");
      items.forEach(({ idx, isChecked, cleanText }) => {
        const itemEl = document.createElement("div");
        itemEl.className = isChecked ? "plan-banner-item completed" : "plan-banner-item";
        
        const checkBox = document.createElement("span");
        checkBox.className = "plan-banner-check-box";
        
        const textSpan = document.createElement("span");
        textSpan.className = "plan-banner-text";
        textSpan.textContent = cleanText;
        
        itemEl.appendChild(checkBox);
        itemEl.appendChild(textSpan);

        if (!isChecked) {
          const carryBtn = document.createElement("button");
          carryBtn.className = "carry-btn";
          carryBtn.title = "Carry forward to tomorrow";
          carryBtn.setAttribute("aria-label", "Carry to tomorrow");
          carryBtn.textContent = "→";
          carryBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            carryForward(cleanText);
          });
          itemEl.appendChild(carryBtn);
        }
        
        itemEl.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleObjective(idx);
        });
        
        listEl.appendChild(itemEl);
      });
      return;
    }
  }
  pb.hidden = true;
  pb.innerHTML = "";
}

function toggleObjective(idx) {
  const todaysPlan = data[PLAN_KEY] && data[PLAN_KEY].note;
  if (!todaysPlan) return;
  
  let lines = todaysPlan.split(/\r?\n/);
  let nonElLineIndices = [];
  lines.forEach((line, index) => {
    if (line.trim() !== "") {
      nonElLineIndices.push(index);
    }
  });
  
  const targetOriginalIndex = nonElLineIndices[idx];
  if (targetOriginalIndex === undefined) return;
  
  const line = lines[targetOriginalIndex];
  let cleanLine = line.trim();
  
  let bulletMatch = cleanLine.match(/^([•\-\*\d+\.\s]*)(.*)$/);
  let prefix = bulletMatch ? bulletMatch[1] : "";
  let remainder = bulletMatch ? bulletMatch[2] : cleanLine;
  
  let checkMatch = remainder.match(/^\[([ xX])\]\s*(.*)$/);
  let newLine;
  if (checkMatch) {
    const isChecked = checkMatch[1].toLowerCase() === "x";
    const text = checkMatch[2];
    const newCheck = isChecked ? "[ ]" : "[x]";
    newLine = `${prefix}${newCheck} ${text}`;
  } else {
    newLine = `${prefix}[x] ${remainder}`;
  }
  
  lines[targetOriginalIndex] = newLine;
  const newNote = lines.join("\n");
  data[PLAN_KEY] = { category: "plan", note: newNote };
  const dateStr = ymd(current);
  pushBlocks(dateStr, [PLAN_KEY], data[PLAN_KEY]);
  
  const pi = document.getElementById("planInput");
  if (pi && activeObjectiveHorizon === "today" && document.activeElement !== pi) {
    pi.value = newNote;
  }
  
  renderPlanBanner();
}

// Carry an unchecked objective forward into the next day's plan.
function carryForward(text) {
  const next = new Date(current); next.setDate(next.getDate() + 1);
  const dateStr = ymd(next);
  const day = loadLocal(dateStr);
  const existing = (day[PLAN_KEY] && day[PLAN_KEY].note) || "";
  const clean = text.trim();
  if (!clean) return;
  if (existing.split(/\r?\n/).some((l) => l.replace(/^[•\-\*\d+\.\s]*(\[[ xX]\])?\s*/i, "").trim() === clean)) {
    setStatus("", "Already in tomorrow's plan");
    setTimeout(() => setStatus("", ""), 2000);
    return;
  }
  const newNote = existing ? existing + "\n• " + clean : "• " + clean;
  const block = { category: "plan", note: newNote };
  day[PLAN_KEY] = block;
  saveLocal(dateStr, day);
  syncSlots(dateStr, [PLAN_KEY], block);
  const pi = document.getElementById("planInput");
  if (activeObjectiveHorizon === "tomorrow" && pi && document.activeElement !== pi) pi.value = newNote;
  setStatus("ok", "Carried to tomorrow ✓");
  setTimeout(() => setStatus("", ""), 2000);
}

function render() {
  document.getElementById("dateMain").textContent = prettyDate(current);
  document.getElementById("dateSub").textContent =
    current.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
  renderDayPlansStrip();

  // Timeline
  const tl = document.getElementById("blockList");
  tl.innerHTML = "";
  let lastHour = -1;
  for (const slot of SLOTS) {
    const hour = parseInt(slot.slice(0, 2), 10);
    if (hour !== lastHour) {
      const hl = document.createElement("div");
      hl.className = "hour-label";
      hl.textContent = formatHour(hour);
      tl.appendChild(hl);
      lastHour = hour;
    }
    const b = data[slot];
    const row = document.createElement("div");
    row.className = "block-row";
    const el = document.createElement("div");
    el.className = "block " + (b ? "filled" : "empty") + (slot === rangeAnchor ? " anchor" : "");
    const c = b ? (CAT[b.category] || CAT.other) : null;
    const noteText = displayBlockNote(b);
    if (c) el.style.setProperty("--blk-color", c.color);
    el.innerHTML = `
      <div class="block-time">${to12(slot)}</div>
      <div class="block-body">
        <div class="block-cat">${b ? (c.label + (b.sub ? ` · ${escapeHtml(b.sub)}` : "")) : "—"}</div>
        ${noteText ? `<div class="block-note">${escapeHtml(noteText)}</div>` : ""}
      </div>`;
    el.dataset.slot = slot;
    attachPress(el, slot);
    const targetButton = document.createElement("button");
    targetButton.className = "block-target-btn";
    targetButton.type = "button";
    targetButton.dataset.targetSlot = slot;
    targetButton.textContent = targetExistsForSlot(slot) ? "Target set" : "Set target";
    targetButton.addEventListener("click", (event) => {
      event.stopPropagation();
      beginDiarySlotTarget(slot);
    });
    if (ymd(current) === ymd(new Date())) {
      const now = new Date();
      const nowSlot = String(now.getHours()).padStart(2, "0") + ":" + (now.getMinutes() < 30 ? "00" : "30");
      if (slot === nowSlot) {
        const line = document.createElement("div");
        line.className = "now-line";
        tl.appendChild(line);
        el.id = "nowBlock";
      }
    }
    row.appendChild(el);
    row.appendChild(targetButton);
    tl.appendChild(row);
  }

  // Reflection note (don't clobber while the user is typing)
  const ri = document.getElementById("reflectInput");
  if (document.activeElement !== ri) {
    ri.value = (data[REFLECT_KEY] && data[REFLECT_KEY].note) || "";
  }

  renderPlanBanner();
  renderObjectiveEditor();
  renderEventReminderBanner();
}

function renderDayPlansStrip() {
  const strip = document.getElementById("dayPlansStrip");
  const list = document.getElementById("dayPlansList");
  const plans = roughPlansForDay(data);
  const status = calendarDayStatus(data);
  const reminderTitles = new Set(eventRemindersForDay(data)
    .filter((item) => item.type === "rough")
    .map((item) => item.title.trim().toLowerCase()));
  strip.hidden = !status && plans.length === 0;
  if (strip.hidden) { list.innerHTML = ""; return; }
  const statusHtml = status
    ? `<div class="day-plan-item status"><span aria-hidden="true">${status.emoji}</span><span>${escapeHtml(status.label)}</span></div>`
    : "";
  const plansHtml = plans.map((plan) => `<div class="day-plan-item"><span aria-hidden="true">${reminderTitles.has(plan.trim().toLowerCase()) ? "🔔" : "•"}</span><span>${escapeHtml(plan)}</span></div>`).join("");
  list.innerHTML = statusHtml + plansHtml;
}

function formatHour(h) {
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}
function to12(slot) {
  let [h, m] = slot.split(":").map(Number);
  const ap = h < 12 ? "AM" : "PM";
  let hh = h % 12; if (hh === 0) hh = 12;
  return `${hh}:${String(m).padStart(2, "0")} ${ap}`;
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function parseGymWorkoutNote(note) {
  if (!note || !note.startsWith(GYM_NOTE_PREFIX)) return null;
  try {
    const obj = JSON.parse(note.slice(GYM_NOTE_PREFIX.length));
    return obj && Array.isArray(obj.exercises) ? obj : null;
  } catch {
    return null;
  }
}
function formatGymExercise(ex) {
  const volume = ex.sets && ex.reps ? `${ex.sets}x${ex.reps}` : "";
  const load = ex.kg != null && ex.kg !== "" ? ` @ ${ex.kg}kg` : "";
  return `${ex.exercise}${volume || load ? " " + volume + load : ""}`;
}
function gymWorkoutSummary(note) {
  const workout = parseGymWorkoutNote(note);
  if (!workout) return note || "";
  return workout.exercises.map(formatGymExercise).join("; ");
}
function displayBlockNote(block) {
  if (!block || !block.note) return "";
  return isGymBlock(block) ? gymWorkoutSummary(block.note) : block.note;
}

// ---- Press & hold + range selection (tap end, or drag to paint) ----
let suppressNextTap = false; // swallow the release right after a long-press fires
let dragging = false;        // true while sweeping a range after the hold fired
let dragEndSlot = null;      // last slot swept over during the drag

// Block page scrolling while painting a range on touch screens.
document.addEventListener("touchmove", (e) => {
  if (dragging) e.preventDefault();
}, { passive: false });

function slotFromPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  const block = el && el.closest && el.closest(".block[data-slot]");
  return block ? block.dataset.slot : null;
}

function previewRange(a, b) {
  const i = SLOTS.indexOf(a), j = SLOTS.indexOf(b);
  const [lo, hi] = i < j ? [i, j] : [j, i];
  const range = SLOTS.slice(lo, hi + 1);
  document.querySelectorAll(".block.selected").forEach((el) => el.classList.remove("selected"));
  for (const s of range) {
    const el = document.querySelector(`.block[data-slot="${s}"]`);
    if (el) el.classList.add("selected");
  }
  return range;
}

function attachPress(el, slot) {
  let timer = null, startY = 0;
  el.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".block-target-btn")) return;
    startY = e.clientY;
    timer = setTimeout(() => {
      timer = null;
      suppressNextTap = true; // the upcoming release is part of the hold, not a tap
      if (navigator.vibrate) navigator.vibrate(15);
      dragging = true;
      dragEndSlot = slot;
      try { el.setPointerCapture(e.pointerId); } catch {}
      startAnchor(slot, el);
    }, 400);
  });
  el.addEventListener("pointermove", (e) => {
    if (e.target.closest(".block-target-btn")) return;
    if (dragging && rangeAnchor) {
      const s = slotFromPoint(e.clientX, e.clientY);
      if (s && s !== dragEndSlot) {
        dragEndSlot = s;
        previewRange(rangeAnchor, s);
      }
      return;
    }
    if (Math.abs(e.clientY - startY) > 10) { clearTimeout(timer); timer = null; }
  });
  el.addEventListener("pointerup", (e) => {
    if (e.target.closest(".block-target-btn")) return;
    if (dragging) {
      dragging = false;
      suppressNextTap = false;
      // Swept onto other blocks → open the sheet for the painted range.
      if (dragEndSlot && dragEndSlot !== rangeAnchor) {
        const range = previewRange(rangeAnchor, dragEndSlot);
        rangeAnchor = null;
        openSheet(range);
      }
      // Released without moving → keep the anchor and wait for the end tap.
      return;
    }
    if (timer) { clearTimeout(timer); timer = null; handleTap(slot); return; }
    if (suppressNextTap) { suppressNextTap = false; return; }
    handleTap(slot);
  });
  el.addEventListener("pointercancel", (e) => {
    if (e.target.closest(".block-target-btn")) return;
    clearTimeout(timer); timer = null; dragging = false;
  });
}

function startAnchor(slot, el) {
  rangeAnchor = slot;
  // Outline the block directly — re-rendering here would destroy the element
  // mid-press and break the follow-up tap.
  document.querySelectorAll(".block.anchor").forEach((b) => b.classList.remove("anchor"));
  if (el) el.classList.add("anchor");
  setStatus("", "Now tap the end block →");
}

function handleTap(slot) {
  suppressNextTap = false;
  if (rangeAnchor && rangeAnchor !== slot) {
    const a = SLOTS.indexOf(rangeAnchor), b = SLOTS.indexOf(slot);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const range = SLOTS.slice(lo, hi + 1);
    rangeAnchor = null;
    render();
    openSheet(range);
  } else if (rangeAnchor === slot) {
    // Tapping the anchored block again cancels the selection.
    rangeAnchor = null;
    render();
  } else {
    openSheet([slot]);
  }
}

function highlightSlots(slotList) {
  document.querySelectorAll(".block.selected").forEach((b) => b.classList.remove("selected"));
  if (!slotList) return;
  for (const s of slotList) {
    const el = document.querySelector(`.block[data-slot="${s}"]`);
    if (el) el.classList.add("selected");
  }
  // Bring the start of the selection into view above the sheet.
  const first = document.querySelector(`.block[data-slot="${slotList[0]}"]`);
  if (first) first.scrollIntoView({ block: "start", behavior: "smooth" });
}

// ---- Edit sheet ----
function openSheet(slotList, preferredCat) {
  plannerSlotMode = false;
  eventMode = false;
  document.getElementById("eventTimePresets").hidden = true;
  document.getElementById("eventTimePicker").hidden = true;
  document.getElementById("eventReminderField").hidden = true;
  document.getElementById("activityPickerLabel").textContent = "What did you do?";
  document.getElementById("activitySearch").placeholder = "Search or add an activity…";
  editing = slotList;
  highlightSlots(slotList);
  const first = slotList[0], last = slotList[slotList.length - 1];
  const existing = data[first];
  const existingCategory = existing && CAT[existing.category];
  const legacyActivity = existingCategory && existingCategory.id.startsWith("c_") && !existing.sub
    ? existingCategory.label
    : null;
  const existingGym = isGymBlock(existing);
  selectedCat = existingGym ? "gym" : (legacyActivity ? "other" : (existing ? existing.category : (preferredCat || null)));
  selectedSub = existingGym ? null : (existing ? (existing.sub || legacyActivity || null) : null);
  selectedActivityLabel = existing
    ? (existingGym ? "Gym" : (existing.sub || legacyActivity || displayBlockNote(existing) || ((CAT[existing.category] || CAT.other).label)))
    : (preferredCat && CAT[preferredCat] ? CAT[preferredCat].label : null);
  const endSlot = SLOTS[(SLOTS.indexOf(last) + 1) % 48] || "00:00";
  const hrs = slotList.length / 2;
  document.getElementById("sheetTime").textContent = slotList.length > 1
    ? `${to12(first)} – ${to12(endSlot)} · ${hrs % 1 ? hrs.toFixed(1) : hrs}h`
    : `${to12(first)} – ${to12(endSlot)}`;
  document.getElementById("activitySearch").value = selectedActivityLabel || "";
  renderCatGrid();
  renderSubRow();
  renderNoteSuggest();
  updateNotePlaceholder();
  document.getElementById("noteInput").value = existing ? (isGymBlock(existing) ? "" : (existing.note || "")) : "";
  renderGymInline(existing);
  document.getElementById("sheetBackdrop").hidden = false;
}

function eventTimeLabel(value) {
  return value === "24:00" ? "12:00 AM" : to12(value);
}

function fillEventTimeOptions() {
  const start = document.getElementById("eventStart");
  const end = document.getElementById("eventEnd");
  if (start.options.length) return;
  for (const slot of SLOTS) start.add(new Option(eventTimeLabel(slot), slot));
  for (const slot of SLOTS.slice(1).concat("24:00")) {
    end.add(new Option(slot === "24:00" ? "12:00 AM (next day)" : eventTimeLabel(slot), slot));
  }
}

function updateEventRange() {
  if (!eventMode) return;
  const startSelect = document.getElementById("eventStart");
  const endSelect = document.getElementById("eventEnd");
  const startIndex = SLOTS.indexOf(startSelect.value);
  let endIndex = endSelect.value === "24:00" ? SLOTS.length : SLOTS.indexOf(endSelect.value);
  if (endIndex <= startIndex) {
    endIndex = Math.min(startIndex + 1, SLOTS.length);
    endSelect.value = endIndex === SLOTS.length ? "24:00" : SLOTS[endIndex];
  }
  if (activeEventPreset === "custom") {
    customEventStart = startSelect.value;
    customEventEnd = endSelect.value;
  }
  editing = SLOTS.slice(startIndex, endIndex);
  const hours = editing.length / 2;
  const presetNames = { all: "All day", morning: "Morning", afternoon: "Afternoon", evening: "Evening" };
  const duration = presetNames[activeEventPreset] || `${hours % 1 ? hours.toFixed(1) : hours}h`;
  document.getElementById("sheetTime").textContent = `Plan event · ${duration}`;
  highlightSlots(editing);
}

function selectEventPreset(preset) {
  const ranges = {
    all: ["00:00", "24:00"],
    morning: ["09:00", "12:00"],
    afternoon: ["12:00", "17:00"],
    evening: ["18:00", "23:00"],
  };
  if (!ranges[preset] && preset !== "custom") return;
  activeEventPreset = preset;
  document.querySelectorAll("[data-event-preset]").forEach((button) => {
    button.classList.toggle("active", button.dataset.eventPreset === preset);
  });
  const picker = document.getElementById("eventTimePicker");
  picker.hidden = preset !== "custom";
  const range = preset === "custom" ? [customEventStart, customEventEnd] : ranges[preset];
  document.getElementById("eventStart").value = range[0];
  document.getElementById("eventEnd").value = range[1];
  updateEventRange();
}

function openEventSheet() {
  closeSheet();
  eventMode = true;
  fillEventTimeOptions();
  const isToday = ymd(current) === ymd(new Date());
  const now = new Date();
  const defaultStart = isToday
    ? String(now.getHours()).padStart(2, "0") + ":" + (now.getMinutes() < 30 ? "00" : "30")
    : "09:00";
  const startIndex = Math.max(0, SLOTS.indexOf(defaultStart));
  const endIndex = Math.min(startIndex + 2, SLOTS.length);
  customEventStart = SLOTS[startIndex];
  customEventEnd = endIndex === SLOTS.length ? "24:00" : SLOTS[endIndex];
  document.getElementById("eventTimePresets").hidden = false;
  document.getElementById("eventReminderField").hidden = false;
  document.getElementById("eventReminderLead").value = "60";
  document.getElementById("activityPickerLabel").textContent = "What is happening?";
  document.getElementById("activitySearch").placeholder = "e.g. Birthday celebration";
  document.getElementById("activitySearch").value = "";
  document.getElementById("noteInput").value = "";
  selectedCat = "social";
  selectedSub = null;
  selectedActivityLabel = null;
  renderCatGrid();
  renderSubRow();
  document.getElementById("areaPicker").hidden = true;
  renderNoteSuggest();
  updateNotePlaceholder();
  renderGymInline(null);
  selectEventPreset("all");
  document.getElementById("sheetBackdrop").hidden = false;
  setTimeout(() => document.getElementById("activitySearch").focus(), 80);
}

// Activity-first picker. Broad categories remain the stable reporting layer,
// while subcategories and recent notes are presented as the things people
// actually recognise and want to log.
function recentActivityOptions(limit) {
  const dateKeys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("day_data_")) dateKeys.push(k);
  }
  dateKeys.sort().reverse();

  const out = [], seen = new Set();
  for (const k of dateKeys) {
    let day;
    try { day = JSON.parse(localStorage.getItem(k)) || {}; } catch { continue; }
    for (let i = SLOTS.length - 1; i >= 0; i--) {
      const b = day[SLOTS[i]];
      if (!b || isGymBlock(b) && parseGymWorkoutNote(b.note)) continue;
      const category = CAT[b.category] || CAT.other;
      const legacyActivity = category.id.startsWith("c_") && !b.sub ? category.label : "";
      const note = (b.note || "").trim();
      const historicalGym = isGymBlock(b);
      const label = (historicalGym ? "Gym" : (b.sub || legacyActivity || note || category.label)).trim();
      const key = label.toLowerCase();
      if (!label || seen.has(key)) continue;
      seen.add(key);
      out.push({
        label,
        catId: historicalGym ? "gym" : (activityAreas[key] || (legacyActivity ? "other" : b.category)),
        sub: historicalGym ? "" : (b.sub || legacyActivity),
        // A note-only activity is reusable by putting the same task back into
        // the note field. Named activities start with a clean optional note.
        note: b.sub ? "" : note,
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

function activityOptions() {
  const out = [], seen = new Set();
  const add = (item) => {
    if (isGymActivityLabel(item.label)) item = { ...item, label: "Gym", catId: "gym", sub: "", note: "" };
    const key = normalizeActivityLabel(item.label);
    if (!key || seen.has(key)) return;
    if (activityAreas[key] && !isGymActivityLabel(item.label)) item = { ...item, catId: activityAreas[key] };
    seen.add(key);
    out.push(item);
  };

  // Keep the activity currently being edited visible, even before it has
  // been saved to the remembered activity list.
  if (selectedSub) add({ label: selectedSub, catId: selectedCat || "other", sub: selectedSub, note: "" });
  recentActivityOptions(10).forEach(add);
  for (const [catId, labels] of Object.entries(customSubs)) {
    for (const label of labels) add({ label, catId, sub: label, note: "" });
  }
  // Existing custom categories were effectively activities. Surface them as
  // activities without rewriting historical records.
  for (const c of customCats) {
    const builtin = BUILTIN_CATEGORIES.find((item) => item.label.toLowerCase() === c.label.toLowerCase());
    add(builtin
      ? { label: builtin.label, catId: builtin.id, sub: "", note: "" }
      : { label: c.label, catId: "other", sub: c.label, note: "", legacyCat: c });
  }
  ["sleep", "gym", "food", "travel"].forEach((id) => {
    const c = CAT[id];
    if (c) add({ label: c.label, catId: id, sub: "", note: "" });
  });
  return out;
}

function openGymTimeBlock() {
  const now = new Date();
  const slot = String(now.getHours()).padStart(2, "0") + ":" + (now.getMinutes() < 30 ? "00" : "30");
  openSheet([slot], "gym");
}

function renderSubRow() {
  const row = document.getElementById("subRow");
  document.getElementById("areaPicker").hidden = !selectedActivityLabel;
  row.hidden = false;
  row.innerHTML = "";
  for (const c of BUILTIN_CATEGORIES) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "sub-chip area-chip" + (selectedCat === c.id ? " selected" : "");
    chip.innerHTML = `<span class="cdot" style="background:${c.color}"></span>${c.label}`;
    chip.addEventListener("click", () => {
      selectedCat = c.id;
      renderSubRow();
      renderCatGrid();
      renderNoteSuggest();
      updateNotePlaceholder();
      renderGymInline(null);
    });
    row.appendChild(chip);
  }
}

function updateNotePlaceholder() {
  const input = document.getElementById("noteInput");
  if (!input) return;
  input.placeholder = isGymCategoryId(selectedCat)
    ? "Optional note"
    : (plannerSlotMode ? "Target for this block (optional)" : "What are you doing? (optional)");
  input.classList.toggle("gym-note-hidden", isGymCategoryId(selectedCat));
}

function renderGymExerciseOptions() {
  const list = document.getElementById("gymExerciseOptions");
  list.innerHTML = "";
  for (const name of gymExercises) {
    const opt = document.createElement("option");
    opt.value = name;
    list.appendChild(opt);
  }
}

function addGymInlineRow(ex) {
  const rows = document.getElementById("gymExerciseRows");
  const row = document.createElement("div");
  row.className = "gym-inline-row";
  row.innerHTML = `
    <input class="gym-input gym-exercise-name" list="gymExerciseOptions" type="text" placeholder="Exercise" value="${ex ? escapeHtml(ex.exercise || "") : ""}">
    <input class="gym-input gym-num gym-sets" type="number" min="1" placeholder="Sets" value="${ex && ex.sets ? ex.sets : ""}">
    <input class="gym-input gym-num gym-reps" type="number" min="1" placeholder="Reps" value="${ex && ex.reps ? ex.reps : ""}">
    <input class="gym-input gym-num gym-kg" type="number" min="0" step="0.5" placeholder="kg" value="${ex && ex.kg != null ? ex.kg : ""}">
    <button class="gym-remove-btn" type="button" aria-label="Remove exercise" title="Remove">×</button>
  `;
  row.querySelector(".gym-remove-btn").addEventListener("click", () => row.remove());
  rows.appendChild(row);
}

function renderGymInline(existing) {
  const panel = document.getElementById("gymInlinePanel");
  const rows = document.getElementById("gymExerciseRows");
  const isGym = isGymCategoryId(selectedCat);
  panel.hidden = !isGym;
  rows.innerHTML = "";
  if (!isGym) return;

  renderGymExerciseOptions();
  const parsed = existing && isGymBlock(existing) ? parseGymWorkoutNote(existing.note || "") : null;
  const exercises = parsed && parsed.exercises.length ? parsed.exercises : [];
  exercises.forEach(addGymInlineRow);
}

function collectGymInlineWorkout() {
  const exercises = [];
  document.querySelectorAll(".gym-inline-row").forEach((row) => {
    const exercise = row.querySelector(".gym-exercise-name").value.trim();
    const sets = parseInt(row.querySelector(".gym-sets").value, 10);
    const reps = parseInt(row.querySelector(".gym-reps").value, 10);
    const kgVal = row.querySelector(".gym-kg").value.trim();
    if (!exercise) return;
    const ex = { exercise };
    if (!isNaN(sets)) ex.sets = sets;
    if (!isNaN(reps)) ex.reps = reps;
    if (kgVal !== "") ex.kg = parseFloat(kgVal);
    exercises.push(ex);
  });
  return { exercises };
}

function firstInvalidGymInlineInput() {
  const rows = Array.from(document.querySelectorAll(".gym-inline-row"));
  for (const row of rows) {
    const name = row.querySelector(".gym-exercise-name").value.trim();
    const sets = row.querySelector(".gym-sets").value.trim();
    const reps = row.querySelector(".gym-reps").value.trim();
    const kg = row.querySelector(".gym-kg").value.trim();
    const hasData = sets !== "" || reps !== "" || kg !== "";
    if (hasData && !name) {
      return row.querySelector(".gym-exercise-name");
    }
  }
  return null;
}

// Recent distinct notes previously typed in this category (most recent first).
function recentNotesFor(catId, limit) {
  const dateKeys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("day_data_")) dateKeys.push(k);
  }
  dateKeys.sort().reverse(); // newest dates first
  const seen = new Set(), out = [];
  for (const k of dateKeys) {
    let day; try { day = JSON.parse(localStorage.getItem(k)); } catch { continue; }
    for (const s of SLOTS) {
      const b = day[s];
      if (b && b.category === catId && b.note) {
        const n = b.note.trim();
        if (n && !seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); out.push(n); }
      }
    }
    if (out.length >= (limit || 6)) break;
  }
  return out.slice(0, limit || 6);
}

function renderNoteSuggest() {
  const row = document.getElementById("noteSuggest");
  row.innerHTML = "";
  if (!selectedCat || isGymCategoryId(selectedCat)) { row.hidden = true; return; }
  const notes = recentNotesFor(selectedCat, 6);
  if (!notes.length) { row.hidden = true; return; }
  row.hidden = false;
  for (const n of notes) {
    const chip = document.createElement("button");
    chip.className = "sub-chip note-suggest";
    chip.textContent = n.length > 28 ? n.slice(0, 27) + "…" : n;
    chip.title = n;
    chip.addEventListener("click", () => { document.getElementById("noteInput").value = n; });
    row.appendChild(chip);
  }
}

function removeSub(catId, label) {
  if (!window.confirm(`Remove "${label}" from ${(CAT[catId] || {}).label || "this category"}?`)) return;
  customSubs[catId] = (customSubs[catId] || []).filter((s) => s !== label);
  if (selectedSub === label) selectedSub = null;
  saveSettings();
  renderSubRow();
}

function selectActivity(activity) {
  const existing = editing && data[editing[0]];
  const preserveGymWorkout = existing && isGymBlock(existing) && isGymCategoryId(activity.catId);
  selectedCat = activity.catId;
  selectedSub = activity.sub || null;
  selectedActivityLabel = activity.label;
  document.getElementById("activitySearch").value = activity.label;
  document.getElementById("noteInput").value = activity.note || "";
  renderCatGrid();
  renderSubRow();
  renderNoteSuggest();
  updateNotePlaceholder();
  renderGymInline(preserveGymWorkout ? existing : null);
}

function createActivityFromSearch() {
  const input = document.getElementById("activitySearch");
  const label = input.value.trim();
  if (!label) { input.focus(); return; }
  const exact = activityOptions().find((a) => a.label.toLowerCase() === label.toLowerCase());
  if (exact) { selectActivity(exact); return; }
  selectedCat = (selectedCat && BUILTIN_CATEGORIES.some((c) => c.id === selectedCat)) ? selectedCat : "other";
  selectedSub = label;
  selectedActivityLabel = label;
  document.getElementById("noteInput").value = "";
  renderCatGrid();
  renderSubRow();
  renderNoteSuggest();
  updateNotePlaceholder();
  renderGymInline(null);
}

function renderCatGrid() {
  const grid = document.getElementById("catGrid");
  grid.innerHTML = "";
  const query = document.getElementById("activitySearch").value.trim().toLowerCase();
  const all = activityOptions();
  const matches = query
    ? all.filter((a) => a.label.toLowerCase().startsWith(query))
      .concat(all.filter((a) => !a.label.toLowerCase().startsWith(query) && a.label.toLowerCase().includes(query)))
      .slice(0, 9)
    : all.slice(0, 6);

  for (const activity of matches) {
    const c = CAT[activity.catId] || CAT.other;
    const btn = document.createElement("button");
    const selected = selectedActivityLabel &&
      selectedActivityLabel.toLowerCase() === activity.label.toLowerCase();
    btn.className = "cat-btn activity-btn" + (selected ? " selected" : "");
    btn.style.setProperty("--cat-color", c.color);
    btn.innerHTML = `<span class="cdot" style="background:${c.color}"></span><span class="activity-copy"><span>${escapeHtml(activity.label)}</span><small>${escapeHtml(c.label)}</small></span>`;
    btn.addEventListener("click", () => selectActivity(activity));
    if (activity.legacyCat) {
      // Long-press (or right-click) a custom category to rename/delete it.
      let t = null;
      btn.addEventListener("pointerdown", () => { t = setTimeout(() => { t = null; manageCategory(activity.legacyCat); }, 500); });
      btn.addEventListener("pointerup", () => { if (t) { clearTimeout(t); t = null; } });
      btn.addEventListener("pointerleave", () => { if (t) { clearTimeout(t); t = null; } });
      btn.addEventListener("contextmenu", (e) => { e.preventDefault(); manageCategory(activity.legacyCat); });
    }
    grid.appendChild(btn);
  }

  const exactMatch = query && all.some((a) => a.label.toLowerCase() === query);
  if (query && !exactMatch) {
    const add = document.createElement("button");
    add.className = "cat-btn cat-add activity-create";
    add.innerHTML = `<span class="cdot" style="border:1.5px dashed currentColor;background:none"></span>Create “${escapeHtml(document.getElementById("activitySearch").value.trim())}”`;
    add.addEventListener("click", createActivityFromSearch);
    grid.appendChild(add);
  }
}
function saveReflection() {
  const note = document.getElementById("reflectInput").value.trim();
  const dateStr = ymd(current);
  const cur = (data[REFLECT_KEY] && data[REFLECT_KEY].note) || "";
  if (note === cur) return; // nothing changed
  if (note) data[REFLECT_KEY] = { category: "reflection", note };
  else delete data[REFLECT_KEY];
  pushBlocks(dateStr, [REFLECT_KEY], note ? { category: "reflection", note } : null);
}

// Sync specific slots for an arbitrary date (used by the plan box).
async function syncSlots(dateStr, slotList, block) {
  if (!sb) return;
  try {
    if (block) {
      const rows = slotList.map((s) => ({
        user_id: USER_ID, date: dateStr, start_time: s,
        category: block.category, note: block.note || "",
        updated_at: new Date().toISOString(),
      }));
      await sb.from("blocks").upsert(rows, { onConflict: "user_id,date,start_time" });
    } else {
      await sb.from("blocks").delete()
        .eq("user_id", USER_ID).eq("date", dateStr).in("start_time", slotList);
    }
  } catch (e) { console.warn(e); }
}

function saveTodayPlan() {
  const input = document.getElementById("planInput");
  if (!input) return;
  const note = input.value.trim();
  const dateStr = ymd(current);
  const cur = (data[PLAN_KEY] && data[PLAN_KEY].note) || "";
  if (note === cur) return;
  const block = note ? { category: "plan", note } : null;
  if (note) data[PLAN_KEY] = block; else delete data[PLAN_KEY];
  saveLocal(dateStr, data);
  syncSlots(dateStr, [PLAN_KEY], block);
  renderPlanBanner();
}

function saveTomorrowPlan() {
  const input = document.getElementById("planInput");
  if (!input) return;
  const note = input.value.trim();
  const next = new Date(current); next.setDate(next.getDate() + 1);
  const dateStr = ymd(next);
  const day = loadLocal(dateStr);
  const cur = (day[PLAN_KEY] && day[PLAN_KEY].note) || "";
  if (note === cur) return;
  const block = note ? { category: "plan", note } : null;
  if (note) day[PLAN_KEY] = block; else delete day[PLAN_KEY];
  saveLocal(dateStr, day);
  syncSlots(dateStr, [PLAN_KEY], block);
  if (dateStr === ymd(current)) {
    if (note) data[PLAN_KEY] = block; else delete data[PLAN_KEY];
    renderPlanBanner();
  }
}

const OBJECTIVE_HORIZONS = {
  today: {
    hint: "Focus items for this diary day · synced live",
    placeholder: "What are your main focus items for today?",
  },
  tomorrow: {
    hint: "Daily actions · planned for tomorrow",
    placeholder: "What do you want tomorrow to look like?",
  },
  short: {
    hint: "Outcomes for the next 1–4 weeks",
    placeholder: "What should move forward over the next few weeks?",
  },
  long: {
    hint: "Direction for the next few months",
    placeholder: "What longer-term direction matters to you?",
  },
};

function currentObjectiveEditorValue() {
  if (activeObjectiveHorizon === "short") return shortTermObjectives;
  if (activeObjectiveHorizon === "long") return longTermObjectives;
  if (activeObjectiveHorizon === "today") {
    return (data[PLAN_KEY] && data[PLAN_KEY].note) || "";
  }
  if (activeObjectiveHorizon === "tomorrow") {
    const next = new Date(current); next.setDate(next.getDate() + 1);
    const nextDay = loadLocal(ymd(next));
    return (nextDay[PLAN_KEY] && nextDay[PLAN_KEY].note) || "";
  }
  return "";
}

function objectiveItemsForHorizon(horizon = activeObjectiveHorizon) {
  if (horizon === "short") return shortTermObjectives.split(/\r?\n/).map(parseObjectiveLine).filter((item) => item.text);
  if (horizon === "long") return longTermObjectives.split(/\r?\n/).map(parseObjectiveLine).filter((item) => item.text);
  if (horizon === "tomorrow") {
    const next = new Date(current); next.setDate(next.getDate() + 1);
    return plannerItemsForDay(loadLocal(ymd(next)));
  }
  return plannerItemsForDay(data);
}

function serializeObjectiveItem(item) {
  const metadata = item.linkId
    ? ` <!--day-link:${item.linkId}:${item.originDate || ""}:${item.transferredTo || ""}-->`
    : "";
  return `${item.completed ? "[x]" : "[ ]"} ${item.text.trim()}${metadata}`;
}

function serializeObjectiveItems(items) {
  return items.map(serializeObjectiveItem).join("\n");
}

function objectiveDateForHorizon(horizon = activeObjectiveHorizon) {
  const targetDate = new Date(current);
  if (horizon === "tomorrow") targetDate.setDate(targetDate.getDate() + 1);
  return ymd(targetDate);
}

function saveObjectiveItemsForHorizon(items, horizon = activeObjectiveHorizon) {
  if (horizon === "short" || horizon === "long") {
    const note = serializeObjectiveItems(items);
    if (horizon === "short") shortTermObjectives = note;
    else longTermObjectives = note;
    saveSettings();
    renderObjectiveEditor();
    return;
  }
  const targetDate = new Date(current);
  if (horizon === "tomorrow") targetDate.setDate(targetDate.getDate() + 1);
  savePlannerItems(ymd(targetDate), items);
}

function slotTargetPrefix(slot) {
  return `${to12(slot)} · `;
}

function targetExistsForSlot(slot) {
  const prefix = slotTargetPrefix(slot).toLowerCase();
  return plannerItemsForDay(data).some((item) => item.text.toLowerCase().startsWith(prefix));
}

function splitTimedTarget(text) {
  const match = text.match(/^(\d{1,2}:\d{2} [AP]M) · (.+)$/);
  return match ? { time: match[1], text: match[2] } : { time: "", text };
}

function beginDiarySlotTarget(slot) {
  activeObjectiveHorizon = "today";
  diaryTargetSlot = slot;
  const items = objectiveItemsForHorizon("today");
  const prefix = slotTargetPrefix(slot).toLowerCase();
  diaryTargetEditingIndex = items.findIndex((item) => item.text.toLowerCase().startsWith(prefix));
  renderObjectiveEditor();
  const input = document.getElementById("diaryTargetInput");
  if (diaryTargetEditingIndex >= 0) {
    input.value = splitTimedTarget(items[diaryTargetEditingIndex].text).text;
    input.select();
  } else {
    const block = data[slot];
    input.value = block ? (block.sub || displayBlockNote(block) || (CAT[block.category] || CAT.other).label) : "";
    input.focus();
    if (input.value) input.select();
  }
  document.querySelector(".diary-target-card")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function renderDiaryTargets() {
  const list = document.getElementById("diaryTargetList");
  if (!list) return;
  const meta = OBJECTIVE_HORIZONS[activeObjectiveHorizon] || OBJECTIVE_HORIZONS.today;
  const items = objectiveItemsForHorizon();
  const completed = items.filter((item) => item.completed).length;
  const score = items.length ? Math.round((completed / items.length) * 100) : 0;
  diaryTargetSelected = items.length ? Math.max(-1, Math.min(diaryTargetSelected, items.length - 1)) : -1;

  document.querySelectorAll("[data-objective-horizon]").forEach((button) => {
    button.classList.toggle("active", button.dataset.objectiveHorizon === activeObjectiveHorizon);
  });
  document.getElementById("objectiveHint").textContent = meta.hint;
  document.getElementById("diaryTargetScore").textContent = items.length ? `${score}%` : "—";
  document.getElementById("diaryTargetScoreLabel").textContent = items.length
    ? `${completed} of ${items.length} completed`
    : "No targets set";
  document.getElementById("diaryTargetProgress").style.width = `${score}%`;

  list.innerHTML = items.length ? items.map((item, index) => {
    const parts = splitTimedTarget(item.text);
    const move = activeObjectiveHorizon === "today" && !item.completed && !item.transferredTo
      ? `<button class="diary-target-move" type="button" data-diary-target-move="${index}" aria-label="Move to tomorrow" title="Move to tomorrow">→</button>`
      : "";
    return `<div class="diary-target-item${item.completed ? " completed" : ""}${index === diaryTargetSelected ? " selected" : ""}" data-diary-target-index="${index}" tabindex="${index === diaryTargetSelected ? "0" : "-1"}">
      <button class="diary-target-toggle" type="button" data-diary-target-toggle="${index}" aria-label="${item.completed ? "Mark incomplete" : "Mark complete"}">${item.completed ? "✓" : ""}</button>
      <span class="diary-target-copy">${parts.time ? `<span class="diary-target-time">${escapeHtml(parts.time)}</span>` : ""}<span>${escapeHtml(parts.text)}</span></span>
      ${move}
      <button class="diary-target-remove" type="button" data-diary-target-remove="${index}" aria-label="Remove target">×</button>
    </div>`;
  }).join("") : `<div class="diary-target-empty">Add only the few outcomes that would make this period worthwhile.</div>`;

  const input = document.getElementById("diaryTargetInput");
  const addButton = document.getElementById("diaryTargetAdd");
  const context = document.getElementById("diaryTargetContext");
  input.placeholder = diaryTargetSlot ? `Target for ${to12(diaryTargetSlot)}…` : meta.placeholder;
  addButton.textContent = diaryTargetEditingIndex >= 0 ? "Save" : "Add";
  context.hidden = !diaryTargetSlot;
  context.innerHTML = diaryTargetSlot
    ? `<span>Linked to ${to12(diaryTargetSlot)}</span><button type="button" id="clearDiaryTargetContext">×</button>`
    : "";
  document.getElementById("clearDiaryTargetContext")?.addEventListener("click", () => {
    diaryTargetSlot = null;
    diaryTargetEditingIndex = -1;
    input.value = "";
    renderDiaryTargets();
    input.focus();
  });
}

function addDiaryTarget() {
  const input = document.getElementById("diaryTargetInput");
  const text = input.value.trim();
  if (!text) return;
  const items = objectiveItemsForHorizon();
  const storedText = diaryTargetSlot ? `${slotTargetPrefix(diaryTargetSlot)}${text}` : text;
  if (diaryTargetEditingIndex >= 0 && items[diaryTargetEditingIndex]) {
    items[diaryTargetEditingIndex].text = storedText;
  } else {
    items.push({ text: storedText, completed: false });
  }
  diaryTargetSlot = null;
  diaryTargetEditingIndex = -1;
  input.value = "";
  saveObjectiveItemsForHorizon(items);
  render();
  input.focus();
}

function updateDiaryTarget(index, action) {
  const items = objectiveItemsForHorizon();
  if (!items[index]) return;
  let linkedCompletion = null;
  if (action === "toggle") {
    items[index].completed = !items[index].completed;
    if (items[index].linkId && (activeObjectiveHorizon === "today" || activeObjectiveHorizon === "tomorrow")) {
      linkedCompletion = { item: { ...items[index] }, sourceDate: objectiveDateForHorizon() };
    }
  }
  else if (action === "remove") items.splice(index, 1);
  saveObjectiveItemsForHorizon(items);
  if (linkedCompletion) syncLinkedObjectiveCompletion(linkedCompletion.item, linkedCompletion.sourceDate);
  render();
}

function linkedObjectiveDates(item, sourceDate) {
  const dates = new Set([sourceDate]);
  if (item.originDate) dates.add(item.originDate);
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key?.startsWith("day_data_")) dates.add(key.slice("day_data_".length));
  }
  return [...dates];
}

function syncLinkedObjectiveCompletion(item, sourceDate) {
  if (!item.linkId) return;
  for (const dateStr of linkedObjectiveDates(item, sourceDate)) {
    if (dateStr === sourceDate) continue;
    const linkedItems = plannerItemsForDay(loadLocal(dateStr));
    let changed = false;
    for (const candidate of linkedItems) {
      if (candidate.linkId === item.linkId && candidate.completed !== item.completed) {
        candidate.completed = item.completed;
        changed = true;
      }
    }
    if (changed) savePlannerItems(dateStr, linkedItems);
  }
}

function focusDiaryTargetSelected() {
  if (diaryTargetSelected < 0) return;
  const row = document.querySelector(`.diary-target-item[data-diary-target-index="${diaryTargetSelected}"]`);
  row?.focus({ preventScroll: true });
  row?.scrollIntoView({ block: "nearest" });
}

function handleDiaryTargetKeyboard(event) {
  const app = document.getElementById("app");
  if (app.hidden || event.defaultPrevented || !document.getElementById("helpDialog").hidden) return;
  const overlayOpen = ["sheetBackdrop", "statsScreen", "plannerScreen", "calendarScreen", "insightScreen"]
    .some((id) => !document.getElementById(id).hidden);
  if (overlayOpen || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target instanceof Element ? event.target : document.body;
  const isTyping = target.matches("input, textarea, select") || target.isContentEditable;
  if (isTyping) {
    if (event.key === "Escape" && target.id === "diaryTargetInput") {
      event.preventDefault();
      target.value = "";
      diaryTargetSlot = null;
      diaryTargetEditingIndex = -1;
      renderDiaryTargets();
      target.blur();
    }
    return;
  }
  const items = objectiveItemsForHorizon();
  if (event.key.toLowerCase() === "n") {
    event.preventDefault();
    document.getElementById("diaryTargetInput").focus();
    return;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    if (!items.length) return;
    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    diaryTargetSelected = diaryTargetSelected < 0
      ? (direction > 0 ? 0 : items.length - 1)
      : (diaryTargetSelected + direction + items.length) % items.length;
    renderDiaryTargets();
    focusDiaryTargetSelected();
    return;
  }
  if (diaryTargetSelected < 0 || !items[diaryTargetSelected]) return;
  if (event.key === " ") {
    event.preventDefault();
    updateDiaryTarget(diaryTargetSelected, "toggle");
    focusDiaryTargetSelected();
  } else if (event.key === "ArrowRight" && activeObjectiveHorizon === "today") {
    event.preventDefault();
    moveDiaryTargetToTomorrow(diaryTargetSelected);
    focusDiaryTargetSelected();
  } else if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    updateDiaryTarget(diaryTargetSelected, "remove");
    focusDiaryTargetSelected();
  }
}

function moveDiaryTargetToTomorrow(index) {
  if (activeObjectiveHorizon !== "today") return;
  const items = objectiveItemsForHorizon("today");
  const item = items[index];
  if (!item) return;
  const sourceDateStr = ymd(current);
  const nextDate = new Date(current);
  nextDate.setDate(nextDate.getDate() + 1);
  const nextDateStr = ymd(nextDate);
  const linkId = item.linkId || `${sourceDateStr}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const originDate = item.originDate || sourceDateStr;
  const tomorrowItems = objectiveItemsForHorizon("tomorrow");
  const existingIndex = tomorrowItems.findIndex((candidate) =>
    candidate.linkId === linkId
    || candidate.text.trim().toLowerCase() === item.text.trim().toLowerCase());
  const futureItem = { text: item.text, completed: item.completed, linkId, originDate, transferredTo: "" };
  if (existingIndex >= 0) {
    tomorrowItems[existingIndex] = { ...tomorrowItems[existingIndex], ...futureItem };
  } else {
    tomorrowItems.push(futureItem);
  }
  items[index] = { ...item, linkId, originDate, transferredTo: nextDateStr };
  saveObjectiveItemsForHorizon(tomorrowItems, "tomorrow");
  saveObjectiveItemsForHorizon(items, "today");
  setStatus("ok", "Linked to tomorrow ✓");
  render();
}

function renderObjectiveEditor() {
  renderDiaryTargets();
}

function saveObjectiveInput() {
  const input = document.getElementById("planInput");
  if (!input) return;
  const note = input.value.trim();
  if (activeObjectiveHorizon === "today") {
    saveTodayPlan();
    return;
  }
  if (activeObjectiveHorizon === "tomorrow") {
    saveTomorrowPlan();
    return;
  }
  if (activeObjectiveHorizon === "short") {
    if (note === shortTermObjectives) return;
    shortTermObjectives = note;
    saveSettings();
  } else if (activeObjectiveHorizon === "long") {
    if (note === longTermObjectives) return;
    longTermObjectives = note;
    saveSettings();
  }
}

function selectObjectiveHorizon(horizon) {
  if (!OBJECTIVE_HORIZONS[horizon] || horizon === activeObjectiveHorizon) return;
  activeObjectiveHorizon = horizon;
  diaryTargetSlot = null;
  diaryTargetEditingIndex = -1;
  document.getElementById("diaryTargetInput").value = "";
  renderObjectiveEditor();
}

function closeSheet() {
  document.getElementById("sheetBackdrop").hidden = true;
  document.getElementById("eventTimePresets").hidden = true;
  document.getElementById("eventTimePicker").hidden = true;
  document.getElementById("eventReminderField").hidden = true;
  eventMode = false;
  plannerSlotMode = false;
  editing = null; selectedCat = null; selectedSub = null; selectedActivityLabel = null;
  highlightSlots(null);
}
function saveSheet() {
  if (!editing) return;
  let note = document.getElementById("noteInput").value.trim();
  const dateStr = ymd(current);
  const savingEvent = eventMode;
  let eventTitle = "";
  if (savingEvent) {
    const eventName = document.getElementById("activitySearch").value.trim();
    if (!eventName) {
      setStatus("err", "Add an event name");
      document.getElementById("activitySearch").focus();
      return;
    }
    eventTitle = eventName;
    if (!selectedActivityLabel || selectedActivityLabel.toLowerCase() !== eventName.toLowerCase()) {
      createActivityFromSearch();
    }
    const conflicts = editing.filter((slot) => data[slot]).length;
    if (conflicts && !window.confirm(`This will replace ${conflicts} already logged half-hour block${conflicts === 1 ? "" : "s"}. Continue?`)) return;
  }
  if (!selectedCat) { closeSheet(); return; }
  const sub = selectedSub || "";
  if (isGymCategoryId(selectedCat)) {
    const invalid = firstInvalidGymInlineInput();
    if (invalid) {
      setStatus("err", "Add exercise name");
      invalid.focus();
      return;
    }
    const workout = collectGymInlineWorkout();
    workout.exercises.forEach((ex) => rememberGymExercise(ex.exercise));
    note = GYM_NOTE_PREFIX + JSON.stringify(workout);
  }
  if (sub) rememberSub(selectedCat, sub);
  rememberActivityArea(selectedActivityLabel || sub || (CAT[selectedCat] && CAT[selectedCat].label), selectedCat);
  const block = { category: selectedCat, note, sub };
  for (const s of editing) data[s] = { category: selectedCat, note, sub };
  if (savingEvent) saveEventReminder(dateStr, eventTitle, editing[0], document.getElementById("eventReminderLead").value);
  pushBlocks(dateStr, editing, block);
  render();
  if (!document.getElementById("plannerScreen").hidden) renderPlanner();
  closeSheet();
}
function clearSheet() {
  if (!editing) return;
  if (eventMode) {
    closeSheet();
    return;
  }
  const dateStr = ymd(current);
  const reminders = eventRemindersForDay(data).filter((item) => item.type === "rough" || !editing.includes(item.start));
  const reminderBlock = eventReminderBlock(reminders);
  if (reminderBlock) data[EVENT_REMINDER_KEY] = reminderBlock;
  else delete data[EVENT_REMINDER_KEY];
  for (const s of editing) delete data[s];
  pushBlocks(dateStr, editing, null);
  syncSlots(dateStr, [EVENT_REMINDER_KEY], reminderBlock);
  render();
  if (!document.getElementById("plannerScreen").hidden) renderPlanner();
  closeSheet();
}

// ---- Export (LLM-friendly JSON) ----
function exportData() {
  const all = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("day_data_")) {
      const date = k.replace("day_data_", "");
      const day = JSON.parse(localStorage.getItem(k));
      all[date] = {
        reflection: (day[REFLECT_KEY] && day[REFLECT_KEY].note) || "",
        objectives: (day[PLAN_KEY] && day[PLAN_KEY].note) || "",
        day_status: day[DAY_STATUS_KEY]
          ? { type: day[DAY_STATUS_KEY].sub || "", label: day[DAY_STATUS_KEY].note || "" }
          : null,
        rough_plans: roughPlansForDay(day),
        event_reminders: eventRemindersForDay(day),
        blocks: SLOTS.filter((s) => day[s]).map((s) => ({
          start_time: s,
          category: day[s].category,
          category_label: (CAT[day[s].category] || CAT.other).label,
          subcategory: day[s].sub || "",
          note: day[s].note || "",
        })),
      };
    }
  }
  const blob = new Blob([JSON.stringify({
    exported_at: new Date().toISOString(),
    user_id: USER_ID,
    targets: { short_term: shortTermObjectives, long_term: longTermObjectives },
    days: all,
  }, null, 2)],
    { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = RECOVERY_MODE ? `day-recovery-${ymd(new Date())}.json` : "day-export.json";
  a.click();
  URL.revokeObjectURL(url);
}

function recoveryRowsFromBackup(backup) {
  if (!backup || typeof backup !== "object" || !backup.days || typeof backup.days !== "object") {
    throw new Error("This is not a Day backup file.");
  }
  const rows = [];
  const restoredDays = [];
  for (const [dateStr, savedDay] of Object.entries(backup.days)) {
    if (dateStr === SETTINGS_DATE || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !savedDay || typeof savedDay !== "object") continue;
    const day = loadLocal(dateStr);
    const blocks = Array.isArray(savedDay.blocks) ? savedDay.blocks : [];
    for (const saved of blocks) {
      if (!saved || !SLOTS.includes(saved.start_time) || typeof saved.category !== "string") continue;
      const block = {
        category: saved.category,
        note: typeof saved.note === "string" ? saved.note : "",
        sub: typeof saved.subcategory === "string" ? saved.subcategory : "",
      };
      day[saved.start_time] = block;
      rows.push({ date: dateStr, start_time: saved.start_time, ...block });
      if (block.sub) {
        const subs = customSubs[block.category] || (customSubs[block.category] = []);
        if (!subs.some((item) => item.toLowerCase() === block.sub.toLowerCase())) subs.push(block.sub);
      }
      if (block.note.startsWith(GYM_NOTE_PREFIX)) {
        try {
          const workout = JSON.parse(block.note.slice(GYM_NOTE_PREFIX.length));
          for (const exercise of workout.exercises || []) {
            const label = (exercise.exercise || "").trim();
            if (label && !gymExercises.some((item) => item.toLowerCase() === label.toLowerCase())) gymExercises.push(label);
          }
        } catch { /* Preserve malformed legacy notes without blocking recovery. */ }
      }
    }
    if (typeof savedDay.reflection === "string" && savedDay.reflection) {
      day[REFLECT_KEY] = { category: "reflection", note: savedDay.reflection, sub: "" };
      rows.push({ date: dateStr, start_time: REFLECT_KEY, ...day[REFLECT_KEY] });
    }
    if (typeof savedDay.objectives === "string" && savedDay.objectives) {
      day[PLAN_KEY] = { category: "plan", note: savedDay.objectives, sub: "" };
      rows.push({ date: dateStr, start_time: PLAN_KEY, ...day[PLAN_KEY] });
    }
    if (savedDay.day_status && DAY_STATUS_TYPES[savedDay.day_status.type]) {
      const type = savedDay.day_status.type;
      const label = savedDay.day_status.label || DAY_STATUS_TYPES[type].label;
      day[DAY_STATUS_KEY] = { category: "calendar_status", note: label, sub: type };
      rows.push({ date: dateStr, start_time: DAY_STATUS_KEY, ...day[DAY_STATUS_KEY] });
    }
    if (Array.isArray(savedDay.rough_plans)) {
      const plans = savedDay.rough_plans.map((item) => String(item).trim()).filter(Boolean);
      if (plans.length) {
        day[ROUGH_PLAN_KEY] = roughPlanBlock(plans);
        rows.push({ date: dateStr, start_time: ROUGH_PLAN_KEY, ...day[ROUGH_PLAN_KEY] });
      }
    }
    if (Array.isArray(savedDay.event_reminders)) {
      const reminders = savedDay.event_reminders.filter((item) => item && typeof item.title === "string" && SLOTS.includes(item.start));
      if (reminders.length) {
        day[EVENT_REMINDER_KEY] = eventReminderBlock(reminders);
        rows.push({ date: dateStr, start_time: EVENT_REMINDER_KEY, ...day[EVENT_REMINDER_KEY] });
      }
    }
    saveLocal(dateStr, day);
    restoredDays.push(dateStr);
  }
  return { rows, restoredDays };
}

async function restoreData(file) {
  if (!file) return;
  if (!sb || !USER_ID || USER_ID === "local-recovery") {
    window.alert("Connect and sign in to the new Supabase project before restoring this backup.");
    return;
  }
  let backup;
  try {
    backup = JSON.parse(await file.text());
    if (!backup.days || typeof backup.days !== "object") throw new Error("Missing days");
  } catch {
    window.alert("That file is not a valid Day recovery backup.");
    return;
  }
  const realDays = Object.keys(backup.days).filter((date) => date !== SETTINGS_DATE && /^\d{4}-\d{2}-\d{2}$/.test(date));
  const blockCount = realDays.reduce((count, date) => count + (Array.isArray(backup.days[date].blocks) ? backup.days[date].blocks.length : 0), 0);
  if (!window.confirm(`Restore ${blockCount} blocks across ${realDays.length} dates? Existing entries at the same times will be replaced.`)) return;

  setStatus("syncing", "Restoring…");
  try {
    const { rows, restoredDays } = recoveryRowsFromBackup(backup);
    const remoteRows = rows.map((row) => ({
      user_id: USER_ID,
      date: row.date,
      start_time: row.start_time,
      category: row.category,
      note: row.note || "",
      subcategory: row.sub || "",
      updated_at: new Date().toISOString(),
    }));
    for (let i = 0; i < remoteRows.length; i += 400) {
      const { error } = await sb.from("blocks").upsert(remoteRows.slice(i, i + 400), { onConflict: "user_id,date,start_time" });
      if (error) throw error;
    }
    if (backup.targets && typeof backup.targets === "object") {
      if (typeof backup.targets.short_term === "string") shortTermObjectives = backup.targets.short_term;
      if (typeof backup.targets.long_term === "string") longTermObjectives = backup.targets.long_term;
    }
    await saveSettings();
    data = loadLocal(ymd(current));
    render();
    setStatus("ok", "Restored");
    window.alert(`Recovery complete: ${remoteRows.length} records restored across ${restoredDays.length} dates.`);
  } catch (error) {
    console.error(error);
    setStatus("err", "Restore incomplete");
    window.alert(`The restore did not finish: ${error.message || error}`);
  }
}

// ---- Statistics ----
let statsRange = 7; // days; 0 = all
const SLEEP_EFFICIENCY = 0.9;

// Historical versions allowed task names to be saved as categories. These
// defaults repair the obvious aliases in existing data without rewriting it.
// A user's explicit area choice is remembered in activityAreas and wins over
// these defaults for blocks that were previously Other/custom.
const DEFAULT_ACTIVITY_AREAS = Object.freeze({
  "calling thad, chatting on whatsapp, other stuff": "social",
  "chores": "chores",
  "gym": "exercise",
  "gym - back and arms": "exercise",
  "immaterial": "work",
  "interview": "work",
  "investing": "learn",
  "job interview": "work",
  "learning about companies": "work",
  "meeting": "work",
  "metro": "travel",
  "moeve": "work",
  "monthly report": "work",
  "party": "social",
  "pilot": "other",
  "prep": "work",
  "presentation work": "work",
  "procrastinated and flicked": "relax",
  "procrastinating": "relax",
  "shopping": "chores",
  "shower": "chores",
  "train": "travel",
  "travel": "travel",
  "watch film": "relax",
  "weekday morning routine": "chores",
});

// Gym keeps its specialist logger and insight, but belongs to Exercise in
// general category metrics so the two do not fragment the same activity.
function reportingCategoryId(catId) {
  if (isGymCategoryId(catId)) return "exercise";
  const category = CAT[catId];
  const builtinMatch = category && BUILTIN_CATEGORIES.find((c) => c.label.toLowerCase() === category.label.toLowerCase());
  if (builtinMatch) return builtinMatch.id;
  if (catId && catId.startsWith("c_")) return "other";
  return CAT[catId] ? catId : "other";
}

function blockSubcategory(block) {
  return ((block && (block.sub || block.subcategory)) || "").trim();
}

function legacyActivityLabel(block) {
  if (!block || !block.category || !block.category.startsWith("c_")) return "";
  return ((CAT[block.category] && CAT[block.category].label) || block.category_label || "").trim();
}

function blockActivityLabel(block) {
  if (!block) return "";
  const note = (block.note || "").trim();
  return blockSubcategory(block) || legacyActivityLabel(block) ||
    (note.startsWith(GYM_NOTE_PREFIX) ? "" : note);
}

function preferredAreaForBlock(block) {
  if (!block) return null;
  const note = (block.note || "").trim();
  const labels = [
    blockSubcategory(block),
    legacyActivityLabel(block),
    note.startsWith(GYM_NOTE_PREFIX) ? "" : note,
  ].map(normalizeActivityLabel).filter(Boolean);
  for (const key of labels) if (activityAreas[key]) return activityAreas[key];
  for (const key of labels) if (DEFAULT_ACTIVITY_AREAS[key]) return DEFAULT_ACTIVITY_AREAS[key];
  return null;
}

// General reports must classify the whole block, not only its old category id.
// This lets one activity retain a stable broad area across old and new entries.
function reportingCategoryForBlock(block) {
  if (!block) return "other";
  if (isGymBlock(block)) return "exercise";
  const preferredArea = preferredAreaForBlock(block);
  if (BUILTIN_CATEGORIES.some((c) => c.id === preferredArea)) {
    return reportingCategoryId(preferredArea);
  }
  const storedArea = reportingCategoryId(block.category);
  return BUILTIN_CATEGORIES.some((c) => c.id === storedArea) ? storedArea : "other";
}

const CATEGORY_MIGRATION_TARGET = 2;

function canonicalStoredBlock(block) {
  const category = isGymBlock(block)
    ? "gym"
    : (preferredAreaForBlock(block) || reportingCategoryId(block.category));
  let sub = blockSubcategory(block);
  if (!sub && block.category && block.category.startsWith("c_")) {
    sub = legacyActivityLabel(block);
  }
  if (isGymBlock(block) && normalizeActivityLabel(sub) === "gym") sub = "";
  return { category, sub };
}

function migrateLocalCategories() {
  let changedBlocks = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith("day_data_")) continue;
    let day;
    try { day = JSON.parse(localStorage.getItem(key)) || {}; } catch { continue; }
    let changedDay = false;
    for (const slot of SLOTS) {
      const block = day[slot];
      if (!block) continue;
      const next = canonicalStoredBlock(block);
      if (block.category !== next.category || (block.sub || "") !== next.sub) {
        day[slot] = { ...block, category: next.category, sub: next.sub };
        changedBlocks++;
        changedDay = true;
      }
    }
    if (changedDay) localStorage.setItem(key, JSON.stringify(day));
  }
  return changedBlocks;
}

// One-time, idempotent migration from legacy task-as-category rows to the
// current broad-category + nested-activity model. Times and notes are untouched.
async function migrateHistoricalCategories() {
  if (categoryMigrationVersion >= CATEGORY_MIGRATION_TARGET || !sb || !USER_ID) return 0;

  // Seed the decisions approved for this migration. Subsequent picker changes
  // remain user-controlled because this block runs only once.
  Object.assign(activityAreas, DEFAULT_ACTIVITY_AREAS);

  const rows = [];
  for (let from = 0;; from += 1000) {
    const { data: page, error } = await sb.from("blocks")
      .select("date,start_time,category,note,subcategory")
      .eq("user_id", USER_ID)
      .order("date", { ascending: true })
      .order("start_time", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(page || []));
    if (!page || page.length < 1000) break;
  }

  const changedRows = [];
  for (const row of rows) {
    if (!SLOTS.includes(row.start_time)) continue;
    const block = { category: row.category, note: row.note || "", sub: row.subcategory || "" };
    const next = canonicalStoredBlock(block);
    if (row.category === next.category && (row.subcategory || "") === next.sub) continue;
    changedRows.push({
      user_id: USER_ID,
      date: row.date,
      start_time: row.start_time,
      category: next.category,
      subcategory: next.sub,
      note: row.note || "",
      updated_at: new Date().toISOString(),
    });
  }

  for (let i = 0; i < changedRows.length; i += 500) {
    const { error } = await sb.from("blocks")
      .upsert(changedRows.slice(i, i + 500), { onConflict: "user_id,date,start_time" });
    if (error) throw error;
  }

  migrateLocalCategories();
  categoryMigrationVersion = CATEGORY_MIGRATION_TARGET;
  await saveSettings();
  return changedRows.length;
}

function rawSleepHours(day) {
  return SLOTS.reduce((hours, s) => hours + (day[s] && reportingCategoryForBlock(day[s]) === "sleep" ? 0.5 : 0), 0);
}

function actualSleepHours(day) {
  return rawSleepHours(day) * SLEEP_EFFICIENCY;
}

// Find the main sleep run ending that morning. Earlier midnight activity does
// not invalidate a later 01:00–09:00 sleep, as it did in the old calculation.
function mainMorningSleepEpisode(day) {
  const episodes = [];
  let active = null;
  for (let i = 0; i < 24; i++) { // midnight through 11:30
    const asleep = day[SLOTS[i]] && reportingCategoryForBlock(day[SLOTS[i]]) === "sleep";
    if (asleep && !active) active = { start: i, end: i + 1 };
    else if (asleep) active.end = i + 1;
    else if (active) { episodes.push(active); active = null; }
  }
  if (active) episodes.push(active);
  const substantial = episodes.filter((e) => e.end - e.start >= 4); // ignore short naps
  return substantial.sort((a, b) => (b.end - b.start) - (a.end - a.start))[0] || null;
}

function wakeTimeForDay(day) {
  const sleep = mainMorningSleepEpisode(day);
  return sleep ? sleep.end * 30 : null;
}

function bedtimeForDay(day) {
  const sleep = mainMorningSleepEpisode(day);
  return sleep ? sleep.start * 30 : null;
}

function averageClockMinutes(values) {
  if (!values.length) return null;
  const radians = values.map((v) => (v / 1440) * Math.PI * 2);
  const sin = radians.reduce((sum, v) => sum + Math.sin(v), 0) / values.length;
  const cos = radians.reduce((sum, v) => sum + Math.cos(v), 0) / values.length;
  let angle = Math.atan2(sin, cos);
  if (angle < 0) angle += Math.PI * 2;
  return (angle / (Math.PI * 2)) * 1440;
}

// Returns { "YYYY-MM-DD": { "08:30": {category,note}, ... }, ... }
function gatherLocalRange(days) {
  const map = {};
  // Local first
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("day_data_")) {
      const date = k.replace("day_data_", "");
      try { map[date] = JSON.parse(localStorage.getItem(k)) || {}; } catch {}
    }
  }
  // Filter to range
  if (days > 0) {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - (days - 1));
    const cut = ymd(cutoff);
    for (const date of Object.keys(map)) if (date < cut) delete map[date];
  }
  const today = ymd(new Date());
  for (const date of Object.keys(map)) if (date > today) delete map[date];
  return map;
}

function minutesToClock(mins) {
  if (mins == null || isNaN(mins)) return "—";
  let h = ((Math.round(mins / 30) * 30) % 1440 + 1440) % 1440;
  let hh = Math.floor(h / 60), mm = h % 60;
  const ap = hh < 12 ? "AM" : "PM";
  let d = hh % 12; if (d === 0) d = 12;
  return `${d}:${String(mm).padStart(2, "0")} ${ap}`;
}
function renderStatsWithMap(map) {
  const body = document.getElementById("statsBody");
  const dates = Object.keys(map).filter((d) => SLOTS.some((s) => map[d][s]));

  if (!dates.length) {
    body.innerHTML = `<div class="stats-empty">No data tracked yet in this range.<br>Start filling in your day →</div>`;
    return;
  }

  const catMins = {};   // category -> minutes
  let totalBlocks = 0;
  const wakeMins = [], bedtimeMins = [];
  let actualSleepTotal = 0, sleepDays = 0;
  for (const d of dates) {
    const day = map[d];
    const rawSleep = rawSleepHours(day);
    if (rawSleep > 0) {
      actualSleepTotal += rawSleep * SLEEP_EFFICIENCY;
      sleepDays++;
    }
    const wake = wakeTimeForDay(day);
    const bedtime = bedtimeForDay(day);
    if (wake != null) wakeMins.push(wake);
    if (bedtime != null) bedtimeMins.push(bedtime);
    for (const s of SLOTS) {
      const b = day[s];
      if (!b) continue;
      totalBlocks++;
      const catId = reportingCategoryForBlock(b);
      catMins[catId] = (catMins[catId] || 0) + 30;
    }
  }

  const totalHours = totalBlocks / 2;
  const avgPerDay = totalHours / dates.length;
  const avgSleep = sleepDays ? actualSleepTotal / sleepDays : 0;

  const cards = `
    <div class="stat-cards">
      <div class="stat-card"><div class="num">${dates.length}</div><div class="lbl">days tracked</div></div>
      <div class="stat-card"><div class="num">${avgPerDay.toFixed(1)}h</div><div class="lbl">tracked / day</div></div>
      <div class="stat-card"><div class="num">${minutesToClock(averageClockMinutes(wakeMins))}</div><div class="lbl">avg wake-up</div></div>
      <div class="stat-card"><div class="num">${minutesToClock(averageClockMinutes(bedtimeMins))}</div><div class="lbl">avg bedtime</div></div>
      <div class="stat-card"><div class="num">${avgSleep.toFixed(1)}h</div><div class="lbl">avg actual sleep</div></div>
      <div class="stat-card"><div class="num">${totalHours}h</div><div class="lbl">total tracked</div></div>
    </div>`;

  const maxMins = Math.max(...Object.values(catMins), 1);
  const bars = CATEGORIES
    .filter((c) => catMins[c.id])
    .sort((a, b) => catMins[b.id] - catMins[a.id])
    .map((c) => {
      const hrs = catMins[c.id] / 60;
      const pct = (catMins[c.id] / maxMins) * 100;
      return `<div class="bar-row">
        <div class="bar-label"><span class="dot" style="background:${c.color}"></span>${c.label}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${c.color}"></div></div>
        <div class="bar-val">${hrs % 1 ? hrs.toFixed(1) : hrs}h</div>
      </div>`;
    }).join("");

  body.innerHTML = cards + `<div class="stats-h">Time by category</div>` + bars;
}

async function renderStats() {
  const map = gatherLocalRange(statsRange);
  renderStatsWithMap(map);
  
  if (sb) {
    let start = null;
    if (statsRange > 0) {
      const d = new Date(); d.setDate(d.getDate() - (statsRange - 1)); start = ymd(d);
    }
    try {
      let q = sb.from("blocks").select("date,start_time,category,note,subcategory").eq("user_id", USER_ID).lte("date", ymd(new Date()));
      if (start) q = q.gte("date", start);
      const { data: rows, error } = await q;
      if (!error && rows) {
        let changed = false;
        for (const r of rows) {
          const oldDay = map[r.date] || {};
          const oldBlock = oldDay[r.start_time];
          if (!oldBlock || oldBlock.category !== r.category || oldBlock.note !== (r.note || "") || oldBlock.sub !== (r.subcategory || "")) {
            (map[r.date] = map[r.date] || {})[r.start_time] = { category: r.category, note: r.note || "", sub: r.subcategory || "" };
            changed = true;
          }
        }
        if (changed) {
          for (const d of Object.keys(map)) {
            saveLocal(d, map[d]);
          }
          renderStatsWithMap(map);
        }
      }
    } catch (e) { console.warn(e); }
  }
}

function openStats() {
  document.getElementById("statsScreen").hidden = false;
  renderStats();
}
function closeStats() {
  document.getElementById("statsScreen").hidden = true;
}

// ---- Work planner ----
function plannerItemsForDay(day) {
  const note = (day && day[PLAN_KEY] && day[PLAN_KEY].note) || "";
  return note.split(/\r?\n/).map(parseObjectiveLine).filter((item) => item.text);
}

function savePlannerItems(dateStr, items) {
  const day = loadLocal(dateStr);
  const note = items.map(serializeObjectiveItem).join("\n");
  const block = note ? { category: "plan", note } : null;
  if (block) day[PLAN_KEY] = block;
  else delete day[PLAN_KEY];
  saveLocal(dateStr, day);
  syncSlots(dateStr, [PLAN_KEY], block);
  if (dateStr === ymd(current)) {
    data = day;
    renderPlanBanner();
    renderObjectiveEditor();
  }
  renderPlanner();
}

function plannerWorkHours(day) {
  return SLOTS.reduce((hours, slot) => {
    const block = day && day[slot];
    return hours + (block && reportingCategoryForBlock(block) === "work" ? 0.5 : 0);
  }, 0);
}

function formatPlannerHours(hours) {
  return `${hours % 1 ? hours.toFixed(1) : hours}h`;
}

function renderPlanner() {
  const dateStr = ymd(plannerDate);
  const todayStr = ymd(new Date());
  const day = loadLocal(dateStr);
  const items = plannerItemsForDay(day);
  const completed = items.filter((item) => item.completed).length;
  const score = items.length ? Math.round((completed / items.length) * 100) : 0;
  if (!items.length) plannerSelectedTask = -1;
  else plannerSelectedTask = Math.max(0, Math.min(plannerSelectedTask, items.length - 1));

  document.getElementById("plannerDateMain").textContent = dateStr === todayStr
    ? "Today"
    : plannerDate.toLocaleDateString(undefined, { weekday: "long" });
  document.getElementById("plannerDateSub").textContent = plannerDate.toLocaleDateString(undefined, {
    day: "numeric", month: "long", year: "numeric",
  });
  document.getElementById("plannerDayScore").textContent = items.length ? `${score}%` : "—";
  document.getElementById("plannerDayScoreLabel").textContent = items.length
    ? `${completed} of ${items.length} completed`
    : "No targets planned";
  document.getElementById("plannerDayProgress").style.width = `${score}%`;
  document.getElementById("plannerWorkHours").textContent = formatPlannerHours(plannerWorkHours(day));

  const now = new Date();
  const nowSlot = `${String(now.getHours()).padStart(2, "0")}:${now.getMinutes() < 30 ? "00" : "30"}`;
  const schedule = document.getElementById("plannerScheduleList");
  schedule.innerHTML = SLOTS.map((slot) => {
    const block = day[slot];
    const category = block ? (CAT[block.category] || CAT.other) : null;
    const detail = block ? displayBlockNote(block) : "";
    const title = block ? (block.sub || detail || category.label) : "—";
    const secondary = block && title !== category.label ? category.label : "";
    const action = !block ? "Schedule" : (detail ? "Edit target" : "Set target");
    const isNow = dateStr === todayStr && slot === nowSlot;
    return `<button class="planner-slot${block ? " filled" : " empty"}${isNow ? " now" : ""}" type="button" data-planner-slot="${slot}"${category ? ` style="--slot-color:${category.color}"` : ""} aria-label="${to12(slot)}${block ? `, ${escapeHtml(title)}` : ", empty"}, ${action}">
      <span class="planner-slot-time">${to12(slot)}</span>
      <span class="planner-slot-content"><span class="planner-slot-title">${escapeHtml(title)}</span>${secondary ? `<span class="planner-slot-detail">${escapeHtml(secondary)}</span>` : ""}</span>
      <span class="planner-slot-action">${action}</span>
    </button>`;
  }).join("");

  const list = document.getElementById("plannerTaskList");
  list.innerHTML = items.length ? items.map((item, index) => `
    <div class="planner-task${item.completed ? " completed" : ""}${index === plannerSelectedTask ? " selected" : ""}" data-planner-index="${index}" tabindex="${index === plannerSelectedTask ? "0" : "-1"}" aria-selected="${index === plannerSelectedTask}">
      <button class="planner-task-toggle" type="button" data-planner-toggle="${index}" aria-label="${item.completed ? "Mark incomplete" : "Mark complete"}">${item.completed ? "✓" : ""}</button>
      <span class="planner-task-text">${escapeHtml(item.text)}</span>
      <button class="planner-task-move" type="button" data-planner-move="${index}" aria-label="Move ${escapeHtml(item.text)} to next day" title="Move to next day">→</button>
      <button class="planner-task-remove" type="button" data-planner-remove="${index}" aria-label="Remove ${escapeHtml(item.text)}">×</button>
    </div>`).join("") : `<div class="planner-empty">Keep it realistic—add the few things that would make this a good workday.</div>`;

  const periodEnd = new Date();
  periodEnd.setHours(12, 0, 0, 0);
  const periodStart = new Date(periodEnd);
  periodStart.setDate(periodStart.getDate() - 6);
  let weekTasks = 0;
  let weekCompleted = 0;
  let plannedDays = 0;
  let achievedDays = 0;
  for (let cursor = new Date(periodStart); cursor <= periodEnd; cursor.setDate(cursor.getDate() + 1)) {
    const dayItems = plannerItemsForDay(loadLocal(ymd(cursor)));
    if (!dayItems.length) continue;
    const done = dayItems.filter((item) => item.completed).length;
    plannedDays++;
    weekTasks += dayItems.length;
    weekCompleted += done;
    if (done === dayItems.length) achievedDays++;
  }
  const weekScore = weekTasks ? Math.round((weekCompleted / weekTasks) * 100) : 0;
  document.getElementById("plannerWeekDates").textContent = `${periodStart.toLocaleDateString(undefined, { day: "numeric", month: "short" })}–${periodEnd.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
  document.getElementById("plannerWeekScore").textContent = weekTasks ? `${weekScore}%` : "—";
  document.getElementById("plannerWeekProgress").style.width = `${weekScore}%`;
  document.getElementById("plannerWeekDetail").textContent = weekTasks
    ? `${weekCompleted} of ${weekTasks} tasks completed · ${achievedDays} of ${plannedDays} planned days fully achieved.`
    : "Plan a target to start measuring follow-through.";
}

function focusPlannerSelectedTask() {
  if (plannerSelectedTask < 0) return;
  const selectedRow = document.querySelector(`.planner-task[data-planner-index="${plannerSelectedTask}"]`);
  selectedRow?.focus({ preventScroll: true });
  selectedRow?.scrollIntoView({ block: "nearest" });
}

async function refreshPlannerData() {
  renderPlanner();
  if (!sb || !USER_ID) return;
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const weekStart = new Date(today); weekStart.setDate(weekStart.getDate() - 6);
  const selected = new Date(plannerDate); selected.setHours(12, 0, 0, 0);
  const rangeStart = selected < weekStart ? selected : weekStart;
  const rangeEnd = selected > today ? selected : today;
  try {
    const { data: rows, error } = await sb.from("blocks")
      .select("date,start_time,category,note,subcategory")
      .eq("user_id", USER_ID).gte("date", ymd(rangeStart)).lte("date", ymd(rangeEnd));
    if (error) throw error;
    for (const row of rows || []) {
      const remoteDay = loadLocal(row.date);
      remoteDay[row.start_time] = {
        category: row.category,
        note: row.note || "",
        sub: row.subcategory || "",
      };
      saveLocal(row.date, remoteDay);
      if (row.date === ymd(current)) data = remoteDay;
    }
    renderPlanner();
  } catch (error) { console.warn(error); }
}

function openPlanner() {
  saveObjectiveInput();
  plannerDate = new Date(current);
  plannerDate.setHours(12, 0, 0, 0);
  plannerSelectedTask = -1;
  document.getElementById("plannerScreen").hidden = false;
  refreshPlannerData();
  requestAnimationFrame(() => {
    const schedule = document.getElementById("plannerScheduleList");
    const target = schedule.querySelector(".planner-slot.now")
      || schedule.querySelector(".planner-slot.filled")
      || schedule.querySelector('[data-planner-slot="08:00"]');
    if (target) schedule.scrollTop = Math.max(0, target.offsetTop - schedule.clientHeight / 3);
  });
}

function closePlanner() {
  document.getElementById("plannerScreen").hidden = true;
}

function movePlannerDate(days) {
  plannerDate.setDate(plannerDate.getDate() + days);
  plannerSelectedTask = -1;
  refreshPlannerData();
}

function addPlannerTask() {
  const input = document.getElementById("plannerTaskInput");
  const text = input.value.trim();
  if (!text) return;
  const dateStr = ymd(plannerDate);
  const items = plannerItemsForDay(loadLocal(dateStr));
  items.push({ text, completed: false });
  plannerSelectedTask = items.length - 1;
  input.value = "";
  savePlannerItems(dateStr, items);
  input.focus();
}

function updatePlannerTask(index, action) {
  const dateStr = ymd(plannerDate);
  const items = plannerItemsForDay(loadLocal(dateStr));
  if (!items[index]) return;
  if (action === "toggle") items[index].completed = !items[index].completed;
  else if (action === "remove") {
    items.splice(index, 1);
    plannerSelectedTask = items.length ? Math.min(index, items.length - 1) : -1;
  }
  savePlannerItems(dateStr, items);
  focusPlannerSelectedTask();
}

function movePlannerTaskToNextDay(index) {
  const sourceDateStr = ymd(plannerDate);
  const sourceItems = plannerItemsForDay(loadLocal(sourceDateStr));
  const item = sourceItems[index];
  if (!item) return;

  const nextDate = new Date(plannerDate);
  nextDate.setDate(nextDate.getDate() + 1);
  const nextDateStr = ymd(nextDate);
  const nextItems = plannerItemsForDay(loadLocal(nextDateStr));
  const alreadyThere = nextItems.some((candidate) => candidate.text.trim().toLowerCase() === item.text.trim().toLowerCase());
  if (!alreadyThere) nextItems.push({ text: item.text, completed: false });

  sourceItems.splice(index, 1);
  plannerSelectedTask = sourceItems.length ? Math.min(index, sourceItems.length - 1) : -1;
  savePlannerItems(nextDateStr, nextItems);
  savePlannerItems(sourceDateStr, sourceItems);
  focusPlannerSelectedTask();
}

function handlePlannerKeyboard(event) {
  const screen = document.getElementById("plannerScreen");
  if (screen.hidden || !document.getElementById("helpDialog").hidden || event.defaultPrevented) return;

  const editor = document.getElementById("sheetBackdrop");
  if (!editor.hidden) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSheet();
    }
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    closePlanner();
    return;
  }

  const target = event.target instanceof Element ? event.target : document.body;
  const isTyping = target.matches("input, textarea, select") || target.isContentEditable;
  if (isTyping || event.ctrlKey || event.metaKey || event.altKey) return;

  const items = plannerItemsForDay(loadLocal(ymd(plannerDate)));
  if (event.key.toLowerCase() === "n") {
    event.preventDefault();
    document.getElementById("plannerTaskInput").focus();
    return;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    if (!items.length) return;
    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    plannerSelectedTask = plannerSelectedTask < 0
      ? (direction > 0 ? 0 : items.length - 1)
      : (plannerSelectedTask + direction + items.length) % items.length;
    renderPlanner();
    focusPlannerSelectedTask();
    return;
  }
  if (plannerSelectedTask < 0 || !items[plannerSelectedTask]) return;
  if (event.key === " " && !target.closest("button, a")) {
    event.preventDefault();
    updatePlannerTask(plannerSelectedTask, "toggle");
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    movePlannerTaskToNextDay(plannerSelectedTask);
  } else if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    updatePlannerTask(plannerSelectedTask, "remove");
  }
}

function openPlannerDay() {
  const target = new Date(plannerDate);
  closePlanner();
  goto(target);
}

async function openPlannerSlot(slot) {
  const target = new Date(plannerDate);
  if (ymd(target) !== ymd(current)) await goto(target);
  else data = loadLocal(ymd(current));
  openSheet([slot]);
  plannerSlotMode = true;
  document.getElementById("activityPickerLabel").textContent = "What are you scheduling?";
  document.getElementById("activitySearch").placeholder = "e.g. Revision, project work, meeting…";
  updateNotePlaceholder();
}

function openKeyboardHelp() {
  const dialog = document.getElementById("helpDialog");
  dialog.hidden = false;
  document.getElementById("helpClose").focus();
}

function closeKeyboardHelp() {
  document.getElementById("helpDialog").hidden = true;
}

function handleKeyboardHelp(event) {
  const dialog = document.getElementById("helpDialog");
  if (!dialog.hidden && event.key === "Escape") {
    event.preventDefault();
    closeKeyboardHelp();
    return;
  }
  const target = event.target instanceof Element ? event.target : document.body;
  const isTyping = target.matches("input, textarea, select") || target.isContentEditable;
  if (dialog.hidden && event.key === "?" && !isTyping && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    openKeyboardHelp();
  }
}

// ---- Calendar ----
function dateFromYmd(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function eventRemindersForDay(day) {
  const note = day?.[EVENT_REMINDER_KEY]?.note || "";
  if (!note) return [];
  try {
    const parsed = JSON.parse(note);
    return Array.isArray(parsed) ? parsed.filter((item) => item && item.title && SLOTS.includes(item.start)) : [];
  } catch { return []; }
}

function eventReminderBlock(reminders) {
  return reminders.length
    ? { category: "calendar_reminder", note: JSON.stringify(reminders), sub: "Event reminders" }
    : null;
}

function eventReminderDate(dateStr, start) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = start.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function saveEventReminder(dateStr, title, start, leadValue) {
  const reminders = eventRemindersForDay(data).filter((item) => item.type === "rough" || item.start !== start);
  if (leadValue !== "none") {
    reminders.push({
      id: `${dateStr}-${start}-${Date.now().toString(36)}`,
      title,
      start,
      lead: Math.max(0, Number(leadValue) || 0),
      dismissed: false,
      notified: false,
      type: "event",
    });
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
  }
  const block = eventReminderBlock(reminders);
  if (block) data[EVENT_REMINDER_KEY] = block;
  else delete data[EVENT_REMINDER_KEY];
  saveLocal(dateStr, data);
  syncSlots(dateStr, [EVENT_REMINDER_KEY], block);
  renderEventReminderBanner();
}

function saveRoughPlanReminder(dateStr, title, reminderType) {
  const day = loadLocal(dateStr);
  const normalizedTitle = title.trim().toLowerCase();
  const reminders = eventRemindersForDay(day).filter((item) => !(item.type === "rough" && item.title.trim().toLowerCase() === normalizedTitle));
  const leads = { day: 0, before: 1440, week: 10080 };
  if (Object.prototype.hasOwnProperty.call(leads, reminderType)) {
    reminders.push({
      id: `${dateStr}-rough-${Date.now().toString(36)}`,
      title: title.trim(),
      start: "09:00",
      lead: leads[reminderType],
      dismissed: false,
      notified: false,
      type: "rough",
    });
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
  }
  const block = eventReminderBlock(reminders);
  if (block) day[EVENT_REMINDER_KEY] = block;
  else delete day[EVENT_REMINDER_KEY];
  saveLocal(dateStr, day);
  if (dateStr === ymd(current)) data = day;
  syncSlots(dateStr, [EVENT_REMINDER_KEY], block);
}

function storedEventReminders() {
  const reminders = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith("day_data_")) continue;
    const dateStr = key.slice("day_data_".length);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
    const day = loadLocal(dateStr);
    eventRemindersForDay(day).forEach((item) => reminders.push({ ...item, dateStr }));
  }
  return reminders;
}

function dueEventReminders(now = new Date()) {
  return storedEventReminders().filter((item) => {
    if (item.dismissed) return false;
    const eventAt = eventReminderDate(item.dateStr, item.start);
    const alertAt = new Date(eventAt.getTime() - item.lead * 60000);
    return now >= alertAt && now <= new Date(eventAt.getTime() + 30 * 60000);
  }).sort((a, b) => eventReminderDate(a.dateStr, a.start) - eventReminderDate(b.dateStr, b.start));
}

function reminderWhenText(reminder, now = new Date()) {
  const eventAt = eventReminderDate(reminder.dateStr, reminder.start);
  const minutes = Math.round((eventAt - now) / 60000);
  const clock = `${eventAt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} at ${to12(reminder.start)}`;
  if (minutes > 60) return `${clock} · in ${Math.round(minutes / 60)} hours`;
  if (minutes > 0) return `${clock} · in ${minutes} minutes`;
  if (minutes === 0) return `${clock} · happening now`;
  return `${clock} · started ${Math.abs(minutes)} minutes ago`;
}

function updateStoredReminder(reminder, updates) {
  const day = loadLocal(reminder.dateStr);
  const reminders = eventRemindersForDay(day).map((item) => item.id === reminder.id ? { ...item, ...updates } : item);
  const block = eventReminderBlock(reminders);
  day[EVENT_REMINDER_KEY] = block;
  saveLocal(reminder.dateStr, day);
  if (reminder.dateStr === ymd(current)) data = day;
  syncSlots(reminder.dateStr, [EVENT_REMINDER_KEY], block);
}

function renderEventReminderBanner() {
  const banner = document.getElementById("eventReminderBanner");
  if (!banner) return;
  const reminder = dueEventReminders()[0];
  banner.hidden = !reminder;
  banner.dataset.reminderId = reminder?.id || "";
  banner.dataset.reminderDate = reminder?.dateStr || "";
  if (!reminder) return;
  document.getElementById("eventReminderTitle").textContent = reminder.title;
  document.getElementById("eventReminderWhen").textContent = reminderWhenText(reminder);
  if (!reminder.notified && "Notification" in window && Notification.permission === "granted") {
    try { new Notification(`Upcoming: ${reminder.title}`, { body: reminderWhenText(reminder), tag: reminder.id }); } catch {}
    updateStoredReminder(reminder, { notified: true });
  }
}

async function pullUpcomingReminders() {
  if (!sb || !USER_ID || USER_ID === "local-recovery") return;
  const start = new Date();
  const end = new Date(start); end.setDate(end.getDate() + 31);
  try {
    const { data: rows, error } = await sb.from("blocks")
      .select("date,category,note,subcategory").eq("user_id", USER_ID)
      .eq("start_time", EVENT_REMINDER_KEY).gte("date", ymd(start)).lte("date", ymd(end));
    if (error) throw error;
    for (const row of rows || []) {
      const day = loadLocal(row.date);
      day[EVENT_REMINDER_KEY] = { category: row.category, note: row.note || "", sub: row.subcategory || "" };
      saveLocal(row.date, day);
      if (row.date === ymd(current)) data = day;
    }
    renderEventReminderBanner();
  } catch (error) { console.warn("Could not sync upcoming reminders", error); }
}

function dayHasCalendarContent(dateStr) {
  const day = loadLocal(dateStr);
  return Object.keys(day).some((key) => SLOTS.includes(key) || key === PLAN_KEY || key === REFLECT_KEY || key === DAY_STATUS_KEY || key === ROUGH_PLAN_KEY || key === EVENT_REMINDER_KEY);
}

function roughPlansForDay(day) {
  const note = day?.[ROUGH_PLAN_KEY]?.note || "";
  if (!note) return [];
  try {
    const parsed = JSON.parse(note);
    if (Array.isArray(parsed)) return parsed.map((item) => String(item).trim()).filter(Boolean);
  } catch {}
  return note.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function roughPlanBlock(plans) {
  return plans.length
    ? { category: "calendar_plan", note: JSON.stringify(plans), sub: "Rough plan" }
    : null;
}

async function addRoughPlanToDates(dateStrings, text) {
  const cleanText = text.trim();
  const dates = [...new Set(dateStrings)].sort();
  if (!cleanText || !dates.length) return false;
  for (const dateStr of dates) {
    const day = loadLocal(dateStr);
    const plans = roughPlansForDay(day);
    if (!plans.some((plan) => plan.toLowerCase() === cleanText.toLowerCase())) plans.push(cleanText);
    day[ROUGH_PLAN_KEY] = roughPlanBlock(plans);
    saveLocal(dateStr, day);
    if (dateStr === ymd(current)) data = day;
  }
  renderCalendar();
  await Promise.all(dates.map((dateStr) => syncSlots(dateStr, [ROUGH_PLAN_KEY], roughPlanBlock(roughPlansForDay(loadLocal(dateStr))))));
  setStatus("ok", dates.length === 1 ? "Rough plan added ✓" : `Added across ${dates.length} days ✓`);
  return true;
}

async function removeRoughPlan(dateStr, index) {
  const day = loadLocal(dateStr);
  const plans = roughPlansForDay(day);
  if (!plans[index]) return;
  const removedTitle = plans[index].trim().toLowerCase();
  plans.splice(index, 1);
  const block = roughPlanBlock(plans);
  if (block) day[ROUGH_PLAN_KEY] = block;
  else delete day[ROUGH_PLAN_KEY];
  const reminders = eventRemindersForDay(day).filter((item) => !(item.type === "rough" && item.title.trim().toLowerCase() === removedTitle));
  const reminderBlock = eventReminderBlock(reminders);
  if (reminderBlock) day[EVENT_REMINDER_KEY] = reminderBlock;
  else delete day[EVENT_REMINDER_KEY];
  saveLocal(dateStr, day);
  if (dateStr === ymd(current)) data = day;
  renderCalendar();
  await Promise.all([
    syncSlots(dateStr, [ROUGH_PLAN_KEY], block),
    syncSlots(dateStr, [EVENT_REMINDER_KEY], reminderBlock),
  ]);
}

function calendarDayStatus(day) {
  const block = day && day[DAY_STATUS_KEY];
  if (!block) return null;
  const type = block.sub || "";
  return { type, ...(DAY_STATUS_TYPES[type] || { label: block.note || "Day label", emoji: "•" }) };
}

function calendarPreviewItems(day) {
  const items = [];
  let active = null;
  for (let index = 0; index <= SLOTS.length; index++) {
    const block = index < SLOTS.length ? day[SLOTS[index]] : null;
    const key = block ? JSON.stringify([block.category || "other", block.sub || "", block.note || ""]) : null;
    if (active && key !== active.key) {
      active.endIndex = index;
      items.push(active);
      active = null;
    }
    if (!active && block) active = { key, startIndex: index, endIndex: index + 1, block };
  }
  return items;
}

function calendarPreviewTime(item) {
  if (item.startIndex === 0 && item.endIndex === SLOTS.length) return "All day";
  const compact = (slot) => {
    const [hour, minute] = slot.split(":").map(Number);
    const period = hour < 12 || hour === 24 ? "AM" : "PM";
    const displayHour = hour % 12 || 12;
    return { clock: `${displayHour}${minute ? `:${String(minute).padStart(2, "0")}` : ""}`, period };
  };
  const start = compact(SLOTS[item.startIndex]);
  const end = compact(item.endIndex === SLOTS.length ? "24:00" : SLOTS[item.endIndex]);
  return start.period === end.period
    ? `${start.clock}–${end.clock} ${end.period}`
    : `${start.clock} ${start.period}–${end.clock} ${end.period}`;
}

function calendarItemTitle(item) {
  const block = item.block || {};
  const category = CAT[block.category] || CAT.other;
  const note = displayBlockNote(block).replace(/^\[GCal\]\s*/i, "").trim();
  if (block.sub && block.sub !== "Google Calendar") return block.sub;
  return note || block.sub || category.label;
}

function calendarCellEntries(day) {
  const reminders = eventRemindersForDay(day);
  const roughReminderTitles = new Set(reminders.filter((item) => item.type === "rough").map((item) => item.title.trim().toLowerCase()));
  const rough = roughPlansForDay(day).map((label) => ({ type: "rough", label: `${roughReminderTitles.has(label.trim().toLowerCase()) ? "🔔 " : ""}${label}` }));
  const reminderStarts = new Set(reminders.filter((item) => item.type !== "rough").map((item) => item.start));
  const events = calendarPreviewItems(day)
    .sort((a, b) => Number(b.block?.sub === "Google Calendar") - Number(a.block?.sub === "Google Calendar") || a.startIndex - b.startIndex)
    .map((item) => ({
      type: "event",
      label: `${reminderStarts.has(SLOTS[item.startIndex]) ? "🔔 " : ""}${item.startIndex === 0 && item.endIndex === SLOTS.length ? "All day" : to12(SLOTS[item.startIndex])} · ${calendarItemTitle(item)}`,
    }));
  if (rough.length && events.length) return [events[0], rough[0], ...events.slice(1), ...rough.slice(1)];
  return events.concat(rough);
}

function renderCalendarDayPreview(dateStr) {
  const preview = document.getElementById("calendarDayPreview");
  if (!dateStr) { preview.innerHTML = ""; return; }
  const day = loadLocal(dateStr);
  const items = calendarPreviewItems(day);
  const reminders = eventRemindersForDay(day);
  const reminderStarts = new Set(reminders.filter((item) => item.type !== "rough").map((item) => item.start));
  const roughReminderTitles = new Set(reminders.filter((item) => item.type === "rough").map((item) => item.title.trim().toLowerCase()));
  const status = calendarDayStatus(day);
  let html = status
    ? `<div class="calendar-preview-status"><span>${status.emoji}</span><span>${escapeHtml(status.label)}</span></div>`
    : "";
  const roughPlans = roughPlansForDay(day);
  if (roughPlans.length) {
    html += `<div class="calendar-rough-list">${roughPlans.map((plan, index) => `
      <div class="calendar-rough-item">
        <span class="calendar-rough-dot" aria-hidden="true"></span>
        <span>${roughReminderTitles.has(plan.trim().toLowerCase()) ? "🔔 " : ""}${escapeHtml(plan)}</span>
        <button type="button" data-remove-rough-plan="${index}" aria-label="Remove ${escapeHtml(plan)}">×</button>
      </div>`).join("")}</div>`;
  }
  html += items.map((item) => {
    const category = CAT[item.block.category] || CAT.other;
    const note = displayBlockNote(item.block);
    const title = `${reminderStarts.has(SLOTS[item.startIndex]) ? "🔔 " : ""}${item.block.sub || note || category.label}`;
    const detail = item.block.sub
      ? [category.label, note].filter(Boolean).join(" · ")
      : (note ? category.label : "");
    return `<button type="button" class="calendar-preview-item" data-preview-start="${item.startIndex}" data-preview-end="${item.endIndex}" style="--preview-color:${category.color}" aria-label="Edit ${escapeHtml(title)} at ${calendarPreviewTime(item)}">
      <span class="calendar-preview-time">${calendarPreviewTime(item)}</span>
      <span class="calendar-preview-bar"></span>
      <span class="calendar-preview-copy"><span class="calendar-preview-title">${escapeHtml(title)}</span>${detail ? `<span class="calendar-preview-detail">${escapeHtml(detail)}</span>` : ""}</span>
    </button>`;
  }).join("");

  const objectives = day[PLAN_KEY] && day[PLAN_KEY].note;
  if (objectives && objectives.trim()) {
    const displayObjectives = objectives.split(/\r?\n/)
      .map(parseObjectiveLine)
      .filter((item) => item.text)
      .map((item) => `${item.completed ? "[x]" : "[ ]"} ${item.text}`)
      .join("\n");
    html += `<div class="calendar-preview-objectives"><div class="calendar-preview-objectives-title">Objectives</div><div class="calendar-preview-objectives-text">${escapeHtml(displayObjectives)}</div></div>`;
  }
  preview.innerHTML = html || `<div class="calendar-preview-empty">Nothing planned or logged for this day yet.</div>`;
}

function renderCalendar() {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  document.getElementById("calendarMonthLabel").textContent = calendarMonth.toLocaleDateString(undefined, {
    month: "long", year: "numeric",
  });

  const grid = document.getElementById("calendarGrid");
  grid.innerHTML = "";
  const first = new Date(year, month, 1, 12);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - mondayOffset, 12);
  const today = ymd(new Date());

  for (let i = 0; i < 42; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const dateStr = ymd(date);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "calendar-day";
    if (date.getMonth() !== month) button.classList.add("outside");
    if (dateStr === today) button.classList.add("today");
    if (!calendarMultiMode && dateStr === selectedCalendarDate) button.classList.add("selected");
    if (calendarMultiMode && selectedCalendarDates.has(dateStr)) button.classList.add("multi-selected");
    if (dayHasCalendarContent(dateStr)) button.classList.add("has-data");
    if (calendarDayStatus(loadLocal(dateStr))) button.classList.add("has-status");
    const day = loadLocal(dateStr);
    const dayEntries = calendarCellEntries(day);
    button.innerHTML = `<span class="calendar-day-number">${date.getDate()}</span>${dayEntries.length
      ? `<span class="calendar-day-plans">${dayEntries.slice(0, 2).map((entry) => `<span class="calendar-day-plan calendar-day-${entry.type}">${escapeHtml(entry.label)}</span>`).join("")}${dayEntries.length > 2 ? `<span class="calendar-day-more">+${dayEntries.length - 2} more</span>` : ""}</span>`
      : ""}`;
    button.dataset.date = dateStr;
    const dateLabel = date.toLocaleDateString(undefined, {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    });
    button.setAttribute("aria-label", dayEntries.length ? `${dateLabel}. ${dayEntries.map((entry) => entry.label).join(". ")}` : dateLabel);
    grid.appendChild(button);
  }

  const actions = document.getElementById("calendarActions");
  actions.hidden = calendarMultiMode || !selectedCalendarDate;
  if (selectedCalendarDate) {
    document.getElementById("calendarSelectedDate").textContent = dateFromYmd(selectedCalendarDate).toLocaleDateString(undefined, {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    });
  }
  renderCalendarDayPreview(calendarMultiMode ? null : selectedCalendarDate);

  document.getElementById("calendarMultiSelect").textContent = calendarMultiMode ? "Done" : "Select days";
  const multiActions = document.getElementById("calendarMultiActions");
  multiActions.hidden = !calendarMultiMode;
  if (calendarMultiMode) {
    const count = selectedCalendarDates.size;
    document.getElementById("calendarSelectionCount").textContent = count
      ? `${count} day${count === 1 ? "" : "s"} selected`
      : "Select dates";
    const selectedStatusTypes = Array.from(selectedCalendarDates).map((date) => {
      const status = calendarDayStatus(loadLocal(date));
      return status ? status.type : null;
    });
    const selectedTypes = new Set(selectedStatusTypes.filter(Boolean));
    document.querySelectorAll("[data-day-status]").forEach((button) => {
      button.disabled = count === 0;
      button.classList.toggle("active", count > 0 && selectedStatusTypes.every((type) => type === button.dataset.dayStatus) && selectedTypes.size === 1);
    });
    document.getElementById("calendarClearStatus").disabled = count === 0;
    document.getElementById("calendarMultiRoughAdd").disabled = count === 0;
  }
}

async function pullCalendarMonth() {
  if (!sb || !USER_ID) return;
  const requestedMonth = `${calendarMonth.getFullYear()}-${calendarMonth.getMonth()}`;
  const start = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1, 12);
  const end = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0, 12);
  try {
    const { data: rows, error } = await sb.from("blocks")
      .select("date,start_time,category,note,subcategory")
      .eq("user_id", USER_ID).gte("date", ymd(start)).lte("date", ymd(end));
    if (error) throw error;
    for (const row of rows || []) {
      const day = loadLocal(row.date);
      day[row.start_time] = {
        category: row.category,
        note: row.note || "",
        sub: row.subcategory || "",
      };
      saveLocal(row.date, day);
    }
    if (requestedMonth === `${calendarMonth.getFullYear()}-${calendarMonth.getMonth()}`) renderCalendar();
  } catch (e) { console.warn(e); }
}

function openCalendar() {
  calendarMonth = new Date(current.getFullYear(), current.getMonth(), 1, 12);
  selectedCalendarDate = ymd(current);
  calendarMultiMode = false;
  selectedCalendarDates.clear();
  document.getElementById("calendarScreen").hidden = false;
  renderCalendar();
  pullCalendarMonth();
}

function closeCalendar() {
  document.getElementById("calendarScreen").hidden = true;
  calendarMultiMode = false;
  calendarDragging = false;
  calendarDragAnchor = null;
  clearTimeout(calendarLongPressTimer);
  calendarLongPressTimer = null;
  selectedCalendarDates.clear();
}

function toggleCalendarMultiMode() {
  calendarMultiMode = !calendarMultiMode;
  selectedCalendarDates.clear();
  renderCalendar();
}

function datesBetween(startDateStr, endDateStr) {
  const start = dateFromYmd(startDateStr);
  const end = dateFromYmd(endDateStr);
  const [first, last] = start <= end ? [start, end] : [end, start];
  const dates = [];
  for (const cursor = new Date(first); cursor <= last; cursor.setDate(cursor.getDate() + 1)) dates.push(ymd(cursor));
  return dates;
}

function calendarDateAtPoint(x, y) {
  const element = document.elementFromPoint(x, y);
  return element?.closest?.("button.calendar-day[data-date]")?.dataset.date || null;
}

function beginCalendarRangeSelection(dateStr, pointerId) {
  calendarMultiMode = true;
  calendarDragging = true;
  calendarDragAnchor = dateStr;
  selectedCalendarDates = new Set([dateStr]);
  suppressCalendarClick = true;
  const grid = document.getElementById("calendarGrid");
  grid.classList.add("dragging");
  try { grid.setPointerCapture(pointerId); } catch {}
  renderCalendar();
}

function updateCalendarRangeSelection(endDateStr) {
  if (!calendarDragging || !calendarDragAnchor || !endDateStr) return;
  selectedCalendarDates = new Set(datesBetween(calendarDragAnchor, endDateStr));
  renderCalendar();
}

function finishCalendarRangeSelection(pointerId) {
  clearTimeout(calendarLongPressTimer);
  calendarLongPressTimer = null;
  const grid = document.getElementById("calendarGrid");
  if (!calendarDragging) {
    try { grid.releasePointerCapture(pointerId); } catch {}
    return;
  }
  calendarDragging = false;
  calendarDragAnchor = null;
  grid.classList.remove("dragging");
  try { grid.releasePointerCapture(pointerId); } catch {}
  setTimeout(() => { suppressCalendarClick = false; }, 0);
}

async function applyCalendarDayStatus(type) {
  const dates = Array.from(selectedCalendarDates).sort();
  if (!dates.length) return;
  const meta = type ? DAY_STATUS_TYPES[type] : null;
  if (type && !meta) return;
  for (const dateStr of dates) {
    const day = loadLocal(dateStr);
    if (meta) day[DAY_STATUS_KEY] = { category: "calendar_status", note: meta.label, sub: type };
    else delete day[DAY_STATUS_KEY];
    saveLocal(dateStr, day);
    if (dateStr === ymd(current)) data = day;
  }
  renderCalendar();
  if (!sb) return;
  setStatus("syncing", "Saving…");
  try {
    if (meta) {
      const rows = dates.map((dateStr) => ({
        user_id: USER_ID,
        date: dateStr,
        start_time: DAY_STATUS_KEY,
        category: "calendar_status",
        note: meta.label,
        subcategory: type,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await sb.from("blocks").upsert(rows, { onConflict: "user_id,date,start_time" });
      if (error) throw error;
    } else {
      const { error } = await sb.from("blocks").delete()
        .eq("user_id", USER_ID).eq("start_time", DAY_STATUS_KEY).in("date", dates);
      if (error) throw error;
    }
    setStatus("ok", "Synced");
  } catch (e) {
    console.warn(e);
    setStatus("err", "Saved offline");
  }
}

function moveCalendarMonth(amount) {
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + amount, 1, 12);
  selectedCalendarDate = null;
  renderCalendar();
  pullCalendarMonth();
}

async function openSelectedCalendarDate(planEvent) {
  if (!selectedCalendarDate) return;
  const target = dateFromYmd(selectedCalendarDate);
  closeCalendar();
  await goto(target);
  if (planEvent) openEventSheet();
}

async function editCalendarPreviewItem(startIndex, endIndex) {
  if (!selectedCalendarDate) return;
  const target = dateFromYmd(selectedCalendarDate);
  closeCalendar();
  await goto(target);
  openSheet(SLOTS.slice(startIndex, endIndex));
}

// ===========================================================
//  Insights — each opens its own page from the bottom popup
// ===========================================================
let insightRange = 7;
let currentInsight = null;

const INSIGHTS = [
  { id: "subs",     title: "Activities",       icon: "🗂",  desc: "Time by named activity",         fn: renderInsightActivities },
  { id: "heatmap",  title: "Weekly rhythm",    icon: "🔥",  desc: "When activities tend to happen", fn: renderInsightHeatmap, menu: false },
  { id: "goals",    title: "Objectives",       icon: "🎯",  desc: "Daily actions & longer-term direction", fn: renderInsightGoals },
  { id: "gym",      title: "Gym Tracker",      icon: "🏋️", desc: "Weight progress & workouts",    fn: renderInsightGym, menu: false },
];

// ---- shared helpers ----
const catColor = (id) => (CAT[reportingCategoryId(id)] || CAT.other).color;
const catLabel = (id) => (CAT[reportingCategoryId(id)] || CAT.other).label;
const WD_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WD_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon-first
function isGymCategoryId(catId) {
  const c = CAT[catId];
  return catId === "gym" || (c && c.label.toLowerCase() === "gym");
}
function isGymActivityLabel(label) {
  const value = normalizeActivityLabel(label);
  return value === "gym" || /^gym\s*(?:-|–|—|:)\s*\S/.test(value);
}
function isGymBlock(b) {
  return !!b && (
    isGymCategoryId(b.category) ||
    normalizeActivityLabel(b.category_label) === "gym" ||
    isGymActivityLabel(blockSubcategory(b)) ||
    (b.note || "").startsWith(GYM_NOTE_PREFIX)
  );
}
function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}
function fmtH(h) { return (h % 1 ? h.toFixed(1) : h) + "h"; }
function trackedDates(map) {
  return Object.keys(map).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && SLOTS.some((s) => map[d][s])).sort();
}
function barRow(label, color, hrs, maxH) {
  const pct = maxH ? (hrs / maxH) * 100 : 0;
  return `<div class="bar-row">
    <div class="bar-label"><span class="dot" style="background:${color}"></span>${escapeHtml(label)}</div>
    <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
    <div class="bar-val">${fmtH(hrs)}</div></div>`;
}
const emptyMsg = (t) => `<div class="stats-empty">${t}</div>`;

// ---- 1. Subcategory / project breakdown ----
function renderInsightSubs(map) {
  const mins = {}; // "cat sub" -> minutes
  for (const d of trackedDates(map))
    for (const s of SLOTS) {
      const b = map[d][s];
      if (b && b.sub) { const k = b.category + " " + b.sub; mins[k] = (mins[k] || 0) + 30; }
    }
  const keys = Object.keys(mins).sort((a, b) => mins[b] - mins[a]);
  if (!keys.length) return emptyMsg("No projects/subcategories logged in this range yet.");
  const maxH = Math.max(...keys.map((k) => mins[k])) / 60;
  return `<div class="stats-h">Time by project</div>` + keys.map((k) => {
    const [cat, sub] = k.split(" ");
    return barRow(`${catLabel(cat)} · ${sub}`, catColor(cat), mins[k] / 60, maxH);
  }).join("");
}

// Activity/project totals are grouped by activity label rather than by
// area+label. Reclassifying an activity should not split its historical total.
// Legacy custom categories and old note-only tasks are treated as activities
// because that is how earlier versions of the picker were used.
function renderInsightActivities(map) {
  const activities = {};
  for (const d of trackedDates(map)) {
    for (const s of SLOTS) {
      const b = map[d][s];
      if (!b) continue;
      const label = (isGymBlock(b) ? "Gym" : (blockActivityLabel(b) || b.note || "")).trim();
      if (!label) continue;
      const key = normalizeActivityLabel(label);
      const item = activities[key] || (activities[key] = { label, mins: 0, categories: {} });
      const catId = reportingCategoryForBlock(b);
      item.mins += 30;
      item.categories[catId] = (item.categories[catId] || 0) + 30;
    }
  }
  const items = Object.values(activities).sort((a, b) => b.mins - a.mins);
  if (!items.length) return emptyMsg("No named activities logged in this range yet.");
  const maxH = items[0].mins / 60;
  return `<div class="stats-h">Named activity time</div>` + items.map((item) => {
    const catId = Object.keys(item.categories).sort((a, b) => item.categories[b] - item.categories[a])[0] || "other";
    return barRow(`${catLabel(catId)} · ${item.label}`, catColor(catId), item.mins / 60, maxH);
  }).join("");
}

// ---- 2. Weekly heatmap ----
function renderInsightHeatmap(map) {
  const dates = trackedDates(map);
  if (!dates.length) return emptyMsg("Nothing to map yet.");
  const wdCount = [0,0,0,0,0,0,0];
  const cell = {}; // `${wd}_${i}` -> {counts, total}
  for (const d of dates) {
    const wd = weekdayOf(d); wdCount[wd]++;
    SLOTS.forEach((s, i) => {
      const b = map[d][s];
      if (!b) return;
      const c = cell[wd + "_" + i] || (cell[wd + "_" + i] = { counts: {}, total: 0 });
      const catId = reportingCategoryForBlock(b);
      c.counts[catId] = (c.counts[catId] || 0) + 1; c.total++;
    });
  }
  let head = `<div class="hm-row hm-head"><div class="hm-time"></div>`;
  for (const wd of WD_ORDER) head += `<div class="hm-cell hm-lbl">${WD_LABELS[wd][0]}</div>`;
  head += `</div>`;
  let rows = "";
  for (let i = 0; i < SLOTS.length; i++) {
    const showTime = i % 4 === 0; // every 2h
    rows += `<div class="hm-row"><div class="hm-time">${showTime ? formatHour(parseInt(SLOTS[i], 10)) : ""}</div>`;
    for (const wd of WD_ORDER) {
      const c = cell[wd + "_" + i];
      let style = "background:transparent";
      if (c && wdCount[wd]) {
        let top = null, n = 0;
        for (const k in c.counts) if (c.counts[k] > n) { n = c.counts[k]; top = k; }
        const alpha = 0.18 + 0.82 * (n / wdCount[wd]);
        style = `background:${catColor(top)};opacity:${alpha.toFixed(2)}`;
      }
      rows += `<div class="hm-cell" style="${style}"></div>`;
    }
    rows += `</div>`;
  }
  return `<div class="stats-h">Weekly rhythm</div><div class="heatmap">${head}${rows}</div>`;
}


// ---- 4. Consistency / streak ----
function renderInsightStreak(map) {
  const dates = trackedDates(map);
  if (!dates.length) return emptyMsg("Start logging to build a streak.");
  const set = new Set(dates);
  // Today is still in progress, so an unlogged today does not erase a streak
  // that was active yesterday.
  let streak = 0; let cur = new Date();
  if (!set.has(ymd(cur))) cur.setDate(cur.getDate() - 1);
  for (;;) { if (set.has(ymd(cur))) { streak++; cur.setDate(cur.getDate() - 1); } else break; }
  // longest streak
  let longest = 0, run = 0, prev = null;
  for (const d of dates) {
    if (prev) {
      const [y, m, da] = prev.split("-").map(Number);
      const nx = new Date(y, m - 1, da); nx.setDate(nx.getDate() + 1);
      run = (ymd(nx) === d) ? run + 1 : 1;
    } else run = 1;
    longest = Math.max(longest, run); prev = d;
  }
  const TARGET = 7;
  let nights = 0, sleepSum = 0, sleepDays = 0;
  for (const d of dates) {
    const sl = actualSleepHours(map[d]);
    if (sl > 0) { sleepDays++; sleepSum += sl; if (sl >= TARGET) nights++; }
  }
  return `<div class="stat-cards">
    <div class="stat-card"><div class="num">🔥 ${streak}</div><div class="lbl">current streak</div></div>
    <div class="stat-card"><div class="num">${longest}</div><div class="lbl">longest streak</div></div>
    <div class="stat-card"><div class="num">${dates.length}</div><div class="lbl">days tracked</div></div>
    <div class="stat-card"><div class="num">${nights}</div><div class="lbl">nights ≥ ${TARGET}h sleep</div></div>
    <div class="stat-card"><div class="num">${sleepDays ? (sleepSum/sleepDays).toFixed(1) : "0.0"}h</div><div class="lbl">avg sleep</div></div>
  </div>`;
}

// ---- 5. Day-of-week patterns ----
function renderInsightWeekday(map) {
  const dates = trackedDates(map);
  if (!dates.length) return emptyMsg("No weekday patterns yet.");
  const wdMins = {}, wdDays = [0,0,0,0,0,0,0];
  for (const d of dates) {
    const wd = weekdayOf(d); wdDays[wd]++;
    for (const s of SLOTS) {
      const b = map[d][s];
      if (b) {
        const catId = reportingCategoryForBlock(b);
        (wdMins[wd] = wdMins[wd] || {});
        wdMins[wd][catId] = (wdMins[wd][catId] || 0) + 30;
      }
    }
  }
  const maxAvg = Math.max(1, ...WD_ORDER.map((wd) => {
    const m = wdMins[wd] || {}; const tot = Object.values(m).reduce((a, b) => a + b, 0);
    return wdDays[wd] ? tot / 60 / wdDays[wd] : 0;
  }));
  return `<div class="stats-h">Average tracked per weekday</div>` + WD_ORDER.map((wd) => {
    const m = wdMins[wd] || {}; const totMin = Object.values(m).reduce((a, b) => a + b, 0);
    const avgH = wdDays[wd] ? (totMin / 60 / wdDays[wd]) : 0;
    let top = null, n = 0; for (const k in m) if (m[k] > n) { n = m[k]; top = k; }
    const label = WD_LABELS[wd] + (top ? ` · mostly ${catLabel(top)}` : "");
    return barRow(label, top ? catColor(top) : "#bbb", Math.round(avgH * 10) / 10, maxAvg);
  }).join("");
}

// ---- 6. Objective follow-through ----
function parseObjectiveLine(line) {
  let raw = (line || "").trim();
  const metadataMatch = raw.match(/\s*<!--day-link:([^:>]+):(\d{4}-\d{2}-\d{2})?:(\d{4}-\d{2}-\d{2})?-->\s*$/);
  const metadata = metadataMatch
    ? { linkId: metadataMatch[1], originDate: metadataMatch[2] || "", transferredTo: metadataMatch[3] || "" }
    : { linkId: "", originDate: "", transferredTo: "" };
  if (metadataMatch) raw = raw.slice(0, metadataMatch.index).trim();
  let remainder = raw.replace(/^[•\-*\d+.\s]*/, "");
  const check = remainder.match(/^\[([ xX])\]\s*(.*)$/);
  return {
    completed: !!check && check[1].toLowerCase() === "x",
    text: check ? check[2] : remainder,
    ...metadata,
  };
}

function renderTargetCard(type, note) {
  const lines = (note || "").split(/\r?\n/).map(parseObjectiveLine).filter((item) => item.text);
  if (!lines.length) return "";
  const isShort = type === "short";
  const title = isShort ? "Short-term" : "Long-term";
  const range = isShort ? "Next 1–4 weeks" : "Next few months";
  const items = lines.map((item) => `
    <div class="target-item${item.completed ? " completed" : ""}">
      <span class="target-dot"></span><span>${escapeHtml(item.text)}</span>
    </div>`).join("");
  return `<div class="target-card ${type}">
    <div class="target-card-head"><span class="target-card-title">${title}</span><span class="target-card-range">${range}</span></div>
    <div class="target-list">${items}</div>
  </div>`;
}

function renderInsightGoals(map) {
  const planned = Object.keys(map).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && map[d][PLAN_KEY] && map[d][PLAN_KEY].note).sort().reverse();
  const targetCards = renderTargetCard("short", shortTermObjectives) + renderTargetCard("long", longTermObjectives);
  const targetsHtml = targetCards
    ? `<div class="stats-h">Current targets</div><div class="target-cards">${targetCards}</div>`
    : "";
  if (!planned.length) {
    return targetsHtml || emptyMsg("Add a Today, Short-term, or Long-term objective to begin.");
  }
  
  let loggedDays = 0;
  let totalTasks = 0;
  let completedTasks = 0;
  
  const list = planned.map((d) => {
    const did = SLOTS.some((s) => map[d][s]);
    if (did) loggedDays++;
    
    const [y, m, da] = d.split("-").map(Number);
    const lbl = new Date(y, m - 1, da).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    
    const note = map[d][PLAN_KEY].note || "";
    const lines = note.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    
    let totalCount = 0;
    let completedCount = 0;
    let subListHtml = "";
    
    let subItemIndex = 0;
    lines.forEach((line) => {
      let isChecked = false;
      let cleanText = line;
      
      let bulletMatch = line.match(/^([•\-\*\d+\.\s]*)(.*)$/);
      let prefix = bulletMatch ? bulletMatch[1] : "";
      let remainder = bulletMatch ? bulletMatch[2] : line;
      
      let checkMatch = remainder.match(/^\[([ xX])\]\s*(.*)$/);
      if (checkMatch) {
        isChecked = checkMatch[1].toLowerCase() === "x";
        cleanText = checkMatch[2];
      } else {
        cleanText = remainder;
      }
      
      totalCount++;
      totalTasks++;
      if (isChecked) {
        completedCount++;
        completedTasks++;
      }
      
      const itemClass = isChecked ? "goal-sub-item completed" : "goal-sub-item";
      subListHtml += `
        <div class="${itemClass}" data-date="${d}" data-idx="${subItemIndex}">
          <span class="goal-sub-dot ${isChecked ? 'met' : 'unmet'}"></span>
          <span class="goal-sub-text">${escapeHtml(cleanText)}</span>
        </div>`;
      subItemIndex++;
    });

    // Colour the day badge: green if all met, amber if partial, red if none
    const ratio = totalCount > 0 ? completedCount / totalCount : 0;
    const badgeClass = completedCount === totalCount && totalCount > 0 ? "goal-badge-all"
      : ratio >= 0.5 ? "goal-badge-some"
      : completedCount > 0 ? "goal-badge-few"
      : "goal-badge-none";
    
    return `
      <div class="goal-row">
        <div class="goal-row-header">
          <div class="goal-day-info">
            <span class="goal-date">${lbl}</span>
            <span class="goal-day-stats ${badgeClass}">${completedCount}/${totalCount} met</span>
          </div>
        </div>
        <div class="goal-sub-list">
          ${subListHtml}
        </div>
      </div>`;
  }).join("");
  
  const consistencyRate = Math.round((loggedDays / planned.length) * 100);
  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  
  return targetsHtml + `
    <div class="stat-cards">
      <div class="stat-card">
        <div class="num">${completionRate}%</div>
        <div class="lbl">objectives met (${completedTasks}/${totalTasks})</div>
      </div>
      <div class="stat-card">
        <div class="num">${consistencyRate}%</div>
        <div class="lbl">logging consistency (${loggedDays}/${planned.length} days)</div>
      </div>
    </div>
    <div class="stats-h">Objectives History</div>
    ${list}`;
}

function toggleInsightObjective(dateStr, idx) {
  const day = loadLocal(dateStr);
  const todaysPlan = day[PLAN_KEY] && day[PLAN_KEY].note;
  if (!todaysPlan) return;

  let lines = todaysPlan.split(/\r?\n/);
  let nonElLineIndices = [];
  lines.forEach((line, index) => {
    if (line.trim() !== "") {
      nonElLineIndices.push(index);
    }
  });

  const targetOriginalIndex = nonElLineIndices[idx];
  if (targetOriginalIndex === undefined) return;

  const line = lines[targetOriginalIndex];
  let cleanLine = line.trim();

  let bulletMatch = cleanLine.match(/^([•\-\*\d+\.\s]*)(.*)$/);
  let prefix = bulletMatch ? bulletMatch[1] : "";
  let remainder = bulletMatch ? bulletMatch[2] : cleanLine;

  let checkMatch = remainder.match(/^\[([ xX])\]\s*(.*)$/);
  let newLine;
  if (checkMatch) {
    const isChecked = checkMatch[1].toLowerCase() === "x";
    const text = checkMatch[2];
    const newCheck = isChecked ? "[ ]" : "[x]";
    newLine = `${prefix}${newCheck} ${text}`;
  } else {
    newLine = `${prefix}[x] ${remainder}`;
  }

  lines[targetOriginalIndex] = newLine;
  const newNote = lines.join("\n");
  const block = { category: "plan", note: newNote };
  day[PLAN_KEY] = block;
  saveLocal(dateStr, day);
  pushBlocks(dateStr, [PLAN_KEY], block);

  if (ymd(current) === dateStr) {
    data[PLAN_KEY] = block;
    render();
  }

  renderInsight();
}

// ====================================================================
//  Gym Tracker
// ====================================================================

// -- Data helpers --
function gymLocalKey(dateStr) { return "day_data_" + dateStr; }
function loadGym(dateStr) {
  const day = loadLocal(dateStr);
  const raw = day[GYM_KEY];
  if (!raw) return { weight: null, sessions: [] };
  try { return JSON.parse(raw.note || "{}"); } catch { return { weight: null, sessions: [] }; }
}
function saveGym(dateStr, gymObj) {
  const day = loadLocal(dateStr);
  const block = { category: "gym", note: JSON.stringify(gymObj) };
  day[GYM_KEY] = block;
  saveLocal(dateStr, day);
  pushBlocks(dateStr, [GYM_KEY], block);
}

// -- Dedicated gym logging sheet (separate from the main time-block sheet) --
function openGymLogger() {
  const dateStr = ymd(current);
  const gym = loadGym(dateStr);
  const el = document.getElementById("gymSheet");

  // Populate inputs
  document.getElementById("gymWeight").value = gym.weight !== null ? gym.weight : "";

  // Render saved sessions
  const sessEl = document.getElementById("gymSessions");
  sessEl.innerHTML = "";
  const sessions = gym.sessions || [];
  sessions.forEach((s, i) => addSessionRow(s, i));

  document.getElementById("gymBackdrop").hidden = false;
}
function closeGymLogger() {
  document.getElementById("gymBackdrop").hidden = true;
}

function addSessionRow(s, idx) {
  const container = document.getElementById("gymSessions");
  const row = document.createElement("div");
  row.className = "gym-session-row";
  row.dataset.idx = idx !== undefined ? idx : container.children.length;
  row.innerHTML = `
    <input class="gym-input" type="text" placeholder="Exercise (e.g. Bench press)" value="${s ? escapeHtml(s.exercise || "") : ""}">
    <input class="gym-input gym-num" type="number" min="1" placeholder="Sets" value="${s ? (s.sets || "") : ""}">
    <input class="gym-input gym-num" type="number" min="1" placeholder="Reps" value="${s ? (s.reps || "") : ""}">
    <input class="gym-input gym-num" type="number" min="0" step="0.5" placeholder="kg" value="${s ? (s.kg !== undefined ? s.kg : "") : ""}">
    <button class="gym-remove-btn" aria-label="Remove" title="Remove">×</button>
  `;
  row.querySelector(".gym-remove-btn").addEventListener("click", () => row.remove());
  container.appendChild(row);
}

function saveGymLogger() {
  const dateStr = ymd(current);
  const weightVal = document.getElementById("gymWeight").value.trim();
  const weight = weightVal !== "" ? parseFloat(weightVal) : null;

  const sessions = [];
  document.querySelectorAll(".gym-session-row").forEach((row) => {
    const inputs = row.querySelectorAll("input");
    const exercise = inputs[0].value.trim();
    const sets = parseInt(inputs[1].value, 10);
    const reps = parseInt(inputs[2].value, 10);
    const kgVal = inputs[3].value.trim();
    if (exercise) {
      const obj = { exercise };
      if (!isNaN(sets)) obj.sets = sets;
      if (!isNaN(reps)) obj.reps = reps;
      if (kgVal !== "") obj.kg = parseFloat(kgVal);
      sessions.push(obj);
    }
  });

  saveGym(dateStr, { weight, sessions });
  closeGymLogger();
  setStatus("ok", "Gym saved ✓");
  setTimeout(() => setStatus("", ""), 2000);
}

// -- Insights renderer --
function renderInsightGym(map) {
  const timelineDays = trackedDates(map).filter((d) => SLOTS.some((s) => isGymBlock(map[d][s])));
  const legacyDays = Object.keys(map)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && map[d][GYM_KEY]);
  const days = Array.from(new Set(timelineDays.concat(legacyDays))).sort().reverse();

  if (!days.length) {
    return `<div class="stats-empty">No gym sessions logged yet.<br>Tap Gym to log the current time block.</div>`;
  }

  let totalSlots = 0;
  let daysWithTimelineGym = 0;
  const sessionsByDay = {};
  for (const d of timelineDays) {
    const count = SLOTS.filter((s) => isGymBlock(map[d][s])).length;
    totalSlots += count;
    if (count) daysWithTimelineGym++;

    const slotRows = [];
    let active = null;
    for (const s of SLOTS) {
      const b = map[d][s];
      const key = isGymBlock(b) ? `${b.category}\0${b.sub || ""}\0${b.note || ""}` : null;
      // A visit is one contiguous run of Gym blocks. Exercise details may
      // legitimately differ between adjacent blocks and must not split it.
      if (key && active && SLOTS.indexOf(s) === SLOTS.indexOf(active.last) + 1) {
        active.last = s;
      } else {
        if (active) slotRows.push(active);
        active = key ? { key, first: s, last: s, block: b } : null;
      }
    }
    if (active) slotRows.push(active);
    sessionsByDay[d] = slotRows;
  }
  const sessionCount = Object.values(sessionsByDay).reduce((sum, rows) => sum + rows.length, 0);
  const avgSession = sessionCount ? (totalSlots / 2) / sessionCount : 0;

  const cards = `<div class="stat-cards">
    <div class="stat-card"><div class="num">${fmtH(totalSlots / 2)}</div><div class="lbl">gym time logged</div></div>
    <div class="stat-card"><div class="num">${daysWithTimelineGym}</div><div class="lbl">days with gym blocks</div></div>
    <div class="stat-card"><div class="num">${sessionCount}</div><div class="lbl">sessions logged</div></div>
    <div class="stat-card"><div class="num">${fmtH(avgSession)}</div><div class="lbl">avg session</div></div>
  </div>`;

  // Weight history (mini chart using bar widths)
  const weightDays = legacyDays.sort().reverse().filter((d) => {
    const raw = map[d][GYM_KEY];
    try { const g = JSON.parse(raw.note || "{}"); return g.weight != null; } catch { return false; }
  }).slice(0, 14).reverse();

  let weightHtml = "";
  if (weightDays.length > 0) {
    const weights = weightDays.map((d) => {
      try { return JSON.parse(map[d][GYM_KEY].note || "{}").weight; } catch { return null; }
    }).filter((w) => w != null);
    const minW = Math.min(...weights) - 1;
    const maxW = Math.max(...weights) + 1;
    const range = maxW - minW || 1;

    const bars = weightDays.map((d, i) => {
      const w = weights[i];
      if (w == null) return "";
      const pct = ((w - minW) / range) * 100;
      const [y, mo, da] = d.split("-").map(Number);
      const lbl = new Date(y, mo - 1, da).toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
      return `<div class="bar-row">
        <div class="bar-label"><span class="dot" style="background:#e08a4a"></span>${lbl}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:#e08a4a"></div></div>
        <div class="bar-val">${w} kg</div>
      </div>`;
    }).join("");

    weightHtml = `<div class="stats-h">Weight history (kg)</div>${bars}`;
  }

  // Session log: prefer normal timeline blocks, then show older structured logs.
  const sessionHtml = days.slice(0, 20).map((d) => {
    const [y, mo, da] = d.split("-").map(Number);
    const lbl = new Date(y, mo - 1, da).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    const slotRows = sessionsByDay[d] || [];

    const timelineRows = slotRows.map((r) => {
      const endSlot = SLOTS[(SLOTS.indexOf(r.last) + 1) % 48] || "00:00";
      const label = gymWorkoutSummary(r.block.note) || r.block.sub || "Gym";
      const detail = `${to12(r.first)} - ${to12(endSlot)}`;
      return `<div class="gym-log-row"><span class="gym-log-exercise">${escapeHtml(label)}</span><span class="gym-log-detail">${detail}</span></div>`;
    }).join("");

    let gym = null;
    if (map[d][GYM_KEY]) {
      try { gym = JSON.parse(map[d][GYM_KEY].note || "{}"); } catch {}
    }
    const weightTag = gym && gym.weight != null ? `<span class="gym-weight-tag">${gym.weight} kg</span>` : "";
    const legacyRows = gym ? (gym.sessions || []).map((s) => {
      const detail = [s.sets ? `${s.sets}x` : "", s.reps ? `${s.reps}` : "", s.kg !== undefined ? ` @ ${s.kg} kg` : ""].join("");
      return `<div class="gym-log-row"><span class="gym-log-exercise">${escapeHtml(s.exercise || "Gym detail")}</span><span class="gym-log-detail">${escapeHtml(detail)}</span></div>`;
    }).join("") : "";

    return `<div class="goal-row">
      <div class="goal-row-header">
        <div class="goal-day-info">
          <span class="goal-date">${lbl}</span>${weightTag}
        </div>
      </div>
      ${timelineRows || ""}
      ${legacyRows || ""}
      ${(!timelineRows && !legacyRows && weightTag) ? `<div class="gym-log-row"><span class="gym-log-exercise" style="color:var(--text-faint)">Weight only</span></div>` : ""}
    </div>`;
  }).join("");

  return cards + weightHtml + `<div class="stats-h">Session log</div>` + sessionHtml;
}

// ---- menu + page routing ----
function openInsightsMenu() {
  const list = document.getElementById("menuList");
  list.innerHTML = "";
  for (const it of INSIGHTS) {
    if (it.menu === false) continue;
    const btn = document.createElement("button");
    btn.className = "menu-item";
    btn.innerHTML = `<span class="menu-icon">${it.icon}</span><span class="menu-text"><span class="menu-title">${it.title}</span><span class="menu-desc">${it.desc}</span></span>`;
    btn.addEventListener("click", () => { closeInsightsMenu(); openInsight(it.id); });
    list.appendChild(btn);
  }
  document.getElementById("insightsMenu").hidden = false;
}
function closeInsightsMenu() { document.getElementById("insightsMenu").hidden = true; }

function openInsight(id) {
  currentInsight = INSIGHTS.find((i) => i.id === id);
  document.getElementById("insightTitle").textContent = currentInsight.title;
  document.getElementById("insightScreen").hidden = false;
  renderInsight();
}
function closeInsight() { document.getElementById("insightScreen").hidden = true; }

async function renderInsight() {
  if (!currentInsight) return;
  const body = document.getElementById("insightBody");
  
  const map = gatherLocalRange(insightRange);
  body.innerHTML = currentInsight.fn(map);
  
  if (sb) {
    let start = null;
    if (insightRange > 0) {
      const d = new Date(); d.setDate(d.getDate() - (insightRange - 1)); start = ymd(d);
    }
    try {
      let q = sb.from("blocks").select("date,start_time,category,note,subcategory").eq("user_id", USER_ID).lte("date", ymd(new Date()));
      if (start) q = q.gte("date", start);
      const { data: rows, error } = await q;
      if (!error && rows) {
        let changed = false;
        for (const r of rows) {
          const oldDay = map[r.date] || {};
          const oldBlock = oldDay[r.start_time];
          if (!oldBlock || oldBlock.category !== r.category || oldBlock.note !== (r.note || "") || oldBlock.sub !== (r.subcategory || "")) {
            (map[r.date] = map[r.date] || {})[r.start_time] = { category: r.category, note: r.note || "", sub: r.subcategory || "" };
            changed = true;
          }
        }
        if (changed) {
          for (const d of Object.keys(map)) {
            saveLocal(d, map[d]);
          }
          body.innerHTML = currentInsight.fn(map);
        }
      }
    } catch (e) { console.warn(e); }
  }
}

// ---- Navigation ----
function goto(d) {
  saveObjectiveInput();
  saveReflection();
  current = d;
  data = loadLocal(ymd(current));
  render();
  const pull = pullDay(ymd(current));
  // On today, start the view at the current time.
  const nowBlock = document.getElementById("nowBlock");
  if (nowBlock) nowBlock.scrollIntoView({ block: "center" });
  return pull;
}

window.addEventListener("beforeunload", () => {
  saveObjectiveInput();
  saveReflection();
});

// ---- Wire up ----
document.getElementById("prevDay").addEventListener("click", () => {
  const d = new Date(current); d.setDate(d.getDate() - 1); goto(d);
});
document.getElementById("nextDay").addEventListener("click", () => {
  const d = new Date(current); d.setDate(d.getDate() + 1); goto(d);
});
document.getElementById("todayBtn").addEventListener("click", () => goto(new Date()));
document.getElementById("statsBtn").addEventListener("click", openStats);
document.getElementById("plannerBack").addEventListener("click", closePlanner);
document.getElementById("plannerToday").addEventListener("click", () => {
  plannerDate = new Date();
  plannerDate.setHours(12, 0, 0, 0);
  plannerSelectedTask = -1;
  refreshPlannerData();
});
document.getElementById("plannerPrev").addEventListener("click", () => movePlannerDate(-1));
document.getElementById("plannerNext").addEventListener("click", () => movePlannerDate(1));
document.getElementById("plannerAddTask").addEventListener("click", addPlannerTask);
document.getElementById("plannerTaskInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); addPlannerTask(); }
});
document.getElementById("plannerTaskList").addEventListener("click", (event) => {
  const row = event.target.closest(".planner-task[data-planner-index]");
  const toggle = event.target.closest("button[data-planner-toggle]");
  const move = event.target.closest("button[data-planner-move]");
  const remove = event.target.closest("button[data-planner-remove]");
  if (row) plannerSelectedTask = parseInt(row.dataset.plannerIndex, 10);
  if (toggle) updatePlannerTask(parseInt(toggle.dataset.plannerToggle, 10), "toggle");
  else if (move) movePlannerTaskToNextDay(parseInt(move.dataset.plannerMove, 10));
  else if (remove) updatePlannerTask(parseInt(remove.dataset.plannerRemove, 10), "remove");
  else if (row) renderPlanner();
});
document.getElementById("plannerScheduleList").addEventListener("click", (event) => {
  const slot = event.target.closest("button[data-planner-slot]");
  if (slot) openPlannerSlot(slot.dataset.plannerSlot);
});
document.getElementById("plannerOpenDay").addEventListener("click", openPlannerDay);
document.addEventListener("keydown", handlePlannerKeyboard);
document.getElementById("helpBtn").addEventListener("click", openKeyboardHelp);
document.getElementById("helpClose").addEventListener("click", closeKeyboardHelp);
document.getElementById("helpDialog").addEventListener("click", (event) => {
  if (event.target.id === "helpDialog") closeKeyboardHelp();
});
document.addEventListener("keydown", handleKeyboardHelp);
document.getElementById("calendarBtn").addEventListener("click", openCalendar);
document.getElementById("calendarBack").addEventListener("click", closeCalendar);
document.getElementById("calendarMultiSelect").addEventListener("click", toggleCalendarMultiMode);
document.getElementById("calendarPrev").addEventListener("click", () => moveCalendarMonth(-1));
document.getElementById("calendarNext").addEventListener("click", () => moveCalendarMonth(1));
document.getElementById("calendarToday").addEventListener("click", () => {
  const today = new Date();
  calendarMonth = new Date(today.getFullYear(), today.getMonth(), 1, 12);
  selectedCalendarDate = ymd(today);
  renderCalendar();
  pullCalendarMonth();
});
document.getElementById("calendarGrid").addEventListener("pointerdown", (event) => {
  const button = event.target.closest("button.calendar-day[data-date]");
  if (!button || event.button !== 0) return;
  clearTimeout(calendarLongPressTimer);
  const delay = calendarMultiMode ? 180 : 380;
  calendarLongPressTimer = setTimeout(() => beginCalendarRangeSelection(button.dataset.date, event.pointerId), delay);
});
document.getElementById("calendarGrid").addEventListener("pointermove", (event) => {
  if (!calendarDragging) return;
  event.preventDefault();
  updateCalendarRangeSelection(calendarDateAtPoint(event.clientX, event.clientY));
});
document.getElementById("calendarGrid").addEventListener("pointerup", (event) => finishCalendarRangeSelection(event.pointerId));
document.getElementById("calendarGrid").addEventListener("pointercancel", (event) => finishCalendarRangeSelection(event.pointerId));
document.addEventListener("pointerup", (event) => {
  if (calendarLongPressTimer || calendarDragging) finishCalendarRangeSelection(event.pointerId);
});
document.addEventListener("pointercancel", (event) => {
  if (calendarLongPressTimer || calendarDragging) finishCalendarRangeSelection(event.pointerId);
});
document.getElementById("calendarGrid").addEventListener("click", (e) => {
  if (suppressCalendarClick) { e.preventDefault(); return; }
  clearTimeout(calendarLongPressTimer);
  calendarLongPressTimer = null;
  const button = e.target.closest("button[data-date]");
  if (!button) return;
  const dateStr = button.dataset.date;
  if (calendarMultiMode) {
    if (selectedCalendarDates.has(dateStr)) selectedCalendarDates.delete(dateStr);
    else selectedCalendarDates.add(dateStr);
  } else {
    selectedCalendarDate = dateStr;
  }
  renderCalendar();
});
document.getElementById("calendarMultiActions").addEventListener("click", (e) => {
  const button = e.target.closest("button[data-day-status]");
  if (button) applyCalendarDayStatus(button.dataset.dayStatus);
});
document.getElementById("calendarClearStatus").addEventListener("click", () => applyCalendarDayStatus(null));
document.getElementById("calendarDayPreview").addEventListener("click", (e) => {
  const removeRough = e.target.closest("button[data-remove-rough-plan]");
  if (removeRough && selectedCalendarDate) {
    removeRoughPlan(selectedCalendarDate, parseInt(removeRough.dataset.removeRoughPlan, 10));
    return;
  }
  const item = e.target.closest("button[data-preview-start][data-preview-end]");
  if (!item) return;
  editCalendarPreviewItem(parseInt(item.dataset.previewStart, 10), parseInt(item.dataset.previewEnd, 10));
});
document.getElementById("calendarOpenDay").addEventListener("click", () => openSelectedCalendarDate(false));
document.getElementById("calendarPlanEvent").addEventListener("click", () => openSelectedCalendarDate(true));
document.getElementById("calendarRoughAdd").addEventListener("click", async () => {
  const input = document.getElementById("calendarRoughInput");
  const text = input.value.trim();
  if (selectedCalendarDate && await addRoughPlanToDates([selectedCalendarDate], text)) {
    saveRoughPlanReminder(selectedCalendarDate, text, document.getElementById("calendarRoughReminder").value);
    input.value = "";
    document.getElementById("calendarRoughReminder").value = "none";
    renderCalendar();
  }
});
document.getElementById("calendarRoughInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); document.getElementById("calendarRoughAdd").click(); }
});
document.getElementById("calendarMultiRoughAdd").addEventListener("click", async () => {
  const input = document.getElementById("calendarMultiRoughInput");
  if (await addRoughPlanToDates([...selectedCalendarDates], input.value)) input.value = "";
});
document.getElementById("calendarMultiRoughInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); document.getElementById("calendarMultiRoughAdd").click(); }
});
document.getElementById("gymBtn").addEventListener("click", () => openInsight("gym"));
document.getElementById("gymBackdrop").addEventListener("click", (e) => {
  if (e.target.id === "gymBackdrop") closeGymLogger();
});
document.getElementById("gymSaveBtn").addEventListener("click", saveGymLogger);
document.getElementById("gymCancelBtn").addEventListener("click", closeGymLogger);
document.getElementById("gymAddSetBtn").addEventListener("click", () => addSessionRow(null));
document.getElementById("addInlineExercise").addEventListener("click", () => addGymInlineRow(null));
document.getElementById("statsBack").addEventListener("click", closeStats);
document.getElementById("rangeSeg").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-range]");
  if (!btn) return;
  statsRange = parseInt(btn.dataset.range, 10);
  document.querySelectorAll("#rangeSeg button").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  renderStats();
});
document.getElementById("insightsBtn").addEventListener("click", openInsightsMenu);
document.getElementById("insightsMenu").addEventListener("click", (e) => {
  if (e.target.id === "insightsMenu") closeInsightsMenu();
});
document.getElementById("insightBack").addEventListener("click", closeInsight);
document.getElementById("insightRangeSeg").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-range]");
  if (!btn) return;
  insightRange = parseInt(btn.dataset.range, 10);
  document.querySelectorAll("#insightRangeSeg button").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  renderInsight();
});
document.getElementById("insightBody").addEventListener("click", (e) => {
  const item = e.target.closest(".goal-sub-item[data-date][data-idx]");
  if (!item) return;
  const dateStr = item.dataset.date;
  const idx = parseInt(item.dataset.idx, 10);
  toggleInsightObjective(dateStr, idx);
});
document.getElementById("exportBtn").addEventListener("click", exportData);
document.getElementById("recoveryExport").addEventListener("click", exportData);
document.getElementById("importBtn").addEventListener("click", () => document.getElementById("importFile").click());
document.getElementById("importFile").addEventListener("change", async (event) => {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  await restoreData(file);
});
document.getElementById("activitySearch").addEventListener("input", (e) => {
  if (!selectedActivityLabel || e.target.value.trim().toLowerCase() !== selectedActivityLabel.toLowerCase()) {
    selectedActivityLabel = null;
    selectedSub = null;
    document.getElementById("areaPicker").hidden = true;
  }
  renderCatGrid();
});
document.getElementById("activitySearch").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    createActivityFromSearch();
  }
});
// Bullet point auto-formatting and list continuation
const handleListKeydown = (e) => {
  if (e.key === "Enter") {
    const el = e.target;
    const val = el.value;
    const pos = el.selectionStart;
    
    // Find beginning of current line
    const lastNewline = val.lastIndexOf("\n", pos - 1);
    const lineStart = lastNewline + 1;
    const currentLine = val.substring(lineStart, pos);
    
    // Match bullet or checklist prefixes
    const match = currentLine.match(/^([•\-\*\d+\.\s]*(\[[ xX]\])?\s*)/);
    if (match && match[1]) {
      const prefix = match[1];
      const remainder = currentLine.substring(prefix.length).trim();
      
      e.preventDefault();
      
      if (remainder === "") {
        // Clear empty bullet line on Enter to end the list
        const newVal = val.substring(0, lineStart) + val.substring(pos);
        el.value = newVal;
        el.selectionStart = el.selectionEnd = lineStart;
      } else {
        // Continue list prefix
        let nextPrefix = prefix;
        const numMatch = prefix.match(/^(\d+)(\.\s*)/);
        if (numMatch) {
          nextPrefix = (parseInt(numMatch[1], 10) + 1) + numMatch[2];
        } else if (prefix.includes("[x]")) {
          nextPrefix = prefix.replace("[x]", "[ ]");
        } else if (prefix.includes("[X]")) {
          nextPrefix = prefix.replace("[X]", "[ ]");
        }
        
        const insertion = "\n" + nextPrefix;
        const newVal = val.substring(0, pos) + insertion + val.substring(pos);
        el.value = newVal;
        el.selectionStart = el.selectionEnd = pos + insertion.length;
      }
      el.dispatchEvent(new Event("input"));
    }
  }
};

const handleListInput = (e) => {
  const el = e.target;
  const val = el.value;
  // Automatically prepend a bullet point if they start typing the first character and it's not a bullet/list character
  if (val.length === 1 && !/^[-*•\d+\[]/.test(val)) {
    el.value = "• " + val;
    el.selectionStart = el.selectionEnd = 3;
    el.dispatchEvent(new Event("input"));
  }
};

let planDebounceTimer = null;
const handleObjectiveInputDebounced = (e) => {
  handleListInput(e);
  clearTimeout(planDebounceTimer);
  planDebounceTimer = setTimeout(() => {
    saveObjectiveInput();
  }, 350);
};

document.getElementById("reflectInput").addEventListener("blur", saveReflection);
document.getElementById("reflectInput").addEventListener("keydown", handleListKeydown);
document.getElementById("reflectInput").addEventListener("input", handleListInput);
document.getElementById("objectiveHorizonSeg").addEventListener("click", (e) => {
  const button = e.target.closest("button[data-objective-horizon]");
  if (button) selectObjectiveHorizon(button.dataset.objectiveHorizon);
});
document.getElementById("diaryTargetAdd").addEventListener("click", addDiaryTarget);
document.getElementById("diaryTargetInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); addDiaryTarget(); }
});
document.getElementById("diaryTargetList").addEventListener("click", (event) => {
  const row = event.target.closest(".diary-target-item[data-diary-target-index]");
  const toggle = event.target.closest("button[data-diary-target-toggle]");
  const move = event.target.closest("button[data-diary-target-move]");
  const remove = event.target.closest("button[data-diary-target-remove]");
  if (row) diaryTargetSelected = parseInt(row.dataset.diaryTargetIndex, 10);
  if (toggle) updateDiaryTarget(parseInt(toggle.dataset.diaryTargetToggle, 10), "toggle");
  else if (move) moveDiaryTargetToTomorrow(parseInt(move.dataset.diaryTargetMove, 10));
  else if (remove) updateDiaryTarget(parseInt(remove.dataset.diaryTargetRemove, 10), "remove");
  else if (row) { renderDiaryTargets(); focusDiaryTargetSelected(); }
});
document.addEventListener("keydown", handleDiaryTargetKeyboard);
document.getElementById("addEventBtn").addEventListener("click", openEventSheet);
document.getElementById("eventReminderDismiss").addEventListener("click", () => {
  const banner = document.getElementById("eventReminderBanner");
  const reminder = storedEventReminders().find((item) => item.id === banner.dataset.reminderId && item.dateStr === banner.dataset.reminderDate);
  if (reminder) updateStoredReminder(reminder, { dismissed: true });
  renderEventReminderBanner();
});
document.getElementById("eventTimePresets").addEventListener("click", (e) => {
  const button = e.target.closest("button[data-event-preset]");
  if (button) selectEventPreset(button.dataset.eventPreset);
});
document.getElementById("eventStart").addEventListener("change", updateEventRange);
document.getElementById("eventEnd").addEventListener("change", updateEventRange);
document.getElementById("saveBlock").addEventListener("click", saveSheet);
document.getElementById("clearBlock").addEventListener("click", clearSheet);
document.getElementById("sheetBackdrop").addEventListener("click", (e) => {
  if (e.target.id === "sheetBackdrop") closeSheet();
});

// ---- Auth ----
function applySession(session) {
  const uid = (session && session.user && session.user.id) || null;
  if (uid && uid === USER_ID) return; // already logged in as this user
  USER_ID = uid;
  if (uid) {
    document.getElementById("authScreen").hidden = true;
    document.getElementById("app").hidden = false;
    pullSettings()
      .then(() => migrateHistoricalCategories())
      .catch((e) => console.warn("Category migration will retry next time", e))
      .finally(() => {
        goto(new Date());
        pullUpcomingReminders();
      });
  } else {
    document.getElementById("app").hidden = true;
    document.getElementById("statsScreen").hidden = true;
    document.getElementById("plannerScreen").hidden = true;
    document.getElementById("calendarScreen").hidden = true;
    document.getElementById("insightScreen").hidden = true;
    document.getElementById("insightsMenu").hidden = true;
    document.getElementById("helpDialog").hidden = true;
    document.getElementById("authScreen").hidden = false;
  }
}

async function sendMagicLink() {
  const email = document.getElementById("authEmail").value.trim();
  const msg = document.getElementById("authMsg");
  if (!sb) {
    msg.textContent = "Add Supabase settings below first.";
    document.getElementById("authSetup").hidden = false;
    return;
  }
  if (!email) { msg.textContent = "Enter your email first."; return; }
  msg.textContent = "Sending…";
  try {
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.href.split("#")[0] },
    });
    msg.textContent = error ? ("Error: " + error.message)
      : "✉️ Check your email for the login link.";
  } catch (e) {
    msg.textContent = "Error: " + e.message;
  }
}

async function saveBrowserSupabaseConfig() {
  const url = document.getElementById("supabaseUrl").value.trim();
  const key = document.getElementById("supabaseKey").value.trim();
  const msg = document.getElementById("authMsg");
  if (!url || !key) {
    msg.textContent = "Paste both your Supabase URL and anon key.";
    return;
  }
  localStorage.setItem("day_supabase_config", JSON.stringify({
    SUPABASE_URL: url,
    SUPABASE_ANON_KEY: key,
  }));
  configureSupabase();
  if (!sb) {
    msg.textContent = "Could not initialise Supabase. Check the URL/key.";
    return;
  }
  msg.textContent = "Supabase saved. Now send yourself a login link.";
}

function wireAuthControls() {
  document.getElementById("authSend").addEventListener("click", sendMagicLink);
  document.getElementById("authEmail").addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMagicLink();
  });
  document.getElementById("saveSupabaseConfig").addEventListener("click", saveBrowserSupabaseConfig);
}

async function initAuth() {
  wireAuthControls();
  if (RECOVERY_MODE) {
    sb = null;
    USER_ID = "local-recovery";
    document.body.classList.add("recovery-mode");
    document.getElementById("authScreen").hidden = true;
    document.getElementById("app").hidden = false;
    document.getElementById("recoveryBanner").hidden = false;
    loadSettingsLocal();
    current = new Date();
    data = loadLocal(ymd(current));
    render();
    setStatus("err", "Recovery mode");
    return;
  }
  if (!sb) {
    document.getElementById("app").hidden = true;
    document.getElementById("authScreen").hidden = false;
    document.getElementById("authSetup").hidden = false;
    document.getElementById("authMsg").textContent =
      "Supabase isn't configured yet.";
    return;
  }
  document.getElementById("signOut").addEventListener("click", () => sb.auth.signOut());
  sb.auth.onAuthStateChange((_e, session) => applySession(session));
  const { data: authData } = await sb.auth.getSession();
  applySession(authData.session);
}

// ---- Boot ----
initAuth();
setInterval(renderEventReminderBanner, 30000);
setInterval(pullUpcomingReminders, 6 * 60 * 60 * 1000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) renderEventReminderBanner(); });

// ---- Google Calendar Sync Module ----

let gcalToken = localStorage.getItem("gcal_access_token") || sessionStorage.getItem("gcal_access_token") || null;
let tokenClient = null;

function getGoogleClientId() {
  return window.APP_CONFIG?.GOOGLE_CLIENT_ID || "";
}

function updateGCalUI() {
  const statusEl = document.getElementById("gcalStatus");
  const connectBtn = document.getElementById("gcalConnectBtn");
  const fetchBtn = document.getElementById("gcalFetchBtn");
  const msgEl = document.getElementById("gcalMsg");

  if (gcalToken) {
    if (statusEl) {
      statusEl.textContent = "Connected";
      statusEl.classList.add("connected");
    }
    if (connectBtn) connectBtn.textContent = "Reconnect GCal";
    if (fetchBtn) fetchBtn.hidden = false;
  } else {
    if (statusEl) {
      statusEl.textContent = "Not connected";
      statusEl.classList.remove("connected");
    }
    if (connectBtn) connectBtn.textContent = "Connect Google Calendar";
    if (fetchBtn) fetchBtn.hidden = true;
  }
}

function initGCalAuth() {
  const clientId = getGoogleClientId();
  const msgEl = document.getElementById("gcalMsg");

  if (!clientId) {
    window.alert("Error: GOOGLE_CLIENT_ID is missing in config.js.");
    if (msgEl) msgEl.textContent = "Error: GOOGLE_CLIENT_ID missing in config.js";
    return;
  }

  if (typeof google === "undefined" || !google.accounts || !google.accounts.oauth2) {
    window.alert("Google Identity script is still loading or blocked by a browser extension. Please refresh the page.");
    if (msgEl) msgEl.textContent = "Google Identity script loading... Try again in a moment.";
    return;
  }

  try {
    if (!tokenClient) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: "https://www.googleapis.com/auth/calendar.events.readonly",
        callback: (response) => {
          if (response.error) {
            console.error("GCal OAuth error:", response);
            window.alert("Google authentication error: " + (response.error_description || response.error));
            if (msgEl) msgEl.textContent = "Authentication failed: " + (response.error_description || response.error);
            return;
          }
          gcalToken = response.access_token;
          localStorage.setItem("gcal_access_token", gcalToken);
          sessionStorage.setItem("gcal_access_token", gcalToken);
          updateGCalUI();
          window.alert("Successfully connected to Google Calendar! Syncing events...");
          fetchGCalEvents(ymd(current));
        },
      });
    }

    tokenClient.requestAccessToken({ prompt: "consent" });
  } catch (err) {
    console.error("GCal Auth error:", err);
    window.alert("Could not trigger Google Login popup: " + err.message);
  }
}

function gcalSlotsForEvent(event, dateStr) {
  if (!event?.start?.dateTime) return event?.start?.date === dateStr ? ["00:00"] : [];

  const eventStart = new Date(event.start.dateTime);
  const eventEnd = event?.end?.dateTime
    ? new Date(event.end.dateTime)
    : new Date(eventStart.getTime() + 30 * 60 * 1000);
  if (!Number.isFinite(eventStart.getTime()) || !Number.isFinite(eventEnd.getTime()) || eventEnd <= eventStart) return [];

  const dayStart = new Date(`${dateStr}T00:00:00`);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  return SLOTS.filter((slot) => {
    const [hours, minutes] = slot.split(":").map(Number);
    const slotStart = new Date(dayStart);
    slotStart.setHours(hours, minutes, 0, 0);
    const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000);
    return eventStart < slotEnd && eventEnd > slotStart && slotStart < dayEnd;
  });
}

async function fetchGCalEvents(dateStr) {
  const msgEl = document.getElementById("gcalMsg");
  if (!gcalToken) {
    initGCalAuth();
    return;
  }

  const dateObj = new Date(dateStr + "T00:00:00");
  const timeMin = dateObj.toISOString();
  const dateEndObj = new Date(dateStr + "T23:59:59");
  const timeMax = dateEndObj.toISOString();

  if (msgEl) msgEl.textContent = "Fetching events for " + dateStr + "...";

  try {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime`,
      {
        headers: {
          Authorization: `Bearer ${gcalToken}`,
        },
      }
    );

    if (res.status === 401) {
      gcalToken = null;
      localStorage.removeItem("gcal_access_token");
      sessionStorage.removeItem("gcal_access_token");
      updateGCalUI();
      if (msgEl) msgEl.textContent = "Session expired. Please reconnect Google Calendar.";
      return;
    }

    const json = await res.json();
    if (!json.items) {
      if (msgEl) msgEl.textContent = "No events returned: " + (json.error?.message || "Unknown response");
      return;
    }

    const events = json.items;
    if (events.length === 0) {
      if (msgEl) msgEl.textContent = `No Google Calendar events found for ${dateStr}.`;
      return;
    }

    let addedCount = 0;
    let addedBlockCount = 0;
    const dateData = loadLocal(dateStr);
    const supabaseRows = [];

    for (const ev of events) {
      if (!ev.start || (!ev.start.dateTime && !ev.start.date)) continue;
      const title = ev.summary || "Google Calendar Event";
      const block = {
        category: "work",
        note: `[GCal] ${title}`,
        sub: "Google Calendar",
      };
      let eventAdded = false;

      for (const slotTime of gcalSlotsForEvent(ev, dateStr)) {
        const existing = dateData[slotTime];
        const sameImportedEvent = existing
          && existing.note === block.note
          && existing.sub === block.sub;

        // Keep manual entries and other events intact. Re-save matching GCal
        // blocks so older imports also receive the corrected category value.
        if (!existing || sameImportedEvent) {
          dateData[slotTime] = block;
          if (!existing) {
            eventAdded = true;
            addedBlockCount++;
          }

          if (sb && USER_ID && USER_ID !== "local-recovery") {
            supabaseRows.push({
              user_id: USER_ID,
              date: dateStr,
              start_time: slotTime,
              category: block.category,
              note: block.note,
              subcategory: block.sub,
              updated_at: new Date().toISOString(),
            });
          }
        }
      }
      if (eventAdded) addedCount++;
    }

    saveLocal(dateStr, dateData);

    if (supabaseRows.length > 0 && sb) {
      setStatus("syncing", "Saving to database…");
      const { error } = await sb.from("blocks").upsert(supabaseRows, { onConflict: "user_id,date,start_time" });
      if (error) {
        console.error("Error saving GCal blocks to Supabase:", error);
      } else {
        setStatus("ok", "Synced");
      }
    }

    if (ymd(current) === dateStr) {
      data = dateData;
      render();
    }

    if (msgEl) msgEl.textContent = `Synced ${addedCount} event(s) across ${addedBlockCount} half-hour block(s) for ${dateStr}.`;
  } catch (err) {
    console.error("Error fetching GCal events:", err);
    if (msgEl) msgEl.textContent = "Failed to fetch events: " + err.message;
  }
}


function wireGCalControls() {
  const connectBtn = document.getElementById("gcalConnectBtn");
  const fetchBtn = document.getElementById("gcalFetchBtn");
  const topBtn = document.getElementById("gcalSyncTopBtn");

  if (connectBtn) connectBtn.addEventListener("click", () => initGCalAuth());
  if (fetchBtn) fetchBtn.addEventListener("click", () => fetchGCalEvents(ymd(current)));
  if (topBtn) topBtn.addEventListener("click", () => {
    if (!gcalToken) {
      initGCalAuth();
    } else {
      fetchGCalEvents(ymd(current));
    }
  });

  updateGCalUI();
}

wireGCalControls();

// ---- Service worker (offline) ----
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js?v=63").catch(() => {});
}
