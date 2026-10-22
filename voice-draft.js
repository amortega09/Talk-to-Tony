(function (root) {
  const categories = ['sleep', 'work', 'exercise', 'gym', 'food', 'learn', 'social', 'chores', 'travel', 'relax', 'other'];
  function plan(draft, rangeApi) {
    const errors = [], slots = new Map(), reflections = [];
    if (!draft || !Array.isArray(draft.items) || !Array.isArray(draft.reflections)) return { errors: ['Make a draft first.'], slots: [], reflections: [] };
    if (draft.items.length > 32 || draft.reflections.length > 8) errors.push('Split this into a smaller request.');
    draft.items.forEach((item, i) => {
      if (!categories.includes(item.category) || !item.activity?.trim()) { errors.push(`Activity ${i + 1}: choose a category and activity name.`); return; }
      const range = rangeApi.build(item.date, item.start, item.end_date, item.end);
      if (range.error) { errors.push(`Activity ${i + 1}: ${range.error}`); return; }
      if (range.days.some(day => day.date === '2000-01-01') || range.hours > 168) { errors.push(`Activity ${i + 1}: choose at most 168 hours on ordinary calendar dates.`); return; }
      for (const day of range.days) for (const slot of day.slots) {
        const key = `${day.date}/${slot}`;
        if (slots.has(key)) { errors.push(`Activities overlap at ${day.date} ${slot}. Adjust or remove an entry.`); return; }
        slots.set(key, { date: day.date, slot, block: { category: item.category, sub: item.activity.trim(), note: item.note || '' } });
      }
    });
    draft.reflections.forEach((item, i) => {
      if (!Number.isFinite(rangeApi.dateNumber(item.date)) || item.date === '2000-01-01' || !item.text?.trim()) errors.push(`Reflection ${i + 1}: enter a date and reflection.`);
      else reflections.push({ date: item.date, text: item.text.trim() });
    });
    if (slots.size > 336) errors.push('Keep each draft at most 168 logged hours.');
    if (!slots.size && !reflections.length) errors.push('Add an activity or reflection before saving.');
    return { errors: [...new Set(errors)], slots: [...slots.values()], reflections };
  }
  function helperOrigin(value) {
    const url = new URL(value);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use a local helper address such as http://127.0.0.1:8765.');
    return url.origin;
  }
  function hostedOrigin(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Invalid hosted voice address.');
    return url.origin;
  }
  const api = { plan, helperOrigin, hostedOrigin, categories };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DayVoiceDraft = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
