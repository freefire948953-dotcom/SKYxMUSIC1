// index.js
const {
 Client, GatewayIntentBits, ActivityType,
 EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
 ContainerBuilder, SectionBuilder, TextDisplayBuilder,
 ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags
} = require('discord.js');
const { Riffy } = require('riffy');
const config = require('./config.js');
const express = require('express');
require('dotenv').config();

// ─── Spotify Integration ──────────────────────────────────────────────────────
const spotifyModule = require('./spotify');
const SpotifyClient = require('spotify-url-info');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
spotifyModule.init({ spotifyClient: SpotifyClient(fetch) });

// ─── Express Server ───────────────────────────────────────────────────────────
function startExpressServer() {
 if (!config.express.enabled) return;

 const app = express();

 app.get('/', (req, res) => {
 res.json({
 status: 'online',
 bot: client.user ? client.user.tag : 'Starting...',
 servers: client.guilds.cache ? client.guilds.cache.size : 0,
 uptime: process.uptime(),
 lavalink: isLavalinkConnected ? 'connected' : 'disconnected'
 });
 });

 app.get('/stats', (req, res) => {
 res.json({
 guilds: client.guilds.cache ? client.guilds.cache.size : 0,
 users: client.guilds.cache
 ? client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0)
 : 0,
 players: riffy.players ? riffy.players.size : 0,
 uptime: process.uptime(),
 memory: process.memoryUsage().heapUsed / 1024 / 1024,
 ping: client.ws ? client.ws.ping : 0,
 lavalink: isLavalinkConnected
 });
 });

 app.listen(config.express.port, '0.0.0.0', () => {
 console.log(`🌐 Express server running on port ${config.express.port}`);
 });
}

startExpressServer();

// ─── Discord Client ───────────────────────────────────────────────────────────
const intents = [
 GatewayIntentBits.Guilds,
 GatewayIntentBits.GuildVoiceStates,
 GatewayIntentBits.GuildMessages
];

if (config.enablePrefix) {
 intents.push(GatewayIntentBits.MessageContent);
}

const client = new Client({
 intents,
 allowedMentions: { parse: [] }
});

let isLavalinkConnected = false;

const riffy = new Riffy(client, config.lavalink.nodes, {
 send: (payload) => {
 const guild = client.guilds.cache.get(payload.d.guild_id);
 if (guild) guild.shard.send(payload);
 },
 defaultSearchPlatform: 'ytmsearch',
 restVersion: 'v4'
});

// ─── State ────────────────────────────────────────────────────────────────────
const queue247 = new Set();
const autoplayEnabled = new Set();
const nowPlayingMessages = new Map();

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatTime(ms) {
 const seconds = Math.floor((ms / 1000) % 60);
 const minutes = Math.floor((ms / (1000 * 60)) % 60);
 const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
 if (hours > 0) {
 return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
 }
 return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function resolveThumbnail(info) {
 if (info.artworkUrl) return info.artworkUrl;
 if (info.thumbnail) return info.thumbnail;

 const uri = info.uri || '';
 let videoId = null;

 if (uri.includes('youtube.com')) {
 videoId = uri.split('v=')[1]?.split('&')[0];
 } else if (uri.includes('youtu.be')) {
 videoId = uri.split('youtu.be/')[1]?.split('?')[0];
 }

 if (videoId) return `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
 return 'https://i.imgur.com/QYJfXQv.png';
}

// ─── Container Builders ───────────────────────────────────────────────────────

function createNowPlayingContainer(player, track, disabled = false) {
 const info = track.info ?? {};
 const thumbnail = resolveThumbnail(info);
 const isPaused = player.paused;

 const container = new ContainerBuilder()
 .addSectionComponents(
 new SectionBuilder()
 .addTextDisplayComponents(
 new TextDisplayBuilder()
 .setContent(
 `## ${config.emojis.music} Now Playing\n` +
 `**[${info.title || 'Unknown Title'}](${info.uri || 'https://youtube.com'})**`
 )
 )
 .setThumbnailAccessory(
 new ThumbnailBuilder()
 .setURL(thumbnail)
 .setDescription(info.title || 'Song Thumbnail')
 )
 )
 .addTextDisplayComponents(
 new TextDisplayBuilder()
 .setContent(
 `**Duration:** ${formatTime(info.length || 0)} • ` +
 `**Requested By:** <@${info.requester}>`
 )
 )
 .addSeparatorComponents(
 new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
 )
 .addActionRowComponents(
 new ActionRowBuilder()
 .addComponents(
 new ButtonBuilder()
 .setCustomId(isPaused ? 'resume' : 'pause')
 .setEmoji(isPaused ? config.emojis.play : config.emojis.pause)
 .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Primary)
 .setDisabled(disabled),
 new ButtonBuilder()
 .setCustomId('skip')
 .setEmoji(config.emojis.skip)
 .setStyle(ButtonStyle.Primary)
 .setDisabled(disabled),
 new ButtonBuilder()
 .setCustomId('stop')
 .setEmoji(config.emojis.stop)
 .setStyle(ButtonStyle.Danger)
 .setDisabled(disabled),
 new ButtonBuilder()
 .setCustomId('shuffle')
 .setEmoji(config.emojis.shuffle)
 .setStyle(ButtonStyle.Secondary)
 .setDisabled(disabled),
 new ButtonBuilder()
 .setCustomId('queue')
 .setEmoji(config.emojis.queue)
 .setStyle(ButtonStyle.Secondary)
 .setDisabled(disabled)
 )
 )
 .addActionRowComponents(
 new ActionRowBuilder()
 .addComponents(
 new ButtonBuilder()
 .setCustomId('loop')
 .setEmoji(config.emojis.loop)
 .setStyle(
 player.loop && player.loop !== 'none'
 ? ButtonStyle.Success
 : ButtonStyle.Secondary
 )
 .setDisabled(disabled),
 new ButtonBuilder()
 .setCustomId('autoplay')
 .setLabel('Autoplay')
 .setEmoji(autoplayEnabled.has(player.guildId) ? '✅' : '❌')
 .setStyle(
 autoplayEnabled.has(player.guildId)
 ? ButtonStyle.Success
 : ButtonStyle.Secondary
 )
 .setDisabled(disabled)
 )
 );

 return container;
}

function createSimpleContainer(title, description, emoji = config.emojis.info) {
 return new ContainerBuilder()
 .addSectionComponents(
 new SectionBuilder()
 .addTextDisplayComponents(
 new TextDisplayBuilder()
 .setContent(`## ${emoji} ${title}\n${description}`)
 )
 .setThumbnailAccessory(
 new ThumbnailBuilder()
 .setURL(client.user.displayAvatarURL({ size: 1024 }))
 .setDescription(title)
 )
 )
 .addSeparatorComponents(
 new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
 );
}

