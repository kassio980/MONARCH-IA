const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

function makeTextInput({ customId, label, style = TextInputStyle.Short, required = true, placeholder = '' }) {
  return new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(style)
    .setRequired(required)
    .setPlaceholder(placeholder);
}

function makeModal(customId, title, inputs = []) {
  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title);

  for (const input of inputs) {
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }

  return modal;
}

module.exports = {
  makeTextInput,
  makeModal,
};
