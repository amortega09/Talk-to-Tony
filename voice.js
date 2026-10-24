/* Voice capture + Ollama Cloud drafts. Provider keys stay on the server. */
(() => {
  const $ = id => document.getElementById(id);
  const agent = DayDiaryAgent.create();
  const state = { token: '', origin: '', connected: false, keyReady: false, speechReady: false, busy: false, saving: false, draft: null, stale: false, version: 0, controller: null, recorder: null, stream: null, timer: null, phase: 'idle', hosted: false, recognition: null, listening: false, browserSpeechFailed: false, history: null, historyController: null };
  $('voiceHelper').value = localStorage.getItem('day_voice_helper') || 'http://127.0.0.1:8765';
  const speechRecognition = () => window.SpeechRecognition || window.webkitSpeechRecognition;
  $('voiceSpeech').value = localStorage.getItem('day_voice_speech') || 'auto';
  const portableSpeech = () => state.hosted && $('voiceSpeech').value !== 'browser';
  const captureSupported = () => portableSpeech() ? !!window.DaySpeech?.supported() : !!speechRecognition();
  function privacy() {
    $('voicePrivacy').textContent = !state.hosted || portableSpeech() ? 'Audio is transcribed on this device. Text and relevant diary context are processed by Ollama. Nothing is saved until you choose.' : 'Your browser’s speech service transcribes audio. Text and relevant diary context are processed by Ollama. Nothing is saved until you choose.';
  }
  const status = text => { $('voiceStatus').textContent = text; };
  function phase(value, message) {
    state.phase = value;
    $('voiceDialog').dataset.phase = value;
    $('voicePhase').textContent = ({ idle: 'Ready when you are', connecting: 'Getting ready', listening: 'Listening', transcribing: 'Writing it down', thinking: 'Making sense of it', review: 'Ready to review', saved: 'All saved', error: 'Let’s try again' })[value] || value;
    $('voiceMeter').hidden = value !== 'listening';
    if (message) status(message);
  }
  const escape = value => escapeHtml(String(value ?? ''));
  function buttons() {
    $('voiceConnect').disabled = state.busy || state.saving || state.listening || !!state.stream;
    $('voiceBuild').disabled = state.busy || state.saving || state.listening || !!state.stream || !state.connected || !state.keyReady || !$('voiceModel').value || !$('voiceTranscript').value.trim();
    $('voiceRecord').disabled = state.busy || state.saving || !state.connected || !state.speechReady || (state.hosted ? !captureSupported() : !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder);
    $('voiceModel').disabled = state.busy || state.saving || state.listening || !!state.stream;
    $('voiceSpeech').disabled = state.busy || state.saving || state.listening || !!state.stream;
    if ($('voiceSpeech').parentElement) $('voiceSpeech').parentElement.hidden = !state.hosted;
    $('voiceHelper').disabled = state.hosted || state.busy || state.saving || state.listening || !!state.stream;
    $('voiceTranscript').disabled = state.saving || state.listening || !!state.stream;
    $('voiceClose').disabled = state.saving;
    const plan = DayVoiceDraft.plan(state.draft, DayEventRange);
    $('voiceSave').hidden = !state.draft;
    $('voiceSaveBar').hidden = !state.draft;
    $('voiceRecordLabel').textContent = state.stream || state.listening ? 'Finish talking' : state.busy ? 'One moment…' : state.draft?.questions?.length ? 'Answer by voice' : state.draft ? 'Add a correction' : 'Start talking';
    $('voiceBuild').textContent = state.draft?.questions?.length ? 'Reply' : state.draft ? 'Apply changes' : 'Organise my day';
    $('voiceTranscriptLabel').textContent = $('voiceTranscript').value.trim() ? 'What I heard · edit text' : 'Prefer to type?';
    $('voiceRetry').hidden = state.busy || state.connected;
    $('voiceSaveSummary').textContent = state.draft ? `${plan.slots.length / 2}h · ${state.draft.items.length} ${state.draft.items.length === 1 ? 'activity' : 'activities'}${state.draft.reflections.length ? ' · reflection' : ''}` : '';
    $('voiceSave').disabled = state.busy || state.saving || state.listening || !!state.stream || state.stale || plan.errors.length > 0;
    $('voiceValidation').textContent = state.draft ? (state.stale ? 'Your description changed. Make a new draft before saving.' : plan.errors.join(' ')) : '';
  }
  async function api(path, body, timeout = 180000) {
    const controller = new AbortController();
    const requestOwner=USER_ID;
    state.controller = controller;
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const audio = body instanceof Blob;
      let authorization = {};
      if (state.hosted) {
        const session = await sb?.auth?.getSession();
        const token = session?.data?.session?.access_token;
        if(USER_ID!==requestOwner || (session?.data?.session?.user?.id && session.data.session.user.id!==requestOwner)) throw new Error('Your account changed. Close and reopen voice to continue.');
        if (!token) throw new Error('Please sign in to Day to use voice.');
        authorization = { Authorization: 'Bearer ' + token };
      }
      const response = await fetch(state.origin + path, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store', signal: controller.signal,
        headers: { ...authorization, ...(body === undefined ? {} : { ...(state.hosted ? {} : { 'X-Day-Token': state.token }), 'Content-Type': audio ? (body.type || 'application/octet-stream') : 'application/json' }) },
        body: body === undefined ? undefined : audio ? body : JSON.stringify(body) });
      let result;
      try { result = await response.json(); } catch { throw new Error('The voice service returned an unexpected response. Your words are safe—please reconnect.'); }
      if (!response.ok) throw new Error(result.error || 'The voice service could not complete the request.');
      return result;
    } finally { clearTimeout(timer); if (state.controller === controller) state.controller = null; }
  }
  async function connect() {
    if (state.busy || state.saving || state.stream || state.listening) return;
    const version = state.version;
    state.connected = false; state.busy = true; phase('connecting', 'Getting your space ready…'); buttons();
    try {
      const hosted = window.APP_CONFIG?.VOICE_API_URL;
      state.hosted = !!hosted;
      state.origin = hosted ? DayVoiceDraft.hostedOrigin(hosted) : DayVoiceDraft.helperOrigin($('voiceHelper').value.trim());
      if (portableSpeech()) window.DaySpeech?.prepare?.().catch(() => {});
      const result = await api('/api/voice/status', undefined, 20000);
      if (version !== state.version) return;
      if ((!state.hosted && !result.token) || !Array.isArray(result.models)) throw new Error('The voice service returned an invalid connection response.');
      state.token = result.token || ''; state.connected = true; state.keyReady = !!result.api_key_ready; state.speechReady = !!result.transcription_ready && (!state.hosted || captureSupported());
      privacy();
      const preferred = localStorage.getItem('day_voice_model_v2') || 'auto';
      const automatic = result.recommended_model ? `<option value="auto">Automatic · ${escape(result.recommended_model)} (recommended)</option>` : '<option value="">Choose a cloud model (recommendation unavailable)</option>';
      const models = [...result.models].sort((a, b) => (a === result.recommended_model ? -1 : b === result.recommended_model ? 1 : a.localeCompare(b)));
      $('voiceModel').innerHTML = automatic + models.map(model => `<option value="${escape(model)}">${escape(model)}</option>`).join('');
      $('voiceModel').value = preferred === 'auto' ? (result.recommended_model ? 'auto' : '') : result.models.includes(preferred) ? preferred : (result.recommended_model ? 'auto' : '');
      if (!state.hosted) localStorage.setItem('day_voice_helper', state.origin);
      phase(state.draft ? 'review' : 'idle', !state.keyReady ? 'Voice needs a one-time setup. Your text will stay here.' : result.ollama_error ? 'We couldn’t reach the voice service. Try again in a moment.' : !$('voiceModel').value ? 'Please choose an available model in Voice settings.' : state.speechReady ? 'Click the microphone. Stop whenever you’re done.' : 'You can type your day below while voice is unavailable.');
      $('voiceSettings').open = false;
    } catch (error) {
      if (version === state.version) {
        phase('error', 'Voice couldn’t connect. Your text is safe. Try again in a moment.');
        $('voiceSettings').open = false;
      }
    } finally { if (version === state.version) { state.busy = false; buttons(); } }
  }
  function timeSelect(value, end, index, field) {
    const times = [...SLOTS, ...(end ? ['24:00'] : [])];
    return `<select data-group="items" data-index="${index}" data-field="${field}"><option value="">Choose time</option>${times.map(t => `<option value="${t}"${t === value ? ' selected' : ''}>${t === '24:00' ? 'Midnight (end of day)' : to12(t)}</option>`).join('')}</select>`;
  }
  function draftDate(value) {
    if (!value) return 'Choose a day';
    const today = ymd(new Date());
    if (value === today) return 'Today';
    if (value === DayEventRange.shift(today, -1)) return 'Yesterday';
    return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function renderDraft() {
    const d = state.draft;
    $('voiceReply').hidden = !d;
    $('voiceReply').textContent = d?.reply || '';
    $('voiceQuestions').textContent = d?.questions?.find(q=>q.trim()) || '';
    $('voiceDraft').innerHTML = !d ? '' : d.items.map((item, i) => {
      const range = DayEventRange.build(item.date, item.start, item.end_date, item.end);
      const timing = item.start && item.end ? `${to12(item.start)} – ${item.end === '24:00' ? 'midnight' : to12(item.end)}` : 'Add a time';
      const date = draftDate(item.date) + (item.end_date && item.end_date !== item.date ? ` → ${draftDate(item.end_date)}` : '');
      return `<details class="voice-card"${range.error || !item.activity ? ' open' : ''}><summary><span class="voice-card-mark" aria-hidden="true">${i + 1}</span><span class="voice-card-title"><strong>${escape(item.activity || 'Untitled activity')}</strong><small>${escape(date)} · ${escape(timing)}</small></span><span class="voice-card-edit">Edit</span></summary>
      <fieldset class="voice-entry"><legend class="sr-only">Activity ${i + 1}</legend>
      <div class="voice-grid"><label>Start date<input type="date" data-group="items" data-index="${i}" data-field="date" value="${escape(item.date)}" /></label><label>End date<input type="date" data-group="items" data-index="${i}" data-field="end_date" value="${escape(item.end_date)}" /></label>
      <label>Start${timeSelect(item.start, false, i, 'start')}</label><label>End${timeSelect(item.end, true, i, 'end')}</label></div>
      <label>Activity<input maxlength="200" data-group="items" data-index="${i}" data-field="activity" value="${escape(item.activity)}" /></label>
      <label>Category<select data-group="items" data-index="${i}" data-field="category">${DayVoiceDraft.categories.map(cat => `<option value="${cat}"${cat === item.category ? ' selected' : ''}>${escape(cat === 'gym' ? 'Gym' : catLabel(cat))}</option>`).join('')}</select></label>
      <label>Note<textarea maxlength="4000" rows="2" data-group="items" data-index="${i}" data-field="note">${escape(item.note)}</textarea></label>
      <button type="button" class="text-btn" data-remove="items" data-index="${i}">Remove activity</button></fieldset></details>`;
    }).join('') + d.reflections.map((item, i) => `<details class="voice-card"${!item.date ? ' open' : ''}><summary><span class="voice-card-mark" aria-hidden="true">✦</span><span class="voice-card-title"><strong>A thought about your day</strong><small>${escape(draftDate(item.date))} · ${escape(item.text.slice(0, 65))}${item.text.length > 65 ? '…' : ''}</small></span><span class="voice-card-edit">Edit</span></summary>
      <fieldset class="voice-entry"><legend class="sr-only">Reflection ${i + 1}</legend><label>Date<input type="date" data-group="reflections" data-index="${i}" data-field="date" value="${escape(item.date)}" /></label>
      <label>Reflection<textarea maxlength="4000" rows="3" data-group="reflections" data-index="${i}" data-field="text">${escape(item.text)}</textarea></label>
      <small>Added to this day’s reflection.</small><button type="button" class="text-btn" data-remove="reflections" data-index="${i}">Remove reflection</button></fieldset></details>`).join('');
    buttons();
  }
  async function build() {
    const version = state.version;
    const transcript = $('voiceTranscript').value.trim();
    if (!transcript) return;
    state.busy = true; $('voiceDraft').inert = true; phase('thinking', 'Finding the activities, times and thoughts in your words…'); buttons();
    try {
      const now = new Date();
      phase('thinking', 'Finding the relevant parts of your diary…');
      const owner = USER_ID;
      const controller = new AbortController();state.historyController=controller;
      const historyTimer=setTimeout(()=>controller.abort(),30000);
      let history;
      try {
        history = state.history?.owner===owner && Date.now()-state.history.loadedAt<30000 ? state.history : await DayVoiceContext.load({client:sb,userId:owner,storage:localStorage,signal:controller.signal});
      } catch(error) {
        if(version!==state.version)return;
        history={rows:[],source:sb?'cloud':'local',complete:false};
      } finally {clearTimeout(historyTimer);if(state.historyController===controller)state.historyController=null;}
      if(version!==state.version || USER_ID!==owner)return;
      state.history={...history,owner,loadedAt:Date.now()};
      const outcome=await agent.run({userId:owner,transcript,previous:state.draft,
        context:{today:ymd(now),viewed_date:ymd(current),local_time:`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone},
        recall:async({query})=>{
          const diary=DayVoiceContext.select(history,{today:ymd(now),viewedDate:ymd(current),transcript:query});
          $('voiceContextStatus').textContent=diary.status==='ready' ? `Using ${diary.coverage.days_available} saved diary ${diary.coverage.days_available===1?'day':'days'} · ${diary.entries.length} relevant ${diary.entries.length===1?'activity':'activities'}${diary.routines.length?' · routines':''}${diary.day_notes.length+diary.notes.length?' · notes':''}${Object.values(diary.goals).some(Boolean)?' · goals':''}.` : 'Some diary history could not load. Missing details will need clarification.';
          $('voiceContextStatus').hidden=false;
          return diary;
        },
        think:payload=>{phase('thinking','Organising your words with your diary context…');return api('/api/voice/draft',payload);}
      });
      if(!outcome)return;
      const result=outcome.draft;
      if (version !== state.version || USER_ID!==owner) {agent.reset();return;}
      if (!Array.isArray(result.items) || !Array.isArray(result.reflections) || !Array.isArray(result.questions)) throw new Error('Invalid draft returned. Nothing was saved.');
      state.draft = { reply: result.reply, questions: result.questions, items: result.items, reflections: result.reflections }; state.stale = transcript !== $('voiceTranscript').value.trim(); renderDraft(); $('voiceCompose').open = state.stale || !!outcome.question; phase('review', state.stale ? 'Your words changed while processing. Apply your changes to update the preview.' : outcome.question ? 'One quick question—reply by voice or edit the text below.' : 'Here’s what I heard. Change anything, then save.');
    } catch (error) { if (version === state.version) phase('error', error.name === 'AbortError' ? 'That took too long. Your words are still here—try again.' : error.message); }
    finally { if (version === state.version) { state.busy = false; $('voiceDraft').inert = false; buttons(); } }
  }
  async function recordInBrowser() {
    if (state.recognition) { state.recognition.stop(); return; }
    const Recognition = speechRecognition();
    if (!Recognition) { $('voiceCompose').open = true; phase('error', 'Voice isn’t available in this browser. You can type your day below.'); return; }
    const version = state.version;
    const before = state.draft && !state.stale ? '' : $('voiceTranscript').value.trim();
    const recognition = new Recognition();
    let heard = '', failed = false;
    state.recognition = recognition; state.listening = true;
    recognition.lang = navigator.language || 'en-GB';
    recognition.continuous = true; recognition.interimResults = true;
    recognition.onresult = event => {
      const words = [];
      for (let i = 0; i < event.results.length; i++) words.push(event.results[i][0].transcript);
      heard = words.join(' ').trim();
      if (version === state.version) $('voiceTranscript').value = [before, heard].filter(Boolean).join('\n');
    };
    recognition.onerror = event => {
      failed = true;
      if (version === state.version) {
        const messages = {
          'not-allowed': 'Microphone access is blocked. Allow it in your browser’s site settings, then try again.',
          'audio-capture': 'Your microphone isn’t available. Check your input device and close other apps using it.',
          'no-speech': 'No speech was detected. Try speaking closer to your microphone.',
          'language-not-supported': 'This speech service doesn’t support your language. Use built-in transcription in Voice settings.'
        };
        if (['network', 'service-not-allowed'].includes(event.error) && window.DaySpeech?.supported()) {
          state.browserSpeechFailed = true; $('voiceSpeech').value = 'auto';
          localStorage.setItem('day_voice_speech', 'portable'); privacy();
          phase('error', 'Your browser’s speech service is unavailable. Click the microphone again to use built-in transcription.');
        } else phase('error', messages[event.error] || `Speech recognition stopped (${event.error || 'unknown error'}). Try again or type below.`);
        $('voiceCompose').open = true;
      }
    };
    recognition.onend = async () => {
      if (state.recognition === recognition) { state.recognition = null; state.listening = false; clearTimeout(state.timer); }
      if (version !== state.version) return;
      state.busy = false; buttons();
      if (failed) return;
      if (!heard) { phase('error', 'I didn’t catch any speech. Try again or type below.'); return; }
      state.stale = !!state.draft;
      await build();
    };
    try {
      recognition.start();
      $('voiceCompose').open = true;
      phase('listening', 'Take your time. Click again when you’re done.'); buttons();
      state.timer = setTimeout(() => { if (state.recognition === recognition) recognition.stop(); }, 120000);
    } catch {
      state.recognition = null; state.listening = false;
      phase('error', 'We couldn’t start voice. You can type your day instead.'); $('voiceCompose').open = true; buttons();
    }
  }
  async function record() {
    if (state.hosted && !portableSpeech()) return recordInBrowser();
    if (state.recorder?.state === 'recording') { state.recorder.stop(); return; }
    const version = state.version;
    const before = state.draft && !state.stale ? '' : $('voiceTranscript').value.trim();
    state.busy = true; buttons();
    if (portableSpeech()) window.DaySpeech?.prepare?.().catch(() => {});
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (version !== state.version) { stream.getTracks().forEach(track => track.stop()); return; }
      state.stream = stream;
      const chunks = [];
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(t => MediaRecorder.isTypeSupported(t));
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      state.recorder = recorder;
      let recordTimer, failed = false;
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        clearTimeout(recordTimer); stream.getTracks().forEach(track => track.stop());
        if (state.recorder === recorder) { state.stream = null; state.recorder = null; $('voiceRecordLabel').textContent = 'Start talking'; }
        if (version !== state.version) { buttons(); return; }
        if (failed) { state.busy = false; phase('error', 'Recording failed. Your existing draft is safe. Please try again.'); buttons(); return; }
        state.busy = true; phase('transcribing', 'Turning your words into a clear picture…'); buttons();
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType });
          const result = state.hosted ? await window.DaySpeech.transcribe(blob, message => { if (version === state.version) phase('transcribing', message); }) : await api('/api/voice/transcribe', blob);
          if (version !== state.version) return;
          if (!result.text?.trim()) throw new Error('I didn’t catch any speech. Try again or type instead.');
          $('voiceTranscript').value = [before, result.text].filter(Boolean).join('\n');
          state.stale = !!state.draft; state.busy = false; buttons();
          await build();
        } catch (error) { if (version === state.version) phase('error', error.name === 'AbortError' ? 'That took too long. Try recording a shorter thought.' : error.message); }
        finally { if (version === state.version) { state.busy = false; buttons(); } }
      };
      recorder.onerror = () => { failed = true; status('Recording failed. Try again or type your description.'); if (recorder.state !== 'inactive') recorder.stop(); else { stream.getTracks().forEach(track => track.stop()); state.stream = null; state.recorder = null; state.busy = false; phase('error', 'Recording failed. Please try again.'); buttons(); } };
      recorder.start(); recordTimer = state.timer = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 120000);
      $('voiceCompose').open = false; phase('listening', 'Take your time. Click again when you’re done.');
    } catch (error) { stream?.getTracks().forEach(track => track.stop()); state.stream = null; phase('error', error.name === 'NotAllowedError' ? 'Allow microphone access in your browser, or type your day below.' : 'We couldn’t start the microphone. You can type your day instead.'); $('voiceCompose').open = true; }
    finally { if (version === state.version) { state.busy = false; buttons(); } }
  }
  async function save() {
    if ($('voiceSave').disabled || !state.draft) return;
    const plan = DayVoiceDraft.plan(state.draft, DayEventRange);
    if (plan.errors.length) return;
    if (RECOVERY_MODE) { status('Recovery mode is read-only. Open the normal signed-in app to save.'); return; }
    state.saving = true; status('Saving your day…'); buttons(); $('voiceDraft').inert = true;
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
      persisted = true; agent.reset(); state.history = null; state.draft = null; renderDraft();
      if (map[ymd(current)]) { data = map[ymd(current)]; render(); }
      if (sb) for (let offset = 0; offset < rows.length; offset += 500) {
        const { error } = await sb.from('blocks').upsert(rows.slice(offset, offset + 500), { onConflict: 'user_id,date,start_time' });
        if (error) throw new Error('Saved on this device, but cloud sync failed. Export a backup before switching devices.');
      }
      phase('saved', `Saved ${plan.slots.length / 2} hours${plan.reflections.length ? ' and your reflection' : ''}. You’re all set.`);
      setStatus('ok', sb ? 'Synced' : 'Saved locally');
      $('voiceTranscript').value = '';
    } catch (error) { status(error.message || 'Could not save.'); if (persisted) setStatus('err', 'Saved locally · sync failed'); }
    finally { state.saving = false; $('voiceDraft').inert = false; buttons(); }
  }
  function close() {
    if (state.saving) return;
    state.version++; state.controller?.abort(); clearTimeout(state.timer);
    state.busy = false; state.connected = false; state.token = '';
    state.recognition?.abort(); state.recognition = null; state.listening = false;
    $('voiceDraft').inert = false;
    if (state.recorder?.state === 'recording') state.recorder.stop();
    state.stream?.getTracks().forEach(track => track.stop()); state.stream = null; state.recorder = null;
    agent.reset();
    state.historyController?.abort(); state.historyController=null; state.history=null;
    window.DaySpeech?.cancel();
    $('voiceRecordLabel').textContent = 'Start talking';
    $('voiceDialog').hidden = true; $('voiceOpen').focus();
  }
  async function open() {
    $('voiceDialog').hidden = false;
    buttons(); $('voiceClose').focus();
    await connect();
    if (!$('voiceDialog').hidden && !$('voiceRecord').disabled && document.activeElement === $('voiceClose')) $('voiceRecord').focus();
  }
  $('voiceOpen').addEventListener('click', open);
  $('voiceClose').addEventListener('click', close);
  $('voiceDialog').addEventListener('click', e => { if (e.target === $('voiceDialog')) close(); });
  $('voiceDialog').addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  $('voiceConnect').addEventListener('click', connect);
  $('voiceRecord').addEventListener('click', record);
  $('voiceBuild').addEventListener('click', build);
  $('voiceRetry').addEventListener('click', connect);
  $('voiceTranscript').addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !$('voiceBuild').disabled) { e.preventDefault(); build(); } });
  $('voiceSave').addEventListener('click', save);
  $('voiceHelper').addEventListener('input', () => { state.connected = false; buttons(); status('Reconnect to use the new helper address.'); });
  $('voiceSpeech').addEventListener('change', () => { localStorage.setItem('day_voice_speech', $('voiceSpeech').value); state.speechReady = captureSupported(); privacy(); buttons(); });
  $('voiceModel').addEventListener('change', () => localStorage.setItem('day_voice_model_v2', $('voiceModel').value));
  $('voiceTranscript').addEventListener('input', () => { state.stale = !!state.draft; buttons(); });
  $('voiceDraft').addEventListener('input', e => {
    const { group, index, field } = e.target.dataset;
    if (!group || !state.draft?.[group]?.[index]) return;
    state.draft[group][index][field] = e.target.value || (['date', 'end_date', 'start', 'end'].includes(field) ? null : '');
    const item = state.draft[group][index], card = e.target.closest('.voice-card');
    if (card) {
      const detail = card.querySelector('.voice-card-title small');
      if (group === 'items') {
        card.querySelector('.voice-card-title strong').textContent = item.activity || 'Untitled activity';
        const date = draftDate(item.date) + (item.end_date && item.end_date !== item.date ? ` → ${draftDate(item.end_date)}` : '');
        detail.textContent = `${date} · ${item.start && item.end ? `${to12(item.start)} – ${item.end === '24:00' ? 'midnight' : to12(item.end)}` : 'Add a time'}`;
      } else detail.textContent = `${draftDate(item.date)} · ${item.text.slice(0, 65)}${item.text.length > 65 ? '…' : ''}`;
    }
    buttons();
  });
  $('voiceDraft').addEventListener('click', e => {
    const { remove, index } = e.target.dataset;
    if (remove && state.draft?.[remove]) { state.draft[remove].splice(Number(index), 1); renderDraft(); }
  });
})();
