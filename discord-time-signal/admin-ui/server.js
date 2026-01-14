import express from 'express';
import fs from 'fs';
import path from 'path';
import ini from 'ini';
import url from 'url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIGS_DIR = process.env.ADMIN_CONFIGS_DIR
  ? path.resolve(process.env.ADMIN_CONFIGS_DIR)
  : path.resolve(__dirname, '../configs');
const AUDIO_DIR = process.env.ADMIN_AUDIO_DIR
  ? path.resolve(process.env.ADMIN_AUDIO_DIR)
  : path.resolve(__dirname, '../audio');

const app = express();
const PORT = process.env.PORT || 5173;
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function parseIniSafe(filePath) {
  try { return ini.parse(fs.readFileSync(filePath, 'utf-8')); }
  catch(e){ return { __error: String(e) }; }
}

function coerceBool(v) {
  if (typeof v === 'boolean') return v;
  if (v == null) return false;
  const s = String(v).toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'on';
}


// 未指定は true、false/0/no/off は false とみなす（行の enabled 用）
function truthyEnabled(v) {
  if (v == null || v === '') return true;
  const s = String(v).trim().toLowerCase();
  return !(['false','0','no','off'].includes(s));
}

// [time.N] / [time\.N] / [timeN] すべてに対応（空白や制御文字も除去）
function isTimeSectionName(name) {
  const n = String(name || '').trim();
  return /^time(?:\\\.|\.)?\d+$/i.test(n)   // "time\.1" or "time.1"
      || /^time\d+$/i.test(n);             // "time1"
}
function parseTimeIndex(name) {
  const n = String(name || '').trim();
  // 優先順： time\.N → time.N → timeN
  let m = n.match(/^time\\\.(\d+)$/i);
  if (m) return +m[1];
  m = n.match(/^time\.(\d+)$/i);
  if (m) return +m[1];
  m = n.match(/^time(\d+)$/i);
  if (m) return +m[1];
  // 最後の連続数字を採る保険（将来の揺れ吸収）
  m = n.match(/(\d+)\s*$/);
  return m ? +m[1] : 0;
}

function normalizeGuildConfig(parsed) {
  const general = parsed.general || {};
  const timesSec = parsed.times || {};

  // 1) [times] セクション（"time.1" / "time1" / "time\.1" を許容）
  const fromTimesSection = Object.entries(timesSec)
    .filter(([k]) => isTimeSectionName(k))
    .map(([k, v]) => ({
      index: parseTimeIndex(k),
      value: String(v ?? '').trim(),
      enabled: true,
      source: 'times_section'
    }));

  // 2) [general].times （CSV）
  const fromGeneralCsv = String(general.times ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map((v, i) => ({ index: i + 1, value: v, enabled: true, source: 'general_csv' }));

  // 2b) [general] 直下に "time.1"/"time1"/"time\.1" が並ぶ形も許容（運用差異吸収）
  const fromGeneralTimeKeys = Object.entries(general)
    .filter(([k]) => isTimeSectionName(k))
    .map(([k, v]) => ({
      index: parseTimeIndex(k),
      value: String(v ?? '').trim(),
      enabled: true,
      source: 'general_time_key'
    }));

  // 3) [time.N] / [time\.N] セクション（行ごとの上書き）
  const entries = Object.entries(parsed);
  // DEBUG: セクション名を出力（環境変数でON）
  if (process.env.DEBUG_INI === '1') {
    console.log('[DEBUG] INI sections =', entries.map(([k]) => k));
  }
  const fromTimeSections = entries
    .filter(([name]) => name !== 'general' && name !== 'audio' && name !== 'times')
    .filter(([name]) => isTimeSectionName(name))
    .map(([name, obj]) => {
      const idx = parseTimeIndex(String(name)) || 0;
      const t   = String(obj.time ?? '').trim();
      const cron= String(obj.cron ?? '').trim();
      return {
        index: idx,
        value: t,                 // 画面の <input type="time"> で扱う
        cron,                     // 将来のcron編集UI用
        enabled: truthyEnabled(obj.enabled),
        tz: obj.tz || '',
        audio: obj.audio || '',
        message: obj.message || '',
        source: 'time_section'
      };
    });

  // 合算（単純昇順ソート）
  let timeEntries = [
    ...fromGeneralCsv,
    ...fromGeneralTimeKeys,
    ...fromTimesSection,
    ...fromTimeSections
  ].sort((a, b) => (a.index || 0) - (b.index || 0));

  // DEBUG: 何件拾えているか確認
  if (process.env.DEBUG_INI === '1') {
    console.log('[DEBUG] normalized.times =', timeEntries);
  }

  // チャンネルID：互換（channel_id）を維持しつつ、text/voice を分離
  const legacyChannel = general.channel_id || '';
  const textChannelId  = general.text_channel_id  || legacyChannel || '';
  const voiceChannelId = general.voice_channel_id || legacyChannel || '';

  // 既定の audio_file は [audio] 優先、なければ [general]
  const audioFile =
    (parsed.audio?.audio_file ? String(parsed.audio.audio_file) : '') ||
    (general.audio_file ? String(general.audio_file) : '');

  return {
    general: {
      text_enabled: coerceBool(general.text_enabled),
      voice_enabled: coerceBool(general.voice_enabled),
      message_template: general.message_template ?? "",
      timezone: general.timezone ?? "Asia/Tokyo",
      // 互換: 旧単一 channel_id を残しつつ…
      channel_id: legacyChannel,
      // 新規: テキスト/ボイスを個別に保持
      text_channel_id: textChannelId,
      voice_channel_id: voiceChannelId,
      // 表示名（未指定/数値っぽい場合は空にしておく）
      server_name: (typeof general.server_name === 'string' && general.server_name.trim()) ? general.server_name.trim() : "",
      // ▼ UI向けに CSV のまま返す（デフォルト時報の表示用）
      times: String(general.times ?? ''),
      // ▼ general 側に audio_file があれば明示的に返す（なければ空）
      audio_file: String(general.audio_file ?? ''),
      // advanced_cron（文字列で保持。CSV可）
      advanced_cron: String(general.advanced_cron ?? '')
    },
    audio: { audio_file: audioFile },
    times: timeEntries
  };
}

function detectServerName(general) {
  const candidates = [general?.server_name, general?.guild_name, general?.name, general?.guild];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() && !/^\d{16,20}$/.test(c.trim())) return c.trim();
  }
  return null;
}

