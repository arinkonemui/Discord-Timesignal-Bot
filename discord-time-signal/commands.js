// commands.js
const { SlashCommandBuilder } = require('discord.js');

module.exports = [
  new SlashCommandBuilder().setName('join').setDescription('今いるボイスチャンネルに参加します'),
  new SlashCommandBuilder().setName('leave').setDescription('ボイスチャンネルから退出します'),

  new SlashCommandBuilder()
    .setName('set-audio')
    .setDescription('再生する音声ファイル（audio/配下）を設定します')
    .addStringOption(opt =>
      opt.setName('file').setDescription('例: chime.wav').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('set-text-channel')
    .setDescription('このチャンネルを通知先に設定します'),

  new SlashCommandBuilder()
    .setName('text-toggle')
    .setDescription('テキスト通知をON/OFFします')
    .addStringOption(opt =>
      opt.setName('mode')
        .setDescription('on / off')
        .setRequired(true)
        .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })
    ),
  
  // 時報テキスト設定
  new SlashCommandBuilder()
  .setName('set-message')
  .setDescription('時報のメッセージ文面テンプレートを設定します（{time},{HH},{mm} 使用可）')
  .addStringOption(opt =>
    opt.setName('template')
      .setDescription('例: ⏰ {time} の時報です')
      .setRequired(true)
  ),

  // HH:mm形式
  new SlashCommandBuilder()
    .setName('add-time')
    .setDescription('時報の時刻を追加します（推奨: HH:mm / 互換: cron）')
    .addStringOption(opt =>
      opt.setName('time')
      .setDescription('HH:mm（24時間表記）例: 09:00')
      .setRequired(false)
    )
    // clon形式
    .addStringOption(opt =>
      opt.setName('cron')
      .setDescription('互換: 0 0 9 * * *（毎朝9時）')
      .setRequired(false)
    )
    // タイムゾーン
    .addStringOption(opt =>
      opt.setName('tz')
      .setDescription('タイムゾーン（例: Asia/Tokyo）')
      .setRequired(false)
    )

    // ★ この時刻だけのメッセージテンプレ
    .addStringOption(opt =>
      opt.setName('message')
      .setDescription('この時刻だけのメッセージテンプレ（{time},{HH},{mm} 使用可）')
      .setRequired(false)
    )
    // ★ この時刻だけの音源ファイル
    .addStringOption(opt =>
      opt.setName('file')
      .setDescription('この時刻だけの音源（audio/配下のファイル名）')
      .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('remove-time')
    .setDescription('登録済みの時刻を削除します（/list の番号）')
    .addIntegerOption(opt =>
      opt.setName('index').setDescription('削除する番号（1始まり）').setRequired(true)
    ),

  // ★ 既存の時刻エントリに「個別の音源」を設定
  new SlashCommandBuilder()
    .setName('set-time-audio')
    .setDescription('登録済みの時刻に個別の音源ファイルを設定します')
    .addIntegerOption(opt =>
      opt.setName('index').setDescription('対象の番号（/list の番号）').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('file').setDescription('音源ファイル名（audio/配下）').setRequired(true)
    ),

  // ★ 既存の時刻エントリに「個別のメッセージ」を設定
  new SlashCommandBuilder()
    .setName('set-time-message')
    .setDescription('登録済みの時刻に個別のメッセージテンプレを設定します')
    .addIntegerOption(opt =>
      opt.setName('index').setDescription('対象の番号（/list の番号）').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('template').setDescription('テンプレ（{time},{HH},{mm} 使用可）').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('list')
    .setDescription('現在の設定を表示します'),
  new SlashCommandBuilder()
    .setName('test')
    .setDescription('すぐに一度だけ再生します（テキストON時は投稿も）'),

  // 指定した時刻エントリの設定でテスト再生
  new SlashCommandBuilder()
    .setName('test-time')
    .setDescription('登録済みの時刻（index）の設定でテスト再生します')
    .addIntegerOption(opt =>
      opt.setName('index').setDescription('対象の番号（/list の番号）').setRequired(true)
    ),

  // settings.ini の出力／再読込
  new SlashCommandBuilder()
    .setName('config-export')
    .setDescription('現在の設定を settings.ini に書き出します'),
  new SlashCommandBuilder()
    .setName('config-reload')
    .setDescription('settings.ini を読み込んで設定を反映します'),
  
  // helpコマンド
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('コマンド一覧と使い方を表示します')
    .addStringOption(opt =>
      opt.setName('command')
        .setDescription('詳しく見たいコマンド名（例: add-time, set-audio）')
        .setRequired(false)
    ),
].map(c => c.toJSON());
