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

function normalizeGuildConfig(parsed) {
  const general = parsed.general || {};
  const timesSec = parsed.times || {};
  const timeEntries = Object.entries(timesSec)
    .filter(([k]) => /^time\.\d+$/i.test(k))
    .map(([k, v]) => ({ index: Number(k.split('.')[1]), value: String(v).trim() }))
    .sort((a, b) => a.index - b.index);

  return {
    general: {
      text_enabled: coerceBool(general.text_enabled),
      voice_enabled: coerceBool(general.voice_enabled),
      message_template: general.message_template ?? "",
      timezone: general.timezone ?? "Asia/Tokyo",
      channel_id: general.channel_id ?? "",
      server_name: general.server_name ?? general.guild_name ?? general.name ?? ""
    },
    audio: { audio_file: parsed.audio?.audio_file ?? "" },
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
  const displayName = normalized.general.server_name || id;
  res.json({ id, name: displayName, file, raw: parsed, normalized });
});

app.get('/api/audio', (req, res) => {
  try {
    const files = fs.readdirSync(AUDIO_DIR, { withFileTypes: true })
      .filter(d => d.isFile()).map(d => d.name);
    res.json({ files });
  } catch { res.json({ files: [] }); }
});

app.get('/api/health', (req, res) => res.json({ ok:true, configsDir: CONFIGS_DIR, audioDir: AUDIO_DIR }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => {
  console.log(`[admin-ui] Listening on http://localhost:${PORT}`);
  console.log(`[admin-ui] CONFIGS_DIR = ${CONFIGS_DIR}`);
  console.log(`[admin-ui] AUDIO_DIR   = ${AUDIO_DIR}`);
});
