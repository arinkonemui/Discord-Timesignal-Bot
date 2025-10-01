// index.js
require('dotenv').config();

const { Client, GatewayIntentBits, REST, Routes, EmbedBuilder,MessageFlags,PermissionsBitField,ChannelType, } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  NoSubscriberBehavior,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  generateDependencyReport
} = require('@discordjs/voice');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const ini = require('ini');
const ffmpeg = require('ffmpeg-static');
if (ffmpeg) process.env.FFMPEG_PATH = ffmpeg;

// ---- 基本設定 ----
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const DEFAULT_TZ = process.env.TZ || 'Asia/Tokyo';
if (!TOKEN || !CLIENT_ID) {
  console.error('❌ .env の DISCORD_TOKEN / CLIENT_ID を設定してください。');
  process.exit(1);
}

// ディレクトリ & パス
const ROOT_CATALOG_PATH = path.join(__dirname, 'settings.ini');         // ルートは「カタログ」
const CONFIGS_DIR = path.join(__dirname, 'configs');                     // 人が触る、ギルド専用 ini を置く
const STORE_PATH = path.join(__dirname, 'storage.json');                 // 内部状態（人は触らない）
const AUDIO_DIR = path.join(__dirname, 'audio');
if (!fs.existsSync(CONFIGS_DIR)) fs.mkdirSync(CONFIGS_DIR, { recursive: true });
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

// パス関数
const guildIniPath = (gid) => path.join(CONFIGS_DIR, `${gid}.ini`);

// 内部ストア
function loadStore() {
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify({ guilds: {} }, null, 2));
  }
  return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
}
function saveStore(data) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
  try {
    const st = fs.statSync(STORE_PATH);
    console.log(`[store] wrote ${STORE_PATH} @ ${st.mtime.toISOString()}`);
  } catch {}
}
let store = loadStore();

// ジョブ管理
const jobsByGuild = new Map();

