/* Calendar arithmetic uses UTC dates so DST does not skip or repeat slots. */
(function (root) {
  const slots = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
  function dateNumber(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return NaN;
    const n = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === value ? n / 86400000 : NaN;
  }
  function shift(date, count) {
    const n = dateNumber(date);
    return Number.isFinite(n) ? new Date((n + count) * 86400000).toISOString().slice(0, 10) : '';
  }
  function build(startDate, startTime, endDate, endTime) {
    const first = dateNumber(startDate), last = dateNumber(endDate);
    const start = slots.indexOf(startTime), end = endTime === '24:00' ? 48 : slots.indexOf(endTime);
    if (!Number.isFinite(first) || !Number.isFinite(last) || start < 0 || end < 0) return { error: 'Choose valid start and end dates and times.', days: [] };
    if (last < first || (last === first && end <= start)) return { error: 'End must be after start. Choose a later end date for an overnight event.', days: [] };
    if (last - first >= 366) return { error: 'Choose a range of up to 366 dates.', days: [] };
    const days = [];
    for (let n = first; n <= last; n++) {
      const selection = slots.slice(n === first ? start : 0, n === last ? end : 48);
      if (selection.length) days.push({ date: shift(startDate, n - first), slots: selection });
    }
    return { days, hours: days.reduce((sum, day) => sum + day.slots.length / 2, 0) };
  }
  const api = { build, shift, dateNumber };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DayEventRange = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
