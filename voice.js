/* Desktop voice capture + Ollama Cloud drafts. Keys live only in desktop.py. */
(() => {
  const $ = id => document.getElementById(id);
  const state = { token: '', origin: '', connected: false, keyReady: false, speechReady: false, busy: false, saving: false, draft: null, stale: false, version: 0, controller: null, recorder: null, stream: null, timer: null };
  $('voiceHelper').value = localStorage.getItem('day_voice_helper') || 'http://127.0.0.1:8765';
  const status = text => { $('voiceStatus').textContent = text; };
  const escape = value => escapeHtml(String(value ?? ''));
  function buttons() {
    $('voiceConnect').disabled = state.busy || state.saving || !!state.stream;
    $('voiceBuild').disabled = state.busy || state.saving || !!state.stream || !state.connected || !state.keyReady || !$('voiceModel').value || !$('voiceTranscript').value.trim();
    $('voiceRecord').disabled = state.busy || state.saving || !state.connected || !state.speechReady || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder;
    $('voiceModel').disabled = state.busy || state.saving;
    $('voiceHelper').disabled = state.busy || state.saving || !!state.stream;
    $('voiceTranscript').disabled = state.saving;
    $('voiceClose').disabled = state.saving;
    const plan = DayVoiceDraft.plan(state.draft, DayEventRange);
    $('voiceSave').hidden = !state.draft;
    $('voiceSave').disabled = state.busy || state.saving || !!state.stream || state.stale || plan.errors.length > 0;
    $('voiceValidation').textContent = state.draft ? (state.stale ? 'Your description changed. Make a new draft before saving.' : plan.errors.join(' ')) : '';
  }
  async function api(path, body, timeout = 180000) {
    const controller = new AbortController();
    state.controller = controller;
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const audio = body instanceof Blob;
      const response = await fetch(state.origin + path, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store', signal: controller.signal,
        headers: { ...(body === undefined ? {} : { 'X-Day-Token': state.token, 'Content-Type': audio ? (body.type || 'application/octet-stream') : 'application/json' }) },
        body: body === undefined ? undefined : audio ? body : JSON.stringify(body) });
      let result;
      try { result = await response.json(); } catch { throw new Error('This address is not the Day desktop helper. Start python3 desktop.py and reconnect.'); }
      if (!response.ok) throw new Error(result.error || 'The desktop helper could not complete the request.');
      return result;
    } finally { clearTimeout(timer); if (state.controller === controller) state.controller = null; }
  }
  async function connect() {
    const version = state.version;
    state.connected = false; state.busy = true; buttons(); status('Connecting…');
    try {
      state.origin = DayVoiceDraft.helperOrigin($('voiceHelper').value.trim());
      const result = await api('/api/voice/status', undefined, 20000);
      if (version !== state.version) return;
      if (!result.token || !Array.isArray(result.models)) throw new Error('Desktop helper returned an invalid connection response.');
      state.token = result.token; state.connected = true; state.keyReady = !!result.api_key_ready; state.speechReady = !!result.transcription_ready;
      const preferred = localStorage.getItem('day_voice_model');
      $('voiceModel').innerHTML = result.models.map(model => `<option value="${escape(model)}">${escape(model)}</option>`).join('');
      $('voiceModel').value = result.models.includes(preferred) ? preferred : result.default_model;
      localStorage.setItem('day_voice_helper', state.origin);
      status(!state.keyReady ? 'Add your key to .day-voice/ollama.env, then reconnect.' : result.ollama_error || (state.speechReady ? 'Connected · local transcription + Ollama Cloud.' : 'Cloud connected. Type to begin; local transcription needs setup (see README).'));
      $('voiceSettings').open = !state.keyReady || !result.models.length;
    } catch (error) {
      if (version === state.version) status(error.name === 'AbortError' ? 'Connection cancelled or timed out.' : `${error.message} If blocked, allow your Day website with --allow-origin.`);
    } finally { state.busy = false; buttons(); }
  }
  function timeSelect(value, end, index, field) {
    const times = [...SLOTS, ...(end ? ['24:00'] : [])];
    return `<select data-group="items" data-index="${index}" data-field="${field}"><option value="">Choose time</option>${times.map(t => `<option value="${t}"${t === value ? ' selected' : ''}>${t === '24:00' ? 'Midnight (end of day)' : to12(t)}</option>`).join('')}</select>`;
  }
  function renderDraft() {
    const d = state.draft;
    $('voiceReply').hidden = !d;
    $('voiceReply').textContent = d?.reply || '';
    $('voiceQuestions').textContent = d?.questions?.join(' ') || '';
    $('voiceDraft').innerHTML = !d ? '' : d.items.map((item, i) => `<fieldset class="voice-entry"><legend>Activity ${i + 1}</legend>
      <div class="voice-grid"><label>Start date<input type="date" data-group="items" data-index="${i}" data-field="date" value="${escape(item.date)}" /></label><label>End date<input type="date" data-group="items" data-index="${i}" data-field="end_date" value="${escape(item.end_date)}" /></label>
      <label>Start${timeSelect(item.start, false, i, 'start')}</label><label>End${timeSelect(item.end, true, i, 'end')}</label></div>
      <label>Activity<input maxlength="200" data-group="items" data-index="${i}" data-field="activity" value="${escape(item.activity)}" /></label>
      <label>Category<select data-group="items" data-index="${i}" data-field="category">${DayVoiceDraft.categories.map(cat => `<option value="${cat}"${cat === item.category ? ' selected' : ''}>${escape(cat === 'gym' ? 'Gym' : catLabel(cat))}</option>`).join('')}</select></label>
      <label>Note<textarea maxlength="4000" rows="2" data-group="items" data-index="${i}" data-field="note">${escape(item.note)}</textarea></label>
      <button type="button" class="text-btn" data-remove="items" data-index="${i}">Remove activity</button></fieldset>`).join('') + d.reflections.map((item, i) => `<fieldset class="voice-entry"><legend>Reflection ${i + 1}</legend>
      <label>Date<input type="date" data-group="reflections" data-index="${i}" data-field="date" value="${escape(item.date)}" /></label>
      <label>Reflection<textarea maxlength="4000" rows="3" data-group="reflections" data-index="${i}" data-field="text">${escape(item.text)}</textarea></label>
      <small>Appended to this day’s reflection.</small><button type="button" class="text-btn" data-remove="reflections" data-index="${i}">Remove reflection</button></fieldset>`).join('');
    buttons();
  }
  async function build() {
    const version = state.version;
    const transcript = $('voiceTranscript').value.trim();
    state.busy = true; $('voiceDraft').inert = true; buttons(); status('Preparing your draft with Ollama Cloud…');
    try {
      const now = new Date();
      const result = await api('/api/voice/draft', { transcript, model: $('voiceModel').value, previous: state.draft,
        context: { today: ymd(now), viewed_date: ymd(current), local_time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          activities: activityOptions().slice(0, 80).map(a => ({ activity: a.label, category: a.catId })) } });
      if (version !== state.version) return;
      if (!Array.isArray(result.items) || !Array.isArray(result.reflections) || !Array.isArray(result.questions)) throw new Error('Invalid draft returned. Nothing was saved.');
      state.draft = result; state.stale = transcript !== $('voiceTranscript').value.trim(); renderDraft(); status(state.stale ? 'Your description changed during drafting. Make a new draft before saving.' : 'Draft ready. Check the dates, times and activities before saving.');
    } catch (error) { if (version === state.version) status(error.name === 'AbortError' ? 'Request cancelled or timed out. Nothing was saved.' : error.message); }
    finally { state.busy = false; $('voiceDraft').inert = false; buttons(); }
  }
  async function record() {
    if (state.recorder?.state === 'recording') { state.recorder.stop(); return; }
    const version = state.version;
    state.busy = true; buttons();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (version !== state.version) { stream.getTracks().forEach(track => track.stop()); return; }
      state.stream = stream;
      const chunks = [];
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(t => MediaRecorder.isTypeSupported(t));
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      state.recorder = recorder;
      let recordTimer;
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        clearTimeout(recordTimer); stream.getTracks().forEach(track => track.stop());
        if (state.recorder === recorder) { state.stream = null; state.recorder = null; $('voiceRecord').textContent = '🎙 Record'; }
        if (version !== state.version) { buttons(); return; }
        state.busy = true; buttons(); status('Transcribing on your computer…');
        try {
          const result = await api('/api/voice/transcribe', new Blob(chunks, { type: recorder.mimeType }));
          if (version !== state.version) return;
          $('voiceTranscript').value = [$('voiceTranscript').value.trim(), result.text].filter(Boolean).join('\n');
          state.stale = !!state.draft; buttons(); status('Transcript ready. Edit it if needed, then make a draft.');
        } catch (error) { if (version === state.version) status(error.name === 'AbortError' ? 'Transcription cancelled or timed out.' : error.message); }
        finally { state.busy = false; buttons(); }
      };
      recorder.onerror = () => { status('Recording failed. Try again or type your description.'); if (recorder.state !== 'inactive') recorder.stop(); else stream.getTracks().forEach(track => track.stop()); };
      recorder.start(); recordTimer = state.timer = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 120000);
      $('voiceRecord').textContent = '■ Stop recording'; status('Recording · click Stop when finished (2 minute limit).');
    } catch (error) { stream?.getTracks().forEach(track => track.stop()); state.stream = null; status(error.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow it in your browser, or type instead.' : 'Could not start the microphone. Type your description instead.'); }
    finally { state.busy = false; buttons(); }
  }
  async function save() {
    if ($('voiceSave').disabled || !state.draft) return;
    const plan = DayVoiceDraft.plan(state.draft, DayEventRange);
    if (plan.errors.length) return;
    if (RECOVERY_MODE) { status('Recovery mode is read-only. Open the normal signed-in app to save.'); return; }
    state.saving = true; buttons(); $('voiceDraft').inert = true;
    const map = {}, rows = [];
    let persisted = false;
    try {
      const dates = [...new Set([...plan.slots.map(x => x.date), ...plan.reflections.map(x => x.date)])];
      for (const date of dates) map[date] = loadLocal(date);
      if (sb) for (let offset = 0; ; offset += 500) {
        const { data: remote, error } = await sb.from('blocks').select('date,start_time,category,note,subcategory').eq('user_id', USER_ID).in('date', dates).order('date').order('start_time').range(offset, offset + 499);
        if (error) throw new Error('Could not check existing records. Nothing was saved; reconnect and retry.');
        for (const r of remote || []) map[r.date][r.start_time] = { category: r.category, note: r.note || '', sub: r.subcategory || '' };
        if (!remote || remote.length < 500) break;
      }
      const conflicts = plan.slots.filter(item => map[item.date][item.slot]).length;
      if (conflicts && !window.confirm(`Replace ${conflicts} existing half-hour block${conflicts === 1 ? '' : 's'} with this reviewed draft?`)) return;
      for (const item of plan.slots) map[item.date][item.slot] = item.block;
      for (const item of plan.reflections) {
        const old = map[item.date][REFLECT_KEY]?.note || '';
        map[item.date][REFLECT_KEY] = { category: 'reflection', note: old === item.text ? old : [old, item.text].filter(Boolean).join('\n\n') };
      }
      const touched = new Map(plan.slots.map(item => [`${item.date}/${item.slot}`, { date: item.date, slot: item.slot }]));
      for (const item of plan.reflections) touched.set(`${item.date}/${REFLECT_KEY}`, { date: item.date, slot: REFLECT_KEY });
      for (const { date, slot } of touched.values()) {
        const block = map[date][slot];
        rows.push({ user_id: USER_ID, date, start_time: slot, category: block.category, subcategory: block.sub || '', note: block.note || '', updated_at: new Date().toISOString() });
      }
      for (const date of dates) saveLocal(date, map[date]);
      persisted = true; state.draft = null; renderDraft();
      if (map[ymd(current)]) { data = map[ymd(current)]; render(); }
      if (sb) for (let offset = 0; offset < rows.length; offset += 500) {
        const { error } = await sb.from('blocks').upsert(rows.slice(offset, offset + 500), { onConflict: 'user_id,date,start_time' });
        if (error) throw new Error('Saved on this device, but cloud sync failed. Export a backup before switching devices.');
      }
      status(`Saved ${plan.slots.length / 2} hours${plan.reflections.length ? ' and your reflection' : ''}.`);
      setStatus('ok', sb ? 'Synced' : 'Saved locally');
      $('voiceTranscript').value = '';
    } catch (error) { status(error.message || 'Could not save.'); if (persisted) setStatus('err', 'Saved locally · sync failed'); }
    finally { state.saving = false; $('voiceDraft').inert = false; buttons(); }
  }
  function close() {
    if (state.saving) return;
    state.version++; state.controller?.abort(); clearTimeout(state.timer);
    if (state.recorder?.state === 'recording') state.recorder.stop();
    state.stream?.getTracks().forEach(track => track.stop()); state.stream = null; state.recorder = null;
    $('voiceRecord').textContent = '🎙 Record';
    $('voiceDialog').hidden = true; $('voiceOpen').focus();
  }
  $('voiceOpen').addEventListener('click', () => { $('voiceDialog').hidden = false; buttons(); $('voiceTranscript').focus(); });
  $('voiceClose').addEventListener('click', close);
  $('voiceDialog').addEventListener('click', e => { if (e.target === $('voiceDialog')) close(); });
  $('voiceDialog').addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  $('voiceConnect').addEventListener('click', connect);
  $('voiceRecord').addEventListener('click', record);
  $('voiceBuild').addEventListener('click', build);
  $('voiceSave').addEventListener('click', save);
  $('voiceHelper').addEventListener('input', () => { state.connected = false; buttons(); status('Reconnect to use the new helper address.'); });
  $('voiceModel').addEventListener('change', () => localStorage.setItem('day_voice_model', $('voiceModel').value));
  $('voiceTranscript').addEventListener('input', () => { state.stale = !!state.draft; buttons(); });
  $('voiceDraft').addEventListener('input', e => {
    const { group, index, field } = e.target.dataset;
    if (!group || !state.draft?.[group]?.[index]) return;
    state.draft[group][index][field] = e.target.value || (['date', 'end_date', 'start', 'end'].includes(field) ? null : ''); buttons();
  });
  $('voiceDraft').addEventListener('click', e => {
    const { remove, index } = e.target.dataset;
    if (remove && state.draft?.[remove]) { state.draft[remove].splice(Number(index), 1); renderDraft(); }
  });
})();
