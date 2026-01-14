const $ = (s)=>document.querySelector(s);
const $$ = (s)=>Array.from(document.querySelectorAll(s));

const api = {
  async guilds(){ return jget('/api/guilds'); },
  async guild(id){ return jget(`/api/guilds/${id}`); },
  async audio(){ return jget('/api/audio'); },
};
async function jget(u){ const r=await fetch(u); if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }

// ▼ 未保存フラグを追加
const state = { audioFiles:[], guilds:[], current:null, model:null, dirty:false };
const statusEl = $('#status'), guildListEl = $('#guild-list'), audioListEl = $('#audio-list');
const editorEl = $('#editor'), emptyEl = $('#empty'), currentGuildEl = $('#current-guild');
const tzEl = $('#timezone');
const timesTbody = $('#times-body');
// デフォルト時報ブロック要素
const defaultAudioEl = $('#default-audio');
const defaultAudioFileEl = $('#default-audio-file');
const defaultAudioToggleBtn = $('#default-audio-toggle');
const defaultTimesEl = $('#default-times');
const defaultEnableBtn = $('#default-enable');
// ▼ 変更3で使う要素
const unsavedEl = $('#unsaved-indicator');
const btnSave = $('#btn-save');
const btnReload = $('#btn-reload');

const tzOptions = ['Asia/Tokyo','UTC','Asia/Seoul','Asia/Shanghai','Asia/Taipei','America/Los_Angeles','America/New_York','Europe/London','Europe/Paris'];
function setStatus(s){ statusEl.textContent=s; }

// ▼ 未保存管理と離脱ガード
function markDirty(v=true){
  state.dirty = !!v;
  if (unsavedEl) unsavedEl.style.display = state.dirty ? 'block' : 'none';
  updateSaveButtonState();
}
window.addEventListener('beforeunload', (e)=>{
  if(state.dirty){ e.preventDefault(); e.returnValue=''; }
});

function renderGuildList(){
  guildListEl.innerHTML='';
  state.guilds.forEach(g=>{
    const li=document.createElement('li');
    li.textContent=g.name || g.id;   // サーバー名表示（なければID）
    li.dataset.id=g.id;
    if(state.current && state.current.id===g.id) li.classList.add('active');
    li.onclick=()=>loadGuild(g.id);
    guildListEl.appendChild(li);
  });
}
function renderAudioList(){
  audioListEl.innerHTML='';
  state.audioFiles.forEach(name=>{
    const li=document.createElement('li'); li.textContent=name; audioListEl.appendChild(li);
  });
}

function toModel(data){
  const baseMsg   = data.normalized.general.message_template || '';
  const baseAudio = data.normalized.audio.audio_file || '';
  return {
    id: data.id,
    name: data.name || data.id,
    general: { ...data.normalized.general },
    audio:   { ...data.normalized.audio },
    times: (data.normalized.times || []).map(t => ({
      index: t.index,
      enabled: (t.enabled !== false),           // ← APIのenabledを尊重
      time: (t.value || ''),                    // ← APIのtimeをそのまま
      audio_file: (t.audio || baseAudio),       // ← 行オーバーライド or 既定
      message: (t.message || baseMsg),          // ← 行オーバーライド or 既定
      tz: t.tz || data.normalized.general.timezone || 'Asia/Tokyo',
      source: t.source || ''
    })),
    // デフォルト時報の独立ON/OFF（未保存のローカル状態）。未指定は true。
    default_enabled: (data.normalized.general?.default_enabled !== false)
  };
}

// HTML（重複時刻は <span class="masked">、改行は「カンマ直後」で自然折返し）
function formatTimesFlowMasked(csv, maskedSet){
  if(!csv) return '';
  const parts = csv.split(',').map(s=>s.trim()).filter(Boolean);
  // ",<ZWSP> " を挿入してカンマ位置で改行可能にする
  return parts.map(t => maskedSet.has(t) ? `<span class="masked">${t}</span>` : t)
              .join(',&#8203; ');
}


