// index.js — Render-Ready, Fully Fixed Version
const {
  Client, GatewayIntentBits, ActivityType,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle
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

// ─── Discord Client ───────────────────────────────────────────────────────────
const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildMessages
];
if (config.enablePrefix) intents.push(GatewayIntentBits.MessageContent);

const client = new Client({ intents, allowedMentions: { parse: [] } });
let isLavalinkConnected = false;

const riffy = new Riffy(client, config.lavalink.nodes, {
  send: (payload) => {
    const guild = client.guilds.cache.get(payload.d?.guild_id);
    if (guild) guild.shard.send(payload);
  },
  defaultSearchPlatform: 'ytmsearch',
  restVersion: 'v4'
});

// ─── State ────────────────────────────────────────────────────────────────────
const queue247 = new Set();
const autoplayEnabled = new Set();
const nowPlayingMessages = new Map();
const lastTrack = new Map();

// ─── Express Server ───────────────────────────────────────────────────────────
// RENDER FIX: Start Express immediately at boot so Render detects the port.
// All endpoint values use optional chaining so they are safe before client is ready.
function startExpressServer() {
  if (!config.express?.enabled) return;
  const app = express();

  app.get('/', (req, res) => res.json({
    status: 'online',
    bot: client.user?.tag ?? 'Starting...',
    servers: client.guilds.cache?.size ?? 0,
    uptime: process.uptime(),
    lavalink: isLavalinkConnected ? 'connected' : 'disconnected'
  }));

  app.get('/stats', (req, res) => res.json({
    guilds: client.guilds.cache?.size ?? 0,
    users: client.guilds.cache?.reduce((a, g) => a + g.memberCount, 0) ?? 0,
    players: riffy?.players?.size ?? 0,
    uptime: process.uptime(),
    memory: process.memoryUsage().heapUsed / 1024 / 1024,
    ping: client.ws?.ping ?? 0,
    lavalink: isLavalinkConnected
  }));

  const port = config.express.port ?? process.env.PORT ?? 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`🌐 Express server running on port ${port}`);
  });
}

// Start Express BEFORE login so Render's port scanner sees it immediately
startExpressServer();

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatTime(ms) {
  if (!ms || ms <= 0) return '0:00';
  const s = Math.floor((ms / 1000) % 60);
  const m = Math.floor((ms / 60000) % 60);
  const h = Math.floor(ms / 3600000);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function resolveThumbnail(info) {
  if (info.artworkUrl) return info.artworkUrl;
  if (info.thumbnail) return info.thumbnail;
  const uri = info.uri || '';
  let videoId = null;
  if (uri.includes('youtube.com')) videoId = uri.split('v=')[1]?.split('&')[0];
  else if (uri.includes('youtu.be')) videoId = uri.split('youtu.be/')[1]?.split('?')[0];
  return videoId
    ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
    : 'https://i.imgur.com/QYJfXQv.png';
}

function progressBar(position, length, size = 12) {
  if (!length || length <= 0 || !position || position < 0) return '░'.repeat(size);
  const pct = Math.min(position / length, 1);
  const filled = Math.round(pct * size);
  return '▓'.repeat(filled) + '░'.repeat(size - filled);
}

function getLoopEmoji(loop) {
  if (!loop || loop === 'none') return '➡️ Off';
  if (loop === 'track') return '🔂 Track';
  return '🔁 Queue';
}

// ─── Embed Builders ───────────────────────────────────────────────────────────
const ACCENT_COLOR  = 0x5865F2;
const SUCCESS_COLOR = 0x57F287;
const ERROR_COLOR   = 0xED4245;
const WARNING_COLOR = 0xFEE75C;
const INFO_COLOR    = 0x5865F2;

function createNowPlayingEmbed(player, track, disabled = false) {
  const info = track.info ?? {};
  const thumbnail = resolveThumbnail(info);
  const isPaused = player.paused;
  const pos = player.position || 0;
  const len = info.length || 0;
  const bar = progressBar(pos, len);
  const loopMode = getLoopEmoji(player.loop);
  const autoplay = autoplayEnabled.has(player.guildId) ? '✅' : '❌';
  const requesterDisplay = info.requester ? `<@${info.requester}>` : 'Unknown';

  const embed = new EmbedBuilder()
    .setColor(isPaused ? WARNING_COLOR : ACCENT_COLOR)
    .setAuthor({ name: '🎵 Now Playing', iconURL: client.user.displayAvatarURL() })
    .setTitle(info.title || 'Unknown Title')
    .setURL(info.uri || null)
    .setThumbnail(thumbnail)
    .addFields(
      { name: '👤 Artist',       value: info.author || 'Unknown', inline: true },
      { name: '⏱️ Duration',     value: formatTime(len),          inline: true },
      { name: '📢 Requested By', value: requesterDisplay,         inline: true },
      {
        name: `${bar} \`${formatTime(pos)} / ${formatTime(len)}\``,
        value: `🔊 Vol: **${player.volume ?? 100}%** • Loop: **${loopMode}** • Autoplay: **${autoplay}**`
      }
    )
    .setFooter({ text: isPaused ? '⏸️ Paused' : '▶️ Playing' })
    .setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(isPaused ? 'resume' : 'pause')
      .setEmoji(isPaused ? '▶️' : '⏸️')
      .setLabel(isPaused ? 'Resume' : 'Pause')
      .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder().setCustomId('skip').setEmoji('⏭️').setLabel('Skip')
      .setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('stop').setEmoji('⏹️').setLabel('Stop')
      .setStyle(ButtonStyle.Danger).setDisabled(disabled),
    new ButtonBuilder().setCustomId('shuffle').setEmoji('🔀').setLabel('Shuffle')
      .setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('queue').setEmoji('📋').setLabel('Queue')
      .setStyle(ButtonStyle.Secondary).setDisabled(disabled)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('loop')
      .setEmoji('🔁')
      .setLabel(`Loop: ${player.loop && player.loop !== 'none' ? player.loop : 'Off'}`)
      .setStyle(player.loop && player.loop !== 'none' ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('autoplay')
      .setEmoji(autoplayEnabled.has(player.guildId) ? '✅' : '❌')
      .setLabel('Autoplay')
      .setStyle(autoplayEnabled.has(player.guildId) ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder().setCustomId('volumedown').setEmoji('🔉').setLabel('-10%')
      .setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('volumeup').setEmoji('🔊').setLabel('+10%')
      .setStyle(ButtonStyle.Secondary).setDisabled(disabled)
  );

  return { embeds: [embed], components: [row1, row2] };
}

function createSimpleEmbed(title, description, color = INFO_COLOR, emoji = '') {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(color)
        .setDescription(`${emoji} **${title}**\n${description}`)
        .setTimestamp()
    ]
  };
}

