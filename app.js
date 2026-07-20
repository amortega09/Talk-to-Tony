/* ===========================================================
   Day — a calm 30-minute-block time tracker (offline-first PWA)
   Data model (one object per block, LLM-friendly):
     { date:"2026-07-19", start_time:"08:30", category:"work", note:"..." }
   =========================================================== */

const BUILTIN_CATEGORIES = [
  { id: "sleep",    label: "Sleep",    color: "#7b8cde" },
  { id: "work",     label: "Work",     color: "#4a5d4e" },
  { id: "exercise", label: "Exercise", color: "#e08a4a" },
  { id: "food",     label: "Food",     color: "#d1a13a" },
  { id: "learn",    label: "Learn",    color: "#5aa0a8" },
  { id: "social",   label: "Social",   color: "#c76b98" },
  { id: "chores",   label: "Chores",   color: "#9a8c7a" },
  { id: "relax",    label: "Relax",    color: "#6aa86a" },
  { id: "other",    label: "Other",    color: "#9b9793" },
];
// Palette used to auto-assign colors to custom categories.
const AUTO_COLORS = [
  "#c0693e", "#4f8a8b", "#a86bb0", "#5a8f4a", "#c99a3a", "#b45d7a",
  "#6a7fd0", "#7a9e5e", "#c65f5f", "#4a8fb0", "#9a7f4a", "#8a6fb0",
];

let customCats = [];                 // [{id,label,color}], user-created, synced
let customSubs = {};                 // { catId: [label,...] }, remembered subcategories
let CATEGORIES = BUILTIN_CATEGORIES.slice();
let CAT = {};
function rebuildCats() {
  CATEGORIES = BUILTIN_CATEGORIES.concat(customCats);
  CAT = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
}
rebuildCats();

// Special "slot" keys stored in the same table (never real times).
const REFLECT_KEY = "__reflect__";
const PLAN_KEY = "__plan__";
const SETTINGS_DATE = "2000-01-01";  // sentinel row for synced settings

// ---- Authenticated user id (set after Supabase magic-link login) ----
let USER_ID = null;

