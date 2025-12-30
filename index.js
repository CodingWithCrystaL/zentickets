const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  ChannelType,
  TextInputBuilder,
  TextInputStyle,
  ModalBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  ActivityType
} = require("discord.js");
const math = require("mathjs");
const fs = require("fs");
const express = require("express");
const os = require("os");

// ---------- Get token from environment variable first, fallback to config.json ----------
let config;
try {
  config = require("./config.json");
} catch (error) {
  console.error("❌ config.json not found or invalid!");
  process.exit(1);
}

// Use environment variable BOT_TOKEN if available, otherwise use config.json
const BOT_TOKEN = process.env.BOT_TOKEN || config.token;

if (!BOT_TOKEN) {
  console.error("❌ Bot token not found! Set BOT_TOKEN environment variable or add token to config.json");
  process.exit(1);
}

// Use config.json for all other settings
const OWNERS = Array.isArray(config.owners) ? config.owners : [config.ownerId].filter(Boolean);
const SUPPORT_ROLE = config.supportRole;
const SHOP_CATEGORY = config.shopCategory;
const SUPPORT_CATEGORY = config.supportCategory;
const TRANSCRIPT_CHANNEL = config.transcriptChannel;
const CUSTOMER_ROLE_ID = config.customerRoleId || "1375877638450577450";

// ---------- File paths / persistence ----------
const teamPath = "./team.json";
const warningsPath = "./warnings.json";
const modlogPath = "./modlog.json";
const autoresPath = "./autores.json";

function ensureFile(path, fallback = {}) {
  if (!fs.existsSync(path)) fs.writeFileSync(path, JSON.stringify(fallback, null, 2));
  return JSON.parse(fs.readFileSync(path, "utf8"));
}
function saveFile(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

let team = ensureFile(teamPath, {});
let warnings = ensureFile(warningsPath, {});
let modlogs = ensureFile(modlogPath, {});
let autores = ensureFile(autoresPath, {});

// ---------- Express keep-alive ----------
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Discord Bot - Online</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          height: 100vh;
          display: flex;
          justify-content: center;
          align-items: center;
          color: white;
          text-align: center;
        }
        .container {
          background: rgba(0, 0, 0, 0.7);
          padding: 2rem;
          border-radius: 10px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        }
        h1 {
          margin: 0 0 1rem 0;
        }
        .status {
          display: inline-block;
          width: 10px;
          height: 10px;
          background: #4CAF50;
          border-radius: 50%;
          margin-right: 10px;
          animation: pulse 2s infinite;
        }
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.5; }
          100% { opacity: 1; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🤖 Discord Bot Status</h1>
        <p><span class="status"></span> Bot is running and ready!</p>
        <p>Made by Kai</p>
      </div>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`✅ KeepAlive server running on port ${PORT}`);
});

// ---------- Config ----------
const prefix = ",";

// ---------- Client ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel, Partials.GuildMember, Partials.Message]
});

// ---------- Crash protection ----------
process.on("unhandledRejection", console.error);
process.on("uncaughtException", console.error);

// ---------- Helpers ----------
function parseTime(str) {
  const match = /^(\d+)(s|m|h|d)$/.exec(str);
  if (!match) return null;
  const n = Number(match[1]);
  const u = match[2];
  const mul = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return n * mul[u];
}
function msParse(str) {
  const m = /^(\d+)(s|m|h|d)?$/.exec(str);
  if (!m) return null;
  const num = Number(m[1]);
  const unit = m[2] || "m";
  const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return num * mult[unit];
}
function isSupport(member) {
  if (!member || !member.roles) return false;
  return member.roles.cache.has(SUPPORT_ROLE);
}
function sendModLog(guild, embed) {
  try {
    const channelId = modlogs[guild.id];
    if (!channelId) return;
    const ch = guild.channels.cache.get(channelId);
    if (ch && ch.send) ch.send({ embeds: [embed] }).catch(() => {});
  } catch (err) {}
}
function simpleEmbed(title, desc, color = "#000000") {
  return new EmbedBuilder().setTitle(title).setDescription(desc).setColor(color).setTimestamp();
}
function cleanInput(text) {
  if (!text) return "";
  const cleaned = text.toLowerCase().replace(/[^a-z0-9]/gi, "").slice(0, 25);
  return cleaned;
}
function isTicketChannel(channel) {
  return channel.parentId && [SHOP_CATEGORY, SUPPORT_CATEGORY].includes(channel.parentId);
}

// ---------- Autoresponse helpers ----------
function ensureGuildAutores(guildId) {
  if (!autores[guildId]) autores[guildId] = { enabled: true, responses: {} };
  return autores[guildId];
}