function createQueueEmbed(player) {
  const queue = player.queue ?? [];
  const current = player.current;
  const embed = new EmbedBuilder()
    .setColor(ACCENT_COLOR)
    .setAuthor({ name: '📋 Queue', iconURL: client.user.displayAvatarURL() })
    .setTimestamp();

  let desc = '';
  if (current?.info) {
    desc += `**▶️ Now Playing:**\n[${current.info.title}](${current.info.uri})\n${current.info.author || 'Unknown'} • \`${formatTime(current.info.length)}\` • <@${current.info.requester ?? 'Unknown'}>\n\n`;
  }
  if (queue.length > 0) {
    desc += '**📃 Up Next:**\n';
    queue.slice(0, 10).forEach((t, i) => {
      const inf = t.info || {};
      desc += `\`${i + 1}.\` [${inf.title}](${inf.uri}) • \`${formatTime(inf.length || 0)}\`\n`;
    });
    if (queue.length > 10) desc += `\n*...and ${queue.length - 10} more*`;
  } else if (!current) {
    desc = '> The queue is currently empty.';
  }

  const totalDuration = queue.reduce((a, t) => a + (t.info?.length || 0), 0) + (current?.info?.length || 0);
  embed.setDescription(desc || '> The queue is currently empty.');
  embed.setFooter({
    text: `${queue.length + (current ? 1 : 0)} tracks • Total: ${formatTime(totalDuration)} • Loop: ${player.loop || 'none'} • Autoplay: ${autoplayEnabled.has(player.guildId) ? 'On' : 'Off'}`
  });
  return { embeds: [embed] };
}

function createStatsEmbed() {
  const memory = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
  const totalUsers = client.guilds.cache.reduce((a, g) => a + g.memberCount, 0);
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(ACCENT_COLOR)
        .setAuthor({ name: `${client.user.username} Statistics`, iconURL: client.user.displayAvatarURL() })
        .setThumbnail(client.user.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: '🏠 Servers', value: `\`${client.guilds.cache.size}\``,           inline: true },
          { name: '👥 Users',   value: `\`${totalUsers.toLocaleString()}\``,         inline: true },
          { name: '🎵 Players', value: `\`${riffy.players.size}\``,                  inline: true },
          { name: '⏱️ Uptime',  value: `\`${formatTime(client.uptime)}\``,           inline: true },
          { name: '🏓 Ping',    value: `\`${client.ws.ping}ms\``,                    inline: true },
          { name: '💾 Memory',  value: `\`${memory} MB\``,                           inline: true },
          { name: '🎛️ Lavalink', value: isLavalinkConnected ? '🟢 Connected' : '🔴 Disconnected', inline: true }
        )
        .setTimestamp()
    ]
  };
}