// ---- Supabase (optional) ----
let sb = null;
const cfg = window.APP_CONFIG || {};
if (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase) {
  sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
}

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
let selectedCat = null;
let selectedSub = null; // chosen subcategory label (optional)
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
  } catch { customCats = []; customSubs = {}; }
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
      localStorage.setItem("day_settings", JSON.stringify({ customCats, subs: customSubs }));
      rebuildCats();
    }
  } catch (e) { console.warn(e); }
}
async function saveSettings() {
  localStorage.setItem("day_settings", JSON.stringify({ customCats, subs: customSubs }));
  if (!sb) return;
  try {
    await sb.from("blocks").upsert({
      user_id: USER_ID, date: SETTINGS_DATE, start_time: "__settings__",
      category: "settings", note: JSON.stringify({ customCats, subs: customSubs }),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,date,start_time" });
  } catch (e) { console.warn(e); }
}
function rememberSub(catId, label) {
  label = (label || "").trim();
  if (!catId || !label) return;
  const arr = customSubs[catId] || (customSubs[catId] = []);
  if (!arr.includes(label)) { arr.push(label); saveSettings(); }
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

function render() {
  document.getElementById("dateMain").textContent = prettyDate(current);
  document.getElementById("dateSub").textContent =
    current.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });

  // Summary chips (counts -> hours)
  const counts = {};
  for (const slot of SLOTS) {
    const b = data[slot];
    if (b) counts[b.category] = (counts[b.category] || 0) + 1;
  }
  const summary = document.getElementById("summary");
  summary.innerHTML = "";
  const tracked = Object.values(counts).reduce((a, b) => a + b, 0);
  const untracked = SLOTS.length - tracked;
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cid, n]) => {
      const c = CAT[cid] || CAT.other;
      const chip = document.createElement("div");
      chip.className = "chip";
      chip.style.setProperty("--chip-color", c.color);
      chip.innerHTML = `<span class="dot" style="background:${c.color}"></span>${c.label} · ${(n / 2)}h`;
      summary.appendChild(chip);
    });

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
    const el = document.createElement("div");
    el.className = "block " + (b ? "filled" : "empty") + (slot === rangeAnchor ? " anchor" : "");
    const c = b ? (CAT[b.category] || CAT.other) : null;
    if (c) el.style.setProperty("--blk-color", c.color);
    el.innerHTML = `
      <div class="block-time">${to12(slot)}</div>
      <div class="block-body">
        <div class="block-cat">${b ? (c.label + (b.sub ? ` · ${escapeHtml(b.sub)}` : "")) : "—"}</div>
        ${b && b.note ? `<div class="block-note">${escapeHtml(b.note)}</div>` : ""}
      </div>`;
    el.dataset.slot = slot;
    attachPress(el, slot);
    // Red "now" marker just above the current half-hour (today only)
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
    tl.appendChild(el);
  }

  // Reflection note (don't clobber while the user is typing)
  const ri = document.getElementById("reflectInput");
  if (document.activeElement !== ri) {
    ri.value = (data[REFLECT_KEY] && data[REFLECT_KEY].note) || "";
  }

  // Today's objectives banner (whatever was planned the day before)
  const pb = document.getElementById("planBanner");
  const todaysPlan = data[PLAN_KEY] && data[PLAN_KEY].note;
  if (todaysPlan) { pb.hidden = false; pb.textContent = "🎯 " + todaysPlan; }
  else { pb.hidden = true; }

  // "Objectives for tomorrow" box reflects next day's plan
  const pi = document.getElementById("planInput");
  if (document.activeElement !== pi) {
    const next = new Date(current); next.setDate(next.getDate() + 1);
    const nd = loadLocal(ymd(next));
    pi.value = (nd[PLAN_KEY] && nd[PLAN_KEY].note) || "";
  }
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
  el.addEventListener("pointerup", () => {
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
  el.addEventListener("pointercancel", () => { clearTimeout(timer); timer = null; dragging = false; });
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
function openSheet(slotList) {
  editing = slotList;
  highlightSlots(slotList);
  const first = slotList[0], last = slotList[slotList.length - 1];
  const existing = data[first];
  selectedCat = existing ? existing.category : null;
  selectedSub = existing ? (existing.sub || null) : null;
  const endSlot = SLOTS[(SLOTS.indexOf(last) + 1) % 48] || "00:00";
  const hrs = slotList.length / 2;
  document.getElementById("sheetTime").textContent = slotList.length > 1
    ? `${to12(first)} – ${to12(endSlot)} · ${hrs % 1 ? hrs.toFixed(1) : hrs}h`
    : `${to12(first)} – ${to12(endSlot)}`;
  renderCatGrid();
  renderSubRow();
  document.getElementById("noteInput").value = existing ? (existing.note || "") : "";
  document.getElementById("sheetBackdrop").hidden = false;
}

function renderSubRow() {
  const row = document.getElementById("subRow");
  if (!selectedCat) { row.hidden = true; row.innerHTML = ""; return; }
  row.hidden = false;
  row.innerHTML = "";
  const subs = customSubs[selectedCat] || [];
  for (const s of subs) {
    const chip = document.createElement("button");
    chip.className = "sub-chip" + (selectedSub === s ? " selected" : "");
    chip.textContent = s;
    chip.addEventListener("click", () => {
      selectedSub = (selectedSub === s) ? null : s; // tap again to deselect
      renderSubRow();
    });
    // Long-press / right-click to remove a remembered subcategory
    let t = null;
    chip.addEventListener("pointerdown", () => { t = setTimeout(() => { t = null; removeSub(selectedCat, s); }, 500); });
    chip.addEventListener("pointerup", () => { if (t) { clearTimeout(t); t = null; } });
    chip.addEventListener("pointerleave", () => { if (t) { clearTimeout(t); t = null; } });
    chip.addEventListener("contextmenu", (e) => { e.preventDefault(); removeSub(selectedCat, s); });
    row.appendChild(chip);
  }
  const add = document.createElement("button");
  add.className = "sub-chip sub-add";
  add.textContent = subs.length ? "+ Add" : "+ Add project / detail";
  add.addEventListener("click", () => {
    const name = window.prompt("Project / detail name:");
    if (name && name.trim()) {
      rememberSub(selectedCat, name.trim());
      selectedSub = name.trim();
      renderSubRow();
    }
  });
  row.appendChild(add);
}

function removeSub(catId, label) {
  if (!window.confirm(`Remove "${label}" from ${(CAT[catId] || {}).label || "this category"}?`)) return;
  customSubs[catId] = (customSubs[catId] || []).filter((s) => s !== label);
  if (selectedSub === label) selectedSub = null;
  saveSettings();
  renderSubRow();
}

function renderCatGrid() {
  const grid = document.getElementById("catGrid");
  grid.innerHTML = "";
  for (const c of CATEGORIES) {
    const isCustom = c.id.startsWith("c_");
    const btn = document.createElement("button");
    btn.className = "cat-btn" + (selectedCat === c.id ? " selected" : "");
    btn.style.setProperty("--cat-color", c.color);
    btn.innerHTML = `<span class="cdot" style="background:${c.color}"></span>${c.label}`;
    btn.addEventListener("click", () => {
      if (selectedCat !== c.id) selectedSub = null; // switching category clears sub
      selectedCat = c.id;
      grid.querySelectorAll(".cat-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      renderSubRow();
    });
    if (isCustom) {
      // Long-press (or right-click) a custom category to rename/delete it.
      let t = null;
      btn.addEventListener("pointerdown", () => { t = setTimeout(() => { t = null; manageCategory(c); }, 500); });
      btn.addEventListener("pointerup", () => { if (t) { clearTimeout(t); t = null; } });
      btn.addEventListener("pointerleave", () => { if (t) { clearTimeout(t); t = null; } });
      btn.addEventListener("contextmenu", (e) => { e.preventDefault(); manageCategory(c); });
    }
    grid.appendChild(btn);
  }
  // "+ New" tile to create a custom category
  const add = document.createElement("button");
  add.className = "cat-btn cat-add";
  add.innerHTML = `<span class="cdot" style="border:1.5px dashed currentColor;background:none"></span>New`;
  add.addEventListener("click", () => {
    const name = window.prompt("New category name:");
    const id = addCustomCategory(name);
    if (id) { selectedCat = id; selectedSub = null; renderCatGrid(); renderSubRow(); }
  });
  grid.appendChild(add);
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

function savePlan() {
  const note = document.getElementById("planInput").value.trim();
  const next = new Date(current); next.setDate(next.getDate() + 1);
  const dateStr = ymd(next);
  const day = loadLocal(dateStr);
  const cur = (day[PLAN_KEY] && day[PLAN_KEY].note) || "";
  if (note === cur) return;
  const block = note ? { category: "plan", note } : null;
  if (note) day[PLAN_KEY] = block; else delete day[PLAN_KEY];
  saveLocal(dateStr, day);
  syncSlots(dateStr, [PLAN_KEY], block);
  // If we're viewing that day right now, keep it in sync.
  if (dateStr === ymd(current)) { if (note) data[PLAN_KEY] = block; else delete data[PLAN_KEY]; }
}

function closeSheet() {
  document.getElementById("sheetBackdrop").hidden = true;
  editing = null; selectedCat = null; selectedSub = null;
  highlightSlots(null);
}
function saveSheet() {
  if (!editing) return;
  const note = document.getElementById("noteInput").value.trim();
  const dateStr = ymd(current);
  if (!selectedCat) { closeSheet(); return; }
  const sub = selectedSub || "";
  if (sub) rememberSub(selectedCat, sub);
  const block = { category: selectedCat, note, sub };
  for (const s of editing) data[s] = { category: selectedCat, note, sub };
  pushBlocks(dateStr, editing, block);
  render();
  closeSheet();
}
function clearSheet() {
  if (!editing) return;
  const dateStr = ymd(current);
  for (const s of editing) delete data[s];
  pushBlocks(dateStr, editing, null);
  render();
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
  const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), user_id: USER_ID, days: all }, null, 2)],
    { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "day-export.json"; a.click();
  URL.revokeObjectURL(url);
}

// ---- Statistics ----
let statsRange = 7; // days; 0 = all

// Returns { "YYYY-MM-DD": { "08:30": {category,note}, ... }, ... }
async function gatherRange(days) {
  const map = {};
  // Local first
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("day_data_")) {
      const date = k.replace("day_data_", "");
      try { map[date] = JSON.parse(localStorage.getItem(k)) || {}; } catch {}
    }
  }
  // Remote authoritative (fills in days visited on other devices)
  if (sb) {
    let start = null;
    if (days > 0) {
      const d = new Date(); d.setDate(d.getDate() - (days - 1)); start = ymd(d);
    }
    try {
      let q = sb.from("blocks").select("date,start_time,category,note").eq("user_id", USER_ID);
      if (start) q = q.gte("date", start);
      const { data: rows, error } = await q;
      if (!error && rows) {
        for (const r of rows) {
          (map[r.date] = map[r.date] || {})[r.start_time] = { category: r.category, note: r.note || "" };
        }
      }
    } catch (e) { console.warn(e); }
  }
  // Filter to range
  if (days > 0) {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - (days - 1));
    const cut = ymd(cutoff);
    for (const date of Object.keys(map)) if (date < cut) delete map[date];
  }
  return map;
}