function createQueueContainer(player) {
 const queue = player.queue ?? [];
 const current = player.current;
 let description = '';

 if (current?.info) {
 description +=
 `**Now Playing:**\n` +
 `**[${current.info.title}](${current.info.uri})**\n` +
 `${current.info.author || 'Unknown'} • ${formatTime(current.info.length)} • <@${current.info.requester}>\n\n`;
 }

 if (queue.length > 0) {
 description += `**Up Next:**\n`;
 queue.slice(0, 10).forEach((t, i) => {
 const inf = t.info || {};
 description +=
 `\`${i + 1}.\` **[${inf.title}](${inf.uri})**\n` +
 `${inf.author || 'Unknown'} • ${formatTime(inf.length || 0)} • <@${inf.requester}>\n`;
 });
 if (queue.length > 10) description += `\n*...and ${queue.length - 10} more track(s)*`;
 } else if (!current) {
 description = 'The queue is currently empty.';
 }

 description +=
 `\n\n**Loop:** ${(!player.loop || player.loop === 'none') ? 'off' : player.loop}` +
 ` | **Autoplay:** ${autoplayEnabled.has(player.guildId) ? '✅ On' : '❌ Off'}` +
 ` | **Total:** ${queue.length + (current ? 1 : 0)} tracks`;

 return new ContainerBuilder()
 .addSectionComponents(
 new SectionBuilder()
 .addTextDisplayComponents(
 new TextDisplayBuilder().setContent(`## ${config.emojis.queue} Queue\n${description}`)
 )
 .setThumbnailAccessory(
 new ThumbnailBuilder()
 .setURL(client.user.displayAvatarURL({ size: 1024 }))
 .setDescription('Queue')
 )
 )
 .addSeparatorComponents(
 new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
 );
}

function createStatsContainer() {
 const memory = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
 const totalUsers = client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0);
 const description =
 `**Servers:** ${client.guilds.cache.size}\n` +
 `**Users:** ${totalUsers}\n` +
 `**Players:** ${riffy.players.size}\n` +
 `**Uptime:** ${formatTime(client.uptime)}\n` +
 `**Ping:** ${client.ws.ping}ms\n` +
 `**Memory:** ${memory} MB`;

 return new ContainerBuilder()
 .addSectionComponents(
 new SectionBuilder()
 .addTextDisplayComponents(
 new TextDisplayBuilder().setContent(`## ${config.emojis.info} Bot Statistics\n${description}`)
 )
 .setThumbnailAccessory(
 new ThumbnailBuilder()
 .setURL(client.user.displayAvatarURL({ size: 1024 }))
 .setDescription('Bot Avatar')
 )
 )
 .addSeparatorComponents(
 new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
 );
}

function createHelpContainer() {
 const lavalinkStatus = isLavalinkConnected ? '🟢 Connected' : '🔴 Not Connected';
 const description =
 `A powerful music bot with high quality audio\n\n` +
 `**Total Commands:** 20\n**Prefix:** \`${config.prefix}\`\n**Lavalink:** ${lavalinkStatus}\nMade by **Susmita OP**\n\n` +
 `**${config.emojis.music} Music Commands**\n` +
 `**play** (p) - Play a song\n` +
 `**pause** (pa) - Pause current song\n` +
 `**resume** (r, res) - Resume playback\n` +
 `**skip** (s, next) - Skip current song\n` +
 `**stop** (st, leave) - Stop player\n` +
 `**nowplaying** (np) - Show current song\n` +
 `**queue** (q) - Show queue\n` +
 `**loop** (l, repeat) - Loop mode\n` +
 `**shuffle** (sh, mix) - Shuffle queue\n` +
 `**volume** (v, vol) - Set volume\n` +
 `**clearqueue** (cq, clear) - Clear queue\n` +
 `**remove** (rm, delete) - Remove from queue\n` +
 `**move** (mv) - Move in queue\n` +
 `**247** (24/7, stay) - Toggle 24/7\n` +
 `**autoplay** (ap) - Toggle autoplay\n\n` +
 `**${config.emojis.info} Utility Commands**\n` +
 `**stats** (status, info) - Bot stats\n` +
 `**ping** (latency) - Bot ping\n` +
 `**invite** (inv) - Invite link\n` +
 `**support** (server) - Support server\n` +
 `**help** (h, cmd) - This message\n\n` +
 `💡 **Tip:** Mention me and type \`join\` to join your voice channel!`;

 return new ContainerBuilder()
 .addSectionComponents(
 new SectionBuilder()
 .addTextDisplayComponents(
 new TextDisplayBuilder().setContent(`## ${client.user.username} Help\n${description}`)
 )
 .setThumbnailAccessory(
 new ThumbnailBuilder()
 .setURL(client.user.displayAvatarURL({ size: 1024 }))
 .setDescription('Bot Avatar')
 )
 )
 .addSeparatorComponents(
 new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
 )
 .addActionRowComponents(
 new ActionRowBuilder()
 .addComponents(
 new ButtonBuilder()
 .setLabel('Invite Me')
 .setStyle(ButtonStyle.Link)
 .setURL(`https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=3165184&scope=bot%20applications.commands`),
 new ButtonBuilder()
 .setLabel('Support')
 .setStyle(ButtonStyle.Link)
 .setURL(config.supportServer)
 )
 );
}

// ─── Shared command logic ─────────────────────────────────────────────────────

async function resolveWithFallback(query, requesterId) {
 const isUrl = /^https?:\/\//i.test(query);
 if (isUrl) {
 const result = await riffy.resolve({ query, requester: requesterId });
 if (result && result.tracks && result.tracks.length > 0) return result;
 }

 const platforms = ['ytmsearch', 'ytsearch', 'scsearch'];

 for (const platform of platforms) {
 try {
 const searchQuery = isUrl ? query : `${platform}:${query}`;
 const result = await riffy.resolve({ query: searchQuery, requester: requesterId });
 if (result && result.tracks && result.tracks.length > 0) {
 console.log(`✅ Found results on platform: ${platform}`);
 return result;
 }
 console.log(`⚠️ No results on ${platform}, trying next...`);
 } catch (err) {
 console.error(`❌ Error searching on ${platform}:`, err.message);
 }
 }

 return null;
}

// ─── Spotify → Riffy adapter ──────────────────────────────────────────────────
// Bridges spotify.js to your Riffy player
function makeSpotifyPlayerAdapter(guildId, voiceChannelId, textChannelId, requesterId) {
 return {
 getQueue: (gId) => {
 const player = riffy.players.get(gId);
 return { queue: player ? [...player.queue] : [] };
 },
 enqueue: async (gId, items) => {
 let player = riffy.players.get(gId);
 if (!player) {
 player = riffy.createConnection({
 guildId,
 voiceChannel: voiceChannelId,
 textChannel: textChannelId,
 deaf: true
 });
 }
 const trackArray = Array.isArray(items) ? items : [items];
 for (const item of trackArray) {
 try {
 // Search YouTube Music using the spotify search query
 const result = await riffy.resolve({
 query: `ytmsearch:${item.search}`,
 requester: requesterId
 });
 if (result && result.tracks && result.tracks.length > 0) {
 const track = result.tracks[0];
 track.info.requester = requesterId;
 player.queue.add(track);
 console.log(`✅ Spotify→YTM queued: ${item.title}`);
 } else {
 console.warn(`⚠️ No YTM result for Spotify track: ${item.title}`);
 }
 } catch (err) {
 console.error(`❌ Failed to resolve Spotify track "${item.title}":`, err.message);
 }
 }
 if (!player.playing && !player.paused) player.play();
 },
 guilds: {
 get: (gId) => ({ maxQueue: 500 })
 }
 };
}