// 音声プレビュー制御
function bindDefaultPreview(audioFile){
  defaultAudioFileEl.textContent = audioFile || '(未設定)';
  if(audioFile){
    defaultAudioEl.src = `/media/audio/${encodeURIComponent(audioFile)}`;
    defaultAudioToggleBtn.disabled = false;
  }else{
    defaultAudioEl.removeAttribute('src');
    defaultAudioToggleBtn.disabled = true;
  }
  defaultAudioToggleBtn.textContent = '▶ 再生';
  defaultAudioToggleBtn.onclick = ()=>{
    if(!defaultAudioEl.src) return;
    if(defaultAudioEl.paused){
      defaultAudioEl.play().then(()=> defaultAudioToggleBtn.textContent='■ 停止').catch(()=>{});
    }else{
      defaultAudioEl.pause(); defaultAudioEl.currentTime=0; defaultAudioToggleBtn.textContent='▶ 再生';
    }
  };
  defaultAudioEl.onended = ()=>{ defaultAudioToggleBtn.textContent='▶ 再生'; };
}

// 現在の timeN（表示対象のみ）の時刻集合
function getTimeSlotSet(){
  const all = (state.model?.times || []);
  // general_csv は表示対象外のため source フィルタは不要だが念のため
  return new Set(all.filter(r => r.source !== 'general_csv').map(r => r.time).filter(Boolean));
}


// 2つのスイッチを同期（上部カードとデフォルトブロック）
function syncSwitchPair(btnA, btnB, initVal, onChange){
  const setBoth=(v)=>{ setSwitch(btnA,v); setSwitch(btnB,v); };
  setBoth(!!initVal);
  btnA.onclick=btnB.onclick=()=>{ const next = !(btnA.classList.contains('on')); setBoth(next); onChange(next); };
}

// 表示対象（[general].times 由来は除外）
function getVisibleTimes(){
  const all = (state.model?.times || []);
  // source が 'general_csv' の行は表示しない
  return all.filter(r => r.source !== 'general_csv');
  // ※ [general] 直下の timeN/time.N も非表示にしたい場合は:
  // return all.filter(r => !['general_csv','general_time_key'].includes(r.source));
}

function renderEditor(){
  if(!state.model){ editorEl.classList.add('hidden'); emptyEl.classList.remove('hidden'); return; }
  emptyEl.classList.add('hidden'); editorEl.classList.remove('hidden');
  currentGuildEl.textContent = state.model.name;

  // タイムゾーン
  tzEl.innerHTML='';
  tzOptions.forEach(tz=>{
    const opt=document.createElement('option'); opt.value=tz; opt.textContent=tz;
    if((state.model.general.timezone||'')===tz) opt.selected=true;
    tzEl.appendChild(opt);
  });
  tzEl.onchange = (e)=>{ state.model.general.timezone = e.target.value; markDirty(); };
  // ▼ 上部トグルの初期化＆イベント
  const textBtn  = document.getElementById('toggle-text-enabled');
  const voiceBtn = document.getElementById('toggle-voice-enabled');
  // 全体ON/OFF（既存）
  syncSwitch(textBtn,  !!state.model.general.text_enabled,  (v)=>{ state.model.general.text_enabled  = v; markDirty(); redrawDefaultBlock(); });
  syncSwitch(voiceBtn, !!state.model.general.voice_enabled, (v)=>{ state.model.general.voice_enabled = v; markDirty(); redrawDefaultBlock(); });


  // ▼ デフォルト時報の表記
  redrawDefaultBlock();
  // general.audio_file（なければ normalized.audio.audio_file）
  // → redrawDefaultBlock 内で実施

  updateSaveButtonState();

  // ← ここで時報テーブルを描画（ロード直後に反映されるように）
  drawTimes();
  // ロード直後は未保存扱いをクリア
  markDirty(false);
}

