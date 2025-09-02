// commands.js
const { SlashCommandBuilder, SlashCommandIntegerOption, SlashCommandStringOption, SlashCommandBooleanOption, SlashCommandSubcommandBuilder, SlashCommandNumberOption } = require('discord.js');

module.exports = [
  new SlashCommandBuilder().setName('join').setDescription('今いるボイスチャンネルに参加します'),
  new SlashCommandBuilder().setName('leave').setDescription('ボイスチャンネルから退出します'),
  new SlashCommandBuilder()
    .setName('set-audio')
    .setDescription('再生する音声ファイル（audio/配下）を設定します')
    .addStringOption(opt =>
      opt.setName('file').setDescription('例: chime.mp3').setRequired(true)
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
  new SlashCommandBuilder()
    .setName('add-time')
    .setDescription('時報の時刻を追加します（cron式: "sec min hour day month dow"）')
    .addStringOption(opt =>
      opt.setName('cron')
        .setDescription('例: 0 0 9 * * *（毎朝9時）')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('tz')
        .setDescription('タイムゾーン（例: Asia/Tokyo）。未指定なら環境変数TZを使用')
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('remove-time')
    .setDescription('登録済みの時刻を削除します（/list の番号）')
    .addIntegerOption(opt =>
      opt.setName('index')
        .setDescription('削除する番号（1始まり）')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('list')
    .setDescription('現在の設定を表示します'),
  new SlashCommandBuilder()
    .setName('test')
    .setDescription('すぐに一度だけ再生します（テキストON時は投稿も）'),
].map(c => c.toJSON());