async function handlePlay(guildId, voiceChannelId, textChannelId, query, requesterId, reply, editReply) {
 if (!isLavalinkConnected) {
 return reply(`${config.emojis.error} Lavalink is not connected. Music commands are unavailable.`);
 }

 // ── Spotify handler ────────────────────────────────────────────────────────
 if (spotifyModule.isSpotifyUrl(query)) {
 const spotifyReplyFn = async (data) => {
 // spotify.js sends { embeds: [...] } — convert to our container style
 const embedData = data && data.embeds && data.embeds[0];
 const title = embedData?.data?.title || embedData?.title || 'Spotify';
 const description = embedData?.data?.description || embedData?.description || '';
 return editReply({
 components: [createSimpleContainer(title, description, '🎵')],
 flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2
 });
 };

 const spotifyPlayer = makeSpotifyPlayerAdapter(guildId, voiceChannelId, textChannelId, requesterId);

 await spotifyModule.handleSpotify(
 query,
 guildId,
 textChannelId,
 requesterId,
 spotifyReplyFn,
 spotifyPlayer
 );
 return;
 }
 // ──────────────────────────────────────────────────────────────────────────

 let player = riffy.players.get(guildId);
 if (!player) {
 player = riffy.createConnection({
 guildId,
 voiceChannel: voiceChannelId,
 textChannel: textChannelId,
 deaf: true
 });
 }

 const resolve = await resolveWithFallback(query, requesterId);

 if (!resolve || !resolve.tracks.length) {
 return editReply(`${config.emojis.error} No results found for **${query}**. Try a different search term or paste a direct URL.`);
 }

 if (resolve.loadType === 'playlist') {
 for (const track of resolve.tracks) {
 track.info.requester = requesterId;
 player.queue.add(track);
 }
 const container = createSimpleContainer(
 'Playlist Added',
 `Added playlist **${resolve.playlistInfo.name}** (${resolve.tracks.length} tracks)`,
 config.emojis.success
 );
 await editReply({ components: [container], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 });
 } else if (resolve.loadType === 'search' || resolve.loadType === 'track') {
 const track = resolve.tracks[0];
 track.info.requester = requesterId;
 player.queue.add(track);
 const container = createSimpleContainer(
 'Added to Queue',
 `[${track.info.title}](${track.info.uri})`,
 config.emojis.success
 );
 await editReply({ components: [container], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 });
 } else {
 return editReply(`${config.emojis.error} No results found for **${query}**. Try a different search term or paste a direct URL.`);
 }

 if (!player.playing && !player.paused) player.play();
}

// ─── Riffy Events ─────────────────────────────────────────────────────────────

riffy.on('nodeConnect', (node) => {
 console.log(`${config.emojis.success} Node ${node.name} connected`);
 isLavalinkConnected = true;
});

riffy.on('nodeError', (node, error) => {
 console.error(`${config.emojis.error} Node ${node.name} error:`, error);
 isLavalinkConnected = false;
});

riffy.on('nodeDisconnect', (node) => {
 console.log(`${config.emojis.error} Node ${node.name} disconnected`);
 isLavalinkConnected = false;
});

riffy.on('trackStart', async (player, track) => {
 const channel = client.channels.cache.get(player.textChannel);
 if (!channel) return;

 const container = createNowPlayingContainer(player, track);

 try {
 const msg = await channel.send({
 components: [container],
 flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2
 });
 nowPlayingMessages.set(player.guildId, msg);
 } catch (err) {
 console.error('Failed to send Now Playing message:', err);
 }
});

riffy.on('queueEnd', async (player) => {
 const channel = client.channels.cache.get(player.textChannel);

 const msg = nowPlayingMessages.get(player.guildId);
 if (msg && player.current) {
 try {
 const disabledContainer = createNowPlayingContainer(player, player.current, true);
 await msg.edit({
 components: [disabledContainer],
 flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2
 });
 } catch (err) {
 console.error('Failed to disable buttons:', err);
 }
 }
 nowPlayingMessages.delete(player.guildId);

 if (autoplayEnabled.has(player.guildId) && player.current) {
 try {
 const track = player.current;
 const title = track.info.title || '';
 const author = track.info.author || '';

 const searchTerms = [
 `${title} similar hindi songs`,
 `${author} hindi sad songs`,
 `${title} bollywood playlist`,
 `${author} bollywood hits`,
 `${title} slowed reverb`,
 `${title} lofi`,
 `${author} romantic hindi songs`
 ];
 const query = searchTerms[Math.floor(Math.random() * searchTerms.length)];

 const result = await riffy.resolve({ query, requester: track.info.requester });

 if (result && result.tracks && result.tracks.length > 0) {
 const candidates = result.tracks.filter(t => t.info.uri !== track.info.uri);
 const nextTrack = candidates.length > 0
 ? candidates[Math.floor(Math.random() * candidates.length)]
 : result.tracks[Math.floor(Math.random() * result.tracks.length)];

 nextTrack.info.requester = track.info.requester;
 player.queue.add(nextTrack);
 player.play();

 if (channel) {
 const container = createSimpleContainer(
 'Autoplay',
 `Automatically added **[${nextTrack.info.title}](${nextTrack.info.uri})**`,
 '🔁'
 );
 await channel.send({
 components: [container],
 flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2
 });
 }
 return;
 }
 } catch (err) {
 console.error('Autoplay Error:', err);
 }
 }

 if (queue247.has(player.guildId)) {
 if (channel) {
 const container = createSimpleContainer(
 '24/7 Mode',
 'Queue ended but staying in 24/7 mode',
 config.emojis.info
 );
 await channel.send({
 components: [container],
 flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2
 });
 }
 return;
 }

 if (channel) {
 const container = createSimpleContainer(
 'Queue Ended',
 'Queue ended, leaving voice channel',
 config.emojis.success
 );
 await channel.send({
 components: [container],
 flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2
 });
 }

 player.destroy();
});

// ─── Client Events ────────────────────────────────────────────────────────────

