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
  const m={ id:data.id, name:data.name || data.id,
    general:{...data.normalized.general}, audio:{...data.normalized.audio},
    times:data.normalized.times.map(t=>({ index:t.index, enabled:true, time:t.value,
      audio_file:data.normalized.audio.audio_file||'', message:data.normalized.general.message_template||'' }))};
  return m;
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
  syncSwitch(textBtn,  !!state.model.general.text_enabled,  (v)=>{ state.model.general.text_enabled  = v; markDirty(); });
  syncSwitch(voiceBtn, !!state.model.general.voice_enabled, (v)=>{ state.model.general.voice_enabled = v; markDirty(); });

  updateSaveButtonState();
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
  state.model.times.forEach((row,i)=>{
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
    message: state.model.general.message_template || ''
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