function findMatchingResponse(guildId, messageContent) {
  const g = autores[guildId];
  if (!g || !g.enabled) return null;
  const text = messageContent.toLowerCase();
  for (const trigger of Object.keys(g.responses || {})) {
    try {
      if (trigger.startsWith("/") && trigger.endsWith("/")) {
        const pattern = new RegExp(trigger.slice(1, -1), "i");
        if (pattern.test(messageContent)) return g.responses[trigger];
      } else {
        if (text.includes(trigger.toLowerCase())) return g.responses[trigger];
      }
    } catch (e) {
      continue;
    }
  }
  return null;
}

// ---------- Status rotation ----------
const statuses = [
  "I put the 'pro' in procrastination",
  "Sarcasm is my love language",
  "I'm not arguing, I'm explaining why I'm right",
  "I'm silently correcting your grammar",
  "I love deadlines. I love the whooshing sound they make as they fly by",
  "whispering into the static",
  "counting the seconds between heartbeats",
  "weaving dreams into paper",
  "the shadow behind the curtain hums",
  "feeding the ticks inside the clock",
  "listening for footsteps that never came",
  "smiling with no face",
  "collecting lost names"
];
let statusIndex = 0;

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`✅ Using token from: ${process.env.BOT_TOKEN ? 'Environment Variable' : 'config.json'}`);

  // Status rotation
  setInterval(() => {
    try {
      client.user.setActivity(statuses[statusIndex], { type: ActivityType.Watching });
    } catch (err) {
      console.error("Status error:", err);
    }
    statusIndex = (statusIndex + 1) % statuses.length;
  }, 30000);

  // Register slash commands
  const commands = [
    new SlashCommandBuilder().setName("sendpanel").setDescription("Send the main ticket panel"),
    new SlashCommandBuilder().setName("close").setDescription("Close the current ticket")
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log("✅ Slash commands registered");
  } catch (e) {
    console.error("❌ Failed to register slash commands:", e);
  }
});

// ---------- Snipe store ----------
const snipes = new Map();
client.on("messageDelete", (message) => {
  try {
    if (message.partial) return;
    if (!message.content && message.attachments.size === 0) return;
    snipes.set(message.channel.id, {
      content: message.content || null,
      authorTag: message.author ? message.author.tag : "Unknown",
      avatar: message.author ? message.author.displayAvatarURL() : null,
      image: message.attachments.first()?.proxyURL || null,
      time: Date.now()
    });
  } catch {}
});

