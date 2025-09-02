require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, EmbedBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, NoSubscriberBehavior, createAudioResource, AudioPlayerStatus, getVoiceConnection } = require('@discordjs/voice');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { generateDependencyReport } = require('@discordjs/voice');
console.log(generateDependencyReport());

// ---- 基本設定 ----
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const DEFAULT_TZ = process.env.TZ || 'Asia/Tokyo';

// 永続ストレージ（超シンプルなJSON）
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

// Guild別のジョブ管理
const jobsByGuild = new Map();

// ---- クライアント ----
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates, // 音声接続に必要
  ],
});

// ---- スラコマ登録 ----
async function registerCommands() {
  const commands = require('./commands.js');
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  // 全ギルド共通のGlobalコマンド
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log('✅ Slash commands registered.');
}

// ---- ユーティリティ ----
function ensureGuildConfig(guildId) {
  if (!store.guilds[guildId]) {
    store.guilds[guildId] = {
      textChannelId: null,
      voiceChannelId: null,
      audioFile: 'chime.wav',
      textEnabled: true,
      times: [], // { cron: "0 0 9 * * *", tz: "Asia/Tokyo" }
    };
    saveStore(store);
  }
  return store.guilds[guildId];
}

function replySettingsEmbed(cfg) {
  const embed = new EmbedBuilder()
    .setTitle('⏰ 時報ボット設定')
    .addFields(
      { name: 'テキスト通知', value: cfg.textEnabled ? 'ON' : 'OFF', inline: true },
      { name: '通知チャンネル', value: cfg.textChannelId ? `<#${cfg.textChannelId}>` : '未設定', inline: true },
      { name: '音声ファイル', value: cfg.audioFile || '未設定', inline: true },
      { name: 'ボイスチャンネル', value: cfg.voiceChannelId ? `<#${cfg.voiceChannelId}>` : '未設定', inline: true },
      { name: '登録時刻', value: cfg.times.length ? cfg.times.map((t, i) => `${i + 1}. \`${t.cron}\` (${t.tz || DEFAULT_TZ})`).join('\n') : 'なし' }
    )
    .setTimestamp(new Date());
  return embed;
}

// 音声再生
async function playOnce(guildId) {
  const cfg = ensureGuildConfig(guildId);
  if (!cfg.voiceChannelId) throw new Error('voiceChannelが未設定です。/join で参加してください。');

  const voiceChannel = await client.channels.fetch(cfg.voiceChannelId).catch(() => null);
  if (!voiceChannel) throw new Error('voiceChannelが見つかりません。');

  // 既存接続 or 新規接続
  let connection = getVoiceConnection(guildId);
  if (!connection) {
    connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
  }

  const filePath = path.join(__dirname, 'audio', cfg.audioFile);
  if (!fs.existsSync(filePath)) throw new Error(`音声ファイルが見つかりません: ${cfg.audioFile}`);

  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
  const resource = createAudioResource(filePath);
  connection.subscribe(player);
  player.play(resource);

  return new Promise((resolve, reject) => {
    player.on(AudioPlayerStatus.Idle, () => resolve());
    player.on('error', (e) => reject(e));
  });
}

// テキスト投稿
async function postTextIfEnabled(guildId, messageText) {
  const cfg = ensureGuildConfig(guildId);
  if (!cfg.textEnabled || !cfg.textChannelId) return;
  const ch = await client.channels.fetch(cfg.textChannelId).catch(() => null);
  if (!ch) return;
  await ch.send(messageText);
}

