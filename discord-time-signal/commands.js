// commands.js
const { SlashCommandBuilder, ChannelType } = require('discord.js');

module.exports = [
  // 基本
  new SlashCommandBuilder()
    .setName('join')
    .setDescription('今いるボイスチャンネルに参加し、このテキストチャンネルを通知先に設定（初回はギルド専用iniを自動生成・適用）'),

  new SlashCommandBuilder()
    .setName('leave')
    .setDescription('ボイスチャンネルから退出します'),

  new SlashCommandBuilder()
    .setName('set-audio')
    .setDescription('既定の音源（全体）を設定します（audio/配下のファイル名）')
    .addStringOption(opt => opt.setName('file').setDescription('例: chime.wav').setRequired(true)),

  new SlashCommandBuilder()
    .setName('set-message')
    .setDescription('既定メッセージテンプレを設定します（{time},{HH},{mm} 使用可）')
    .addStringOption(opt => opt.setName('template').setDescription('例: ⏰ {time} の時報です').setRequired(true)),

  new SlashCommandBuilder()
    .setName('set-text-channel')
    .setDescription('通知先チャンネルをこのチャンネルに設定'),
  
  new SlashCommandBuilder()
    .setName('set-voice-channel')
    .setDescription('ボイスチャンネルを指定して保存します')
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('対象のボイスチャンネル')
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('text-toggle')
    .setDescription('テキスト通知をON/OFFします')
    .addStringOption(opt =>
      opt.setName('mode').setDescription('on または off').setRequired(true)
        .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })
    ),

  // スケジュール
  new SlashCommandBuilder()
    .setName('add-time')
    .setDescription('時刻を追加（推奨: HH:mm / 互換: cron） ※この時刻だけの message/file 同時設定可')
    .addStringOption(opt => opt.setName('time').setDescription('HH:mm（24h）例: 09:00').setRequired(false))
    .addStringOption(opt => opt.setName('cron').setDescription('例: 0 0 9 * * *').setRequired(false))
    .addStringOption(opt => opt.setName('tz').setDescription('例: Asia/Tokyo').setRequired(false))
    .addStringOption(opt => opt.setName('message').setDescription('この時刻だけのメッセ（{time},{HH},{mm}）').setRequired(false))
    .addStringOption(opt => opt.setName('file').setDescription('この時刻だけの音源（audio/配下）').setRequired(false)),

  new SlashCommandBuilder()
    .setName('set-time-audio')
    .setDescription('登録済みの時刻に個別音源を設定します')
    .addIntegerOption(opt => opt.setName('index').setDescription('/list の番号').setRequired(true))
    .addStringOption(opt => opt.setName('file').setDescription('audio/配下のファイル名').setRequired(true)),

  new SlashCommandBuilder()
    .setName('set-time-message')
    .setDescription('登録済みの時刻に個別メッセージを設定します')
    .addIntegerOption(opt => opt.setName('index').setDescription('/list の番号').setRequired(true))
    .addStringOption(opt => opt.setName('template').setDescription('テンプレ（{time},{HH},{mm}）').setRequired(true)),

  new SlashCommandBuilder()
    .setName('set-time-enabled')
    .setDescription('登録済みの時刻エントリを ON/OFF 切替します')
    .addIntegerOption(opt => opt.setName('index').setDescription('/list の番号').setRequired(true))
    .addBooleanOption(opt => opt.setName('enabled').setDescription('true=ON / false=OFF').setRequired(true)),

  new SlashCommandBuilder()
    .setName('remove-time')
    .setDescription('登録済みの時刻を削除します')
    .addIntegerOption(opt => opt.setName('index').setDescription('/list の番号').setRequired(true)),

  new SlashCommandBuilder()
    .setName('list')
    .setDescription('現在の設定を表示します'),

  // テスト
  new SlashCommandBuilder()
    .setName('test')
    .setDescription('既定設定でテスト再生（テキストON時は投稿も）'),

  new SlashCommandBuilder()
    .setName('test-time')
    .setDescription('指定エントリ（/list の番号）の設定でテスト再生')
    .addIntegerOption(opt => opt.setName('index').setDescription('対象番号').setRequired(true)),

  // ファイル連携（人が触るiniを正とする）
  new SlashCommandBuilder()
    .setName('sync-settings')
    .setDescription('このサーバーの ini（configs/<guildId>.ini）を読み直して反映します'),

  new SlashCommandBuilder()
    .setName('copy-settings')
    .setDescription('このサーバーの ini を他サーバーへコピーして適用（voice/textのIDは上書きしません）')
    .addStringOption(opt => opt.setName('to').setDescription('all または guildIdのカンマ区切り').setRequired(true)),

  // デバッグ（任意）
  new SlashCommandBuilder()
    .setName('debug-config')
    .setDescription('このサーバーの設定（ID含む）を表示'),

  new SlashCommandBuilder()
    .setName('debug-paths')
    .setDescription('実体パスとタイムスタンプを表示'),

  new SlashCommandBuilder()
    .setName('save-store')
    .setDescription('storage.json を即座に保存'),

  new SlashCommandBuilder()
    .setName('debug-store')
    .setDescription('storage.json のこのギルドの塊を表示'),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('コマンド一覧を表示'),

  new SlashCommandBuilder().setName('debug-voice').setDescription('ボイスチャンネルの種別・権限・状態を表示'),
].map(c => c.toJSON());
