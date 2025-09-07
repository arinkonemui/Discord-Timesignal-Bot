// index.js
require('dotenv').config();

const { Client, GatewayIntentBits, REST, Routes, EmbedBuilder } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  NoSubscriberBehavior,
  createAudioResource,
  AudioPlayerStatus,
  getVoiceConnection,
  generateDependencyReport
} = require('@discordjs/voice');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const ini = require('ini');

// FFmpeg（mp3/wav再生用）。見つかれば環境変数へ。
const ffmpeg = require('ffmpeg-static');
if (ffmpeg) process.env.FFMPEG_PATH = ffmpeg;

// ---- 基本設定 ----
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const DEFAULT_TZ = process.env.TZ || 'Asia/Tokyo';
const ACTIVE_GUILD_ID = process.env.ACTIVE_GUILD_ID || null; // 単一サーバー固定したいときだけ指定

if (!TOKEN || !CLIENT_ID) {
  console.error('❌ .env の DISCORD_TOKEN / CLIENT_ID を設定してください。');
  process.exit(1);
}

// 人が編集する設定ファイル（単一）
const CONFIG_PATH = path.join(__dirname, 'settings.ini');
let activeGuildId = null; // 実際に適用するサーバーID（.env優先／未指定なら最初に操作されたサーバー）
let lastIniWrite = 0;     // 自動保存直後の監視イベントをスキップするためのタイムスタンプ
let bootstrapped = false; // 初期ロード完了までは settings.ini へ書き出さない

// 内部ストレージ（JSON）
const STORE_PATH = path.join(__dirname, 'storage.json');
function loadStore() {
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify({ guilds: {} }, null, 2));
  }
  return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
}
function saveStore(data) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}
let store = loadStore();

// 直近で使ったギルドがあれば、それを事前に候補にしておく
const storedGuildIds = Object.keys(store.guilds || {});
if (!ACTIVE_GUILD_ID && storedGuildIds.length && !activeGuildId) {
  activeGuildId = storedGuildIds[0];
}

// ジョブ管理
const jobsByGuild = new Map();

// ---- ユーティリティ ----
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
      // times: [{ cron, tz, audioFile?, messageTemplate? }]
      times: [],
    };
    saveStore(store);
  }
  return store.guilds[guildId];
}