// 小道具
function hhmmToCron(hhmm) {
  const m = hhmm.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  const H = parseInt(m[1], 10);
  const M = parseInt(m[2], 10);
  return `0 ${M} ${H} * * *`;
}
function cronToHHmm(cronExp) {
  const m = cronExp.match(/^0\s+(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
  if (!m) return null;
  const M = m[1].padStart(2, '0');
  const H = m[2].padStart(2, '0');
  return `${H}:${M}`;
}

function ensureGuildConfig(guildId) {
  if (!store.guilds[guildId]) {
    store.guilds[guildId] = {
      textChannelId: null,
      voiceChannelId: null,
      audioFile: 'chime.wav',
      textEnabled: true,
      messageTemplate: '⏰ {time} の時報です',
      times: [], // [{ cron, tz, audioFile?, messageTemplate? }]
    };
    saveStore(store);
  }
  return store.guilds[guildId];
}

// ルート settings.ini を「カタログ」用途で出力（ギルド名 ↔ ini パス）
function writeGuildCatalog(client, activeGuildId = null) {
  const obj = { catalog: {} };
  for (const g of client.guilds.cache.values()) {
    const safeName = String(g.name).replace(/[\r\n]/g, ' ').replace(/=/g, '＝');
    obj.catalog[safeName] = `configs/${g.id}.ini`;
  }
  obj.catalog['_active_guild_id'] = activeGuildId || '(none)';
  fs.writeFileSync(ROOT_CATALOG_PATH, ini.stringify(obj), 'utf-8');
  console.log(`[ini] wrote catalog to ${ROOT_CATALOG_PATH}`);
}

// ギルド専用 ini の入出力
function exportGuildIni(guildId) {
  const cfg = ensureGuildConfig(guildId);
  const gobj = client.guilds.cache.get(guildId);
  const serverName = gobj?.name || '';
  const tz = cfg.times[0]?.tz || DEFAULT_TZ;
  const hhmmList = cfg.times.map(t => cronToHHmm(t.cron)).filter(Boolean);
  const advList  = cfg.times.map(t => (cronToHHmm(t.cron) ? null : t.cron)).filter(Boolean);

  const data = {
    general: {
      server_name: serverName,
      timezone: tz,
      text_enabled: !!cfg.textEnabled,
      audio_file: cfg.audioFile || 'chime.wav',
      message_template: cfg.messageTemplate || '⏰ {time} の時報です',
      text_channel_id: cfg.textChannelId || '',
      voice_channel_id: cfg.voiceChannelId || '',
      times: hhmmList.join(','),
      advanced_cron: advList.join(','),
    }
  };
  cfg.times.forEach((t, idx) => {
    const sec = {};
    const hh = cronToHHmm(t.cron);
    if (hh) sec.time = hh; else sec.cron = t.cron;
    if (t.tz) sec.tz = t.tz;
    if (t.audioFile) sec.audio = t.audioFile;
    if (t.messageTemplate) sec.message = t.messageTemplate;
    data[`time.${idx + 1}`] = sec;
  });

  const p = guildIniPath(guildId);
  fs.writeFileSync(p, ini.stringify(data), 'utf-8');
  console.log(`[ini] wrote ${p}`);
  return p;
}

function applyGuildIni(guildId) {
  const p = guildIniPath(guildId);
  if (!fs.existsSync(p)) return false;

  const parsed = ini.parse(fs.readFileSync(p, 'utf-8'));
  const g = parsed.general || parsed;
  const tzDefault = g.timezone || DEFAULT_TZ;

  const cfg = ensureGuildConfig(guildId);
  if (typeof g.text_enabled !== 'undefined') cfg.textEnabled = String(g.text_enabled).toLowerCase() === 'true';
  if (g.audio_file)       cfg.audioFile = g.audio_file;
  if (g.message_template) cfg.messageTemplate = g.message_template;
  if (g.text_channel_id)  cfg.textChannelId = g.text_channel_id;
  if (g.voice_channel_id) cfg.voiceChannelId = g.voice_channel_id;

  const times = [];
  const timeSections = Object.keys(parsed).filter(k => /^time\.\d+$/.test(k))
    .sort((a,b)=>parseInt(a.split('.')[1])-parseInt(b.split('.')[1]));
  if (timeSections.length > 0) {
    for (const key of timeSections) {
      const sec = parsed[key] || {};
      let cronExp = null;
      if (sec.time) cronExp = hhmmToCron(String(sec.time));
      if (!cronExp && sec.cron && cron.validate(String(sec.cron))) cronExp = String(sec.cron);
      if (!cronExp) continue;
      const t = { cron: cronExp, tz: sec.tz || tzDefault };
      if (sec.audio)   t.audioFile = String(sec.audio);
      if (sec.message) t.messageTemplate = String(sec.message);
      times.push(t);
    }
  } else {
    const timesStr = String(g.times || '').trim();
    if (timesStr) {
      for (const t of timesStr.split(',').map(s => s.trim()).filter(Boolean)) {
        const c = hhmmToCron(t);
        if (c) times.push({ cron: c, tz: tzDefault });
      }
    }
    const advStr = String(g.advanced_cron || '').trim();
    if (advStr) {
      for (const c of advStr.split(',').map(s => s.trim()).filter(Boolean)) {
        if (cron.validate(c)) times.push({ cron: c, tz: tzDefault });
      }
    }
  }
  if (times.length) cfg.times = times;

  saveStore(store);
  rebuildJobsForGuild(guildId);
  console.log(`[ini] applied ${p}`);
  return true;
}

// 表示
function replySettingsEmbed(cfg, guildName = '') {
  const lines = cfg.times.length
    ? cfg.times.map((t, i) => {
        const hhmm = cronToHHmm(t.cron);
        const base = hhmm ? hhmm : `\`${t.cron}\``;
        const parts = [];
        if (t.audioFile) parts.push(`audio: \`${t.audioFile}\``);
        if (t.messageTemplate) {
          const s = String(t.messageTemplate);
          parts.push(`msg: "${s.slice(0,30)}${s.length>30?'…':''}"`);
        }
        const opt = parts.length ? ' | ' + parts.join(' / ') : '';
        return `${i + 1}. ${base} (${t.tz || DEFAULT_TZ})${opt}`;
      })
    : ['なし'];

  const MAX = 1024;
  const overflowNote = '（多すぎるため以下省略。configs/<GuildID>.ini をご確認ください）';
  const suffix = `\n…\n${overflowNote}`;
  const reserve = cfg.times.length > 0 ? suffix.length : 0;

  let value = '';
  for (const line of lines) {
    const add = (value ? '\n' : '') + line;
    if (value.length + add.length + (lines.length > 0 ? reserve : 0) > MAX) {
      value += suffix;
      break;
    }
    value += add;
  }

  const embed = new EmbedBuilder()
    .setTitle(`⏰ 時報ボット設定${guildName ? ` — ${guildName}` : ''}`)
    .addFields(
      { name: 'メッセージ（既定）', value: (cfg.messageTemplate || '（未設定）').slice(0, 200), inline: false },
      { name: 'テキスト通知', value: cfg.textEnabled ? 'ON' : 'OFF', inline: true },
      { name: '通知チャンネル', value: cfg.textChannelId ? `<#${cfg.textChannelId}>` : '未設定', inline: true },
      { name: '音声ファイル（既定）', value: cfg.audioFile || '未設定', inline: true },
      { name: 'ボイスチャンネル', value: cfg.voiceChannelId ? `<#${cfg.voiceChannelId}>` : '未設定', inline: true },
      { name: '登録時刻', value }
    )
    .setTimestamp(new Date());
  return embed;
}

// 文面
function renderMessageWith(template, tz, now = new Date()) {
  const timeStr = now.toLocaleTimeString('ja-JP', { timeZone: tz || DEFAULT_TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  const [HH, mm] = timeStr.split(':');
  const tpl = template || '⏰ {time} の時報です';
  return tpl.replace(/\{time\}/g, `${HH}:${mm}`).replace(/\{HH\}/g, HH).replace(/\{mm\}/g, mm);
}
function renderMessage(cfg, now = new Date()) {
  const tz = (cfg.times[0]?.tz) || DEFAULT_TZ;
  const timeStr = now.toLocaleTimeString('ja-JP', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
  const [HH, mm] = timeStr.split(':');
  const tpl = cfg.messageTemplate || '⏰ {time} の時報です';
  return tpl.replace(/\{time\}/g, `${HH}:${mm}`).replace(/\{HH\}/g, HH).replace(/\{mm\}/g, mm);
}

// 再生
async function playOnce(guildId, audioOverride = null) {
  const cfg = ensureGuildConfig(guildId);
  if (!cfg.voiceChannelId) throw new Error('voiceChannelが未設定です。/join で参加してください。');
  console.log(`[voice] target guild=${guildId} voiceChannelId=${cfg.voiceChannelId}`);
  const voiceChannel = await client.channels.fetch(cfg.voiceChannelId).catch((e) => {
    console.error('[voice] fetch channel failed:', e?.message || e);
    return null;
  });
  if (!voiceChannel) throw new Error('voiceChannelが見つかりません。');
  // Stageチャンネルはスピーカー昇格が必要（まずは通常VCでテスト）
  //const { ChannelType } = require('discord.js');
  if (voiceChannel.type === ChannelType.GuildStageVoice) {
    throw new Error('Stageチャンネルでは再生できません（スピーカー昇格が必要）。通常のボイスチャンネルで /join → /test を試してください。');
  }
  const me = await voiceChannel.guild.members.fetch(client.user.id);
  const perms = voiceChannel.permissionsFor(me);
  if (!perms?.has(PermissionsBitField.Flags.Connect)) {
    throw new Error('Bot に「接続」権限がありません（ロール/チャンネル権限を確認）。');
  }
  if (!perms?.has(PermissionsBitField.Flags.Speak)) {
    throw new Error('Bot に「発言」権限がありません（ロール/チャンネル権限を確認）。');
  }
  if (me.voice.serverMute) {
    throw new Error('Bot がサーバーミュートです。ミュート解除してください。');
  }

  // 既存接続のみ使用（自動接続しない）
  const connection = getVoiceConnection(guildId);
  if (!connection) throw new Error('Botがボイスチャンネルに未接続です。/join を実行して接続した状態でお試しください。');

  // ❶ 接続が Ready になるのを待つ（サーバー差で必須）
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 5_000);
    console.log('[voice] connection is Ready');
  } catch (e) {
    console.error('[voice] connection not ready:', e?.message || e);
    throw new Error('ボイス接続が安定しませんでした（5秒以内にReadyになりません）。VCや権限を確認してください。');
  }


  const fileName = audioOverride || cfg.audioFile;
  const filePath = path.join(AUDIO_DIR, fileName);
  console.log('[voice] will play file:', filePath);
  if (!fs.existsSync(filePath)) {
    const files = fs.existsSync(AUDIO_DIR) ? fs.readdirSync(AUDIO_DIR) : [];
    throw new Error(
      `音声ファイルが見つかりません: ${fileName}\n` +
      `探した場所: ${filePath}\n` +
      `audio/にあるファイル: [${files.join(', ')}]`
    );
  }

  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
  const resource = createAudioResource(filePath);
  connection.subscribe(player);
  player.on('error', (e) => console.error('[voice] player error:', e));
  player.on(AudioPlayerStatus.Buffering, () => console.log('[voice] player: Buffering'));
  player.on(AudioPlayerStatus.Playing,   () => console.log('[voice] player: Playing'));
  player.on(AudioPlayerStatus.Idle,      () => console.log('[voice] player: Idle'));
  player.play(resource);
  return new Promise((resolve, reject) => {
    player.on(AudioPlayerStatus.Idle, () => resolve());
    player.on('error', (e) => reject(e));
  });
}

// テキスト
async function postTextIfEnabled(guildId, messageText) {
  const cfg = ensureGuildConfig(guildId);
  if (!cfg.textEnabled || !cfg.textChannelId) return;
  const ch = await client.channels.fetch(cfg.textChannelId).catch(() => null);
  if (!ch) return;
  await ch.send(messageText);
}

// ジョブ
function rebuildJobsForGuild(guildId) {
  const current = jobsByGuild.get(guildId) || [];
  current.forEach(job => job.stop());
  jobsByGuild.set(guildId, []);

  const cfg = ensureGuildConfig(guildId);
  cfg.times.forEach((entry) => {
    const cronExp = entry.cron;
    const tz = entry.tz || DEFAULT_TZ;
    const msgTpl = entry.messageTemplate || cfg.messageTemplate;
    const audio = entry.audioFile || cfg.audioFile;
    const job = cron.schedule(cronExp, async () => {
      try {
        const now = new Date();
        // 参加中か確認（未接続なら完全スキップ）
        const conn = getVoiceConnection(guildId);
        if (!conn) {
          console.log(`[${guildId}] skipped: not joined (no active voice connection)`);
          return;
        }
        // 接続中のみテキスト+音声
        await postTextIfEnabled(guildId, renderMessageWith(msgTpl, tz, now));
        await playOnce(guildId, audio);
      } catch (e) {
        console.error(`[${guildId}] Scheduled run error:`, e);
      }
    }, { timezone: tz });
    job.start();
    jobsByGuild.get(guildId).push(job);
  });
}

// ---- スラッシュコマンド登録（ギルドのみ）----
async function registerGuildCommands(guildId) {
  const commands = require('./commands.js');
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  console.log(`🛠 Registering GUILD ${guildId}:`, commands.map(c => c.name).join(', '));
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, guildId), { body: commands });
  console.log(`⚡ Registered GUILD commands for ${guildId}`);
}

// ---- クライアント ----
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(generateDependencyReport());

  // 既存ギルドぶんコマンド登録
  client.guilds.cache.forEach(g => registerGuildCommands(g.id).catch(console.error));

  // 既存ジョブ復元（スケジュールがあるギルドのみ）
  for (const gid of Object.keys(store.guilds || {})) {
    const c = ensureGuildConfig(gid);
    if ((c.times || []).length > 0) rebuildJobsForGuild(gid);
  }

  // ルートにカタログ（ギルド名 ↔ ini）を書き出し
  writeGuildCatalog(client, null);

  // configs/ の自動反映（任意・軽い監視）
  fs.watch(CONFIGS_DIR, { persistent: false }, (event, filename) => {
    if (!filename || !filename.endsWith('.ini')) return;
    const gid = path.basename(filename, '.ini');
    if (!/^\d+$/.test(gid)) return;
    // 反映
    try {
      if (applyGuildIni(gid)) {
        console.log(`🔄 reloaded by file change: ${filename}`);
      }
    } catch (e) {
      console.error(`reload failed for ${filename}:`, e.message);
    }
  });
});