// ---------- Command Handler ----------
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  // AUTORESPONSE: check first
  try {
    const reply = findMatchingResponse(message.guild.id, message.content);
    if (reply) {
      await message.reply({ content: reply }).catch(() => {});
      return;
    }
  } catch (e) {
    console.error("Autoresponse error:", e);
  }

  // Handle ticket commands first
  const args = message.content.trim().split(/\s+/);
  const cmd = args.shift().toLowerCase();

  // Ticket commands
  if (cmd === ",done") {
    if (!message.member.roles.cache.has(SUPPORT_ROLE))
      return message.reply("❌ Only support team can use this.");
    await handleTicketDone(message.channel);
    return;
  }

  if (cmd === ",close") {
    if (!message.member.roles.cache.has(SUPPORT_ROLE))
      return message.reply("❌ Only support team can use this.");
    await handleTicketClose(message.channel, message.member);
    return;
  }

  if (cmd === ",add") {
    if (!message.member.roles.cache.has(SUPPORT_ROLE))
      return message.reply("❌ Only support team can use this.");
    const user = message.mentions.members.first();
    if (!user) return message.reply("❌ Mention a user to add.");
    if (!isTicketChannel(message.channel))
      return message.reply("❌ Use this inside a ticket channel.");

    await message.channel.permissionOverwrites.edit(user.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true
    });
    message.reply(`✅ Added ${user} to this ticket.`);
    return;
  }

  if (cmd === ",rename") {
    if (!message.member.roles.cache.has(SUPPORT_ROLE))
      return message.reply("❌ Only support team can use this.");
    const newName = cleanInput(args.join(" "));
    if (!newName) return message.reply("❌ Provide a valid new name.");
    if (!isTicketChannel(message.channel))
      return message.reply("❌ Use this inside a ticket channel.");

    await message.channel.setName(newName).catch(() => {});
    message.reply(`✅ Renamed ticket to **${newName}**`);
    return;
  }

  // Original command handler
  if (!message.content.startsWith(prefix)) return;

  const commandArgs = message.content.slice(prefix.length).trim().split(/ +/);
  const command = (commandArgs.shift() || "").toLowerCase();

  const ownerOnly = ["addaddy", "broadcast"];
  const supportRequired = [
    "calc","upi","ltc","usdt","vouch","remind","userinfo","stats","ping",
    "notify","clear","nuke","snipe","lock","unlock","slowmode","warn","kick","ban","unban",
    "mute","unmute","warnings","clearwarnings","serverinfo","say","poll","avatar","modlog","help"
  ];

  // Multi-owner check
  if (ownerOnly.includes(command) && !OWNERS.includes(message.author.id)) {
    return message.reply("❌ You are not allowed to use that command.");
  }

  if (supportRequired.includes(command)) {
    if (message.guild) {
      if (!isSupport(message.member)) return message.reply("❌ Only support role can use this command.");
    } else {
      return message.reply("❌ This command can't be used in DMs.");
    }
  }

  // ---------------- Commands ----------------

  // AUTORESPONSE MANAGEMENT
  if (command === "autoresponse" || command === "autoresponses") {
    const sub = (commandArgs.shift() || "").toLowerCase();
    if (!isSupport(message.member) && !OWNERS.includes(message.author.id))
      return message.reply("❌ Only support team or owners can manage autoresponses.");

    if (sub === "add") {
      const trigger = commandArgs.shift();
      const reply = commandArgs.join(" ");
      if (!trigger || !reply) return message.reply("Usage: ,autoresponse add <trigger> <reply>");
      const g = ensureGuildAutores(message.guild.id);
      g.responses[trigger] = reply;
      autores[message.guild.id] = g;
      saveFile(autoresPath, autores);
      return message.reply(`✅ Added autoresponse for trigger: \`${trigger}\``);
    }

    if (sub === "remove" || sub === "rm") {
      const trigger = commandArgs.shift();
      if (!trigger) return message.reply("Usage: ,autoresponse remove <trigger>");
      const g = ensureGuildAutores(message.guild.id);
      if (!g.responses[trigger]) return message.reply("❌ That trigger does not exist.");
      delete g.responses[trigger];
      autores[message.guild.id] = g;
      saveFile(autoresPath, autores);
      return message.reply(`✅ Removed autoresponse for trigger: \`${trigger}\``);
    }

    if (sub === "list") {
      const g = ensureGuildAutores(message.guild.id);
      const keys = Object.keys(g.responses || {});
      if (!keys.length) return message.reply("✅ No autoresponses set for this server.");
      const lines = keys.map(k => `• \`${k}\` → ${g.responses[k].slice(0, 150)}`).join("\n");
      return message.reply({ embeds: [simpleEmbed("Autoresponses", lines)] });
    }

    if (sub === "toggle") {
      const g = ensureGuildAutores(message.guild.id);
      g.enabled = !g.enabled;
      autores[message.guild.id] = g;
      saveFile(autoresPath, autores);
      return message.reply(`✅ Autoresponses are now **${g.enabled ? "ENABLED" : "DISABLED"}**`);
    }

    return message.reply("Usage: ,autoresponse <add|remove|list|toggle>");
  }

  // CALC
  if (command === "calc") {
    const expr = commandArgs.join(" ");
    if (!expr) return message.reply("Usage: ,calc <expression>");
    try {
      const res = math.evaluate(expr);
      return message.reply({ embeds: [simpleEmbed("Calculator", `\`${expr}\` → **${res}**`)] });
    } catch {
      return message.reply("❌ Invalid expression.");
    }
  }

  // PAYMENT SHOW - upi, ltc, usdt
  if (["upi", "ltc", "usdt"].includes(command)) {
    const data = team[message.author.id];
    if (!data || !data[command]) return message.reply("❌ No saved address found.");
    const embed = new EmbedBuilder()
      .setTitle(`${command.toUpperCase()} Address`)
      .setDescription(`\`\`\`${data[command]}\`\`\``)
      .setColor("#000000")
      .setFooter({ text: `${message.guild ? message.guild.name : "DM"} | Made by Kai` });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("Copy Address").setStyle(ButtonStyle.Secondary).setCustomId(`copy-${command}-${message.author.id}`)
    );
    return message.reply({ embeds: [embed], components: [row] });
  }

  // VOUCH
  if (command === "vouch") {
    if (commandArgs.length < 2) return message.reply("Usage: ,vouch <product> <price>");
    const price = commandArgs.pop();
    const product = commandArgs.join(" ");
    const embed = new EmbedBuilder()
      .setDescription(`+rep ${message.author.id} | Legit Purchased **${product}** for **${price}**`)
      .setColor("#000000")
      .setFooter({ text: `${message.guild ? message.guild.name : "DM"} | Made by Kai` });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("Copy Vouch").setStyle(ButtonStyle.Secondary).setCustomId(`copy-vouch-${message.author.id}`)
    );
    return message.reply({ embeds: [embed], components: [row] });
  }

  // REMIND
  if (command === "remind") {
    const user = message.mentions.users.first();
    const delay = parseTime(commandArgs[0]);
    const msg = commandArgs.slice(1).join(" ");
    if (!user || !delay || !msg) return message.reply("Usage: ,remind @user 10s message");
    message.reply(`✅ Reminder set for ${user.tag} in ${commandArgs[0]}`);
    setTimeout(() => {
      user.send(`⏰ Reminder: ${msg}`).catch(() => {});
    }, delay);
    return;
  }

  // ADD ADDY
  if (command === "addaddy") {
    if (commandArgs.length < 3) return message.reply("Usage: ,addaddy USERID TYPE ADDRESS");
    const [userId, type, ...addrArr] = commandArgs;
    const address = addrArr.join(" ");
    const t = type.toLowerCase();
    if (!["upi", "ltc", "usdt"].includes(t)) return message.reply("Type must be upi/ltc/usdt");
    if (!team[userId]) team[userId] = {};
    team[userId][t] = address;
    saveFile(teamPath, team);
    return message.reply(`✅ Saved ${t.toUpperCase()} for <@${userId}>: \`${address}\``);
  }

  // SHOW ADDY
  if (command === "showaddy") {
    const id = commandArgs[0] || message.author.id;
    const data = team[id];
    if (!data) return message.reply("❌ No addresses for that user.");
    const lines = Object.entries(data).map(([k, v]) => `**${k.toUpperCase()}**: \`${v}\``).join("\n");
    return message.reply({ embeds: [new EmbedBuilder().setTitle(`Addresses for ${id}`).setDescription(lines).setColor("#000000")] });
  }

  // STATS
  if (command === "stats") {
    const embed = new EmbedBuilder()
      .setTitle("Bot Stats")
      .setColor("#000000")
      .setDescription(`**Guilds:** ${client.guilds.cache.size}\n**Users:** ${client.users.cache.size}\n**Uptime:** ${Math.floor(client.uptime / 1000 / 60)} mins\n**Memory:** ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB\n**Platform:** ${os.platform()} ${os.arch()}`)
      .setFooter({ text: "Made by Kai" });
    return message.reply({ embeds: [embed] });
  }

  // PING
  if (command === "ping") {
    const m = await message.reply("🏓 Pinging...");
    return m.edit(`🏓 Pong! Latency: ${m.createdTimestamp - message.createdTimestamp}ms | API: ${Math.round(client.ws.ping)}ms`);
  }

  // USERINFO
  if (command === "userinfo") {
    const user = message.mentions.users.first() || message.author;
    const member = message.guild.members.cache.get(user.id) || await message.guild.members.fetch(user.id).catch(() => null);
    const embed = new EmbedBuilder()
      .setTitle(`User Info: ${user.tag}`)
      .setThumbnail(user.displayAvatarURL({ dynamic: true }))
      .setColor("#000000")
      .addFields(
        { name: "User ID", value: user.id, inline: true },
        { name: "Bot?", value: user.bot ? "Yes" : "No", inline: true },
        { name: "Status", value: member?.presence?.status || "offline", inline: true },
        { name: "Joined Server", value: member ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : "N/A", inline: true },
        { name: "Account Created", value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true }
      )
      .setFooter({ text: `${message.guild ? message.guild.name : "DM"} | Made by Kai` });
    return message.reply({ embeds: [embed] });
  }

  // NOTIFY
  if (command === "notify") {
    const user = message.mentions.users.first();
    const msg = commandArgs.slice(1).join(" ");
    if (!user || !msg) return message.reply("Usage: ,notify @user message");
    const channelLink = message.channel.toString();
    user.send(`📢 You have been notified by **${message.author.tag}** in ${channelLink}:\n\n${msg}`).catch(() => {});
    return message.reply(`✅ ${user.tag} has been notified.`);
  }

  // BROADCAST
  if (command === "broadcast") {
    const msg = commandArgs.join(" ");
    if (!msg) return message.reply("Usage: ,broadcast message");
    message.guild.members.cache.forEach(member => {
      if (!member.user.bot) member.send(`📣 Broadcast from **${message.guild.name}**:\n\n${msg}`).catch(() => {});
    });
    return message.reply("✅ Broadcast sent to all members.");
  }

  // CLEAR
  if (command === "clear") {
    const amount = parseInt(commandArgs[0]);
    if (!amount || amount < 1 || amount > 100) return message.reply("Usage: ,clear <1-100>");
    await message.channel.bulkDelete(amount, true).catch(() => message.reply("❌ Unable to delete messages."));
    const embed = simpleEmbed("Clear", `${message.author.tag} deleted ${amount} messages in ${message.channel}`);
    sendModLog(message.guild, embed);
    return message.reply(`✅ Deleted ${amount} messages`).then(msg => setTimeout(() => msg.delete().catch(() => {}), 3000));
  }

  // NUKE
  if (command === "nuke") {
    const channel = message.channel;
    const position = channel.position;
    const parent = channel.parent;
    await channel.clone().then(newCh => {
      newCh.setPosition(position).catch(() => {});
      newCh.setParent(parent).catch(() => {});
      channel.delete().catch(() => {});
    });
    return;
  }

  // LOCK
  if (command === "lock") {
    message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false }).catch(() => {});
    return message.reply("🔒 Channel locked.");
  }

  // UNLOCK
  if (command === "unlock") {
    message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: true }).catch(() => {});
    return message.reply("🔓 Channel unlocked.");
  }

  // SLOWMODE
  if (command === "slowmode") {
    const time = parseInt(commandArgs[0]);
    if (isNaN(time) || time < 0 || time > 21600) return message.reply("Usage: ,slowmode <seconds> (0–21600)");
    message.channel.setRateLimitPerUser(time).catch(() => message.reply("❌ Unable to set slowmode."));
    return message.reply(`✅ Slowmode set to ${time} seconds.`);
  }

  // WARN
  if (command === "warn") {
    const user = message.mentions.users.first();
    const reason = commandArgs.slice(1).join(" ") || "No reason provided.";
    if (!user) return message.reply("Usage: ,warn @user reason");
    if (!warnings[user.id]) warnings[user.id] = [];
    warnings[user.id].push({ reason, by: message.author.id, time: Date.now() });
    saveFile(warningsPath, warnings);
    sendModLog(message.guild, simpleEmbed("Warn", `${user.tag} warned by ${message.author.tag}\nReason: ${reason}`));
    return message.reply(`✅ ${user.tag} has been warned.`);
  }

  // WARNINGS
  if (command === "warnings") {
    const user = message.mentions.users.first() || message.author;
    const data = warnings[user.id] || [];
    if (!data.length) return message.reply("✅ No warnings.");
    const lines = data.map((w, i) => `**${i+1}.** ${w.reason} (by <@${w.by}>)`).join("\n");
    return message.reply({ embeds: [simpleEmbed("Warnings", lines)] });
  }

  // CLEARWARNINGS
  if (command === "clearwarnings") {
    const user = message.mentions.users.first();
    if (!user) return message.reply("Usage: ,clearwarnings @user");
    warnings[user.id] = [];
    saveFile(warningsPath, warnings);
    return message.reply(`✅ Cleared all warnings for ${user.tag}`);
  }

  // KICK
  if (command === "kick") {
    const user = message.mentions.users.first();
    if (!user) return message.reply("Usage: ,kick @user");
    const member = message.guild.members.cache.get(user.id) || await message.guild.members.fetch(user.id).catch(() => null);
    if (!member) return message.reply("❌ Member not found.");
    if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.KickMembers)) {
      return message.reply("❌ I don't have permission to kick.");
    }
    await member.kick("Kicked by bot").catch(() => message.reply("❌ Failed to kick."));
    sendModLog(message.guild, simpleEmbed("Kick", `${user.tag} was kicked by ${message.author.tag}`));
    return message.reply(`✅ ${user.tag} has been kicked.`);
  }

  // BAN
  if (command === "ban") {
    const user = message.mentions.users.first();
    if (!user) return message.reply("Usage: ,ban @user");
    const member = message.guild.members.cache.get(user.id) || await message.guild.members.fetch(user.id).catch(() => null);
    if (!member) return message.reply("❌ Member not found.");
    if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
      return message.reply("❌ I don't have permission to ban.");
    }
    await member.ban({ reason: "Banned by bot" }).catch(() => message.reply("❌ Failed to ban."));
    sendModLog(message.guild, simpleEmbed("Ban", `${user.tag} was banned by ${message.author.tag}`));
    return message.reply(`✅ ${user.tag} has been banned.`);
  }

  // UNBAN
  if (command === "unban") {
    const userId = commandArgs[0];
    if (!userId) return message.reply("Usage: ,unban USER_ID");
    if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
      return message.reply("❌ I don't have permission to unban.");
    }
    await message.guild.bans.remove(userId).catch(() => message.reply("❌ Failed to unban."));
    return message.reply(`✅ Unbanned ${userId}`);
  }

  // MUTE
  if (command === "mute") {
    const user = message.mentions.users.first();
    if (!user) return message.reply("Usage: ,mute @user");
    const member = message.guild.members.cache.get(user.id) || await message.guild.members.fetch(user.id).catch(() => null);
    if (!member) return message.reply("❌ Member not found.");
    if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.MuteMembers)) {
      return message.reply("❌ I don't have permission to mute.");
    }
    await member.voice.setMute(true, "Muted by bot").catch(() => message.reply("❌ Failed to mute."));
    sendModLog(message.guild, simpleEmbed("Mute", `${user.tag} was muted by ${message.author.tag}`));
    return message.reply(`✅ ${user.tag} has been muted.`);
  }

  // UNMUTE
  if (command === "unmute") {
    const user = message.mentions.users.first();
    if (!user) return message.reply("Usage: ,unmute @user");
    const member = message.guild.members.cache.get(user.id) || await message.guild.members.fetch(user.id).catch(() => null);
    if (!member) return message.reply("❌ Member not found.");
    if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.MuteMembers)) {
      return message.reply("❌ I don't have permission to unmute.");
    }
    await member.voice.setMute(false, "Unmuted by bot").catch(() => message.reply("❌ Failed to unmute."));
    sendModLog(message.guild, simpleEmbed("Unmute", `${user.tag} was unmuted by ${message.author.tag}`));
    return message.reply(`✅ ${user.tag} has been unmuted.`);
  }

  // MODLOG
  if (command === "modlog") {
    const ch = message.mentions.channels.first();
    if (!ch) return message.reply("Usage: ,modlog #channel");
    modlogs[message.guild.id] = ch.id;
    saveFile(modlogPath, modlogs);
    return message.reply(`✅ Modlog set to ${ch.name}`);
  }

  // SERVERINFO
  if (command === "serverinfo") {
    const g = message.guild;
    const embed = new EmbedBuilder()
      .setTitle("Server Info")
      .setDescription(g.description || "No description")
      .setColor("#000000")
      .addFields(
        { name: "Name", value: g.name, inline: true },
        { name: "Members", value: `${g.memberCount}`, inline: true },
        { name: "Owner", value: `${g.ownerId}`, inline: true },
        { name: "Created", value: `<t:${Math.floor(g.createdTimestamp / 1000)}:R>`, inline: true }
      );
    return message.reply({ embeds: [embed] });
  }

  // SAY
  if (command === "say") {
    const msg = commandArgs.join(" ");
    if (!msg) return message.reply("Usage: ,say message");
    return message.channel.send(msg);
  }

  // POLL
  if (command === "poll") {
    const question = commandArgs.join(" ");
    if (!question) return message.reply("Usage: ,poll question");
    const embed = new EmbedBuilder().setTitle("Poll").setDescription(question).setColor("#000000");
    const msg = await message.channel.send({ embeds: [embed] });
    await msg.react("✅");
    await msg.react("❌");
    return;
  }

  // AVATAR
  if (command === "avatar") {
    const user = message.mentions.users.first() || message.author;
    const embed = new EmbedBuilder()
      .setTitle(`${user.tag}'s Avatar`)
      .setImage(user.displayAvatarURL({ dynamic: true, size: 1024 }))
      .setColor("#000000");
    return message.reply({ embeds: [embed] });
  }

  // HELP
  if (command === "help") {
    const embed = new EmbedBuilder()
      .setTitle("Commands List")
      .setDescription("Prefix: `,`")
      .setColor("#0d0d0d")
      .addFields(
        { name: "💳 Payments", value: "`,upi` `,ltc` `,usdt`", inline: false },
        { name: "🛠 Utilities", value: "`,calc` `,remind` `,vouch` `,notify` `,snipe`", inline: false },
        { name: "ℹ️ Info", value: "`,stats` `,ping` `,userinfo` `,serverinfo`", inline: false },
        { name: "🔨 Moderation", value: "`,clear` `,warn` `,kick` `,ban` `,mute` `,modlog`", inline: false },
        { name: "🎫 Tickets", value: "`,done` `,close` `,add` `,rename`", inline: false },
        { name: "🤖 Owners", value: "`,addaddy` `,broadcast`", inline: false },
        { name: "⚙️ Autoresponse", value: "`,autoresponse add/remove/list/toggle`", inline: false }
      )
      .setFooter({ text: "Made by Kai" })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  // SNIPE
  if (command === "snipe") {
    const data = snipes.get(message.channel.id);
    if (!data) return message.reply("❌ No message to snipe.");
    const embed = new EmbedBuilder()
      .setTitle("Sniped Message")
      .setDescription(data.content || "No text content")
      .setAuthor({ name: data.authorTag, iconURL: data.avatar })
      .setImage(data.image || null)
      .setFooter({ text: "Deleted message" })
      .setColor("#000000");
    return message.reply({ embeds: [embed] });
  }
});

