const { EmbedBuilder } = require('discord.js');
function makeEmbed(title, description) {
  return new EmbedBuilder().setTitle(title).setDescription(description).setColor(0x1DB954);
}
module.exports = { makeEmbed };