function replySettingsEmbed(cfg) {
  // 行を作る（1フィールドに収める）
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
  const overflowNote = '（多すぎるため以下省略。/config-export で settings.ini を参照してください）';
  const suffix = `\n…\n${overflowNote}`;
  const reserve = cfg.times.length > 0 ? suffix.length : 0; // 省略時だけ付ける

  let value = '';
  for (const line of lines) {
    const add = (value ? '\n' : '') + line;
    // 省略メッセージ分を予約しておき、超えそうなら打ち切り
    if (value.length + add.length + (lines.length > 0 ? reserve : 0) > MAX) {
      value += suffix;
      break;
    }
    value += add;
  }

  const embed = new EmbedBuilder()
    .setTitle('⏰ 時報ボット設定')
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

// 個別テンプレ＋TZで文面を組み立て
function renderMessageWith(template, tz, now = new Date()) {
  const timeStr = now.toLocaleTimeString('ja-JP', {
    timeZone: tz || DEFAULT_TZ, hour: '2-digit', minute: '2-digit', hour12: false
  });
  const [HH, mm] = timeStr.split(':');
  const tpl = template || '⏰ {time} の時報です';
  return tpl.replace(/\{time\}/g, `${HH}:${mm}`).replace(/\{HH\}/g, HH).replace(/\{mm\}/g, mm);
}

// 既定テンプレでの文面（後方互換）
function setDefaultTextChannel(guildId, channelId) {
  const cfg = ensureGuildConfig(guildId);
  if (!cfg.textChannelId) {
    cfg.textChannelId = channelId;
    saveStore(store);
    if (bootstrapped) exportSettingsIni(guildId);
  }
}

function renderMessage(cfg, now = new Date()) {
  const tz = (cfg.times[0]?.tz) || DEFAULT_TZ;
  const timeStr = now.toLocaleTimeString('ja-JP', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
  const [HH, mm] = timeStr.split(':');
  const tpl = cfg.messageTemplate || '⏰ {time} の時報です';
  return tpl
    .replace(/\{time\}/g, `${HH}:${mm}`)
    .replace(/\{HH\}/g, HH)
    .replace(/\{mm\}/g, mm);
}


async function playOnce(guildId, audioOverride = null) {
  const cfg = ensureGuildConfig(guildId);
  if (!cfg.voiceChannelId) throw new Error('voiceChannelが未設定です。/join で参加してください。');

  const voiceChannel = await client.channels.fetch(cfg.voiceChannelId).catch(() => null);
  if (!voiceChannel) throw new Error('voiceChannelが見つかりません。');

  let connection = getVoiceConnection(guildId);
  if (!connection) {
    const joinOptions = {
      channelId: voiceChannel.id,
      guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true,
    };
    // DAVE を無効化したい場合は .env に DAVE_DISABLE=1 を入れる
    if (process.env.DAVE_DISABLE === '1') {
      // @snazzah/davey が未導入の環境向けの一時回避
      joinOptions.daveEncryption = false;
    }
    connection = joinVoiceChannel(joinOptions);
  }

  const fileName = audioOverride || cfg.audioFile;
  const filePath = path.join(__dirname, 'audio', fileName);
  if (!fs.existsSync(filePath)) {
    const dir = path.join(__dirname, 'audio');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    throw new Error(
      `音声ファイルが見つかりません: ${fileName}\n` +
      `探した場所: ${filePath}\n` +
      `audio/にあるファイル: [${files.join(', ')}]`
    );
  }

  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
  const resource = createAudioResource(filePath);
  connection.subscribe(player);
  player.play(resource);

  return new Promise((resolve, reject) => {
    player.on(AudioPlayerStatus.Idle, () => resolve());
    player.on('error', (e) => reject(e));
  });
}

async function postTextIfEnabled(guildId, messageText) {
  const cfg = ensureGuildConfig(guildId);
  if (!cfg.textEnabled || !cfg.textChannelId) return;
  const ch = await client.channels.fetch(cfg.textChannelId).catch(() => null);
  if (!ch) return;
  await ch.send(messageText);
}

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
        await postTextIfEnabled(guildId, renderMessageWith(msgTpl, tz, now));
        await playOnce(guildId, audio);
      } catch (e) {
        console.error('Scheduled run error:', e);
      }
    }, { timezone: tz });
    job.start();
    jobsByGuild.get(guildId).push(job);
  });
}

// ---- settings.ini 単一ファイル I/O ----
function exportSettingsIni(guildId) {
  if (!guildId) return null;
  // 単一 settings.ini 運用なので、アクティブなギルド以外からの書き出しは無効化
  if (activeGuildId && guildId !== activeGuildId) {
    return null
  }
  const cfg = ensureGuildConfig(guildId);
    const tz = cfg.times[0]?.tz || DEFAULT_TZ;
    const hhmmList = cfg.times.map(t => cronToHHmm(t.cron)).filter(Boolean);
    const advList  = cfg.times.map(t => (cronToHHmm(t.cron) ? null : t.cron)).filter(Boolean);

    const data = {
    general: {
      timezone: tz,
      text_enabled: !!cfg.textEnabled,
      audio_file: cfg.audioFile || 'chime.wav',
      message_template: cfg.messageTemplate || '⏰ {time} の時報です',
      text_channel_id: cfg.textChannelId || '',
      voice_channel_id: cfg.voiceChannelId || '',
      times: hhmmList.join(','),        // HH:mm カンマ区切り
      advanced_cron: advList.join(','), // 変換できない cron はここへ
    }
  };

  // ★ per-time セクションも出力（time.1, time.2, ...）
  cfg.times.forEach((t, idx) => {
    const sec = {};
    const hh = cronToHHmm(t.cron);
    if (hh) sec.time = hh; else sec.cron = t.cron;
    if (t.tz) sec.tz = t.tz;
    if (t.audioFile) sec.audio = t.audioFile;
    if (t.messageTemplate) sec.message = t.messageTemplate;
    data[`time.${idx + 1}`] = sec;
  });

  fs.writeFileSync(CONFIG_PATH, ini.stringify(data), 'utf-8');
  lastIniWrite = Date.now();
  console.log(`[ini] wrote settings.ini (audio_file=${cfg.audioFile}, tz=${tz})`);
  return CONFIG_PATH;
}

