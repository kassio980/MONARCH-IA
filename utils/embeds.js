const { EmbedBuilder } = require('discord.js');

function createBaseEmbed(title, description, color) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color);
}

module.exports = {
  createBaseEmbed,
};