function redrawDefaultBlock(){
  // デフォルト時報の独立ON/OFF
  setSwitch(defaultEnableBtn, !!state.model.default_enabled);
  defaultEnableBtn.onclick = ()=>{
    const next = !defaultEnableBtn.classList.contains('on');
    setSwitch(defaultEnableBtn, next);
    state.model.default_enabled = next;
    markDirty();
    // 有効表示の再計算（淡色マスクには影響しないが将来の保存/API想定で呼ぶ）
    renderDefaultTimes();
  };
  renderDefaultTimes();
  // 音声プレビューは常に動く（プレビュー自体はスケジュール可否に影響しない）
  const generalAudio = state.model.general.audio_file || state.model.audio.audio_file || '';
  bindDefaultPreview(generalAudio);
}

function renderDefaultTimes(){
  const csv = state.model.general.times || '';
  const masked = getTimeSlotSet();   // timeN と重複する時刻をマスク
  // 内部の有効判定（参考：default_enabled と全体スイッチ）
  const effText  = !!state.model.default_enabled && !!state.model.general.text_enabled;
  const effVoice = !!state.model.default_enabled && !!state.model.general.voice_enabled;
  // 将来API保存時にこの値を渡して実行可否に反映予定。表示は淡色マスクのみ。
  defaultTimesEl.innerHTML = csv ? formatTimesFlowMasked(csv, masked) : '(未設定)';
  // 参考：効果的に完全OFFならヒントを追加で出すことも可能（UI要件次第）
}

// スイッチUI共通
function syncSwitch(btn, val, onChange){ setSwitch(btn, val); btn.onclick=()=>{ const next=!btn.classList.contains('on'); setSwitch(btn,next); onChange(next); }; }
function setSwitch(btn, on){ btn.className = 'switch ' + (on?'on':'off'); btn.textContent = on?'ON':'OFF'; }

// ▼ 入力バリデーション（HH:mm）
function isValidHHmm(s){
  if(typeof s!=='string') return false;
  const m = s.match(/^(\d{2}):(\d{2})$/);
  if(!m) return false;
  const hh = +m[1], mm = +m[2];
  return hh>=0 && hh<=23 && mm>=0 && mm<=59;
}
function validateAll(){
  if(!state.model) return false;
  for(const row of state.model.times){
    if(row.enabled && !isValidHHmm(row.time)) return false;
  }
  return true;
}
function updateSaveButtonState(){
  if(btnSave){
    const ok = validateAll();
    btnSave.disabled = !ok || !state.dirty || !state.model;
  }
}