function applySettingsIni(guildId) {
  if (!guildId) return;
  if (!fs.existsSync(CONFIG_PATH)) return; // 無ければ何もしない（初回は export で作成）
  const parsed = ini.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  const g = parsed.general || parsed;

  const tzDefault = g.timezone || DEFAULT_TZ;
  const times = [];

  const cfg = ensureGuildConfig(guildId);
  if (typeof g.text_enabled !== 'undefined') cfg.textEnabled = String(g.text_enabled).toLowerCase() === 'true';
  if (g.audio_file)       cfg.audioFile = g.audio_file;
  if (g.message_template) cfg.messageTemplate = g.message_template;
  if (g.text_channel_id)  cfg.textChannelId = g.text_channel_id;
  if (g.voice_channel_id) cfg.voiceChannelId = g.voice_channel_id;

  // ★ per-time セクション（あればこちらを優先）
  const timeSections = Object.keys(parsed).filter(k => /^time\.\d+$/.test(k)).sort((a, b) => {
    const ia = parseInt(a.split('.')[1], 10);
    const ib = parseInt(b.split('.')[1], 10);
    return ia - ib;
  });
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
    // 従来フィールド（times / advanced_cron）から構築
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
}

function setActiveGuildIfNeeded(candidateId) {
  if (ACTIVE_GUILD_ID) { activeGuildId = ACTIVE_GUILD_ID; return; }
  if (!activeGuildId && candidateId) activeGuildId = candidateId;
}

// ---- スラッシュコマンド登録（Global + Guild 即時）----
async function registerGlobalCommands() {
  const commands = require('./commands.js');
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  console.log('🛠 Registering GLOBAL:', commands.map(c => c.name).join(', '));
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log('🌐 Registered GLOBAL commands（反映に時間がかかる場合あり）');
}
async function registerGuildCommands(guildId) {
  const commands = require('./commands.js');
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  console.log(`🛠 Registering GUILD ${guildId}:`, commands.map(c => c.name).join(', '));
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, guildId), { body: commands });
  console.log(`⚡ Registered GUILD commands for ${guildId}（即時反映）`);
}

// ---- クライアント ----
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(generateDependencyReport()); // 依存状況を起動時にログ

  // 適用先サーバーを決定（.env優先 → 過去に使ったGuild → いま入っているGuild）
  const storedGuildIds = Object.keys(store.guilds || {});
  const firstFromStore = storedGuildIds[0] || null;
  const firstFromCache = client.guilds.cache.first()?.id || null;
  setActiveGuildIfNeeded(firstFromStore || firstFromCache);


  // 既存Guildのジョブ復元
  for (const guildId of Object.keys(store.guilds || {})) {
    rebuildJobsForGuild(guildId);
  }

  // settings.ini があれば読込、なければ初回書き出し
  if (activeGuildId) {
    if (fs.existsSync(CONFIG_PATH)) applySettingsIni(activeGuildId);
    else exportSettingsIni(activeGuildId);
  }

  // ← 初期ロードが完了。ここから export を許可
  bootstrapped = true;

  // settings.ini を監視（手編集→自動反映）
  fs.watchFile(CONFIG_PATH, { interval: 500 }, () => {
    if (!activeGuildId) return;
    if (Date.now() - lastIniWrite < 1000) return; // 直前の自動保存は無視
    try {
      applySettingsIni(activeGuildId);
      console.log('🔄 Reloaded settings from settings.ini');
    } catch (e) {
      console.error('INI reload failed:', e.message);
    }
  });

  // コマンド登録：グローバル + いま入っているサーバーへ即時
  registerGlobalCommands().catch(console.error);
  client.guilds.cache.forEach(g => registerGuildCommands(g.id).catch(console.error));
});

// 新しく招待されたサーバーにも即時登録
client.on('guildCreate', (guild) => {
  registerGuildCommands(guild.id).catch(console.error);
});