app.get('/api/guilds', (req, res) => {
  let result = [];
  try {
    const files = fs.readdirSync(CONFIGS_DIR, { withFileTypes: true })
      .filter(d => d.isFile() && d.name.endsWith('.ini'));

    result = files.map(d => {
      const id = d.name.replace(/\.ini$/i, '');
      const file = path.join(CONFIGS_DIR, d.name);
      const parsed = parseIniSafe(file);
      const name = detectServerName(parsed?.general) || id;
      return { id, name };
    });
  } catch {}
  res.json({ guilds: result });
});

app.get('/api/guilds/:id', (req, res) => {
  const id = req.params.id;
  const file = path.join(CONFIGS_DIR, `${id}.ini`);
  if (!fs.existsSync(file)) return res.status(404).json({ error:'Not found' });
  const parsed = parseIniSafe(file);
  const normalized = normalizeGuildConfig(parsed);
  // general.server_name が空なら detectServerName() を使って推測
  const fallback = detectServerName(parsed?.general);
  const displayName = (normalized.general.server_name || fallback || id);
  res.json({ id, name: displayName, file, raw: parsed, normalized });
});

app.get('/api/audio', (req, res) => {
  try {
    const files = fs.readdirSync(AUDIO_DIR, { withFileTypes: true })
      .filter(d => d.isFile()).map(d => d.name);
    res.json({ files });
  } catch { res.json({ files: [] }); }
});

// ▼ 追加：音声プレビュー配信 (/media/audio/:name)
app.get('/media/audio/:name', (req, res) => {
  const name = (req.params.name || '').trim();
  if (!/^[\w.\-]+$/i.test(name)) return res.status(400).end();
  const abs = path.join(AUDIO_DIR, name);
  if (!fs.existsSync(abs)) return res.status(404).end();
  res.sendFile(abs);
});

app.get('/api/health', (req, res) => res.json({ ok:true, configsDir: CONFIGS_DIR, audioDir: AUDIO_DIR }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => {
  console.log(`[admin-ui] Listening on http://localhost:${PORT}`);
  console.log(`[admin-ui] CONFIGS_DIR = ${CONFIGS_DIR}`);
  console.log(`[admin-ui] AUDIO_DIR   = ${AUDIO_DIR}`);
});