// ---------- Interaction Handler ----------
client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "close")
        return handleTicketClose(interaction.channel, interaction.member, interaction);

      if (interaction.commandName === "sendpanel") {
        const embed = new EmbedBuilder()
          .setTitle("Shop & Support Tickets")
          .setDescription("> **Click below to open a Ticket**\n\n")
          .setColor("#000000");

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("create-shop-ticket").setLabel("Purchase").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId("create-support-ticket").setLabel("Support").setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({ content: "✅ Panel sent!", flags: 64 });
        await interaction.channel.send({ embeds: [embed], components: [row] });
      }
    }

    if (interaction.isButton()) {
      const id = interaction.customId;

      // Copy buttons
      if (id.startsWith("copy-")) {
        const teamData = ensureFile(teamPath, {});
        const parts = id.split("-");
        const key = parts[1];
        const userId = parts[2];
        let content = null;

        if (key === "vouch") {
          content = interaction.message.embeds[0]?.description || null;
        } else {
          const userData = teamData[userId] || {};
          content = userData[key] || null;
        }

        if (!content) return interaction.reply({ content: "❌ No data found to copy.", ephemeral: true });
        return interaction.reply({ content, ephemeral: true });
      }

      // Shop ticket
      if (id === "create-shop-ticket") return showShopModal(interaction);
      // Support ticket
      if (id === "create-support-ticket") return showSupportModal(interaction);
      // Close buttons
      if (id === "confirm-close") return handleTicketClose(interaction.channel, interaction.member, interaction);
      if (id === "cancel-close") return interaction.reply({ content: "❌ Ticket closure cancelled.", flags: 64 });
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === "shop-ticket-modal") return createShopTicket(interaction);
      if (interaction.customId === "support-ticket-modal") return createSupportTicket(interaction);
    }
  } catch (e) {
    console.error("Interaction error:", e);
    if (interaction && !interaction.replied)
      await interaction.reply({ content: "❌ Something went wrong.", flags: 64 }).catch(() => {});
  }
});

