/* Pure daily analysis. Missing slots are unknown; calendar imports are plans.
   Work runs describe contiguous logging, not measured attention or productivity. */
(function (root) {
  const slots = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
  const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const shift = (date, days) => {
    const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  function checkin(day) {
    try {
      const value = JSON.parse(day.__checkin__?.note || '{}');
      return Object.fromEntries(['energy', 'satisfaction'].map(k => [k,
        Number.isInteger(value[k]) && value[k] >= 1 && value[k] <= 5 ? value[k] : null]));
    } catch { return { energy: null, satisfaction: null }; }
  }
  function analyze(map, { today, range = 30, category = b => b.category, objectives = () => [] } = {}) {
    const days = Object.entries(map).filter(([date]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date !== '2000-01-01' && date <= today)
      .sort(([a], [b]) => a.localeCompare(b)).map(([date, day]) => {
        const counts = {}; let logged = 0, imported = 0, run = 0, longest = 0, switches = 0, previous = null;
        const hours = Array(24).fill(null);
        slots.forEach((slot, i) => {
          const b = day[slot]; const isImport = b && /^\[GCal\]/.test(b.note || '');
          if (isImport) imported++;
          if (!b || isImport) { previous = null; run = 0; return; }
          const cat = category(b); logged++; counts[cat] = (counts[cat] || 0) + 0.5;
          if (previous !== null && previous !== cat) switches++;
          previous = cat; run = cat === 'work' ? run + 0.5 : 0; longest = Math.max(longest, run);
          const h = Math.floor(i / 2); hours[h] = (hours[h] || 0) + (cat === 'work' ? 0.5 : 0);
        });
        const items = objectives(day).filter(item => !item.transferredTo);
        // Recover a night crossing midnight only when its boundaries are known.
        // Never infer sleep through unrecorded half-hours.
        const previousDay = map[shift(date, -1)] || {};
        const night = [...slots.map(s => previousDay[s]), ...slots.slice(0, 24).map(s => day[s])];
        const isSleep = b => b && !/^\[GCal\]/.test(b.note || '') && category(b) === 'sleep';
        let nightSleep = null, wake = null;
        for (let i = 48; i < night.length; i++) {
          if (!isSleep(night[i])) continue;
          let start = i, end = i;
          while (start > 0 && isSleep(night[start - 1])) start--;
          while (end < night.length && isSleep(night[end])) end++;
          if (start > 0 && night[start - 1] && !/^\[GCal\]/.test(night[start - 1].note || '') && end < night.length && night[end] && !/^\[GCal\]/.test(night[end].note || '') && end - start >= 8 && (nightSleep === null || (end - start) / 2 > nightSleep)) {
            nightSleep = (end - start) / 2; wake = (end - 48) / 2;
          }
          i = end - 1;
        }
        return { date, logged, imported, counts, longest, switches, hours,
          status: day.__day_status__?.sub || '', weekday: new Date(`${date}T12:00:00Z`).getUTCDay(),
          completion: items.length ? items.filter(x => x.completed).length / items.length : null,
          targets: items.length, nightSleep, wake, checkin: checkin(day) };
      });
    const start = range ? shift(today, 1 - range) : days[0]?.date || today;
    const selected = days.filter(d => d.date >= start);
    const logged = selected.filter(d => d.logged);
    // All-time still compares the last two completed 14-day periods.
    const period = range || 14, end = shift(today, -1), recentStart = shift(end, 1 - period);
    const previousStart = shift(recentStart, -period);
    const eligible = days.filter(d => d.date < today && d.logged >= 32 && !d.status);
    const recent = eligible.filter(d => d.date >= recentStart && d.date <= end);
    const prior = eligible.filter(d => d.date >= previousStart && d.date < recentStart);
    const comparable = eligible.filter(d => d.date >= start);
    const categories = {};
    logged.forEach(d => Object.entries(d.counts).forEach(([k, v]) => { categories[k] = (categories[k] || 0) + v; }));
    const comparisons = [];
    function compare(label, split, outcome, unit) {
      const valid = comparable.filter(d => outcome(d) !== null && split(d) !== null);
      const a = valid.filter(d => split(d)), b = valid.filter(d => !split(d));
      if (a.length >= 5 && b.length >= 5) comparisons.push({ label, a: mean(a.map(outcome)), b: mean(b.map(outcome)), nA: a.length, nB: b.length, unit });
    }
    compare('Target completion · exercise vs no logged exercise', d => (d.counts.exercise || d.counts.gym || 0) > 0, d => d.completion, '%');
    compare('Satisfaction · exercise vs no logged exercise', d => (d.counts.exercise || d.counts.gym || 0) > 0, d => d.checkin.satisfaction, '/5');
    compare('Target completion · higher vs lower energy', d => d.checkin.energy === null ? null : d.checkin.energy >= 4, d => d.completion, '%');
    compare('Target completion · 7h+ vs shorter logged nights', d => d.nightSleep === null ? null : d.nightSleep >= 7, d => d.completion, '%');
    const rhythm = Array.from({ length: 24 }, (_, h) => {
      const observed = logged.filter(d => d.hours[h] !== null);
      return { hour: h, days: observed.length, work: mean(observed.map(d => d.hours[h])) };
    });
    return { selected, logged, categories, comparisons, rhythm, recent, prior, period,
      recentStart, end, previousStart, mean, eligible: comparable.length };
  }
  const api = { analyze, checkin, shift };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DayPatterns = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