// ---- スラッシュコマンド ----
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // 最後に操作されたサーバーをアクティブに
  setActiveGuildIfNeeded(interaction.guildId);

  // ★ 起動時に apply できていない場合、最初の操作で先に settings.ini を適用
  if (!bootstrapped && activeGuildId) {
    if (fs.existsSync(CONFIG_PATH)) applySettingsIni(activeGuildId);
    else exportSettingsIni(activeGuildId);
    bootstrapped = true;
  }

  // テキストチャンネルの自動反映
  setDefaultTextChannel(interaction.guildId, interaction.channelId);

  const { guildId, member } = interaction;
  const cfg = ensureGuildConfig(guildId);

  try {
    switch (interaction.commandName) {
      case 'join': {
        if (!member?.voice?.channel) {
          return interaction.reply({ content: 'ボイスチャンネルに参加した状態で実行してください。', ephemeral: true });
        }
        const channel = member.voice.channel;
        cfg.voiceChannelId = channel.id; // ボイスチャンネルのIDセット
        cfg.textChannelId = interaction.channelId;  // テキストチャンネルのIDセット
        saveStore(store);
        if (bootstrapped) exportSettingsIni(guildId);

        const joinOptions = {
          channelId: channel.id,
          guildId,
          adapterCreator: channel.guild.voiceAdapterCreator,
          selfDeaf: true,
        };
        if (process.env.DAVE_DISABLE === '1') joinOptions.daveEncryption = false;
        joinVoiceChannel(joinOptions);

        rebuildJobsForGuild(guildId);
        await interaction.reply({ content: `参加しました：<#${channel.id}> に接続します。` });
        break;
      }

      case 'leave': {
        const conn = getVoiceConnection(guildId);
        if (conn) conn.destroy();
        cfg.voiceChannelId = null;
        saveStore(store);
        if (bootstrapped) exportSettingsIni(guildId);
        rebuildJobsForGuild(guildId);
        await interaction.reply('ボイスチャンネルから退出しました。');
        break;
      }

      case 'set-audio': {
        const file = interaction.options.getString('file', true);
        const full = path.join(__dirname, 'audio', file);
        if (!fs.existsSync(full)) {
          return interaction.reply({ content: `audio/${file} が見つかりません。`, ephemeral: true });
        }
        cfg.audioFile = file;
        saveStore(store);
        if (bootstrapped) exportSettingsIni(guildId);
        await interaction.reply({ embeds: [replySettingsEmbed(cfg)] });
        break;
      }

      case 'set-message': {
        const template = interaction.options.getString('template', true);
        cfg.messageTemplate = template;
        saveStore(store);
        if (bootstrapped) exportSettingsIni(guildId);

        const preview = renderMessage(cfg, new Date());
        const embed = new EmbedBuilder()
          .setTitle('📝 メッセージテンプレートを更新しました')
          .addFields(
            { name: 'Template', value: '```\n' + template.slice(0, 500) + '\n```' },
            { name: 'Preview', value: preview }
          )
          .setTimestamp(new Date());

        await interaction.reply({ embeds: [embed] });
        break;
      }


      case 'set-text-channel': {
        cfg.textChannelId = interaction.channelId;
        saveStore(store);
        if (bootstrapped) exportSettingsIni(guildId);
        await interaction.reply({ embeds: [replySettingsEmbed(cfg)] });
        break;
      }

      case 'text-toggle': {
        const mode = interaction.options.getString('mode', true);
        cfg.textEnabled = (mode === 'on');
        saveStore(store);
        if (bootstrapped) exportSettingsIni(guildId);
        await interaction.reply({ embeds: [replySettingsEmbed(cfg)] });
        break;
      }

      case 'add-time': {
        const timeStr = interaction.options.getString('time');
        const cronExpInput = interaction.options.getString('cron');
        const tz = interaction.options.getString('tz') || null;
        const perMsg = interaction.options.getString('message') || null;
        const perFile = interaction.options.getString('file') || null;

        if (!timeStr && !cronExpInput) {
          return interaction.reply({
            content: 'HH:mm または cron を1つ指定してください。例: /add-time time:"09:00"',
            ephemeral: true
          });
        }
        if (timeStr && cronExpInput) {
          return interaction.reply({
            content: 'HH:mm と cron は同時指定できません。どちらか一方にしてください。',
            ephemeral: true
          });
        }

        let cronExp = cronExpInput;
        if (timeStr) {
          const c = hhmmToCron(timeStr);
          if (!c) return interaction.reply({ content: 'HH:mm の形式が不正です（例: 09:00）', ephemeral: true });
          cronExp = c;
        }
        if (!cron.validate(cronExp)) {
          return interaction.reply({ content: 'cron式が不正です。例: 0 0 9 * * *', ephemeral: true });
        }

        // ★ 個別ファイルが指定された場合は存在チェック
        if (perFile) {
          const full = path.join(__dirname, 'audio', perFile);
          if (!fs.existsSync(full)) {
            return interaction.reply({ content: `audio/${perFile} が見つかりません。`, ephemeral: true });
          }
        }

        const entry = { cron: cronExp, tz };
        if (perMsg)  entry.messageTemplate = perMsg;
        if (perFile) entry.audioFile = perFile;
        cfg.times.push(entry);
        saveStore(store);
        if (bootstrapped) exportSettingsIni(guildId);
        rebuildJobsForGuild(guildId);

        const shown = timeStr ?? (cronToHHmm(cronExp) || cronExp);
        await interaction.reply({
          content:
            `追加しました：**${shown}**（${tz || DEFAULT_TZ}）`
            + (perFile ? ` | audio: \`${perFile}\`` : '')
            + (perMsg  ? ` | msg: "${perMsg.slice(0,30)}${perMsg.length>30?'…':''}"` : ''),
          embeds: [replySettingsEmbed(cfg)]
        });
        break;
      }

      // ★ 既存エントリに個別の音源を設定
      case 'set-time-audio': {
        const index = interaction.options.getInteger('index', true);
        const file = interaction.options.getString('file', true);
        if (index < 1 || index > cfg.times.length) {
          return interaction.reply({ content: '番号が不正です。/list で確認してください。', ephemeral: true });
        }
        const full = path.join(__dirname, 'audio', file);
        if (!fs.existsSync(full)) {
          return interaction.reply({ content: `audio/${file} が見つかりません。`, ephemeral: true });
        }
        cfg.times[index - 1].audioFile = file;
        saveStore(store);
        if (bootstrapped) exportSettingsIni(guildId);
        rebuildJobsForGuild(guildId);
        await interaction.reply({ content: `#${index} に audio: \`${file}\` を設定しました。`, embeds: [replySettingsEmbed(cfg)] });
        break;
      }

      // ★ 既存エントリに個別のメッセージを設定
      case 'set-time-message': {
        const index = interaction.options.getInteger('index', true);
        const tpl = interaction.options.getString('template', true);
        if (index < 1 || index > cfg.times.length) {
          return interaction.reply({ content: '番号が不正です。/list で確認してください。', ephemeral: true });
        }
        cfg.times[index - 1].messageTemplate = tpl;
        saveStore(store);
        if (bootstrapped) exportSettingsIni(guildId);
        rebuildJobsForGuild(guildId);

        const tz = cfg.times[index - 1].tz || DEFAULT_TZ;
        const preview = renderMessageWith(tpl, tz, new Date());
        const embed = new EmbedBuilder()
          .setTitle(`📝 #${index} のメッセージを更新しました`)
          .addFields(
            { name: 'Template', value: '```\n' + tpl.slice(0, 500) + '\n```' },
            { name: 'Preview', value: preview }
          )
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
        if (bootstrapped) exportSettingsIni(guildId);
        rebuildJobsForGuild(guildId);
        await interaction.reply({ content: '削除しました。', embeds: [replySettingsEmbed(cfg)] });
        break;
      }

      case 'list': {
        await interaction.reply({ embeds: [replySettingsEmbed(cfg)] });
        break;
      }

      case 'test': {
        await interaction.reply({ content: '🔧 テストを実行します…' }); // 先に即時応答
        const preview = renderMessageWith(cfg.messageTemplate, (cfg.times[0]?.tz)||DEFAULT_TZ, new Date());
        await postTextIfEnabled(guildId, '🔧 テスト: ' + preview);
        await playOnce(guildId, cfg.audioFile);
        await interaction.editReply('✅ テスト再生完了です。');
        break;
      }

      case 'config-export': {
        try {
          const p = exportSettingsIni(guildId);
          await interaction.reply({ content: `📝 設定を書き出しました：\`${p}\`\nこのファイル（settings.ini）は保存時に自動で反映されます。` });
        } catch (e) {
          await interaction.reply({ content: `エクスポートに失敗：${e.message}`, ephemeral: true });
        }
        break;
      }

      case 'config-reload': {
        try {
          applySettingsIni(guildId);
          await interaction.reply({ content: '🔄 settings.ini を読み込み、設定を反映しました。', embeds: [replySettingsEmbed(ensureGuildConfig(guildId))] });
        } catch (e) {
          await interaction.reply({ content: `読み込みに失敗：${e.message}`, ephemeral: true });
        }
        break;
      }
      /*******************/
      // helpコマンド定義
      /*******************/
      case 'help': {
        const lines = [
          '【基本】',
          '`/join` — 今いるボイスチャンネルに参加',
          '`/leave` — ボイスチャンネルから退出',
          '`/set-time-message index:<N> template:<...>` — ★既存時刻に個別メッセージを設定',
          '`/text-toggle mode:<on|off>` — テキスト通知のON/OFF',
          '`/help` — このヘルプを表示',
          '',
          '【スケジュール】',
          '`/add-time time:<HH:mm>  または  cron:"..." [tz:<TZ>]` — 時刻を追加（HH:mm推奨）',
          '`/set-time-audio index:<N> file:<name>` — ★既存時刻に個別音源を設定',
          '`/set-time-message index:<N> template:<...>` — ★既存時刻に個別メッセージを設定',
          '`/remove-time index:<N>` — 登録済みの時刻を削除（/listの番号）',
          '`/list` — 現在の設定を表示',
          '',
          '【以下は通常は使用しないでOK】',
          '`/set-audio file:<name>` — 既定の音源を設定（audio/配下）',
          '`/set-message` — 時報設定時の文面を設定',
          '`/set-text-channel` — このチャンネルを通知先に設定（/joinでも自動設定）',
          '`/config-export` — settings.iniに書き出し（予備）',
          '`/config-reload` — settings.iniを読み直し（予備）',
        ];

        const name = (interaction.options.getString('command') || '').toLowerCase();

        // 詳細ヘルプ定義（必要に応じて追記できます）
        const details = {
          'join': {
            title: '/join',
            body: [
              'あなたが入っている**ボイスチャンネル**にBotが参加します。',
              '同時に「**このテキストチャンネル**」を通知先に設定します。',
              '例: `/join`',
            ],
          },
          'leave': {
            title: '/leave',
            body: ['ボイスチャンネルから退出します。'],
          },
          'set-audio': {
            title: '/set-audio',
            body: [
              '再生する音源ファイルを `audio/` から選びます（拡張子まで一致）。',
              '例: `/set-audio file: chime.wav`',
            ],
          },
          'set-text-channel': {
            title: '/set-text-channel',
            body: [
              '「いまのテキストチャンネル」を通知先として保存します。',
              '※ /join 実行時も自動でこのチャンネルに設定されます。',
            ],
          },
          'text-toggle': {
            title: '/text-toggle',
            body: ['通知文面のON/OFFを切り替えます。例: `/text-toggle mode: on`'],
          },
          'add-time': {
            title: '/add-time',
            body: [
              '時報を追加します。**HH:mm** か **cron** のどちらかを指定してください。',
              '例: `/add-time time: 09:00`（毎日9時）',
              '例: `/add-time cron: "0 0 * * * *"`（毎正時）',
              'オプション: `tz`（例: Asia/Tokyo）',
            ],
          },
          'remove-time': {
            title: '/remove-time',
            body: ['`/list` の番号で時刻を削除します。例: `/remove-time index: 1`'],
          },
          'list': {
            title: '/list',
            body: ['現在の設定（通知先・音源・登録時刻など）を表示します。'],
          },
          'test': {
            title: '/test',
            body: [
              'すぐに1回だけ再生します。テキスト通知がONなら投稿も行います。',
            ],
          },
          'config-export': {
            title: '/config-export（予備）',
            body: [
              '`settings.ini` に現在の設定を書き出します（配布向けの設定ファイル）。',
              '通常運用では不要です。',
            ],
          },
          'config-reload': {
            title: '/config-reload（予備）',
            body: [
              '`settings.ini` を読み込み直して反映します（自動反映が効かない場合の予備）。',
            ],
          },
        };

        // 一覧（ショート版）
        const embed = new EmbedBuilder()
          .setTitle('🛟 ヘルプ — コマンド一覧')
          .setDescription(lines.join('\n'))
          .setFooter({ text: '詳しくは /help command:<コマンド名> で個別ヘルプ' })
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