// ----------------- TICKET FUNCTIONS -----------------
async function showShopModal(interaction) {
  const modal = new ModalBuilder().setCustomId("shop-ticket-modal").setTitle("Shop Ticket");
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("product").setLabel("Product Name").setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("payment").setLabel("Payment Method").setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("details").setLabel("Description").setStyle(TextInputStyle.Paragraph).setRequired(false))
  );
  return interaction.showModal(modal);
}

async function showSupportModal(interaction) {
  const modal = new ModalBuilder().setCustomId("support-ticket-modal").setTitle("Support Ticket");
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("concern").setLabel("What is your concern?").setStyle(TextInputStyle.Paragraph).setRequired(true))
  );
  return interaction.showModal(modal);
}

async function createShopTicket(interaction) {
  const guild = interaction.guild, member = interaction.member;
  const product = interaction.fields.getTextInputValue("product");
  const payment = interaction.fields.getTextInputValue("payment");
  const details = interaction.fields.getTextInputValue("details") || "No details";
  const orderId = `#GX${Math.floor(1000 + Math.random() * 9000)}`;
  const name = cleanInput(product) || `shop-${member.user.username}`;

  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: SHOP_CATEGORY,
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: member.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
      { id: SUPPORT_ROLE, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
    ]
  });

  const embed = new EmbedBuilder()
    .setTitle("🛒 Shop Ticket Opened")
    .setDescription(`Hey <@${member.id}>!\n\nProduct: **${product}**\nPayment: **${payment}**\nDetails: ${details}\nOrder ID: ${orderId}`)
    .setColor("#000000");

  const closeBtn = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("confirm-close").setLabel("❌ Close Ticket").setStyle(ButtonStyle.Danger)
  );

  await channel.send({ content: `<@${member.id}> @everyone`, embeds: [embed], components: [closeBtn] });
  await interaction.reply({ content: `✅ Ticket created: ${channel}`, flags: 64 });
}