client.on('ready', async () => {
 console.log(`${config.emojis.success} Logged in as ${client.user.tag}`);

 try {
 riffy.init(client.user.id);
 } catch (error) {
 console.error(`${config.emojis.error} Failed to initialize Riffy:`, error);
 }

 const activityTypes = {
 PLAYING: ActivityType.Playing,
 LISTENING: ActivityType.Listening,
 WATCHING: ActivityType.Watching,
 STREAMING: ActivityType.Streaming,
 COMPETING: ActivityType.Competing
 };
 const activityType = activityTypes[config.activity.type] || ActivityType.Listening;
 client.user.setActivity(config.activity.name, { type: activityType });
 console.log(`${config.emojis.success} Activity set: ${config.activity.type} ${config.activity.name}`);

 const commands = [
 { name: 'play', description: 'Play a song', options: [{ name: 'query', description: 'Song name or URL', type: 3, required: true }] },
 { name: 'pause', description: 'Pause the current song' },
 { name: 'resume', description: 'Resume the paused song' },
 { name: 'skip', description: 'Skip the current song' },
 { name: 'stop', description: 'Stop the player and clear queue' },
 { name: 'volume', description: 'Set volume', options: [{ name: 'level', description: 'Volume level (1-100)', type: 4, required: true, min_value: 1, max_value: 100 }] },
 { name: 'queue', description: 'Show the current queue' },
 { name: 'nowplaying', description: 'Show currently playing song' },
 { name: 'shuffle', description: 'Shuffle the queue' },
 { name: 'loop', description: 'Toggle loop mode', options: [{ name: 'mode', description: 'Loop mode', type: 3, required: true, choices: [{ name: 'Off', value: 'none' }, { name: 'Track', value: 'track' }, { name: 'Queue', value: 'queue' }] }] },
 { name: 'remove', description: 'Remove a song from queue', options: [{ name: 'position', description: 'Position in queue', type: 4, required: true, min_value: 1 }] },
 { name: 'move', description: 'Move a song in queue', options: [{ name: 'from', description: 'From position', type: 4, required: true, min_value: 1 }, { name: 'to', description: 'To position', type: 4, required: true, min_value: 1 }] },
 { name: 'clearqueue', description: 'Clear the queue' },
 { name: '247', description: 'Toggle 24/7 mode' },
 { name: 'autoplay', description: 'Toggle autoplay mode' },
 { name: 'stats', description: 'Show bot statistics' },
 { name: 'ping', description: 'Show bot latency' },
 { name: 'invite', description: 'Get bot invite link' },
 { name: 'support', description: 'Get support server link' },
 { name: 'help', description: 'Show all commands' }
 ];

 await client.application.commands.set(commands);
 console.log(`${config.emojis.success} Slash commands registered globally`);
});

client.on('raw', (d) => riffy.updateVoiceState(d));

// ─── Interactions ─────────────────────────────────────────────────────────────