function minutesToClock(mins) {
  if (mins == null || isNaN(mins)) return "—";
  let h = Math.round(mins / 30) * 30;
  let hh = Math.floor(h / 60), mm = h % 60;
  const ap = hh < 12 ? "AM" : "PM";
  let d = hh % 12; if (d === 0) d = 12;
  return `${d}:${String(mm).padStart(2, "0")} ${ap}`;
}
function slotToMinutes(slot) {
  const [h, m] = slot.split(":").map(Number); return h * 60 + m;
}

async function renderStats() {
  const body = document.getElementById("statsBody");
  body.innerHTML = `<div class="stats-empty">Loading…</div>`;
  const map = await gatherRange(statsRange);
  const dates = Object.keys(map).filter((d) => SLOTS.some((s) => map[d][s]));

  if (!dates.length) {
    body.innerHTML = `<div class="stats-empty">No data tracked yet in this range.<br>Start filling in your day →</div>`;
    return;
  }

  const catMins = {};   // category -> minutes
  let totalBlocks = 0;
  const wakeMins = [], lastMins = [];
  for (const d of dates) {
    let firstNonSleep = null, lastNonSleep = null;
    for (const s of SLOTS) {
      const b = map[d][s];
      if (!b) continue;
      totalBlocks++;
      catMins[b.category] = (catMins[b.category] || 0) + 30;
      if (b.category !== "sleep") {
        if (firstNonSleep == null) firstNonSleep = slotToMinutes(s);
        lastNonSleep = slotToMinutes(s);
      }
    }
    if (firstNonSleep != null) wakeMins.push(firstNonSleep);
    if (lastNonSleep != null) lastMins.push(lastNonSleep + 30);
  }

  const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const totalHours = totalBlocks / 2;
  const avgPerDay = totalHours / dates.length;
  const sleepHours = (catMins.sleep || 0) / 60;
  const avgSleep = sleepHours / dates.length;

  const cards = `
    <div class="stat-cards">
      <div class="stat-card"><div class="num">${dates.length}</div><div class="lbl">days tracked</div></div>
      <div class="stat-card"><div class="num">${avgPerDay.toFixed(1)}h</div><div class="lbl">tracked / day</div></div>
      <div class="stat-card"><div class="num">${minutesToClock(avg(wakeMins))}</div><div class="lbl">avg wake-up</div></div>
      <div class="stat-card"><div class="num">${minutesToClock(avg(lastMins))}</div><div class="lbl">avg wind-down</div></div>
      <div class="stat-card"><div class="num">${avgSleep.toFixed(1)}h</div><div class="lbl">avg sleep / day</div></div>
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

function openStats() {
  document.getElementById("statsScreen").hidden = false;
  renderStats();
}
function closeStats() {
  document.getElementById("statsScreen").hidden = true;
}

// ---- Navigation ----
function goto(d) {
  current = d;
  data = loadLocal(ymd(current));
  render();
  pullDay(ymd(current));
  // On today, start the view at the current time.
  const nowBlock = document.getElementById("nowBlock");
  if (nowBlock) nowBlock.scrollIntoView({ block: "center" });
}

// ---- Wire up ----
document.getElementById("prevDay").addEventListener("click", () => {
  const d = new Date(current); d.setDate(d.getDate() - 1); goto(d);
});
document.getElementById("nextDay").addEventListener("click", () => {
  const d = new Date(current); d.setDate(d.getDate() + 1); goto(d);
});
document.getElementById("todayBtn").addEventListener("click", () => goto(new Date()));
document.getElementById("statsBtn").addEventListener("click", openStats);
document.getElementById("statsBack").addEventListener("click", closeStats);
document.getElementById("rangeSeg").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-range]");
  if (!btn) return;
  statsRange = parseInt(btn.dataset.range, 10);
  document.querySelectorAll("#rangeSeg button").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  renderStats();
});
document.getElementById("exportBtn").addEventListener("click", exportData);
document.getElementById("reflectInput").addEventListener("blur", saveReflection);
document.getElementById("planInput").addEventListener("blur", savePlan);
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
    pullSettings().then(() => goto(new Date()));
  } else {
    document.getElementById("app").hidden = true;
    document.getElementById("statsScreen").hidden = true;
    document.getElementById("authScreen").hidden = false;
  }
}

async function sendMagicLink() {
  const email = document.getElementById("authEmail").value.trim();
  const msg = document.getElementById("authMsg");
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

async function initAuth() {
  if (!sb) {
    document.getElementById("app").hidden = true;
    document.getElementById("authScreen").hidden = false;
    document.getElementById("authMsg").textContent =
      "Supabase isn't configured yet — add your keys in config.js.";
    return;
  }
  document.getElementById("authSend").addEventListener("click", sendMagicLink);
  document.getElementById("authEmail").addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMagicLink();
  });
  document.getElementById("signOut").addEventListener("click", () => sb.auth.signOut());
  sb.auth.onAuthStateChange((_e, session) => applySession(session));
  const { data } = await sb.auth.getSession();
  applySession(data.session);
}

// ---- Boot ----
initAuth();

// ---- Service worker (offline) ----
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