function createHelpEmbed() {
  const embed = new EmbedBuilder()
    .setColor(ACCENT_COLOR)
    .setAuthor({ name: `${client.user.username} Help`, iconURL: client.user.displayAvatarURL() })
    .setThumbnail(client.user.displayAvatarURL({ size: 256 }))
    .setDescription(`A powerful music bot with high quality audio.\n**Prefix:** \`${config.prefix}\` • **Commands:** 20`)
    .addFields(
      { name: '🎵 Music',   value: '`play` `pause` `resume` `skip` `stop` `nowplaying` `queue` `loop` `shuffle` `volume` `clearqueue` `remove` `move` `247` `autoplay`', inline: false },
      { name: '🛠️ Utility', value: '`stats` `ping` `invite` `support` `help`', inline: false },
      { name: '💡 Tips',    value: `• Mention me to play: \`@${client.user.username} <song>\`\n• Supports YouTube, Spotify, SoundCloud links\n• Use \`loop track\` or \`loop queue\` for looping` }
    )
    .setFooter({ text: 'Made by Susmita OP' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Invite Bot').setEmoji('🔗').setStyle(ButtonStyle.Link)
      .setURL(`https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=3165184&scope=bot%20applications.commands`),
    new ButtonBuilder().setLabel('Support Server').setEmoji('💬').setStyle(ButtonStyle.Link)
      .setURL(config.supportServer)
  );
  return { embeds: [embed], components: [row] };
}

// ─── Search with Fallback ─────────────────────────────────────────────────────
async function resolveWithFallback(query, requesterId) {
  const isUrl = /^https?:\/\//i.test(query);

  if (isUrl) {
    try {
      const result = await riffy.resolve({ query, requester: requesterId });
      if (result?.tracks?.length > 0) return result;
    } catch (err) {
      console.error('URL resolve failed:', err.message);
    }
    return null;
  }

  // Strip any accidental existing prefix to avoid double-prefixing
  const cleanQuery = query.replace(/^(ytmsearch|ytsearch|scsearch):/i, '');
  const platforms = ['ytmsearch', 'ytsearch', 'scsearch'];

  for (const platform of platforms) {
    try {
      const result = await riffy.resolve({ query: `${platform}:${cleanQuery}`, requester: requesterId });
      if (result?.tracks?.length > 0) {
        console.log(`✅ Found on: ${platform}`);
        return result;
      }
    } catch (err) {
      console.error(`❌ ${platform} error:`, err.message);
    }
  }
  return null;
}

// ─── Spotify Adapter ──────────────────────────────────────────────────────────
function makeSpotifyPlayerAdapter(guildId, voiceChannelId, textChannelId, requesterId) {
  return {
    getQueue: (gId) => {
      const player = riffy.players.get(gId);
      return { queue: player ? [...player.queue] : [] };
    },
    enqueue: async (gId, items) => {
      let player = riffy.players.get(gId);
      if (!player) {
        player = riffy.createConnection({ guildId, voiceChannel: voiceChannelId, textChannel: textChannelId, deaf: true });
      }
      const trackArray = Array.isArray(items) ? items : [items];
      await Promise.allSettled(
        trackArray.map(async (item) => {
          try {
            const result = await riffy.resolve({ query: `ytmsearch:${item.search}`, requester: requesterId });
            if (result?.tracks?.length > 0) {
              const track = result.tracks[0];
              track.info.requester = requesterId;
              player.queue.add(track);
            }
          } catch (err) {
            console.error(`❌ Spotify track failed "${item.title}":`, err.message);
          }
        })
      );
      // Only call play() once after all tracks are resolved
      if (!player.playing && !player.paused && player.queue.length > 0) {
        player.play();
      }
    },
    guilds: { get: () => ({ maxQueue: 500 }) }
  };
}

// ─── Core Play Handler ────────────────────────────────────────────────────────
async function handlePlay(guildId, voiceChannelId, textChannelId, query, requesterId, reply, editReply) {
  if (!isLavalinkConnected) {
    return reply({ content: '❌ Lavalink is not connected. Music commands are unavailable.', ephemeral: true });
  }

  if (spotifyModule.isSpotifyUrl(query)) {
    const spotifyReplyFn = async (data) => {
      const embedData = data?.embeds?.[0];
      const title = embedData?.data?.title || embedData?.title || 'Spotify';
      const description = embedData?.data?.description || embedData?.description || '';
      try {
        return await editReply(createSimpleEmbed(title, description, SUCCESS_COLOR, '🎵'));
      } catch {
        return await reply(createSimpleEmbed(title, description, SUCCESS_COLOR, '🎵'));
      }
    };
    const spotifyPlayer = makeSpotifyPlayerAdapter(guildId, voiceChannelId, textChannelId, requesterId);
    await spotifyModule.handleSpotify(query, guildId, textChannelId, requesterId, spotifyReplyFn, spotifyPlayer);
    return;
  }

  let player = riffy.players.get(guildId);
  if (!player) {
    player = riffy.createConnection({ guildId, voiceChannel: voiceChannelId, textChannel: textChannelId, deaf: true });
  }

  const resolve = await resolveWithFallback(query, requesterId);
  if (!resolve?.tracks?.length) {
    return editReply({ content: `❌ No results found for **${query}**.`, ephemeral: true });
  }

  if (resolve.loadType === 'playlist') {
    for (const track of resolve.tracks) {
      track.info.requester = requesterId;
      player.queue.add(track);
    }
    await editReply(createSimpleEmbed(
      'Playlist Added',
      `**[${resolve.playlistInfo.name}](${query})** — ${resolve.tracks.length} tracks added to queue`,
      SUCCESS_COLOR, '🎵'
    ));
  } else {
    const track = resolve.tracks[0];
    track.info.requester = requesterId;
    player.queue.add(track);
    await editReply(createSimpleEmbed(
      'Added to Queue',
      `**[${track.info.title}](${track.info.uri})**\n${track.info.author || ''} • \`${formatTime(track.info.length)}\``,
      SUCCESS_COLOR, '✅'
    ));
  }

  if (!player.playing && !player.paused) player.play();
}

// ─── Riffy Events ─────────────────────────────────────────────────────────────
riffy.on('nodeConnect',    (node)        => { console.log(`✅ Node ${node.name} connected`);       isLavalinkConnected = true;  });
riffy.on('nodeError',      (node, error) => { console.error(`❌ Node ${node.name} error:`, error); isLavalinkConnected = false; });
riffy.on('nodeDisconnect', (node)        => { console.log(`⚠️ Node ${node.name} disconnected`);   isLavalinkConnected = false; });

riffy.on('trackStart', async (player, track) => {
  const channel = client.channels.cache.get(player.textChannel);
  if (!channel) return;

  // Save track before queueEnd can clear player.current
  lastTrack.set(player.guildId, track);

  const oldMsg = nowPlayingMessages.get(player.guildId);
  if (oldMsg) oldMsg.delete().catch(() => {});

  try {
    const msg = await channel.send(createNowPlayingEmbed(player, track));
    nowPlayingMessages.set(player.guildId, msg);
  } catch (err) {
    console.error('Failed to send Now Playing:', err);
  }
});

riffy.on('queueEnd', async (player) => {
  const channel = client.channels.cache.get(player.textChannel);

  // Use lastTrack because player.current is null by the time queueEnd fires
  const track = lastTrack.get(player.guildId);

  const msg = nowPlayingMessages.get(player.guildId);
  if (msg && track) {
    await msg.edit(createNowPlayingEmbed(player, track, true)).catch(() => {});
  }
  nowPlayingMessages.delete(player.guildId);

  // Autoplay
  if (autoplayEnabled.has(player.guildId) && track) {
    try {
      const title  = track.info.title  || '';
      const author = track.info.author || '';
      const genre  = track.info.sourceName || '';
      const searchTerms = [
        `${author} mix`,
        `songs like ${title}`,
        `${author} best songs`,
        `${title} recommended`,
        `${genre} similar to ${title}`
      ].filter(Boolean);

      const query  = searchTerms[Math.floor(Math.random() * searchTerms.length)];
      const result = await riffy.resolve({ query: `ytmsearch:${query}`, requester: track.info.requester });

      if (result?.tracks?.length > 0) {
        const candidates = result.tracks.filter(t => t.info.uri !== track.info.uri);
        const next = candidates.length > 0
          ? candidates[Math.floor(Math.random() * Math.min(5, candidates.length))]
          : result.tracks[0];

        next.info.requester = track.info.requester;
        player.queue.add(next);
        player.play();

        if (channel) {
          await channel.send(createSimpleEmbed('Autoplay', `Added **[${next.info.title}](${next.info.uri})**`, INFO_COLOR, '🔁'));
        }
        lastTrack.delete(player.guildId);
        return;
      }
    } catch (err) {
      console.error('Autoplay Error:', err);
    }
  }

  lastTrack.delete(player.guildId);

  if (queue247.has(player.guildId)) {
    if (channel) await channel.send(createSimpleEmbed('24/7 Mode', 'Queue ended — staying in VC', INFO_COLOR, '🔔'));
    return;
  }

  if (channel) await channel.send(createSimpleEmbed('Queue Ended', 'All songs played. Leaving voice channel.', INFO_COLOR, '👋'));
  player.destroy();
});

// ─── Client Ready ─────────────────────────────────────────────────────────────
client.on('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  try { riffy.init(client.user.id); } catch (e) { console.error('Riffy init failed:', e); }

  const activityTypes = {
    PLAYING: ActivityType.Playing, LISTENING: ActivityType.Listening,
    WATCHING: ActivityType.Watching, STREAMING: ActivityType.Streaming,
    COMPETING: ActivityType.Competing
  };
  client.user.setActivity(config.activity.name, {
    type: activityTypes[config.activity.type] ?? ActivityType.Listening
  });

  const commands = [
    { name: 'play',        description: 'Play a song',               options: [{ name: 'query',    description: 'Song name or URL', type: 3, required: true }] },
    { name: 'pause',       description: 'Pause the current song' },
    { name: 'resume',      description: 'Resume the paused song' },
    { name: 'skip',        description: 'Skip current song' },
    { name: 'stop',        description: 'Stop the player and clear queue' },
    { name: 'volume',      description: 'Set volume (1-100)',          options: [{ name: 'level',    description: 'Volume level', type: 4, required: true, min_value: 1, max_value: 100 }] },
    { name: 'queue',       description: 'Show the current queue' },
    { name: 'nowplaying',  description: 'Show currently playing song' },
    { name: 'shuffle',     description: 'Shuffle the queue' },
    { name: 'loop',        description: 'Toggle loop mode',            options: [{ name: 'mode',     description: 'Loop mode', type: 3, required: true, choices: [{ name: 'Off', value: 'none' }, { name: 'Track', value: 'track' }, { name: 'Queue', value: 'queue' }] }] },
    { name: 'remove',      description: 'Remove a song from queue',    options: [{ name: 'position', description: 'Position in queue', type: 4, required: true, min_value: 1 }] },
    { name: 'move',        description: 'Move a song in queue',        options: [{ name: 'from',     description: 'From position', type: 4, required: true, min_value: 1 }, { name: 'to', description: 'To position', type: 4, required: true, min_value: 1 }] },
    { name: 'clearqueue',  description: 'Clear the queue' },
    { name: '247',         description: 'Toggle 24/7 mode' },
    { name: 'autoplay',    description: 'Toggle autoplay mode' },
    { name: 'stats',       description: 'Show bot statistics' },
    { name: 'ping',        description: 'Show bot latency' },
    { name: 'invite',      description: 'Get bot invite link' },
    { name: 'support',     description: 'Get support server link' },
    { name: 'help',        description: 'Show all commands' }
  ];

  await client.application.commands.set(commands);
  console.log('✅ Slash commands registered');
});