client.on('interactionCreate', async (interaction) => {

 if (interaction.isButton()) {
 const player = riffy.players.get(interaction.guildId);

 if (!player) {
 return interaction.reply({ content: `${config.emojis.error} No player found`, ephemeral: true }).catch(() => {});
 }

 const member = interaction.member;
 if (!member.voice.channel) {
 return interaction.reply({ content: `${config.emojis.error} You need to be in a voice channel`, ephemeral: true }).catch(() => {});
 }
 if (member.voice.channel.id !== player.voiceChannel) {
 return interaction.reply({ content: `${config.emojis.error} You need to be in the same voice channel`, ephemeral: true }).catch(() => {});
 }

 try {
 switch (interaction.customId) {

 case 'pause':
 case 'resume': {
 const shouldPause = interaction.customId === 'pause';
 await player.pause(shouldPause);

 const message = nowPlayingMessages.get(player.guildId);
 if (message && player.current) {
 const updatedContainer = createNowPlayingContainer(player, player.current);
 await message.edit({ components: [updatedContainer], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 }).catch(() => {});
 }

 await interaction.reply({
 content: shouldPause ? `${config.emojis.pause} Paused` : `${config.emojis.play} Resumed`,
 ephemeral: true
 });
 break;
 }

 case 'skip': {
 if (player.current) {
 const disabledContainer = createNowPlayingContainer(player, player.current, true);
 await interaction.message.edit({ components: [disabledContainer], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 }).catch(() => {});
 }
 player.stop();
 await interaction.reply({ content: `${config.emojis.skip} Skipped`, ephemeral: true });
 break;
 }

 case 'stop': {
 if (player.current) {
 const disabledContainer = createNowPlayingContainer(player, player.current, true);
 await interaction.message.edit({ components: [disabledContainer], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 }).catch(() => {});
 }
 nowPlayingMessages.delete(player.guildId);
 player.destroy();
 await interaction.reply({ content: `${config.emojis.stop} Stopped`, ephemeral: true });
 break;
 }

 case 'shuffle': {
 if (!player.queue || player.queue.length === 0) {
 return interaction.reply({ content: `${config.emojis.error} Queue is empty`, ephemeral: true });
 }
 player.queue.shuffle();
 await interaction.reply({ content: `${config.emojis.shuffle} Shuffled queue`, ephemeral: true });
 break;
 }

 case 'loop': {
 const modes = ['none', 'track', 'queue'];
 const currentMode = player.loop || 'none';
 const nextMode = modes[(modes.indexOf(currentMode) + 1) % modes.length];
 player.setLoop(nextMode);

 const loopMsg = nowPlayingMessages.get(player.guildId);
 if (loopMsg && player.current) {
 const updatedContainer = createNowPlayingContainer(player, player.current);
 await loopMsg.edit({ components: [updatedContainer], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 }).catch(() => {});
 }

 const loopLabel = nextMode === 'none' ? 'off' : nextMode;
 await interaction.reply({ content: `${config.emojis.loop} Loop set to: ${loopLabel}`, ephemeral: true });
 break;
 }

 case 'autoplay': {
 if (autoplayEnabled.has(player.guildId)) {
 autoplayEnabled.delete(player.guildId);
 await interaction.reply({ content: '❌ Autoplay Disabled', ephemeral: true });
 } else {
 autoplayEnabled.add(player.guildId);
 await interaction.reply({ content: '✅ Autoplay Enabled', ephemeral: true });
 }

 const loopMsg = nowPlayingMessages.get(player.guildId);
 if (loopMsg && player.current) {
 const updatedContainer = createNowPlayingContainer(player, player.current);
 await loopMsg.edit({ components: [updatedContainer], flags: MessageFlags.IsPersistent | MessageFlags.IsComponentsV2 }).catch(() => {});
 }
 break;
 }

 case 'queue': {
 const queueContainer = createQueueContainer(player);
 await interaction.reply({ components: [queueContainer], flags: MessageFlags.IsComponentsV2, ephemeral: true });
 break;
 }
 }
 } catch (err) {
 console.error('Button interaction error:', err);
 if (!interaction.replied) {
 await interaction.reply({ content: `${config.emojis.error} Something went wrong`, ephemeral: true }).catch(() => {});
 }
 }
 }

 if (!interaction.isChatInputCommand()) return;

 const { commandName, options, member, guild, channel } = interaction;

 try {
 if (commandName === 'play') {
 const query = options.getString('query');
 if (!member.voice.channel) {
 return interaction.reply({ content: `${config.emojis.error} You need to be in a voice channel`, ephemeral: true });
 }
 await interaction.deferReply();
 await handlePlay(
 guild.id,
 member.voice.channel.id,
 channel.id,
 query,
 member.user.id,
 (msg) => interaction.reply(typeof msg === 'string' ? { content: msg, ephemeral: true } : msg),
 (data) => interaction.editReply(data)
 );
 }

 else if (commandName === 'pause') {
 const player = riffy.players.get(guild.id);
 if (!player) return interaction.reply({ content: `${config.emojis.error} No player found`, ephemeral: true });
 if (!member.voice.channel || member.voice.channel.id !== player.voiceChannel) {
 return interaction.reply({ content: `${config.emojis.error} You need to be in the same voice channel`, ephemeral: true });
 }
 player.pause(true);
 await interaction.reply({ components: [createSimpleContainer('Paused', 'Playback paused', config.emojis.pause)], flags: MessageFlags.IsComponentsV2 });
 }

 else if (commandName === 'resume') {
 const player = riffy.players.get(guild.id);
 if (!player) return interaction.reply({ content: `${config.emojis.error} No player found`, ephemeral: true });
 if (!member.voice.channel || member.voice.channel.id !== player.voiceChannel) {
 return interaction.reply({ content: `${config.emojis.error} You need to be in the same voice channel`, ephemeral: true });
 }
 player.pause(false);
 await interaction.reply({ components: [createSimpleContainer('Resumed', 'Playback resumed', config.emojis.play)], flags: MessageFlags.IsComponentsV2 });
 }

 else if (commandName === 'skip') {
 const player = riffy.players.get(guild.id);
 if (!player) return interaction.reply({ content: `${config.emojis.error} No player found`, ephemeral: true });
 if (!member.voice.channel || member.voice.channel.id !== player.voiceChannel) {
 return interaction.reply({ content: `${config.emojis.error} You need to be in the same voice channel`, ephemeral: true });
 }
 player.stop();
 await interaction.reply({ components: [createSimpleContainer('Skipped', 'Skipped to next track', config.emojis.skip)], flags: MessageFlags.IsComponentsV2 });
 }

 else if (commandName === 'stop') {
 const player = riffy.players.get(guild.id);
 if (!player) return interaction.reply({ content: `${config.emojis.error} No player found`, ephemeral: true });
 if (!member.voice.channel || member.voice.channel.id !== player.voiceChannel) {
 return interaction.reply({ content: `${config.emojis.error} You need to be in the same voice channel`, ephemeral: true });
 }
 nowPlayingMessages.delete(guild.id);
 player.destroy();
 await interaction.reply({ components: [createSimpleContainer('Stopped', 'Stopped and cleared queue', config.emojis.stop)], flags: MessageFlags.IsComponentsV2 });
 }

 else if (commandName === 'volume') {
 const player = riffy.players.get(guild.id);
 if (!player) return interaction.reply({ content: `${config.emojis.error} No player found`, ephemeral: true });
 if (!member.voice.channel || member.voice.channel.id !== player.voiceChannel) {
 return interaction.reply({ content: `${config.emojis.error} You need to be in the same voice channel`, ephemeral: true });
 }
 const volume = options.getInteger('level');
 player.setVolume(volume);
 await interaction.reply({ components: [createSimpleContainer('Volume Set', `Volume set to ${volume}%`, config.emojis.volume)], flags: MessageFlags.IsComponentsV2 });
 }

 else if (commandName === 'queue') {
 const player = riffy.players.get(guild.id);
 if (!player) return interaction.reply({ content: `${config.emojis.error} No player found`, ephemeral: true });
 if (!player.queue.length && !player.current) {
 return interaction.reply({ content: `${config.emojis.error} Queue is empty`, ephemeral: true });
 }
 await interaction.reply({ components: [createQueueContainer(player)], flags: MessageFlags.IsComponentsV2 });
 }

 else if (commandName === 'nowplaying') {
 const player = riffy.players.get(guild.id);
 if (!player || !player.current) {
 return interaction.reply({ content: `${config.emojis.error} Nothing is playing`, ephemeral: true });
 }
 const info = player.current.info ?? {};
 const thumbnail = resolveThumbnail(info);
 const status = player.paused ? '⏸️ Paused' : '▶️ Playing';
 const description =
 `**[${info.title || 'Unknown Title'}](${info.uri || 'https://youtube.com'})**\n\n` +
 `**Status:** ${status}\n` +
 `**Position:** ${formatTime(player.position || 0)} / ${formatTime(info.length || 0)}\n` +
 `**Requested By:** <@${info.requester}>\n` +
 `**Loop:** ${(!player.loop || player.loop === 'none') ? 'off' : player.loop}`;

 const container = new ContainerBuilder()
 .addSectionComponents(
 new SectionBuilder()
 .addTextDisplayComponents(
 new TextDisplayBuilder().setContent(`## ${config.emojis.music} Now Playing\n${description}`)
 )
 .setThumbnailAccessory(
 new ThumbnailBuilder().setURL(thumbnail).setDescription(info.title || 'Song Thumbnail')
 )
 )
 .addSeparatorComponents(
 new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
 );

 await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
 }

 else if (commandName === 'shuffle') {
 const player = riffy.players.get(guild.id);
 if (!player) return interaction.reply({ content: `${config.emojis.error} No player found`, ephemeral: true });
 if (!member.voice.channel || member.voice.channel.id !== player.voiceChannel) {
 return interaction.reply({ content: `${config.emojis.error} You need to be in the same voice channel`, ephemeral: true });
 }
 if (!player.queue.length) {
 return interaction.reply({ content: `${config.emojis.error} Queue is empty`, ephemeral: true });
 }
 player.queue.shuffle();
 await interaction.reply({ components: [createSimpleContainer('Shuffled', 'Shuffled the queue', config.emojis.shuffle)], flags: MessageFlags.IsComponentsV2 });
 }

 else if (commandName === 'loop') {
 const player = riffy.players.get(guild.id);
 if (!player) return interaction.reply({ content: `${config.emojis.error} No player found`, ephemeral: true });
 if (!member.voice.channel || member.voice.channel.id !== player.voiceChannel) {
 return interaction.reply({ content: `${config.emojis.error} You need to be in the same voice channel`, ephemeral: true });
 }
 const mode = options.getString('mode');
 player.setLoop(mode);
 await interaction.reply({ components: [createSimpleContainer('Loop Set', `Loop set to: ${mode}`, config.emojis.loop)], flags: MessageFlags.IsComponentsV2 });
 }

 else if (commandName === 'remove') {
 const player = riffy.players.get(guild.id);
 if (!player) return interaction.reply({ content: `${config.emojis.error} No player found`, ephemeral: true });
 if (!member.voice.channel || member.voice.channel.id !== player.voiceChannel) {
 return interaction.reply({ content: `${config.emojis.error} You need to be in the same voice channel`, ephemeral: true });
 }
 const position = options.getInteger('position') - 1;
 if (position < 0 || position >= player.queue.length) {
 return interaction.reply({ content: `${config.emojis.error} Invalid position`, ephemeral: true });
 }
 const removed = player.queue.remove(position);
 await interaction.reply({ components: [createSimpleContainer('Removed', `Removed: **${removed.info.title}**`, config.emojis.success)], flags: MessageFlags.IsComponentsV2 });
 }

 else if (commandName === 'move') {
 const player = riffy.players.get(guild.id);
 if (!player) return interaction.reply({ content: `${config.emojis.error} No player found`, ephemeral: true });
 if (!member.voice.channel || member.voice.channel.id !== player.voiceChannel) {
 return interaction.reply({ content: `${config.emojis.error} You need to be in the same voice channel`, ephemeral: true });
 }
 const from = options.getInteger('from') - 1;
 const to = options.getInteger('to') - 1;
 if (from < 0 || from >= player.queue.length || to < 0 || to >= player.queue.length) {
 return interaction.reply({ content: `${config.emojis.error} Invalid positions`, ephemeral: true });
 }
 const queueArray = [...player.queue];
 const [track] = queueArray.splice(from, 1);
 queueArray.splice(to, 0, track);
 player.queue.clear();
 for (const t of queueArray) player.queue.add(t);
 await interaction.reply({ components: [createSimpleContainer('Moved', `Moved: **${track.info.title}**`, config.emojis.success)], flags: MessageFlags.IsComponentsV2 });
 }

 else if (commandName === 'clearqueue') {
 const player = riffy.players.get(guild.id);
 if (!player) return interaction.reply({ content: `${config.emojis.error} No player found`, ephemeral: true });
 if (!member.voice.channel || member.voice.channel.id !== player.voiceChannel) {
 return interaction.reply({ content: `${config.emojis.error} You need to be in the same voice channel`, ephemeral: true });
 }
 player.queue.clear();
 await interaction.reply({ components: [createSimpleContainer('Queue Cleared', 'Cleared the queue', config.emojis.success)], flags: MessageFlags.IsComponentsV2 });
 }

 else if (commandName === '247') {
 if (!member.voice.channel) {
 return interaction.reply({ content: `${config.emojis.error} You need to be in a voice channel`, ephemeral: true });
 }
 if (queue247.has(guild.id)) {
 queue247.delete(guild.id);
 await interaction.reply({ components: [createSimpleContainer('24/7 Disabled', '24/7 mode disabled', config.emojis.success)], flags: MessageFlags.IsComponentsV2 });
 } else {
 queue247.add(guild.id);
 if (!riffy.players.get(guild.id)) {
 riffy.createConnection({ guildId: guild.id, voiceChannel: member.voice.channel.id, textChannel: channel.id, deaf: true });
 }
 await interaction.reply({ components: [createSimpleContainer('24/7 Enabled', '24/7 mode enabled', config.emojis.success)], flags: MessageFlags.IsComponentsV2 });
 }
 }

 else if (commandName === 'autoplay') {
 const player = riffy.players.get(guild.id);
 if (!player) return interaction.reply({ content: `${config.emojis.error} No player found`, ephemeral: true });
 if (autoplayEnabled.has(guild.id)) {
 autoplayEnabled.delete(guild.id);
 await interaction.reply({ components: [createSimpleContainer('Autoplay Disabled', 'Autoplay has been disabled', config.emojis.error)], flags: MessageFlags.IsComponentsV2 });
 } else {
 autoplayEnabled.add(guild.id);
 await interaction.reply({ components: [createSimpleContainer('Autoplay Enabled', 'Autoplay has been enabled', config.emojis.success)], flags: MessageFlags.IsComponentsV2 });
 }
 }

 else if (commandName === 'stats') {
 await interaction.reply({ components: [createStatsContainer()], flags: MessageFlags.IsComponentsV2 });
 }

 else if (commandName === 'ping') {
 await interaction.reply({ components: [createSimpleContainer('Pong!', `Latency: ${client.ws.ping}ms`, config.emojis.info)], flags: MessageFlags.IsComponentsV2 });
 }

 else if (commandName === 'invite') {
 const invite = `https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=3165184&scope=bot%20applications.commands`;
 const container = new ContainerBuilder()
 .addSectionComponents(
 new SectionBuilder()
 .addTextDisplayComponents(
 new TextDisplayBuilder().setContent(`## ${config.emojis.success} Invite Bot\n[Click here to invite me](${invite})`)
 )
 .setThumbnailAccessory(
 new ThumbnailBuilder().setURL(client.user.displayAvatarURL({ size: 1024 })).setDescription('Invite Bot')
 )
 )
 .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
 .addActionRowComponents(
 new ActionRowBuilder().addComponents(
 new ButtonBuilder().setLabel('Invite Me').setStyle(ButtonStyle.Link).setURL(invite)
 )
 );
 await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
 }

 else if (commandName === 'support') {
 const container = new ContainerBuilder()
 .addSectionComponents(
 new SectionBuilder()
 .addTextDisplayComponents(
 new TextDisplayBuilder().setContent(`## ${config.emojis.info} Support Server\n[Join our support server](${config.supportServer})`)
 )
 .setThumbnailAccessory(
 new ThumbnailBuilder().setURL(client.user.displayAvatarURL({ size: 1024 })).setDescription('Support Server')
 )
 )
 .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
 .addActionRowComponents(
 new ActionRowBuilder().addComponents(
 new ButtonBuilder().setLabel('Support').setStyle(ButtonStyle.Link).setURL(config.supportServer)
 )
 );
 await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
 }

 else if (commandName === 'help') {
 await interaction.reply({ components: [createHelpContainer()], flags: MessageFlags.IsComponentsV2 });
 }

 } catch (err) {
 console.error(`Slash command error [${commandName}]:`, err);
 const errMsg = { content: `${config.emojis.error} An error occurred`, ephemeral: true };
 if (interaction.deferred) await interaction.editReply(errMsg).catch(() => {});
 else if (!interaction.replied) await interaction.reply(errMsg).catch(() => {});
 }
});