// 時報テーブル描画（↑↓－ 動作あり）
function drawTimes(){
  timesTbody.innerHTML='';
  const rows = getVisibleTimes();
  rows.forEach((row,i)=>{
    const tr=document.createElement('tr');

    // timeN 表示
    const tdIdx=document.createElement('td'); tdIdx.textContent=`time${i+1}`; tr.appendChild(tdIdx);

    // ON/OFF
    const tdEn=document.createElement('td'); const sw=document.createElement('button');
    sw.className='switch '+(row.enabled?'on':'off'); sw.textContent=row.enabled?'ON':'OFF';
    sw.onclick=()=>{ row.enabled=!row.enabled; setSwitch(sw, row.enabled); markDirty(); updateSaveButtonState(); };

    tdEn.appendChild(sw); tr.appendChild(tdEn);

    // 時刻
    const tdTime=document.createElement('td'); const time=document.createElement('input');
    time.type='time'; time.value=row.time||'07:00'; time.onchange=(e)=>row.time=e.target.value;
    // ▼ 入力時にバリデーション＆未保存マーク
    time.addEventListener('input', (e)=>{
      row.time = e.target.value;
      if (row.enabled){
        if (isValidHHmm(row.time)) time.classList.remove('invalid');
        else time.classList.add('invalid');
      } else {
        // 無効行は赤くしない
        time.classList.remove('invalid');
      }
      markDirty(); updateSaveButtonState();
    });
    tdTime.appendChild(time); tr.appendChild(tdTime);

    // 音声
    const tdAudio=document.createElement('td'); const sel=document.createElement('select');
    state.audioFiles.forEach(name=>{ const opt=document.createElement('option'); opt.value=name; opt.textContent=name; if(row.audio_file===name) opt.selected=true; sel.appendChild(opt); });
    sel.onchange=(e)=>{ row.audio_file=e.target.value; markDirty(); }; tdAudio.appendChild(sel); tr.appendChild(tdAudio);

    // テキストメッセージ
    const tdMsg=document.createElement('td'); const msg=document.createElement('input');
    msg.type='text'; msg.value=row.message||''; msg.placeholder='設定テキストメッセージ'; msg.oninput=(e)=>{ row.message=e.target.value; markDirty(); };
    tdMsg.appendChild(msg); tr.appendChild(tdMsg);

    // 操作（↑ ↓ −）
    const tdOps=document.createElement('td'); const ops=document.createElement('div'); ops.className='op-row';
    const up=btnSmall('↑',()=>{ if(i===0) return; const [r]=state.model.times.splice(i,1); state.model.times.splice(i-1,0,r); drawTimes(); markDirty(); updateSaveButtonState(); });
    const down=btnSmall('↓',()=>{ if(i===state.model.times.length-1) return; const [r]=state.model.times.splice(i,1); state.model.times.splice(i+1,0,r); drawTimes(); markDirty(); updateSaveButtonState(); });
    const del=btnSmall('－',()=>{ state.model.times.splice(i,1); drawTimes(); markDirty(); updateSaveButtonState(); });
    ops.append(up,down,del); tdOps.appendChild(ops); tr.appendChild(tdOps);

    timesTbody.appendChild(tr);
  });
}
function btnSmall(label, onClick){ const b=document.createElement('button'); b.className='btn small'; b.textContent=label; b.onclick=onClick; return b; }

// ＋追加
function addEmptyRow() {
  state.model.times.push({
    index: state.model.times.length + 1,
    enabled: true,
    time: '12:00',
    audio_file: state.audioFiles[0] || '',
    message: state.model.general.message_template || '',
    source: 'time_section' // 追加行の出所を明示化
  });
  drawTimes(); markDirty(); updateSaveButtonState();
}
document.getElementById('btn-add-time').onclick = addEmptyRow;

async function loadGuild(id){
  setStatus(`Loading ${id} ...`);
  try{
    const data=await api.guild(id);
    state.current=data;
    state.model=toModel(data);
    renderGuildList();
    renderEditor();
    setStatus(`Loaded ${state.model.name}`);
  }catch(e){
    console.error(e);
    setStatus(`Failed to load ${id}`);
  }
}

async function bootstrap(){
  try{
    const [g,a]=await Promise.all([api.guilds(), api.audio()]);
    state.guilds=g.guilds||[];
    state.audioFiles=a.files||[];
    renderGuildList();
    renderAudioList();
    setStatus('Ready');
  }catch(e){
    console.error(e);
    setStatus('APIに接続できません');
  }
}
bootstrap();

// ▼ 保存/再読込ボタンの暫定挙動（バックエンド未配線のため見た目だけ）
if (btnSave){
  btnSave.addEventListener('click', ()=>{
    // ここで将来 PUT を投げる予定。今はUI完結：バリデ通過で未保存クリア。
    if(!validateAll()){
      alert('入力に不備があります（時刻は HH:mm）');
      return;
    }
    setStatus('Saved (UI)'); 
    markDirty(false);
  });
}
if (btnReload){
  btnReload.addEventListener('click', async ()=>{
    if(state.dirty && !confirm('未保存の変更があります。破棄して再読込しますか？')) return;
    if(state.model){ await loadGuild(state.model.id); }
    markDirty(false);
  });
}