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
  
  const next = new Date(current); next.setDate(next.getDate() + 1);
  if (dateStr === ymd(next)) {
    const pi = document.getElementById("planInput");
    if (pi && document.activeElement !== pi) {
      pi.value = newNote;
    }
  }
  
  render();
}

// Carry an unchecked objective forward into the next day's plan.
function carryForward(text) {
  const next = new Date(current); next.setDate(next.getDate() + 1);
  const dateStr = ymd(next);
  const day = loadLocal(dateStr);
  const existing = (day[PLAN_KEY] && day[PLAN_KEY].note) || "";
  const clean = text.trim();
  if (!clean) return;
  // Don't duplicate if already there
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
  // Keep planInput in sync if visible
  const pi = document.getElementById("planInput");
  if (pi && document.activeElement !== pi) pi.value = newNote;
  setStatus("ok", "Carried to tomorrow ✓");
  setTimeout(() => setStatus("", ""), 2000);
}

function render() {
  document.getElementById("dateMain").textContent = prettyDate(current);
  document.getElementById("dateSub").textContent =
    current.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });

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
  if (todaysPlan && todaysPlan.trim()) {
    pb.hidden = false;
    const lines = todaysPlan.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length > 0) {
      pb.innerHTML = `
        <div class="plan-banner-title" id="planBannerTitle">
          <div class="plan-banner-title-left">
            <span class="plan-banner-icon">🎯</span>
            <span>Today's Objectives</span>
          </div>
          <button class="plan-banner-toggle" id="planBannerToggle" aria-label="Toggle objectives view">
            <svg class="plan-banner-chevron" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="18 15 12 9 6 15"></polyline>
            </svg>
          </button>
        </div>
        <div class="plan-banner-list" id="planBannerList"></div>
      `;
      
      const isCollapsed = localStorage.getItem("day_plan_banner_collapsed") === "true";
      if (isCollapsed) {
        pb.classList.add("collapsed");
      } else {
        pb.classList.remove("collapsed");
      }

      document.getElementById("planBannerToggle").addEventListener("click", togglePlanBannerCollapse);
      document.getElementById("planBannerTitle").addEventListener("click", togglePlanBannerCollapse);

      const listEl = document.getElementById("planBannerList");
      lines.forEach((line, idx) => {
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
        
        const itemEl = document.createElement("div");
        itemEl.className = isChecked ? "plan-banner-item completed" : "plan-banner-item";
        
        const checkBox = document.createElement("span");
        checkBox.className = "plan-banner-check-box";
        
        const textSpan = document.createElement("span");
        textSpan.className = "plan-banner-text";
        textSpan.textContent = cleanText;
        
        itemEl.appendChild(checkBox);
        itemEl.appendChild(textSpan);

        // Carry-forward button — only on unmet objectives
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
    } else {
      pb.hidden = true;
    }
  } else {
    pb.hidden = true;
    pb.innerHTML = "";
  }

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
function openSheet(slotList, preferredCat) {
  editing = slotList;
  highlightSlots(slotList);
  const first = slotList[0], last = slotList[slotList.length - 1];
  const existing = data[first];
  selectedCat = existing ? existing.category : (preferredCat || null);
  selectedSub = existing ? (existing.sub || null) : null;
  const endSlot = SLOTS[(SLOTS.indexOf(last) + 1) % 48] || "00:00";
  const hrs = slotList.length / 2;
  document.getElementById("sheetTime").textContent = slotList.length > 1
    ? `${to12(first)} – ${to12(endSlot)} · ${hrs % 1 ? hrs.toFixed(1) : hrs}h`
    : `${to12(first)} – ${to12(endSlot)}`;
  renderCatGrid();
  renderSubRow();
  renderNoteSuggest();
  document.getElementById("noteInput").value = existing ? (existing.note || "") : "";
  document.getElementById("sheetBackdrop").hidden = false;
}

function openGymTimeBlock() {
  const now = new Date();
  const slot = String(now.getHours()).padStart(2, "0") + ":" + (now.getMinutes() < 30 ? "00" : "30");
  openSheet([slot], "gym");
}

function renderSubRow() {
  const row = document.getElementById("subRow");
  if (!selectedCat) { row.hidden = true; row.innerHTML = ""; return; }
  row.hidden = false;
  row.innerHTML = "";
  const subs = customSubs[selectedCat] || [];
  for (const s of subs) {
    const chip = document.createElement("div");
    chip.className = "sub-chip" + (selectedSub === s ? " selected" : "");
    
    const labelSpan = document.createElement("span");
    labelSpan.className = "sub-chip-label";
    labelSpan.textContent = s;
    labelSpan.addEventListener("click", () => {
      selectedSub = (selectedSub === s) ? null : s; // tap again to deselect
      renderSubRow();
    });

    const delBtn = document.createElement("button");
    delBtn.className = "sub-chip-remove";
    delBtn.type = "button";
    delBtn.setAttribute("aria-label", `Remove ${s}`);
    delBtn.title = `Remove "${s}"`;
    delBtn.innerHTML = "&times;";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeSub(selectedCat, s);
    });

    chip.appendChild(labelSpan);
    chip.appendChild(delBtn);

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
  if (!selectedCat) { row.hidden = true; return; }
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
      renderNoteSuggest();
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
    if (id) { selectedCat = id; selectedSub = null; renderCatGrid(); renderSubRow(); renderNoteSuggest(); }
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

function renderStatsWithMap(map) {
  const body = document.getElementById("statsBody");
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

async function renderStats() {
  const map = gatherLocalRange(statsRange);
  renderStatsWithMap(map);
  
  if (sb) {
    let start = null;
    if (statsRange > 0) {
      const d = new Date(); d.setDate(d.getDate() - (statsRange - 1)); start = ymd(d);
    }
    try {
      let q = sb.from("blocks").select("date,start_time,category,note").eq("user_id", USER_ID);
      if (start) q = q.gte("date", start);
      const { data: rows, error } = await q;
      if (!error && rows) {
        let changed = false;
        for (const r of rows) {
          const oldDay = map[r.date] || {};
          const oldBlock = oldDay[r.start_time];
          if (!oldBlock || oldBlock.category !== r.category || oldBlock.note !== (r.note || "")) {
            (map[r.date] = map[r.date] || {})[r.start_time] = { category: r.category, note: r.note || "" };
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

// ===========================================================
//  Insights — each opens its own page from the bottom popup
// ===========================================================
let insightRange = 7;
let currentInsight = null;

const INSIGHTS = [
  { id: "subs",     title: "Projects",        icon: "🗂",  desc: "Time by subcategory / project", fn: renderInsightSubs },
  { id: "heatmap",  title: "Weekly rhythm",   icon: "🔥",  desc: "Your week as a heatmap",        fn: renderInsightHeatmap },
  { id: "trends",   title: "Trends",          icon: "📈",  desc: "Sleep & productive hours over time", fn: renderInsightTrends },
  { id: "streak",   title: "Consistency",     icon: "✅",  desc: "Streaks & sleep targets",       fn: renderInsightStreak },
  { id: "weekday",  title: "Day-of-week",     icon: "📅",  desc: "Patterns by weekday",           fn: renderInsightWeekday },
  { id: "goals",    title: "Objectives",      icon: "🎯",  desc: "Planned vs. actually logged",   fn: renderInsightGoals },
  { id: "gym",      title: "Gym Tracker",     icon: "🏋️", desc: "Weight progress & workouts",    fn: renderInsightGym },
];

// ---- shared helpers ----
const catColor = (id) => (CAT[id] || CAT.other).color;
const catLabel = (id) => (CAT[id] || CAT.other).label;
const PRODUCTIVE = ["work", "learn", "exercise", "gym"];
const WD_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WD_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon-first
function isGymBlock(b) {
  if (!b) return false;
  const c = CAT[b.category];
  return b.category === "gym" || (c && c.label.toLowerCase() === "gym");
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
      c.counts[b.category] = (c.counts[b.category] || 0) + 1; c.total++;
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

// ---- 3. Trends over time ----
function renderInsightTrends(map) {
  const dates = trackedDates(map).slice(-30);
  if (!dates.length) return emptyMsg("No data to trend yet.");
  const rows = dates.map((d) => {
    let sleep = 0, prod = 0;
    for (const s of SLOTS) {
      const b = map[d][s]; if (!b) continue;
      if (b.category === "sleep") sleep += 0.5;
      if (PRODUCTIVE.includes(b.category)) prod += 0.5;
    }
    return { d, sleep, prod };
  });
  const maxH = Math.max(12, ...rows.map((r) => Math.max(r.sleep, r.prod)));
  const body = rows.map((r) => {
    const [y, m, day] = r.d.split("-").map(Number);
    const lbl = new Date(y, m - 1, day).toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
    return `<div class="trend-row">
      <div class="trend-date">${lbl}</div>
      <div class="trend-bars">
        <div class="bar-track"><div class="bar-fill" style="width:${(r.sleep/maxH)*100}%;background:${catColor("sleep")}"></div></div>
        <div class="bar-track"><div class="bar-fill" style="width:${(r.prod/maxH)*100}%;background:${catColor("work")}"></div></div>
      </div>
      <div class="trend-val">${fmtH(r.sleep)}<br>${fmtH(r.prod)}</div>
    </div>`;
  }).join("");
  return `<div class="stats-h"><span style="color:${catColor("sleep")}">■</span> Sleep &nbsp; <span style="color:${catColor("work")}">■</span> Productive (work·learn·exercise)</div>${body}`;
}

// ---- 4. Consistency / streak ----
function renderInsightStreak(map) {
  const dates = trackedDates(map);
  if (!dates.length) return emptyMsg("Start logging to build a streak.");
  const set = new Set(dates);
  // current streak counting back from today
  let streak = 0; let cur = new Date();
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
  let nights = 0, sleepSum = 0;
  for (const d of dates) {
    let sl = 0; for (const s of SLOTS) if (map[d][s] && map[d][s].category === "sleep") sl += 0.5;
    sleepSum += sl; if (sl >= TARGET) nights++;
  }
  return `<div class="stat-cards">
    <div class="stat-card"><div class="num">🔥 ${streak}</div><div class="lbl">current streak</div></div>
    <div class="stat-card"><div class="num">${longest}</div><div class="lbl">longest streak</div></div>
    <div class="stat-card"><div class="num">${dates.length}</div><div class="lbl">days tracked</div></div>
    <div class="stat-card"><div class="num">${nights}</div><div class="lbl">nights ≥ ${TARGET}h sleep</div></div>
    <div class="stat-card"><div class="num">${(sleepSum/dates.length).toFixed(1)}h</div><div class="lbl">avg sleep</div></div>
  </div>`;
}

// ---- 5. Day-of-week patterns ----
function renderInsightWeekday(map) {
  const dates = trackedDates(map);
  if (!dates.length) return emptyMsg("No weekday patterns yet.");
  const wdMins = {}, wdDays = [0,0,0,0,0,0,0];
  for (const d of dates) {
    const wd = weekdayOf(d); wdDays[wd]++;
    for (const s of SLOTS) { const b = map[d][s]; if (b) { (wdMins[wd] = wdMins[wd] || {}); wdMins[wd][b.category] = (wdMins[wd][b.category] || 0) + 30; } }
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
function renderInsightGoals(map) {
  const planned = Object.keys(map).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && map[d][PLAN_KEY] && map[d][PLAN_KEY].note).sort().reverse();
  if (!planned.length) return emptyMsg("Set “Objectives for tomorrow” to track follow-through.");
  
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
        <div class="${itemClass}">
          <span class="goal-sub-dot ${isChecked ? 'met' : 'unmet'}"></span>
          <span class="goal-sub-text">${escapeHtml(cleanText)}</span>
        </div>`;
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
  
  return `
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
  for (const d of timelineDays) {
    const count = SLOTS.filter((s) => isGymBlock(map[d][s])).length;
    totalSlots += count;
    if (count) daysWithTimelineGym++;
  }

  const cards = `<div class="stat-cards">
    <div class="stat-card"><div class="num">${fmtH(totalSlots / 2)}</div><div class="lbl">gym time logged</div></div>
    <div class="stat-card"><div class="num">${daysWithTimelineGym}</div><div class="lbl">days with gym blocks</div></div>
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
    const slotRows = [];
    let active = null;
    for (const s of SLOTS) {
      const b = map[d][s];
      const key = isGymBlock(b) ? `${b.category}\0${b.sub || ""}\0${b.note || ""}` : null;
      if (key && active && active.key === key && SLOTS.indexOf(s) === SLOTS.indexOf(active.last) + 1) {
        active.last = s;
      } else {
        if (active) slotRows.push(active);
        active = key ? { key, first: s, last: s, block: b } : null;
      }
    }
    if (active) slotRows.push(active);

    const timelineRows = slotRows.map((r) => {
      const endSlot = SLOTS[(SLOTS.indexOf(r.last) + 1) % 48] || "00:00";
      const label = r.block.sub || r.block.note || "Gym";
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
      let q = sb.from("blocks").select("date,start_time,category,note").eq("user_id", USER_ID);
      if (start) q = q.gte("date", start);
      const { data: rows, error } = await q;
      if (!error && rows) {
        let changed = false;
        for (const r of rows) {
          const oldDay = map[r.date] || {};
          const oldBlock = oldDay[r.start_time];
          if (!oldBlock || oldBlock.category !== r.category || oldBlock.note !== (r.note || "")) {
            (map[r.date] = map[r.date] || {})[r.start_time] = { category: r.category, note: r.note || "" };
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
document.getElementById("gymBtn").addEventListener("click", openGymTimeBlock);
document.getElementById("gymBackdrop").addEventListener("click", (e) => {
  if (e.target.id === "gymBackdrop") closeGymLogger();
});
document.getElementById("gymSaveBtn").addEventListener("click", saveGymLogger);
document.getElementById("gymCancelBtn").addEventListener("click", closeGymLogger);
document.getElementById("gymAddSetBtn").addEventListener("click", () => addSessionRow(null));
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
document.getElementById("exportBtn").addEventListener("click", exportData);
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

document.getElementById("reflectInput").addEventListener("blur", saveReflection);
document.getElementById("reflectInput").addEventListener("keydown", handleListKeydown);
document.getElementById("reflectInput").addEventListener("input", handleListInput);
document.getElementById("planInput").addEventListener("blur", savePlan);
document.getElementById("planInput").addEventListener("keydown", handleListKeydown);
document.getElementById("planInput").addEventListener("input", handleListInput);
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
    document.getElementById("insightScreen").hidden = true;
    document.getElementById("insightsMenu").hidden = true;
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
