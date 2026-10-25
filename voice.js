/* Voice capture + Ollama Cloud drafts. Provider keys stay on the server. */
(() => {
  const $ = id => document.getElementById(id);
  const agent = DayDiaryAgent.create();
  const state = { token: '', origin: '', connected: false, keyReady: false, speechReady: false, busy: false, saving: false, draft: null, stale: false, version: 0, controller: null, recorder: null, stream: null, timer: null, phase: 'idle', hosted: false, recognition: null, listening: false, browserSpeechFailed: false, history: null, historyController: null, prefetch: null, snapshot: null, actionReview: null, undo: null, owner: null };
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
    const local=DayVoiceActions.localCommand($('voiceTranscript').value,{today:ymd(new Date()),viewedDate:ymd(current),shift:DayEventRange.shift});
    $('voiceBuild').disabled = state.busy || state.saving || state.listening || !!state.stream || (!local && (!state.connected || !state.keyReady || !$('voiceModel').value)) || !$('voiceTranscript').value.trim();
    $('voiceRecord').disabled = state.busy || state.saving || !state.connected || !state.speechReady || (state.hosted ? !captureSupported() : !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder);
    $('voiceModel').disabled = state.busy || state.saving || state.listening || !!state.stream;
    $('voiceSpeech').disabled = state.busy || state.saving || state.listening || !!state.stream;
    if ($('voiceSpeech').parentElement) $('voiceSpeech').parentElement.hidden = !state.hosted;
    $('voiceHelper').disabled = state.hosted || state.busy || state.saving || state.listening || !!state.stream;
    $('voiceTranscript').disabled = state.saving || state.listening || !!state.stream;
    $('voiceClose').disabled = state.saving;
    const plan = state.draft?.actions?.length ? {slots:[],errors:state.actionReview?[]:['Preparing action preview…']} : DayVoiceDraft.plan(state.draft, DayEventRange);
    $('voiceSave').hidden = !state.draft;
    $('voiceSaveBar').hidden = !state.draft;
    $('voiceRecordLabel').textContent = state.stream || state.listening ? 'Finish talking' : state.busy ? 'One moment…' : state.draft?.questions?.length ? 'Answer by voice' : state.draft ? 'Add a correction' : 'Start talking';
    $('voiceBuild').textContent = state.draft?.questions?.length ? 'Reply' : state.draft ? 'Apply changes' : 'Organise my day';
    $('voiceTranscriptLabel').textContent = $('voiceTranscript').value.trim() ? 'What I heard · edit text' : 'Prefer to type?';
    $('voiceRetry').hidden = state.busy || state.connected;
    $('voiceSave').textContent = state.draft?.actions?.length ? 'Apply changes' : 'Save to my day';
    $('voiceUndo').hidden = !state.undo || state.undo.owner!==USER_ID; $('voiceUndo').disabled=state.busy || state.saving || state.listening || !!state.stream;
    $('voiceSaveSummary').textContent = state.draft?.actions?.length ? `${state.actionReview?.summaries.length || 0} actions · ${state.actionReview?.patches.length || 0} records changed` : state.draft ? `${plan.slots.length / 2}h · ${state.draft.items.length} ${state.draft.items.length === 1 ? 'activity' : 'activities'}${state.draft.reflections.length ? ' · reflection' : ''}` : '';
    $('voiceSave').disabled = state.busy || state.saving || state.listening || !!state.stream || state.stale || !state.actionReview || !!state.draft?.questions?.length || plan.errors.length > 0;
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
    $('voiceActions').innerHTML = (state.actionReview?.summaries || []).map(t=>`<p>${escape(t)}</p>`).join('') + (state.actionReview?.answers || []).map(t=>`<p>${escape(t)}</p>`).join('');
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
    const version = state.version;++reviewVersion;clearTimeout(entryReviewTimer);
    const transcript = $('voiceTranscript').value.trim();
    if (!transcript) return;
    if(state.owner!==USER_ID){clearAccount();state.owner=USER_ID;}
    try{if(await localCommand(transcript)){buttons();return;}}catch(error){phase('error',error.message);return;}
    state.busy = true; $('voiceDraft').inert = true; phase('thinking', 'Finding the activities, times and thoughts in your words…'); buttons();
    try {
      const now = new Date();
      phase('thinking', 'Finding the relevant parts of your diary…');
      const owner = USER_ID;
      const controller = new AbortController();state.historyController=controller;
      const historyTimer=setTimeout(()=>controller.abort(),30000);
      let history;
      try {
        const query=[...(state.draft?.actions || []).map(a=>`${a.type.replaceAll('_',' ')} ${a.target || ''} ${a.date || ''}`),transcript].join(' ');
        const archive=DayVoiceApp.archiveNeeded(query);
        history=state.history?.complete && state.history?.owner===owner && Date.now()-state.history.loadedAt<30000 && (!archive || state.history.scope==='archive') ? state.history : (!archive && state.prefetch ? await state.prefetch : await DayVoiceApp.history({transcript:query,owner,signal:controller.signal}));
      } catch(error) {
        if(version!==state.version)return;
        state.prefetch=null;history={rows:[],source:sb?'cloud':'local',complete:false};
      } finally {clearTimeout(historyTimer);if(state.historyController===controller)state.historyController=null;}
      if(version!==state.version || USER_ID!==owner)return;
      state.history={...history,owner,loadedAt:Date.now()};state.prefetch=null;
      const snapshot=DayVoiceApp.snapshot(history,transcript+' '+(state.draft?.actions || []).map(a=>a.target || '').join(' '));
      if(history.complete && state.actionReview?.owner===owner && state.actionReview.patches.some(p=>(history.scope==='archive' || history.dates?.includes(p.date) || snapshot.days[p.date]) && !DayVoiceActions.same(snapshot.days[p.date]?.[p.slot],p.before)))throw Error('Records in the previous draft changed. Say “cancel” and describe the change again.');
      state.snapshot=snapshot;
      const outcome=await agent.run({userId:owner,transcript,previous:state.draft,
        context:{today:ymd(now),viewed_date:ymd(current),local_time:`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,app:snapshot.app},
        recall:async({query})=>{
          const diary=DayVoiceContext.select(history,{today:ymd(now),viewedDate:ymd(current),transcript:query});
          $('voiceContextStatus').textContent=diary.status==='ready' ? `Using ${diary.coverage.days_available} saved diary ${diary.coverage.days_available===1?'day':'days'} · ${diary.entries.length} relevant ${diary.entries.length===1?'activity':'activities'}${diary.routines.length?' · routines':''}${diary.day_notes.length+diary.notes.length?' · notes':''}${Object.values(diary.goals).some(Boolean)?' · goals':''}.` : 'Some diary history could not load. Missing details will need clarification.';
          $('voiceContextStatus').hidden=false;
          return diary;
        },
        think:payload=>{phase('thinking','Organising your words with your diary context…');return api('/api/voice/draft',{...payload,model:$('voiceModel').value});}
      });
      if(!outcome)return;
      const result=outcome.draft;
      if (version !== state.version || USER_ID!==owner) {agent.reset();return;}
      if (!Array.isArray(result.items) || !Array.isArray(result.reflections) || !Array.isArray(result.questions)) throw new Error('Invalid draft returned. Nothing was saved.');
      const draft = {reply:result.reply,questions:result.questions,items:result.items,reflections:result.reflections,actions:result.actions || []};
      const review=draft.actions.length ? await DayVoiceApp.review(draft,snapshot,owner) : await DayVoiceApp.reviewEntries(draft,owner);
      if(version!==state.version || USER_ID!==owner)return;
      state.draft=draft;state.actionReview=review;
      if(state.draft.actions.length && !state.draft.questions.length && !state.actionReview.patches.length){state.busy=false;await applyActions();return;}
      state.stale = transcript !== $('voiceTranscript').value.trim(); renderDraft(); $('voiceCompose').open = state.stale || !!outcome.question; phase('review', state.stale ? 'Your words changed while processing. Apply your changes to update the preview.' : outcome.question ? 'One quick question—reply by voice or edit the text below.' : 'Here’s what I heard. Change anything, then save.');
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
      if (version === state.version) $('voiceTranscript').value = DayVoiceActions.localCommand(heard,{today:ymd(new Date()),viewedDate:ymd(current),shift:DayEventRange.shift}) ? heard : [before, heard].filter(Boolean).join('\n');
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
      if(!DayVoiceActions.localCommand(heard,{today:ymd(new Date()),viewedDate:ymd(current),shift:DayEventRange.shift}))state.stale=!!state.draft;
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
          $('voiceTranscript').value = DayVoiceActions.localCommand(result.text,{today:ymd(new Date()),viewedDate:ymd(current),shift:DayEventRange.shift}) ? result.text : [before, result.text].filter(Boolean).join('\n');
          if(!DayVoiceActions.localCommand(result.text,{today:ymd(new Date()),viewedDate:ymd(current),shift:DayEventRange.shift}))state.stale=!!state.draft; state.busy = false; buttons();
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
    if($('voiceSave').disabled || !state.draft || !state.actionReview)return;
    if(state.owner!==USER_ID){clearAccount();return;}
    await applyActions();
  }
  let reviewVersion=0,entryReviewTimer=null;
  function scheduleEntryReview() {
    ++reviewVersion;clearTimeout(entryReviewTimer);state.actionReview=null;buttons();
    entryReviewTimer=setTimeout(refreshEntryReview,250);
  }
  async function refreshEntryReview() {
    const revision=++reviewVersion,version=state.version,owner=USER_ID;
    state.actionReview=null;buttons();
    if(!state.draft || state.draft.actions?.length)return;
    try {
      const review=await DayVoiceApp.reviewEntries(state.draft,owner);
      if(revision!==reviewVersion || version!==state.version || owner!==USER_ID)return;
      state.actionReview=review;$('voiceActions').innerHTML=(review?.summaries || []).map(t=>`<p>${escape(t)}</p>`).join('');buttons();
    } catch(error){if(revision===reviewVersion && version===state.version)phase('error',error.message);}
  }
  function clearAccount() {
    ++reviewVersion;clearTimeout(entryReviewTimer);agent.reset();state.history=null;state.prefetch=null;state.snapshot=null;state.actionReview=null;state.draft=null;state.undo=null;state.stale=false;
    $('voiceTranscript').value='';renderDraft();
  }
  async function localCommand(transcript) {
    const command=DayVoiceActions.localCommand(transcript,{today:ymd(new Date()),viewedDate:ymd(current),shift:DayEventRange.shift});
    if(!command)return false;
    if(command.control==='save'){if($('voiceSave').disabled){phase('review','Resolve the draft details before saving.');return true;}await save();}
    else if(command.control==='cancel'){++reviewVersion;clearTimeout(entryReviewTimer);state.draft=null;state.actionReview=null;state.stale=false;agent.reset();$('voiceTranscript').value='';renderDraft();phase('idle','Draft discarded.');}
    else if(command.control==='undo')await undo();
    else {for(const action of command.actions)await DayVoiceApp.navigate(action);$('voiceTranscript').value='';phase('idle','Opened. You can keep talking.');}
    return true;
  }
  async function applyActions() {
    const review=state.actionReview;if(!review)return;
    state.saving=true;buttons();$('voiceDraft').inert=true;
    try {
      if(review.owner!==USER_ID)throw Error('Your account changed. Reopen voice.');
      const applied=review.patches.length?await DayVoiceApp.apply(review):[];
      if(applied.length)state.undo={patches:applied,owner:review.owner};
      for(const action of review.navigation)await DayVoiceApp.navigate(action);
      const answer=review.answers.join(' ');
      state.draft=null;state.actionReview=null;state.history=null;state.prefetch=null;agent.reset();$('voiceTranscript').value='';renderDraft();
      phase('saved',answer || (applied.length ? 'Applied. Say “undo” to reverse the last change.' : 'Done.'));
    } catch(error) {
      if(error.applied?.length)state.undo={patches:error.applied,owner:review.owner};
      state.stale=true;phase('error',error.message);
    } finally {state.saving=false;$('voiceDraft').inert=false;buttons();}
  }
  async function undo() {
    if(!state.undo || state.undo.owner!==USER_ID){phase('idle','There is no voice change to undo in this session.');return;}
    state.saving=true;buttons();
    try {
      await DayVoiceApp.apply(DayVoiceApp.undoReview(state.undo.patches,state.undo.owner));
      state.undo=null;state.draft=null;state.actionReview=null;state.history=null;state.prefetch=null;agent.reset();$('voiceTranscript').value='';renderDraft();phase('saved','Last voice change undone.');
    } catch(error){
      if(error.applied?.length && state.undo){const completed=new Set(error.applied.map(p=>p.date+'/'+p.slot));state.undo.patches=state.undo.patches.filter(p=>!completed.has(p.date+'/'+p.slot));if(!state.undo.patches.length)state.undo=null;}
      phase('error',error.message);
    }
    finally{state.saving=false;buttons();}
  }
  function close() {
    if (state.saving) return;
    state.version++;++reviewVersion;clearTimeout(entryReviewTimer); state.controller?.abort(); clearTimeout(state.timer);
    state.busy = false; state.connected = false; state.token = '';
    state.recognition?.abort(); state.recognition = null; state.listening = false;
    $('voiceDraft').inert = false;
    if (state.recorder?.state === 'recording') state.recorder.stop();
    state.stream?.getTracks().forEach(track => track.stop()); state.stream = null; state.recorder = null;
    agent.reset();
    state.historyController?.abort(); state.historyController=null; state.history=null;state.prefetch=null;
    window.DaySpeech?.release?.();
    $('voiceRecordLabel').textContent = 'Start talking';
    $('voiceDialog').hidden = true; $('voiceOpen').focus();
  }
  async function open() {
    if(state.owner!==USER_ID){clearAccount();state.owner=USER_ID;}
    $('voiceDialog').hidden = false;
    const owner=USER_ID,version=state.version;
    const controller=new AbortController();state.historyController=controller;
    const timer=setTimeout(()=>controller.abort(),30000);
    state.prefetch=DayVoiceApp.history({owner,signal:controller.signal}).then(history=>{if(version!==state.version || USER_ID!==owner)throw Error('Voice closed.');return history;}).finally(()=>clearTimeout(timer));
    state.prefetch.catch(()=>{});
    buttons(); $('voiceClose').focus();
    await connect();
    if (!$('voiceDialog').hidden && !$('voiceRecord').disabled && document.activeElement === $('voiceClose')) $('voiceRecord').focus();
  }
  sb?.auth?.onAuthStateChange?.((_event,session)=>{if(state.owner!==null && state.owner!==session?.user?.id){close();clearAccount();state.owner=null;}});
  document.addEventListener('keydown',event=>{if((event.metaKey || event.ctrlKey) && event.shiftKey && event.code==='Space'){event.preventDefault();if($('voiceDialog').hidden)open();else if(!$('voiceRecord').disabled)record();}});
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
  $('voiceUndo').addEventListener('click', undo);
  $('voiceHelper').addEventListener('input', () => { state.connected = false; buttons(); status('Reconnect to use the new helper address.'); });
  $('voiceSpeech').addEventListener('change', () => { localStorage.setItem('day_voice_speech', $('voiceSpeech').value); state.speechReady = captureSupported(); privacy(); buttons(); });
  $('voiceModel').addEventListener('change', () => localStorage.setItem('day_voice_model_v2', $('voiceModel').value));
  $('voiceTranscript').addEventListener('input', () => { if(!DayVoiceActions.localCommand($('voiceTranscript').value,{today:ymd(new Date()),viewedDate:ymd(current),shift:DayEventRange.shift}))state.stale=!!state.draft; buttons(); });
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
    if(state.draft.questions?.length && !DayVoiceDraft.plan(state.draft,DayEventRange).errors.length)state.draft.questions=[];
    scheduleEntryReview();
  });
  $('voiceDraft').addEventListener('click', e => {
    const { remove, index } = e.target.dataset;
    if (remove && state.draft?.[remove]) { state.draft[remove].splice(Number(index), 1); renderDraft();scheduleEntryReview(); }
  });
})();