// Only forward voice-related raw events to Riffy to prevent crashes from malformed payloads
client.on('raw', (d) => {
  if (d?.t === 'VOICE_STATE_UPDATE' || d?.t === 'VOICE_SERVER_UPDATE') {
    try { riffy.updateVoiceState(d); } catch (err) { console.error('Riffy updateVoiceState error:', err.message); }
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function requireVC(member, player, res) {
  if (!member.voice.channel) { res('❌ You need to be in a voice channel.'); return false; }
  if (player && member.voice.channel.id !== player.voiceChannel) { res('❌ You must be in the same voice channel as me.'); return false; }
  return true;
}

// ─── Button Handler ───────────────────────────────────────────────────────────
async function handleButtonInteraction(interaction) {
  const player = riffy.players.get(interaction.guildId);
  if (!player) return interaction.reply({ content: '❌ No active player.', ephemeral: true });

  const member = interaction.member;
  if (!member.voice.channel) return interaction.reply({ content: '❌ Join a voice channel first.', ephemeral: true });
  if (member.voice.channel.id !== player.voiceChannel) return interaction.reply({ content: '❌ Join my voice channel.', ephemeral: true });

  const updateNP = async () => {
    const npMsg = nowPlayingMessages.get(player.guildId);
    if (npMsg && player.current) await npMsg.edit(createNowPlayingEmbed(player, player.current)).catch(() => {});
  };

  try {
    switch (interaction.customId) {
      case 'pause':
      case 'resume': {
        const pausing = interaction.customId === 'pause';
        await player.pause(pausing);
        await updateNP();
        return interaction.reply({ content: pausing ? '⏸️ Paused.' : '▶️ Resumed.', ephemeral: true });
      }
      case 'skip': {
        if (player.current) await interaction.message.edit(createNowPlayingEmbed(player, player.current, true)).catch(() => {});
        player.stop();
        return interaction.reply({ content: '⏭️ Skipped.', ephemeral: true });
      }
      case 'stop': {
        if (player.current) await interaction.message.edit(createNowPlayingEmbed(player, player.current, true)).catch(() => {});
        nowPlayingMessages.delete(player.guildId);
        lastTrack.delete(player.guildId);
        player.destroy();
        return interaction.reply({ content: '⏹️ Stopped.', ephemeral: true });
      }
      case 'shuffle': {
        if (!player.queue?.length) return interaction.reply({ content: '❌ Queue is empty.', ephemeral: true });
        player.queue.shuffle();
        return interaction.reply({ content: '🔀 Queue shuffled!', ephemeral: true });
      }
      case 'loop': {
        const modes = ['none', 'track', 'queue'];
        const next = modes[(modes.indexOf(player.loop || 'none') + 1) % modes.length];
        player.setLoop(next);
        await updateNP();
        return interaction.reply({ content: `🔁 Loop: **${next === 'none' ? 'Off' : next}**`, ephemeral: true });
      }
      case 'autoplay': {
        if (autoplayEnabled.has(player.guildId)) autoplayEnabled.delete(player.guildId);
        else autoplayEnabled.add(player.guildId);
        await updateNP();
        return interaction.reply({ content: autoplayEnabled.has(player.guildId) ? '✅ Autoplay enabled.' : '❌ Autoplay disabled.', ephemeral: true });
      }
      case 'queue': {
        if (!player.queue?.length && !player.current) return interaction.reply({ content: '❌ Queue is empty.', ephemeral: true });
        return interaction.reply({ ...createQueueEmbed(player), ephemeral: true });
      }
      case 'volumeup': {
        const vol = Math.min((player.volume ?? 100) + 10, 100);
        player.setVolume(vol);
        await updateNP();
        return interaction.reply({ content: `🔊 Volume: **${vol}%**`, ephemeral: true });
      }
      case 'volumedown': {
        const vol = Math.max((player.volume ?? 100) - 10, 10);
        player.setVolume(vol);
        await updateNP();
        return interaction.reply({ content: `🔉 Volume: **${vol}%**`, ephemeral: true });
      }
    }
  } catch (err) {
    console.error('Button error:', err);
    if (!interaction.replied) interaction.reply({ content: '❌ Something went wrong.', ephemeral: true }).catch(() => {});
  }
}

// ─── Slash Command Handler ────────────────────────────────────────────────────
async function handleSlashCommand(interaction) {
  const { commandName, options, member, guild, channel } = interaction;
  const eph = { ephemeral: true };
  const replyErr = (msg) => interaction.reply({ content: msg, ...eph });

  try {
    if (commandName === 'play') {
      const query = options.getString('query');
      if (!member.voice.channel) return replyErr('❌ You need to be in a voice channel.');
      await interaction.deferReply();
      return handlePlay(
        guild.id, member.voice.channel.id, channel.id, query, member.user.id,
        (d) => interaction.editReply(typeof d === 'string' ? { content: d } : d),
        (d) => interaction.editReply(d)
      );
    }

    const skipPlayerCheck = ['stats', 'ping', 'invite', 'support', 'help', '247'];
    const player = !skipPlayerCheck.includes(commandName) ? riffy.players.get(guild.id) : null;

    switch (commandName) {
      case 'pause':
      case 'resume': {
        if (!player) return replyErr('❌ No player found.');
        if (!requireVC(member, player, replyErr)) return;
        await player.pause(commandName === 'pause');
        const npMsg = nowPlayingMessages.get(guild.id);
        if (npMsg && player.current) await npMsg.edit(createNowPlayingEmbed(player, player.current)).catch(() => {});
        return interaction.reply(createSimpleEmbed(
          commandName === 'pause' ? 'Paused' : 'Resumed',
          commandName === 'pause' ? 'Playback paused.' : 'Playback resumed.',
          commandName === 'pause' ? WARNING_COLOR : SUCCESS_COLOR,
          commandName === 'pause' ? '⏸️' : '▶️'
        ));
      }
      case 'skip': {
        if (!player) return replyErr('❌ No player found.');
        if (!requireVC(member, player, replyErr)) return;
        player.stop();
        return interaction.reply(createSimpleEmbed('Skipped', 'Moved to next track.', INFO_COLOR, '⏭️'));
      }
      case 'stop': {
        if (!player) return replyErr('❌ No player found.');
        if (!requireVC(member, player, replyErr)) return;
        nowPlayingMessages.delete(guild.id);
        lastTrack.delete(guild.id);
        player.destroy();
        return interaction.reply(createSimpleEmbed('Stopped', 'Player stopped and queue cleared.', ERROR_COLOR, '⏹️'));
      }
      case 'volume': {
        if (!player) return replyErr('❌ No player found.');
        if (!requireVC(member, player, replyErr)) return;
        const vol = options.getInteger('level');
        player.setVolume(vol);
        return interaction.reply(createSimpleEmbed('Volume', `Set to **${vol}%**`, SUCCESS_COLOR, '🔊'));
      }
      case 'queue': {
        if (!player) return replyErr('❌ No player found.');
        if (!player.queue.length && !player.current) return replyErr('❌ Queue is empty.');
        return interaction.reply(createQueueEmbed(player));
      }
      case 'nowplaying': {
        if (!player?.current) return replyErr('❌ Nothing is playing.');
        return interaction.reply(createNowPlayingEmbed(player, player.current));
      }
      case 'shuffle': {
        if (!player) return replyErr('❌ No player found.');
        if (!requireVC(member, player, replyErr)) return;
        if (!player.queue.length) return replyErr('❌ Queue is empty.');
        player.queue.shuffle();
        return interaction.reply(createSimpleEmbed('Shuffled', 'Queue has been shuffled.', SUCCESS_COLOR, '🔀'));
      }
      case 'loop': {
        if (!player) return replyErr('❌ No player found.');
        if (!requireVC(member, player, replyErr)) return;
        const mode = options.getString('mode');
        player.setLoop(mode);
        return interaction.reply(createSimpleEmbed('Loop', `Set to **${mode}**`, SUCCESS_COLOR, '🔁'));
      }
      case 'remove': {
        if (!player) return replyErr('❌ No player found.');
        if (!requireVC(member, player, replyErr)) return;
        const pos = options.getInteger('position') - 1;
        if (pos < 0 || pos >= player.queue.length) return replyErr('❌ Invalid position.');
        const removed = player.queue.remove(pos);
        return interaction.reply(createSimpleEmbed('Removed', `Removed **${removed.info.title}**`, SUCCESS_COLOR, '🗑️'));
      }
      case 'move': {
        if (!player) return replyErr('❌ No player found.');
        if (!requireVC(member, player, replyErr)) return;
        const from = options.getInteger('from') - 1;
        const to   = options.getInteger('to')   - 1;
        if (from < 0 || from >= player.queue.length || to < 0 || to >= player.queue.length) return replyErr('❌ Invalid positions.');
        const arr = [...player.queue];
        const [t] = arr.splice(from, 1);
        arr.splice(to, 0, t);
        player.queue.clear();
        for (const track of arr) player.queue.add(track);
        return interaction.reply(createSimpleEmbed('Moved', `Moved **${t.info.title}** to position ${to + 1}`, SUCCESS_COLOR, '↕️'));
      }
      case 'clearqueue': {
        if (!player) return replyErr('❌ No player found.');
        if (!requireVC(member, player, replyErr)) return;
        player.queue.clear();
        return interaction.reply(createSimpleEmbed('Cleared', 'Queue has been cleared.', SUCCESS_COLOR, '🗑️'));
      }
      case '247': {
        if (!member.voice.channel) return replyErr('❌ Join a voice channel first.');
        if (queue247.has(guild.id)) {
          queue247.delete(guild.id);
          return interaction.reply(createSimpleEmbed('24/7 Disabled', 'I will leave when queue ends.', INFO_COLOR, '🔕'));
        } else {
          queue247.add(guild.id);
          if (!riffy.players.get(guild.id)) riffy.createConnection({ guildId: guild.id, voiceChannel: member.voice.channel.id, textChannel: channel.id, deaf: true });
          return interaction.reply(createSimpleEmbed('24/7 Enabled', 'I will stay in VC indefinitely.', SUCCESS_COLOR, '🔔'));
        }
      }
      case 'autoplay': {
        if (!player) return replyErr('❌ No player found.');
        if (autoplayEnabled.has(guild.id)) {
          autoplayEnabled.delete(guild.id);
          return interaction.reply(createSimpleEmbed('Autoplay Off', 'Autoplay disabled.', ERROR_COLOR, '❌'));
        } else {
          autoplayEnabled.add(guild.id);
          return interaction.reply(createSimpleEmbed('Autoplay On', 'Autoplay enabled.', SUCCESS_COLOR, '✅'));
        }
      }
      case 'stats':   return interaction.reply(createStatsEmbed());
      case 'ping':    return interaction.reply(createSimpleEmbed('Pong!', `Latency: \`${client.ws.ping}ms\``, INFO_COLOR, '🏓'));
      case 'invite': {
        const url = `https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=3165184&scope=bot%20applications.commands`;
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Invite').setStyle(ButtonStyle.Link).setURL(url));
        return interaction.reply({ ...createSimpleEmbed('Invite', `[Click here to add me!](${url})`, SUCCESS_COLOR, '🔗'), components: [row] });
      }
      case 'support': {
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Support').setStyle(ButtonStyle.Link).setURL(config.supportServer));
        return interaction.reply({ ...createSimpleEmbed('Support', `[Join the support server!](${config.supportServer})`, INFO_COLOR, '💬'), components: [row] });
      }
      case 'help': return interaction.reply(createHelpEmbed());
    }
  } catch (err) {
    console.error(`Slash error [${commandName}]:`, err);
    const errReply = { content: '❌ An error occurred.', ephemeral: true };
    if (interaction.deferred) await interaction.editReply(errReply).catch(() => {});
    else if (!interaction.replied) await interaction.reply(errReply).catch(() => {});
  }
}

// ─── Prefix Command Handler ───────────────────────────────────────────────────
async function handlePrefixCommand(message, command, args) {
  const guild  = message.guild;
  const member = message.member;
  const replyErr = (msg) => message.reply(msg);

  try {
    if (command === 'play') {
      const query = args.join(' ');
      if (!query) return replyErr('❌ Provide a song name or URL.');
      if (!member.voice.channel) return replyErr('❌ Join a voice channel first.');
      const sent = await message.reply('🔍 Searching...');
      const editReply = async (d) => typeof d === 'string'
        ? sent.edit({ content: d, embeds: [], components: [] })
        : sent.edit({ content: '', ...d });
      return handlePlay(
        guild.id, member.voice.channel.id, message.channel.id, query, message.author.id,
        (d) => sent.edit(typeof d === 'string' ? { content: d, embeds: [], components: [] } : d),
        editReply
      );
    }

    const player = riffy.players.get(guild.id);

    switch (command) {
      case 'pause':
      case 'resume': {
        if (!player) return replyErr('❌ No player found.');
        if (!requireVC(member, player, replyErr)) return;
        await player.pause(command === 'pause');
        const npMsg = nowPlayingMessages.get(guild.id);
        if (npMsg && player.current) await npMsg.edit(createNowPlayingEmbed(player, player.current)).catch(() => {});
        return message.reply(createSimpleEmbed(
          command === 'pause' ? 'Paused' : 'Resumed',
          command === 'pause' ? 'Playback paused.' : 'Playback resumed.',
          command === 'pause' ? WARNING_COLOR : SUCCESS_COLOR,
          command === 'pause' ? '⏸️' : '▶️'
        ));
      }
      case 'skip': {
        if (!player) return replyErr('❌ No player found.');
        if (!requireVC(member, player, replyErr)) return;
        player.stop();
        return message.reply(createSimpleEmbed('Skipped', 'Moved to next track.', INFO_COLOR, '⏭️'));
      }
      case 'stop': {
        if (!player) return replyErr('❌ No player found.');
        if (!requireVC(member, player, replyErr)) return;
        nowPlayingMessages.delete(guild.id);
        lastTrack.delete(guild.id);
        player.destroy();
        return message.reply(createSimpleEmbed('Stopped', 'Player stopped.', ERROR_COLOR, '⏹️'));
      }
      case 'volume': {
        if (!player) return replyErr('❌ No player found.');
        if (!requireVC(member, player, replyErr)) return;
        const vol = parseInt(args[0]);
        if (isNaN(vol) || vol < 1 || vol > 100) return replyErr('❌ Provide a volume between 1–100.');
        player.setVolume(vol);
        return message.reply(createSimpleEmbed('Volume', `Set to **${vol}%**`, SUCCESS_COLOR, '🔊'));
      }
      case 'queue': {
        if (!player) return replyErr('❌ No player found.');
        if (!player.queue.length && !player.current) return replyErr('❌ Queue is empty.');
        return message.reply(createQueueEmbed(player));
      }
      case 'nowplaying': {
        if (!player?.current) return replyErr('❌ Nothing is playing.');
        return message.reply(createNowPlayingEmbed(player, player.current));
      }
      case 'shuffle': {
        if (!player) return replyErr('❌ No player found.');
        if (!requireVC(member, player, replyErr)) return;
        if (!player.queue.length) return replyErr('❌ Queue is empty.');
        player.queue.shuffle();
        return message.reply(createSimpleEmbed('Shuffled', 'Queue has been shuffled.', SUCCESS_COLOR, '🔀'));
      }
      case 'loop': {
        if (!player) return replyErr('❌ No player found.');
        if (!requireVC(member, player, replyErr)) return;
        const mode = args[0] || 'none';
        if (!['none', 'track', 'queue'].includes(mode)) return replyErr('❌ Use: `none`, `track`, or `queue`');
        player.setLoop(mode);
        return message.reply(createSimpleEmbed('Loop', `Set to **${mode}**`, SUCCESS_COLOR, '🔁'));
      }
      case 'remove': {
        if (!player) return replyErr('❌ No player found.');
        if (!requireVC(member, player, replyErr)) return;
        const pos = parseInt(args[0]) - 1;
        if (isNaN(pos) || pos < 0 || pos >= player.queue.length) return replyErr('❌ Invalid position.');
        const removed = player.queue.remove(pos);
        return message.reply(createSimpleEmbed('Removed', `Removed **${removed.info.title}**`, SUCCESS_COLOR, '🗑️'));
      }
      case 'move': {
        if (!player) return replyErr('❌ No player found.');
        if (!requireVC(member, player, replyErr)) return;
        const from = parseInt(args[0]) - 1;
        const to   = parseInt(args[1]) - 1;
        if (isNaN(from) || isNaN(to) || from < 0 || from >= player.queue.length || to < 0 || to >= player.queue.length) return replyErr('❌ Invalid positions.');
        const arr = [...player.queue];
        const [t] = arr.splice(from, 1);
        arr.splice(to, 0, t);
        player.queue.clear();
        for (const track of arr) player.queue.add(track);
        return message.reply(createSimpleEmbed('Moved', `Moved **${t.info.title}** to position ${to + 1}`, SUCCESS_COLOR, '↕️'));
      }
      case 'clearqueue': {
        if (!player) return replyErr('❌ No player found.');
        if (!requireVC(member, player, replyErr)) return;
        player.queue.clear();
        return message.reply(createSimpleEmbed('Cleared', 'Queue cleared.', SUCCESS_COLOR, '🗑️'));
      }
      case '247': {
        if (!member.voice.channel) return replyErr('❌ Join a voice channel first.');
        if (queue247.has(guild.id)) {
          queue247.delete(guild.id);
          return message.reply(createSimpleEmbed('24/7 Off', 'Disabled.', INFO_COLOR, '🔕'));
        } else {
          queue247.add(guild.id);
          if (!riffy.players.get(guild.id)) riffy.createConnection({ guildId: guild.id, voiceChannel: member.voice.channel.id, textChannel: message.channel.id, deaf: true });
          return message.reply(createSimpleEmbed('24/7 On', 'Staying in VC indefinitely.', SUCCESS_COLOR, '🔔'));
        }
      }
      case 'autoplay': {
        if (!player) return replyErr('❌ No player found.');
        if (autoplayEnabled.has(guild.id)) {
          autoplayEnabled.delete(guild.id);
          return message.reply(createSimpleEmbed('Autoplay Off', 'Disabled.', ERROR_COLOR, '❌'));
        } else {
          autoplayEnabled.add(guild.id);
          return message.reply(createSimpleEmbed('Autoplay On', 'Enabled.', SUCCESS_COLOR, '✅'));
        }
      }
      case 'stats':  return message.reply(createStatsEmbed());
      case 'ping':   return message.reply(createSimpleEmbed('Pong!', `Latency: \`${client.ws.ping}ms\``, INFO_COLOR, '🏓'));
      case 'invite': {
        const url = `https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=3165184&scope=bot%20applications.commands`;
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Invite').setStyle(ButtonStyle.Link).setURL(url));
        return message.reply({ ...createSimpleEmbed('Invite', `[Click here!](${url})`, SUCCESS_COLOR, '🔗'), components: [row] });
      }
      case 'support': {
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Support').setStyle(ButtonStyle.Link).setURL(config.supportServer));
        return message.reply({ ...createSimpleEmbed('Support', `[Join here!](${config.supportServer})`, INFO_COLOR, '💬'), components: [row] });
      }
      case 'help': return message.reply(createHelpEmbed());
    }
  } catch (err) {
    console.error(`Prefix error [${command}]:`, err);
    message.reply('❌ An error occurred.').catch(() => {});
  }
}

// ─── Interaction Router ───────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton()) return handleButtonInteraction(interaction);
  if (interaction.isChatInputCommand()) return handleSlashCommand(interaction);
});

// ─── Prefix Message Handler ───────────────────────────────────────────────────
if (config.enablePrefix) {
  client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    const content = message.content.trim();
    const mentionRegex = new RegExp(`^<@!?${client.user.id}>\\s*`);

    if (mentionRegex.test(content)) {
      const rest  = content.replace(mentionRegex, '').trim();
      const lower = rest.toLowerCase();

      if (lower === 'join') {
        if (!message.member.voice.channel) return message.reply('❌ Join a voice channel first!');
        let player = riffy.players.get(message.guild.id);
        if (!player) player = riffy.createConnection({ guildId: message.guild.id, voiceChannel: message.member.voice.channel.id, textChannel: message.channel.id, deaf: true });
        return message.reply(createSimpleEmbed('Joined', `Connected to **${message.member.voice.channel.name}**`, SUCCESS_COLOR, '🎤'));
      }

      if (rest.length > 0) {
        if (!message.member.voice.channel) return message.reply('❌ Join a voice channel first!');
        const words = rest.split(/\s+/);
        const first = words[0].toLowerCase();
        let query = (first === 'play' || first === 'p') ? words.slice(1).join(' ').trim() : rest;
        if (!query) return message.reply('❌ Provide a song name! Example: `@bot Believer`');

        const sent = await message.reply(`🔍 Searching: **${query}**...`);
        const editReply = (d) => typeof d === 'string'
          ? sent.edit({ content: d, embeds: [], components: [] })
          : sent.edit({ content: '', ...d });

        return handlePlay(
          message.guild.id, message.member.voice.channel.id,
          message.channel.id, query, message.author.id, editReply, editReply
        ).catch(err => sent.edit(`❌ Failed: ${err.message}`).catch(() => {}));
      }
      return;
    }

    if (!content.startsWith(config.prefix)) return;

    const args = content.slice(config.prefix.length).trim().split(/ +/);
    let command = args.shift().toLowerCase();

    for (const [cmd, aliases] of Object.entries(config.aliases || {})) {
      if (aliases.includes(command)) { command = cmd; break; }
    }

    return handlePrefixCommand(message, command, args);
  });
}

// ─── Login ────────────────────────────────────────────────────────────────────
client.login(config.token);