// ─── Prefix Commands ──────────────────────────────────────────────────────────

if (config.enablePrefix) {
 client.on('messageCreate', async (message) => {
 if (message.author.bot || !message.guild) return;

 const content = message.content.trim();
 const mentionRegex = new RegExp(`^<@!?${client.user.id}>\\s*`);
 const isMentioned = mentionRegex.test(content);

 if (isMentioned) {
   const mentionContent = content.replace(mentionRegex, '').trim();
   const lowerContent = mentionContent.toLowerCase();

   console.log(`[Mention] User: ${message.author.tag}, Content: "${mentionContent}"`);

   if (lowerContent === 'join') {
     if (!message.member.voice.channel) {
       return message.reply(`${config.emojis.error} You need to be in a voice channel first!`);
     }
     let player = riffy.players.get(message.guild.id);
     if (!player) {
       player = riffy.createConnection({
         guildId: message.guild.id,
         voiceChannel: message.member.voice.channel.id,
         textChannel: message.channel.id,
         deaf: true
       });
     }
     const container = createSimpleContainer(
       'Joined Voice Channel',
       `Connected to **${message.member.voice.channel.name}** 🎤`,
       config.emojis.success
     );
     return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
   }

   if (mentionContent.length > 0) {
     if (!message.member.voice.channel) {
       return message.reply(`${config.emojis.error} You need to be in a voice channel first!`);
     }

     let query = mentionContent;
     const words = mentionContent.split(/\s+/);
     const firstWord = words[0].toLowerCase();
     if (firstWord === 'play' || firstWord === 'p') {
       query = words.slice(1).join(' ').trim();
     }

     if (!query) {
       return message.reply(`${config.emojis.error} Please provide a song name or URL! Example: @bot Believer`);
     }

     const sent = await message.reply(`🔍 Searching: **${query}**...`);

     const prefixEditReply = async (data) => {
       if (typeof data === 'string') return sent.edit({ content: data, components: [] });
       return sent.edit({ content: '', components: data.components, flags: MessageFlags.IsComponentsV2 });
     };

     const prefixReply = async (msg) => {
       if (typeof msg === 'string') return sent.edit({ content: msg, components: [] });
       return sent.edit({ content: '', components: msg.components ?? [], flags: MessageFlags.IsComponentsV2 });
     };

     try {
       await handlePlay(
         message.guild.id,
         message.member.voice.channel.id,
         message.channel.id,
         query,
         message.author.id,
         prefixReply,
         prefixEditReply
       );
     } catch (err) {
       console.error('[Mention Play Error]', err);
       await sent.edit(`${config.emojis.error} Failed to play: ${err.message}`).catch(() => {});
     }
     return;
   }
 }

 if (!message.content.startsWith(config.prefix)) return;

 const args = message.content.slice(config.prefix.length).trim().split(/ +/);
 let command = args.shift().toLowerCase();

 for (const [cmd, aliases] of Object.entries(config.aliases)) {
 if (aliases.includes(command)) { command = cmd; break; }
 }

 try {
 if (command === 'play') {
 const query = args.join(' ');
 if (!query) return message.reply(`${config.emojis.error} Please provide a song name or URL`);
 if (!message.member.voice.channel) return message.reply(`${config.emojis.error} You need to be in a voice channel`);

 const sent = await message.reply('🔍 Searching...');

 const prefixEditReply = async (data) => {
 if (typeof data === 'string') return sent.edit({ content: data, components: [] });
 return sent.edit({ content: '', components: data.components, flags: MessageFlags.IsComponentsV2 });
 };

 const prefixReply = async (msg) => {
 if (typeof msg === 'string') return sent.edit({ content: msg, components: [] });
 return sent.edit({ content: '', components: msg.components ?? [], flags: MessageFlags.IsComponentsV2 });
 };

 await handlePlay(
 message.guild.id,
 message.member.voice.channel.id,
 message.channel.id,
 query,
 message.author.id,
 prefixReply,
 prefixEditReply
 );
 }

 else if (command === 'pause') {
 const player = riffy.players.get(message.guild.id);
 if (!player) return message.reply(`${config.emojis.error} No player found`);
 if (!message.member.voice.channel || message.member.voice.channel.id !== player.voiceChannel) {
 return message.reply(`${config.emojis.error} You need to be in the same voice channel`);
 }
 player.pause(true);
 await message.reply({ components: [createSimpleContainer('Paused', 'Playback paused', config.emojis.pause)], flags: MessageFlags.IsComponentsV2 });
 }

 else if (command === 'resume') {
 const player = riffy.players.get(message.guild.id);
 if (!player) return message.reply(`${config.emojis.error} No player found`);
 if (!message.member.voice.channel || message.member.voice.channel.id !== player.voiceChannel) {
 return message.reply(`${config.emojis.error} You need to be in the same voice channel`);
 }
 player.pause(false);
 await message.reply({ components: [createSimpleContainer('Resumed', 'Playback resumed', config.emojis.play)], flags: MessageFlags.IsComponentsV2 });
 }

 else if (command === 'skip') {
 const player = riffy.players.get(message.guild.id);
 if (!player) return message.reply(`${config.emojis.error} No player found`);
 if (!message.member.voice.channel || message.member.voice.channel.id !== player.voiceChannel) {
 return message.reply(`${config.emojis.error} You need to be in the same voice channel`);
 }
 player.stop();
 await message.reply({ components: [createSimpleContainer('Skipped', 'Skipped to next track', config.emojis.skip)], flags: MessageFlags.IsComponentsV2 });
 }

 else if (command === 'stop') {
 const player = riffy.players.get(message.guild.id);
 if (!player) return message.reply(`${config.emojis.error} No player found`);
 if (!message.member.voice.channel || message.member.voice.channel.id !== player.voiceChannel) {
 return message.reply(`${config.emojis.error} You need to be in the same voice channel`);
 }
 nowPlayingMessages.delete(message.guild.id);
 player.destroy();
 await message.reply({ components: [createSimpleContainer('Stopped', 'Stopped and cleared queue', config.emojis.stop)], flags: MessageFlags.IsComponentsV2 });
 }

 else if (command === 'volume') {
 const player = riffy.players.get(message.guild.id);
 if (!player) return message.reply(`${config.emojis.error} No player found`);
 if (!message.member.voice.channel || message.member.voice.channel.id !== player.voiceChannel) {
 return message.reply(`${config.emojis.error} You need to be in the same voice channel`);
 }
 const volume = parseInt(args[0]);
 if (isNaN(volume) || volume < 1 || volume > 100) {
 return message.reply(`${config.emojis.error} Please provide a volume between 1-100`);
 }
 player.setVolume(volume);
 await message.reply({ components: [createSimpleContainer('Volume Set', `Volume set to ${volume}%`, config.emojis.volume)], flags: MessageFlags.IsComponentsV2 });
 }

 else if (command === 'queue') {
 const player = riffy.players.get(message.guild.id);
 if (!player) return message.reply(`${config.emojis.error} No player found`);
 if (!player.queue.length && !player.current) return message.reply(`${config.emojis.error} Queue is empty`);
 await message.reply({ components: [createQueueContainer(player)], flags: MessageFlags.IsComponentsV2 });
 }

 else if (command === 'nowplaying') {
 const player = riffy.players.get(message.guild.id);
 if (!player || !player.current) return message.reply(`${config.emojis.error} Nothing is playing`);
 const info = player.current.info ?? {};
 const thumbnail = resolveThumbnail(info);
 const status = player.paused ? '⏸️ Paused' : '▶️ Playing';
 const description =
 `**[${info.title || 'Unknown Title'}](${info.uri || 'https://youtube.com'})**\n\n` +
 `**Status:** ${status}\n` +
 `**Position:** ${formatTime(player.position || 0)} / ${formatTime(info.length || 0)}\n` +
 `**Requested By:** <@${info.requester}>\n` +
 `**Loop:** ${(!player.loop || player.loop === 'none') ? 'off' : player.loop}`;

 const container = new ContainerBuilder()
 .addSectionComponents(
 new SectionBuilder()
 .addTextDisplayComponents(
 new TextDisplayBuilder().setContent(`## ${config.emojis.music} Now Playing\n${description}`)
 )
 .setThumbnailAccessory(
 new ThumbnailBuilder().setURL(thumbnail).setDescription(info.title || 'Song Thumbnail')
 )
 )
 .addSeparatorComponents(
 new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
 );

 await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
 }

 else if (command === 'shuffle') {
 const player = riffy.players.get(message.guild.id);
 if (!player) return message.reply(`${config.emojis.error} No player found`);
 if (!message.member.voice.channel || message.member.voice.channel.id !== player.voiceChannel) {
 return message.reply(`${config.emojis.error} You need to be in the same voice channel`);
 }
 if (!player.queue.length) return message.reply(`${config.emojis.error} Queue is empty`);
 player.queue.shuffle();
 await message.reply({ components: [createSimpleContainer('Shuffled', 'Shuffled the queue', config.emojis.shuffle)], flags: MessageFlags.IsComponentsV2 });
 }

 else if (command === 'loop') {
 const player = riffy.players.get(message.guild.id);
 if (!player) return message.reply(`${config.emojis.error} No player found`);
 if (!message.member.voice.channel || message.member.voice.channel.id !== player.voiceChannel) {
 return message.reply(`${config.emojis.error} You need to be in the same voice channel`);
 }
 const mode = args[0] || 'none';
 if (!['none', 'track', 'queue'].includes(mode)) {
 return message.reply(`${config.emojis.error} Invalid loop mode. Use: none, track, queue`);
 }
 player.setLoop(mode);
 await message.reply({ components: [createSimpleContainer('Loop Set', `Loop set to: ${mode}`, config.emojis.loop)], flags: MessageFlags.IsComponentsV2 });
 }

 else if (command === 'remove') {
 const player = riffy.players.get(message.guild.id);
 if (!player) return message.reply(`${config.emojis.error} No player found`);
 if (!message.member.voice.channel || message.member.voice.channel.id !== player.voiceChannel) {
 return message.reply(`${config.emojis.error} You need to be in the same voice channel`);
 }
 const position = parseInt(args[0]) - 1;
 if (isNaN(position) || position < 0 || position >= player.queue.length) {
 return message.reply(`${config.emojis.error} Invalid position`);
 }
 const removed = player.queue.remove(position);
 await message.reply({ components: [createSimpleContainer('Removed', `Removed: **${removed.info.title}**`, config.emojis.success)], flags: MessageFlags.IsComponentsV2 });
 }

 else if (command === 'move') {
 const player = riffy.players.get(message.guild.id);
 if (!player) return message.reply(`${config.emojis.error} No player found`);
 if (!message.member.voice.channel || message.member.voice.channel.id !== player.voiceChannel) {
 return message.reply(`${config.emojis.error} You need to be in the same voice channel`);
 }
 const from = parseInt(args[0]) - 1;
 const to = parseInt(args[1]) - 1;
 if (isNaN(from) || isNaN(to) || from < 0 || from >= player.queue.length || to < 0 || to >= player.queue.length) {
 return message.reply(`${config.emojis.error} Invalid positions`);
 }
 const queueArray = [...player.queue];
 const [track] = queueArray.splice(from, 1);
 queueArray.splice(to, 0, track);
 player.queue.clear();
 for (const t of queueArray) player.queue.add(t);
 await message.reply({ components: [createSimpleContainer('Moved', `Moved: **${track.info.title}**`, config.emojis.success)], flags: MessageFlags.IsComponentsV2 });
 }

 else if (command === 'clearqueue') {
 const player = riffy.players.get(message.guild.id);
 if (!player) return message.reply(`${config.emojis.error} No player found`);
 if (!message.member.voice.channel || message.member.voice.channel.id !== player.voiceChannel) {
 return message.reply(`${config.emojis.error} You need to be in the same voice channel`);
 }
 player.queue.clear();
 await message.reply({ components: [createSimpleContainer('Queue Cleared', 'Cleared the queue', config.emojis.success)], flags: MessageFlags.IsComponentsV2 });
 }

 else if (command === '247') {
 if (!message.member.voice.channel) return message.reply(`${config.emojis.error} You need to be in a voice channel`);
 if (queue247.has(message.guild.id)) {
 queue247.delete(message.guild.id);
 await message.reply({ components: [createSimpleContainer('24/7 Disabled', '24/7 mode disabled', config.emojis.success)], flags: MessageFlags.IsComponentsV2 });
 } else {
 queue247.add(message.guild.id);
 if (!riffy.players.get(message.guild.id)) {
 riffy.createConnection({ guildId: message.guild.id, voiceChannel: message.member.voice.channel.id, textChannel: message.channel.id, deaf: true });
 }
 await message.reply({ components: [createSimpleContainer('24/7 Enabled', '24/7 mode enabled', config.emojis.success)], flags: MessageFlags.IsComponentsV2 });
 }
 }

 else if (command === 'autoplay') {
 const player = riffy.players.get(message.guild.id);
 if (!player) return message.reply(`${config.emojis.error} No player found`);
 if (autoplayEnabled.has(message.guild.id)) {
 autoplayEnabled.delete(message.guild.id);
 await message.reply({ components: [createSimpleContainer('Autoplay Disabled', 'Autoplay has been disabled', config.emojis.error)], flags: MessageFlags.IsComponentsV2 });
 } else {
 autoplayEnabled.add(message.guild.id);
 await message.reply({ components: [createSimpleContainer('Autoplay Enabled', 'Autoplay has been enabled', config.emojis.success)], flags: MessageFlags.IsComponentsV2 });
 }
 }

 else if (command === 'stats') {
 await message.reply({ components: [createStatsContainer()], flags: MessageFlags.IsComponentsV2 });
 }

 else if (command === 'ping') {
 await message.reply({ components: [createSimpleContainer('Pong!', `Latency: ${client.ws.ping}ms`, config.emojis.info)], flags: MessageFlags.IsComponentsV2 });
 }

 else if (command === 'invite') {
 const invite = `https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=3165184&scope=bot%20applications.commands`;
 const container = new ContainerBuilder()
 .addSectionComponents(
 new SectionBuilder()
 .addTextDisplayComponents(
 new TextDisplayBuilder().setContent(`## ${config.emojis.success} Invite Bot\n[Click here to invite me](${invite})`)
 )
 .setThumbnailAccessory(
 new ThumbnailBuilder().setURL(client.user.displayAvatarURL({ size: 1024 })).setDescription('Invite Bot')
 )
 )
 .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
 .addActionRowComponents(
 new ActionRowBuilder().addComponents(
 new ButtonBuilder().setLabel('Invite Me').setStyle(ButtonStyle.Link).setURL(invite)
 )
 );
 await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
 }

 else if (command === 'support') {
 const container = new ContainerBuilder()
 .addSectionComponents(
 new SectionBuilder()
 .addTextDisplayComponents(
 new TextDisplayBuilder().setContent(`## ${config.emojis.info} Support Server\n[Join our support server](${config.supportServer})`)
 )
 .setThumbnailAccessory(
 new ThumbnailBuilder().setURL(client.user.displayAvatarURL({ size: 1024 })).setDescription('Support Server')
 )
 )
 .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
 .addActionRowComponents(
 new ActionRowBuilder().addComponents(
 new ButtonBuilder().setLabel('Support').setStyle(ButtonStyle.Link).setURL(config.supportServer)
 )
 );
 await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
 }

 else if (command === 'help') {
 await message.reply({ components: [createHelpContainer()], flags: MessageFlags.IsComponentsV2 });
 }

 } catch (err) {
 console.error(`Prefix command error [${command}]:`, err);
 message.reply(`${config.emojis.error} An error occurred`).catch(() => {});
 }
 });
}

client.login(config.token);