// Cronジョブ再構築（起動時＆設定変更時）
function rebuildJobsForGuild(guildId) {
  // 既存停止
  const current = jobsByGuild.get(guildId) || [];
  current.forEach(job => job.stop());
  jobsByGuild.set(guildId, []);

  const cfg = ensureGuildConfig(guildId);
  cfg.times.forEach(({ cron: cronExp, tz }) => {
    const job = cron.schedule(cronExp, async () => {
      try {
        // テキスト → 音声の順（好みで逆も可）
        const now = new Date();
        const hh = now.toLocaleTimeString('ja-JP', { hour12: false });
        await postTextIfEnabled(guildId, `⏰ 時報です（${hh}）`);
        await playOnce(guildId);
      } catch (e) {
        console.error('Scheduled run error:', e);
      }
    }, {
      timezone: tz || DEFAULT_TZ,
    });
    job.start();
    jobsByGuild.get(guildId).push(job);
  });
}

// ---- 起動時処理 ----
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  // 全Guildのジョブを復元
  for (const guildId of Object.keys(store.guilds || {})) {
    rebuildJobsForGuild(guildId);
  }
});

// ---- インタラクション（スラコマ） ----
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { guildId, member } = interaction;
  const cfg = ensureGuildConfig(guildId);

  try {
    switch (interaction.commandName) {
      case 'join': {
        if (!member?.voice?.channel) {
          return interaction.reply({ content: 'まずボイスチャンネルに参加した状態で実行してください。', ephemeral: true });
        }
        const channel = member.voice.channel;
        cfg.voiceChannelId = channel.id;
        saveStore(store);

        joinVoiceChannel({
          channelId: channel.id,
          guildId: guildId,
          adapterCreator: channel.guild.voiceAdapterCreator,
          selfDeaf: true,
        });
        rebuildJobsForGuild(guildId);
        await interaction.reply({ content: `参加しました：<#${channel.id}> に接続します。` });
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
        const full = path.join(__dirname, 'audio', file);
        if (!fs.existsSync(full)) {
          return interaction.reply({ content: `audio/${file} が見つかりません。`, ephemeral: true });
        }
        cfg.audioFile = file;
        saveStore(store);
        await interaction.reply({ embeds: [replySettingsEmbed(cfg)] });
        break;
      }
      case 'set-text-channel': {
        cfg.textChannelId = interaction.channelId;
        saveStore(store);
        await interaction.reply({ embeds: [replySettingsEmbed(cfg)] });
        break;
      }
      case 'text-toggle': {
        const mode = interaction.options.getString('mode', true);
        cfg.textEnabled = (mode === 'on');
        saveStore(store);
        await interaction.reply({ embeds: [replySettingsEmbed(cfg)] });
        break;
      }
      case 'add-time': {
        const cronExp = interaction.options.getString('cron', true);
        const tz = interaction.options.getString('tz') || null;

        // 簡易バリデーション
        if (!cron.validate(cronExp)) {
          return interaction.reply({ content: 'cron式が不正です。例: `0 0 9 * * *`（毎朝9時）', ephemeral: true });
        }
        cfg.times.push({ cron: cronExp, tz });
        saveStore(store);
        rebuildJobsForGuild(guildId);
        await interaction.reply({ content: `追加しました：\`${cronExp}\` (${tz || DEFAULT_TZ})`, embeds: [replySettingsEmbed(cfg)] });
        break;
      }
      case 'remove-time': {
        const index = interaction.options.getInteger('index', true);
        if (index < 1 || index > cfg.times.length) {
          return interaction.reply({ content: '番号が不正です。/list で確認してください。', ephemeral: true });
        }
        const removed = cfg.times.splice(index - 1, 1);
        saveStore(store);
        rebuildJobsForGuild(guildId);
        await interaction.reply({ content: `削除しました：\`${removed[0].cron}\``, embeds: [replySettingsEmbed(cfg)] });
        break;
      }
      case 'list': {
        await interaction.reply({ embeds: [replySettingsEmbed(cfg)] });
        break;
      }
      case 'test': {
        await interaction.deferReply();
        const now = new Date();
        const hh = now.toLocaleTimeString('ja-JP', { hour12: false });
        await postTextIfEnabled(guildId, `🔔 テスト時報（${hh}）`);
        await playOnce(guildId);
        await interaction.editReply('テスト再生完了です。');
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
  await registerCommands();
  await client.login(TOKEN);
})();
