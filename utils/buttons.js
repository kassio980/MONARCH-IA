const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function makeRow(buttons = []) {
  const row = new ActionRowBuilder();
  row.addComponents(buttons);
  return row;
}

function makeButton(customId, label, style = ButtonStyle.Secondary, emoji = null) {
  const btn = new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(style);

  if (emoji) btn.setEmoji(emoji);
  return btn;
}

module.exports = {
  makeRow,
  makeButton,
};