client.on('guildCreate', (guild) => {
  registerGuildCommands(guild.id).catch(console.error);
  writeGuildCatalog(client, null);
});

// ---- コマンド処理 ----
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const guildId = interaction.guildId;
  const guildName = interaction.guild?.name || '';
  const member = interaction.member;
  const cfg = ensureGuildConfig(guildId);

  // 既定のテキストチャンネル自動セット（未設定時だけ）
  if (!cfg.textChannelId) {
    cfg.textChannelId = interaction.channelId;
    saveStore(store);
  }

  try {
    switch (interaction.commandName) {
      // --- 基本 ---
      case 'join': {
        if (!member?.voice?.channel) {
          return interaction.reply({ content: 'ボイスチャンネルに参加した状態で実行してください。', ephemeral: true });
        }
        const channel = member.voice.channel;
        // 1) ID保存
        cfg.voiceChannelId = channel.id;
        cfg.textChannelId  = interaction.channelId;
        saveStore(store);
        console.log(`[join] saved guild=${guildId} voiceChannelId=${cfg.voiceChannelId} textChannelId=${cfg.textChannelId}`);

        // 2) ini を用意（無ければテンプレ生成）→ 読み込み
        const p = guildIniPath(guildId);
        if (!fs.existsSync(p)) {
          exportGuildIni(guildId); // 初期テンプレ（現状のcfgを書き出し）
        }
        applyGuildIni(guildId);    // ini → json 反映 & ジョブ再構築

        // 3) 参加 & 応答
        const joinOptions = { channelId: channel.id, guildId, adapterCreator: channel.guild.voiceAdapterCreator, selfDeaf: true };
        if (process.env.DAVE_DISABLE === '1') joinOptions.daveEncryption = false;
        joinVoiceChannel(joinOptions);

        // 4) iniへIDを書き戻し（人が見ても分かるように）
        const parsed = ini.parse(fs.readFileSync(p, 'utf-8'));
        const g = parsed.general || (parsed.general = {});
        g.server_name = guildName || g.server_name || '';
        g.text_channel_id = cfg.textChannelId || '';
        g.voice_channel_id = cfg.voiceChannelId || '';
        fs.writeFileSync(p, ini.stringify(parsed), 'utf-8');

        writeGuildCatalog(client, null);
        rebuildJobsForGuild(guildId);

        //await interaction.reply({ content: `参加しました：<#${channel.id}> に接続します。\n設定ファイル: \`configs/${guildId}.ini\`（IDも書き戻しました）` });
        await interaction.reply({ content: `参加しました：<#${channel.id}> に接続します。\n設定ファイル: \`configs/${guildId}.ini\`（IDも書き戻しました）`, ephemeral: true });
        break;
      }

      case 'leave': {
        const conn = getVoiceConnection(guildId);
        if (conn) conn.destroy();
        cfg.voiceChannelId = null;
        saveStore(store);
        rebuildJobsForGuild(guildId);
        await interaction.reply('ボイスチャンネルから退出しました。');
        break;
      }

      case 'set-audio': {
        const file = interaction.options.getString('file', true);
        const full = path.join(AUDIO_DIR, file);
        if (!fs.existsSync(full)) {
          return interaction.reply({ content: `audio/${file} が見つかりません。`, ephemeral: true });
        }
        cfg.audioFile = file;
        saveStore(store);
        exportGuildIni(guildId);
        await interaction.reply({ embeds: [replySettingsEmbed(cfg, guildName)] });
        break;
      }

      case 'set-message': {
        const template = interaction.options.getString('template', true);
        cfg.messageTemplate = template;
        saveStore(store);
        exportGuildIni(guildId);
        const preview = renderMessage(cfg, new Date());
        const embed = new EmbedBuilder()
          .setTitle('📝 メッセージテンプレを更新しました')
          .addFields({ name: 'Template', value: '```\n' + template.slice(0, 500) + '\n```' }, { name: 'Preview', value: preview })
          .setTimestamp(new Date());
        await interaction.reply({ embeds: [embed] });
        break;
      }

      case 'set-text-channel': {
        cfg.textChannelId = interaction.channelId;
        saveStore(store);
        exportGuildIni(guildId);
        await interaction.reply({ embeds: [replySettingsEmbed(cfg, guildName)] });
        break;
      }

      case 'set-voice-channel': {
        const ch = interaction.options.getChannel('channel', true);
        cfg.voiceChannelId = ch.id;
        saveStore(store);
        exportGuildIni(guildId);
        await interaction.reply({ content: `🎙 ボイスチャンネルを <#${ch.id}> に設定しました。` });
        break;
      }

      case 'text-toggle': {
        const mode = interaction.options.getString('mode', true);
        cfg.textEnabled = (mode === 'on');
        saveStore(store);
        exportGuildIni(guildId);
        await interaction.reply({ embeds: [replySettingsEmbed(cfg, guildName)] });
        break;
      }

      // --- スケジュール ---
      case 'add-time': {
        const timeStr = interaction.options.getString('time');
        const cronExpInput = interaction.options.getString('cron');
        const tz = interaction.options.getString('tz') || null;
        const perMsg = interaction.options.getString('message') || null;
        const perFile = interaction.options.getString('file') || null;
        if (!timeStr && !cronExpInput) {
          return interaction.reply({ content: 'HH:mm または cron を1つ指定してください。例: /add-time time:"09:00"', ephemeral: true });
        }
        if (timeStr && cronExpInput) {
          return interaction.reply({ content: 'HH:mm と cron は同時指定できません。', ephemeral: true });
        }
        let cronExp = cronExpInput;
        if (timeStr) {
          const c = hhmmToCron(timeStr);
          if (!c) return interaction.reply({ content: 'HH:mm の形式が不正です（例: 09:00）', ephemeral: true });
          cronExp = c;
        }
        if (!cron.validate(cronExp)) return interaction.reply({ content: 'cron式が不正です。例: 0 0 9 * * *', ephemeral: true });

        if (perFile) {
          const full = path.join(AUDIO_DIR, perFile);
          if (!fs.existsSync(full)) return interaction.reply({ content: `audio/${perFile} が見つかりません。`, ephemeral: true });
        }
        const entry = { cron: cronExp, tz };
        if (perMsg)  entry.messageTemplate = perMsg;
        if (perFile) entry.audioFile = perFile;
        cfg.times.push(entry);
        saveStore(store);
        exportGuildIni(guildId);
        rebuildJobsForGuild(guildId);

        const shown = timeStr ?? (cronToHHmm(cronExp) || cronExp);
        await interaction.reply({
          content: `追加しました：**${shown}**（${tz || DEFAULT_TZ}）` +
            (perFile ? ` | audio: \`${perFile}\`` : '') +
            (perMsg  ? ` | msg: "${perMsg.slice(0,30)}${perMsg.length>30?'…':''}"` : ''),
          embeds: [replySettingsEmbed(cfg, guildName)]
        });
        break;
      }

      case 'set-time-audio': {
        const index = interaction.options.getInteger('index', true);
        const file = interaction.options.getString('file', true);
        if (index < 1 || index > cfg.times.length) {
          return interaction.reply({ content: '番号が不正です。/list で確認してください。', ephemeral: true });
        }
        const full = path.join(AUDIO_DIR, file);
        if (!fs.existsSync(full)) return interaction.reply({ content: `audio/${file} が見つかりません。`, ephemeral: true });
        cfg.times[index - 1].audioFile = file;
        saveStore(store);
        exportGuildIni(guildId);
        rebuildJobsForGuild(guildId);
        await interaction.reply({ content: `#${index} に audio: \`${file}\` を設定しました。`, embeds: [replySettingsEmbed(cfg, guildName)] });
        break;
      }

      case 'set-time-message': {
        const index = interaction.options.getInteger('index', true);
        const tpl = interaction.options.getString('template', true);
        if (index < 1 || index > cfg.times.length) {
          return interaction.reply({ content: '番号が不正です。/list で確認してください。', ephemeral: true });
        }
        cfg.times[index - 1].messageTemplate = tpl;
        saveStore(store);
        exportGuildIni(guildId);
        rebuildJobsForGuild(guildId);
        const tz = cfg.times[index - 1].tz || DEFAULT_TZ;
        const preview = renderMessageWith(tpl, tz, new Date());
        const embed = new EmbedBuilder()
          .setTitle(`📝 #${index} のメッセージを更新しました`)
          .addFields({ name: 'Template', value: '```\n' + tpl.slice(0, 500) + '\n```' }, { name: 'Preview', value: preview })
          .setTimestamp(new Date());
        await interaction.reply({ embeds: [embed] });
        break;
      }

      case 'remove-time': {
        const index = interaction.options.getInteger('index', true);
        if (index < 1 || index > cfg.times.length) {
          return interaction.reply({ content: '番号が不正です。/list で確認してください。', ephemeral: true });
        }
        cfg.times.splice(index - 1, 1);
        saveStore(store);
        exportGuildIni(guildId);
        rebuildJobsForGuild(guildId);
        await interaction.reply({ content: '削除しました。', embeds: [replySettingsEmbed(cfg, guildName)] });
        break;
      }

      case 'list': {
        await interaction.reply({ embeds: [replySettingsEmbed(cfg, guildName)] });
        break;
      }

      // --- テスト ---
      case 'test': {
        await interaction.reply({ content: '🔧 テストを実行します…' });
        try {
          if (!getVoiceConnection(guildId)) {
            throw new Error('Botがボイスチャンネルに未接続です。/join で接続してから実行してください。');
          }
          const preview = renderMessage(cfg, new Date());
          await postTextIfEnabled(guildId, '🔧 テスト: ' + preview);
          await playOnce(guildId, cfg.audioFile);
          await interaction.editReply('✅ テスト再生完了です。');
        } catch (e) {
          console.error('[test] failed:', e);
          await interaction.editReply('❌ テスト再生に失敗しました。\n```\n' + (e?.message || e) + '\n```');
        }
        break;
      }

      case 'test-time': {
        const index = interaction.options.getInteger('index', true);
        if (index < 1 || index > cfg.times.length) {
          return interaction.reply({ content: '番号が不正です。/list で確認してください。', ephemeral: true });
        }
        await interaction.reply({ content: `🧪 #${index} の設定でテスト中…` });
        try{
          if (!getVoiceConnection(guildId)) {
            throw new Error('Botがボイスチャンネルに未接続です。/join で接続してから実行してください。');
          }
          const entry = cfg.times[index - 1];
          const tz = entry.tz || DEFAULT_TZ;
          const tpl = entry.messageTemplate || cfg.messageTemplate;
          const audio = entry.audioFile || cfg.audioFile;
          const preview = renderMessageWith(tpl, tz, new Date());
          await postTextIfEnabled(guildId, '🧪 テスト: ' + preview);
          await playOnce(guildId, audio);
          await interaction.editReply(`✅ #${index} の設定でテスト完了（${cronToHHmm(entry.cron) || entry.cron} / ${tz}）`);
        } catch(e) {
          console.error('[test-time] failed:', e);
          await interaction.editReply('❌ テストに失敗しました。\n```\n' + (e?.message || e) + '\n```');
        }
        break;
      }

      // --- ファイル連携（iniを正とする） ---
      case 'sync-settings': {
        const ok = applyGuildIni(guildId);
        writeGuildCatalog(client, null);
        if (!ok) {
          return interaction.reply({ content: `configs/${guildId}.ini が見つかりませんでした。/join を先に実行してください。`, ephemeral: true });
        }
        await interaction.reply({ content: `🔄 configs/${guildId}.ini を反映しました。`, embeds: [replySettingsEmbed(ensureGuildConfig(guildId), guildName)] });
        break;
      }

      case 'copy-settings': {
        const toArg = interaction.options.getString('to', true).trim();
        // コピー元（現在ギルド）の ini を読む（無ければ生成）
        if (!fs.existsSync(guildIniPath(guildId))) exportGuildIni(guildId);
        const srcParsed = ini.parse(fs.readFileSync(guildIniPath(guildId), 'utf-8'));
        // voice/text はコピーしない
        if (srcParsed.general) {
          delete srcParsed.general.text_channel_id;
          delete srcParsed.general.voice_channel_id;
        }

        // 対象決定
        let targetIds = [];
        if (toArg.toLowerCase() === 'all') {
          targetIds = [...client.guilds.cache.keys()].filter(id => id !== guildId);
        } else {
          targetIds = toArg.split(',').map(s => s.trim()).filter(Boolean);
        }
        if (targetIds.length === 0) {
          return interaction.reply({ content: 'コピー先がありません。to: all または guildIdのカンマ区切りで指定してください。', ephemeral: true });
        }

        // 各ギルドへ書き込み＆適用
        const done = [];
        for (const tid of targetIds) {
          try {
            const p = guildIniPath(tid);
            let dst = {};
            if (fs.existsSync(p)) dst = ini.parse(fs.readFileSync(p,'utf-8'));
            // マージ（generalは上書き。ただし text/voice は既存優先）
            const gn = dst.general || {};
            const sn = srcParsed.general || {};
            dst.general = Object.assign({}, gn, sn);
            // コピー先のサーバー名に合わせる
            dst.general.server_name = client.guilds.cache.get(tid)?.name || dst.general.server_name || '';
            if (gn.text_channel_id) dst.general.text_channel_id = gn.text_channel_id;
            if (gn.voice_channel_id) dst.general.voice_channel_id = gn.voice_channel_id;
            // time.* は全面置換（見通しのため）
            Object.keys(dst).forEach(k => { if (/^time\.\d+$/.test(k)) delete dst[k]; });
            Object.keys(srcParsed).forEach(k => { if (/^time\.\d+$/.test(k)) dst[k] = srcParsed[k]; });

            fs.writeFileSync(p, ini.stringify(dst), 'utf-8');
            applyGuildIni(tid);
            done.push(`${client.guilds.cache.get(tid)?.name || tid}`);
          } catch (e) {
            console.error('copy failed:', tid, e);
          }
        }
        writeGuildCatalog(client, null);
        await interaction.reply({ content: `📤 このサーバーの設定をコピーして適用しました → ${done.join(', ')}` });
        break;
      }

      // --- デバッグ ---
      case 'debug-config': {
        const lines = [
          `guildId: \`${guildId}\` (${guildName})`,
          `textChannelId: \`${cfg.textChannelId || '(none)'}\``,
          `voiceChannelId: \`${cfg.voiceChannelId || '(none)'}\``,
          `times: ${cfg.times.length} 件`,
          `ini: \`configs/${guildId}.ini\``,
        ];
        await interaction.reply({ content: lines.join('\n'), ephemeral: true });
        break;
      }

      case 'debug-paths': {
        const s = [];
        s.push(`cwd: \`${process.cwd()}\``);
        s.push(`__dirname: \`${__dirname}\``);
        const p = guildIniPath(guildId);
        const ts = (f) => fs.existsSync(f) ? new Date(fs.statSync(f).mtime).toISOString() : '(missing)';
        s.push(`guild ini: \`${p}\` (mtime: ${ts(p)})`);
        s.push(`catalog: \`${ROOT_CATALOG_PATH}\` (mtime: ${ts(ROOT_CATALOG_PATH)})`);
        s.push(`storage: \`${STORE_PATH}\` (mtime: ${ts(STORE_PATH)})`);
        await interaction.reply({ content: s.join('\n'), ephemeral: true });
        break;
      }

      case 'save-store': {
        saveStore(store);
        const st = fs.existsSync(STORE_PATH) ? fs.statSync(STORE_PATH) : null;
        const when = st ? st.mtime.toISOString() : '(missing)';
        await interaction.reply({ content: `💾 保存しました。mtime: ${when}\nSTORE_PATH: \`${STORE_PATH}\``, ephemeral: true });
        break;
      }

      case 'debug-store': {
        const obj = ensureGuildConfig(guildId);
        const dump = JSON.stringify(obj, null, 2);
        const max = 1800;
        const body = dump.length > max ? dump.slice(0, max) + '\n…(truncated)' : dump;
        const st = fs.existsSync(STORE_PATH) ? fs.statSync(STORE_PATH) : null;
        const when = st ? st.mtime.toISOString() : '(missing)';
        const lines = [
          `guildId: \`${guildId}\` (${guildName})`,
          `STORE_PATH: \`${STORE_PATH}\``,
          `mtime: ${when}`,
          '```json',
          body,
          '```'
        ];
        await interaction.reply({ content: lines.join('\n'), ephemeral: true });
        break;
      }

      case 'debug-voice': {
        const os = require('os');
        const chId = cfg.voiceChannelId;
        if (!chId) return interaction.reply({ content: 'voiceChannelId が未設定です。/join してください。', flags: MessageFlags.Ephemeral });

        const ch = await client.channels.fetch(chId).catch(() => null);
        if (!ch) return interaction.reply({ content: `ボイスチャンネルが見つかりません: ${chId}`, flags: MessageFlags.Ephemeral });

        const me = await interaction.guild.members.fetch(client.user.id);
        const perms = ch.permissionsFor(me);
        //const { ChannelType, PermissionsBitField } = require('discord.js');

        const lines = [];
        lines.push(`channel: <#${ch.id}> (\`${ch.id}\`)`);
        lines.push(`type: \`${Object.keys(ChannelType).find(k => ChannelType[k]===ch.type)}\``);
        lines.push(`serverMute: \`${me.voice.serverMute}\`, serverDeaf: \`${me.voice.serverDeaf}\``);
        lines.push(`CONNECT: \`${perms?.has(PermissionsBitField.Flags.Connect)}\``);
        lines.push(`SPEAK:   \`${perms?.has(PermissionsBitField.Flags.Speak)}\``);
        lines.push(`STREAM:  \`${perms?.has(PermissionsBitField.Flags.Stream)}\``);
        lines.push(`REQ_SPEAK (Stage): \`${perms?.has(PermissionsBitField.Flags.RequestToSpeak)}\``);
        await interaction.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
        break;
      }

      case 'help': {
        const lines = [
          '【基本】',
          '`/join` — 参加＆このギルド専用 ini を自動作成・適用。通知先もこのチャンネルに設定',
          '`/leave` — VCから退出',
          '`/set-audio file:<name>` — 既定音源（全体）',
          '`/set-message template:<...>` — 既定メッセ（{time}/{HH}/{mm}）',
          '`/set-text-channel` / `/set-voice-channel channel:<...>` — 通知／ボイスのID設定',
          '`/text-toggle mode:<on|off>` — テキスト通知のON/OFF',
          '',
          '【スケジュール】',
          '`/add-time time:<HH:mm> | cron:"..." [tz] [message] [file]` — この時刻だけの message/file 同時設定可',
          '`/set-time-audio index:<N> file:<name>` / `/set-time-message index:<N> template:<...>`',
          '`/remove-time index:<N>` / `/list`',
          '',
          '【テスト】',
          '`/test`（既定） / `/test-time index:<N>`（個別）',
          '※ 時報は Bot が /join でボイスチャンネルに接続中のときだけ実行されます（未接続ならスキップ）。',
          '',
          '【ファイル】',
          '`/sync-settings` — このギルドの ini（configs/<guildId>.ini）を反映',
          '`/copy-settings to:<all|id,...>` — 現ギルドの ini を他ギルドへコピー＆適用（voice/text は上書きしない）',
          '',
          '【デバッグ】',
          '`/debug-config` `/debug-paths` `/save-store` `/debug-store`',
          '',
          '※ ルート settings.ini は「カタログ」です（ギルド名 ↔ ini パスの一覧）。',
        ];
        const embed = new EmbedBuilder()
          .setTitle('🛟 コマンド一覧')
          .setDescription(lines.join('\n'))
          .setFooter({ text: 'テンプレは {time}/{HH}/{mm} が使えます。' })
          .setTimestamp(new Date());
        await interaction.reply({ embeds: [embed], ephemeral: true });
        break;
      }
    }
  } catch (e) {
    console.error(e);
    const msg = e?.message ? `エラー: ${e.message}` : '不明なエラーが発生しました。';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(msg).catch(() => {});
    } else {
      await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
  }
});

// ---- 起動 ----
(async () => {
  await client.login(TOKEN);
})();