async function createSupportTicket(interaction) {
  const guild = interaction.guild, member = interaction.member;
  const concern = interaction.fields.getTextInputValue("concern");
  const ticketId = `#SUP${Math.floor(1000 + Math.random() * 9000)}`;
  const name = cleanInput(`support-${member.user.username}`);

  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: SUPPORT_CATEGORY,
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: member.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
      { id: SUPPORT_ROLE, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
    ]
  });

  const embed = new EmbedBuilder()
    .setTitle("🆘 Support Ticket")
    .setDescription(`Hey <@${member.id}>!\nConcern: **${concern}**\nTicket ID: ${ticketId}`)
    .setColor("#000000");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("confirm-close").setLabel("❌ Close Ticket").setStyle(ButtonStyle.Danger)
  );

  await channel.send({ content: `<@${member.id}> @everyone`, embeds: [embed], components: [row] });
  await interaction.reply({ content: `✅ Support ticket created: ${channel}`, flags: 64 });
}

async function handleTicketClose(channel, member, interaction = null) {
  if (!isTicketChannel(channel)) {
    if (interaction) return interaction.reply({ content: "❌ Use this inside a ticket.", flags: 64 });
    return channel.send("❌ Use this inside a ticket.");
  }

  if (!interaction) {
    const confirm = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("confirm-close").setLabel("Yes, Close").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("cancel-close").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
    );
    return channel.send({ content: "⚠️ Confirm ticket closure?", components: [confirm] });
  }

  const ticketOwnerOverwrite = channel.permissionOverwrites.cache.find(po => po.type === 1);
  const ticketOwnerId = ticketOwnerOverwrite?.id || null;

  const messages = await fetchAllMessages(channel);
  const transcript = renderTranscript(messages, channel.name);
  const file = { attachment: Buffer.from(transcript, "utf-8"), name: `transcript-${channel.name}.html` };

  const categoryName = channel.parent?.name || "Unknown";
  const closedBy = member ? `<@${member.id}>` : "Unknown";

  const ticketEmbed = new EmbedBuilder()
    .setTitle("Ticket Closed")
    .setDescription("Your ticket has been closed, and the transcript has been archived.")
    .addFields(
      { name: "Category", value: categoryName, inline: false },
      { name: "Channel Name", value: `#${channel.name}`, inline: true },
      { name: "Closed By", value: closedBy, inline: true }
    )
    .setColor("#000000")
    .setTimestamp();

  if (ticketOwnerId) {
    try {
      const guildMember = await channel.guild.members.fetch(ticketOwnerId).catch(() => null);
      const user = guildMember?.user || await client.users.fetch(ticketOwnerId).catch(() => null);
      if (user) {
        await user.send({ embeds: [ticketEmbed], files: [file] }).catch(() => {});
      }
    } catch (e) {
      console.error("DM transcript error:", e);
    }
  }

  try {
    await channel.send({ embeds: [ticketEmbed], files: [file] });
  } catch (e) {
    console.error("Channel transcript send error:", e);
  }

  try {
    if (TRANSCRIPT_CHANNEL) {
      const log = await client.channels.fetch(TRANSCRIPT_CHANNEL);
      if (log && log.isTextBased()) {
        await log.send({ embeds: [ticketEmbed], files: [file] });
      }
    }
  } catch (e) {
    console.error("Transcript upload error:", e);
  }

  await channel.send("✅ Ticket will be deleted in 5 seconds.").catch(() => {});
  setTimeout(() => channel.delete().catch(() => {}), 5000);
}

async function fetchAllMessages(channel) {
  let all = [], last;
  while (true) {
    const fetched = await channel.messages.fetch({ limit: 100, before: last }).catch(() => new Map());
    if (!fetched.size) break;
    all = [...fetched.values(), ...all];
    last = fetched.last().id;
  }
  return all.reverse();
}

function renderTranscript(messages, name) {
  return `
  <html><head><style>
  body{background:#313338;color:#dcddde;font-family:sans-serif}
  .msg{margin:5px 0;padding:5px;border-bottom:1px solid #444}
  .auth{color:#fff;font-weight:bold}
  .time{color:#999;font-size:12px;margin-left:6px}
  </style></head><body>
  <h2>Transcript of #${name}</h2>
  ${messages.map(m => `<div class="msg"><span class="auth">${m.author?.tag || "?"}</span>
  <span class="time">${m.createdAt.toLocaleString()}</span><div>${m.cleanContent || ""}</div></div>`).join("")}
  </body></html>`;
}

async function handleTicketDone(channel) {
  const ticketOwnerId = channel.permissionOverwrites.cache.find(po => po.type === 1)?.id;
  if (!ticketOwnerId) return channel.send("⚠️ Could not find the ticket owner.");
  const member = await channel.guild.members.fetch(ticketOwnerId).catch(() => null);
  if (member) await member.roles.add(CUSTOMER_ROLE_ID).catch(() => {});
  await channel.setName(`done-${channel.name}`.slice(0, 100)).catch(() => {});

  const embed = new EmbedBuilder()
    .setColor("#000000")
    .setTitle("✅ Deal Completed")
    .setDescription(`Thanks For The Deal <@${ticketOwnerId}> \nTicket marked as **done**.`);

  channel.send({ embeds: [embed] });
}

// ---------- Login ----------
client.login(BOT_TOKEN);