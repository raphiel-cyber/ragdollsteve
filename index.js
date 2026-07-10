require('dotenv').config();

const http = require('http');
const {
  Client,
  GatewayIntentBits,
  Partials,
  Events
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

const GUILD_ID = process.env.GUILD_ID;
const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;
const UNVERIFIED_ROLE_ID = process.env.UNVERIFIED_ROLE_ID;
const DM_LOG_CHANNEL_ID = process.env.DM_LOG_CHANNEL_ID;
const STATUS_VOICE_CHANNEL_ID = process.env.STATUS_VOICE_CHANNEL_ID;
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;
const TRUSTED_PING_ROLE_ID = process.env.TRUSTED_PING_ROLE_ID;
const RESTRICTED_CHANNEL_ID = process.env.RESTRICTED_CHANNEL_ID;

const VERIFY_EMOJI = '🛎️';
const VERIFY_WORD = 'verify';
const VERIFY_TIME = 24 * 60 * 60 * 1000;
const EVERYONE_TIMEOUT = 10 * 60 * 1000;

let verificationMode = 'automated';
const kickTimers = new Map();
let restrictedKickCount = 0;

http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Ragdoll Steve is running.');
}).listen(process.env.PORT || 3000);

async function setStatus(name) {
  try {
    if (!STATUS_VOICE_CHANNEL_ID) return;
    const channel = await client.channels.fetch(STATUS_VOICE_CHANNEL_ID);
    if (!channel) return;
    await channel.setName(name);
  } catch (err) {
    console.error('Status channel error:', err);
  }
}

async function sendLog(guild, content) {
  try {
    if (!DM_LOG_CHANNEL_ID) return;
    const channel = guild.channels.cache.get(DM_LOG_CHANNEL_ID);
    if (!channel) return;
    await channel.send(content);
  } catch (err) {
    console.error('Log error:', err);
  }
}

function hasStaffRole(member) {
  if (!member || !STAFF_ROLE_ID) return false;
  return member.roles.cache.has(STAFF_ROLE_ID);
}

function canUseEveryone(member) {
  if (!member || !TRUSTED_PING_ROLE_ID) return false;
  return member.roles.cache.has(TRUSTED_PING_ROLE_ID);
}

async function verifyMember(member, source = 'DM') {
  try {
    if (member.roles.cache.has(UNVERIFIED_ROLE_ID)) {
      await member.roles.remove(UNVERIFIED_ROLE_ID).catch(() => {});
    }

    if (!member.roles.cache.has(VERIFIED_ROLE_ID)) {
      await member.roles.add(VERIFIED_ROLE_ID).catch(() => {});
    }

    if (kickTimers.has(member.id)) {
      clearTimeout(kickTimers.get(member.id));
      kickTimers.delete(member.id);
    }

    await member.send('Ding! Welcome To Raphiel’s Lounge! 🥂').catch(() => {});
    await sendLog(member.guild, `✅ ${member} has been verified through ${source}.`);
  } catch (err) {
    console.error('Verify error:', err);
  }
}

function startKickTimer(member) {
  if (kickTimers.has(member.id)) clearTimeout(kickTimers.get(member.id));

  const timer = setTimeout(async () => {
    try {
      const freshMember = await member.guild.members.fetch(member.id).catch(() => null);
      if (!freshMember) return;

      if (
        freshMember.roles.cache.has(UNVERIFIED_ROLE_ID) &&
        !freshMember.roles.cache.has(VERIFIED_ROLE_ID)
      ) {
        await freshMember.kick('Failed to complete server verification within 24 hours.');
        await sendLog(member.guild, `⏰ ${freshMember.user.tag} was kicked for not verifying within 24 hours.`);
      }
    } catch (err) {
      console.error('Kick timer error:', err);
    }
  }, VERIFY_TIME);

  kickTimers.set(member.id, timer);
}

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`GUILD_ID=${GUILD_ID}`);
  console.log(`UNVERIFIED_ROLE_ID=${UNVERIFIED_ROLE_ID}`);
  console.log(`RESTRICTED_CHANNEL_ID=${RESTRICTED_CHANNEL_ID}`);
  await setStatus('🟢・Verification: Automated');
});

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    if (member.user.bot) return;
    if (member.guild.id !== GUILD_ID) return;

    await member.roles.add(UNVERIFIED_ROLE_ID).catch(() => {});
    startKickTimer(member);

    await member.send(
      `Hello ${member}, welcome to Raphiel’s Lounge!\n\nTo get verified, reply with ${VERIFY_EMOJI} or "Verify" to gain access to the server.\n\nYou have 24 hours to verify or you will be kicked.`
    ).catch(() => {
      console.log(`Could not DM ${member.user.tag}.`);
    });

    await sendLog(member.guild, `📨 Verification DM attempted for ${member.user.tag}.`);
  } catch (err) {
    console.error('Join error:', err);
  }
});

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot) return;

    if (message.guild && message.guild.id !== GUILD_ID) return;

    if (message.guild) {
      console.log(
        `MSG ${message.author.tag} | channel=${message.channel.id} | restricted=${RESTRICTED_CHANNEL_ID} | hasVisitor=${message.member.roles.cache.has(UNVERIFIED_ROLE_ID)} | isStaff=${hasStaffRole(message.member)}`
      );
    }

    // 🚫 Restricted Area Honeypot
    if (
      message.guild &&
      message.channel.id === RESTRICTED_CHANNEL_ID &&
      message.member.roles.cache.has(UNVERIFIED_ROLE_ID)
    ) {
      const userTag = message.author.tag;
      const channelName = message.channel.name;

      console.log(`🔥 RESTRICTED AREA DETECTED: ${userTag}`);

      await message.delete().catch((err) => {
        console.error('Restricted delete error:', err);
      });

      await sendLog(
        message.guild,
        `🚪 ${userTag} was kicked for typing in #${channelName}.`
      );

      await message.member.kick('Typed in restricted-area while unverified.').catch((err) => {
        console.error('Restricted kick error:', err);
      });

      return;
    }

    if (message.guild) {
      if (
        (message.content.includes('@everyone') || message.content.includes('@here')) &&
        !canUseEveryone(message.member)
      ) {
        await message.delete().catch(() => {});

        restrictedKickCount++;

await message.channel.send(
  `🚨 ${message.author} was caught texting in the restricted area.\n\nSteve escorted the guest out of the lounge.\n\n📊 **Total Kicked:** ${restrictedKickCount}`
).then((msg) => {
  setTimeout(() => msg.delete().catch(() => {}), 15000);
});

        if (message.member.moderatable) {
          await message.member.timeout(
            EVERYONE_TIMEOUT,
            'Unauthorized @everyone/@here ping.'
          ).catch(() => {});
        }

        await message.channel.send(
          `*Steve looks at ${message.author} suspiciously.*\n\nSteve timed out the guest for safety.`
        ).then((msg) => {
          setTimeout(() => msg.delete().catch(() => {}), 10000);
        });

        await sendLog(
          message.guild,
          `🚨 ${message.author} was timed out for 10 minutes for unauthorized @everyone/@here usage.`
        );

        return;
      }

      if (!hasStaffRole(message.member)) return;

      if (message.content === '!automated') {
        verificationMode = 'automated';
        await setStatus('🟢・Verification: Automated');
        await message.reply('Verification is now automated.');
        return;
      }

      if (message.content === '!manual') {
        verificationMode = 'manual';
        await setStatus('🟡・Verification: Manual');
        await message.reply('Verification is now manual.');
        return;
      }

      if (message.content === '!offline') {
        verificationMode = 'offline';
        await setStatus('🔴・Verification: Offline');
        await message.reply('Verification is now offline.');
        return;
      }

      if (message.content === '!sendverifyinfo') {
        await message.channel.send(
          `Hello <@&${UNVERIFIED_ROLE_ID}>, be sure to check your DMs from ${client.user} to be verified. If you don’t get a response, just DM the bot "${VERIFY_EMOJI}" or "Verify" to gain access to the server!\n\nYou have 24 hours to verify or you will be kicked.`
        );

        await message.delete().catch(() => {});
        return;
      }

      return;
    }

    const content = message.content.trim().toLowerCase();

    if (content !== VERIFY_WORD && content !== VERIFY_EMOJI) return;

    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(message.author.id).catch(() => null);

    if (!member) {
      await message.reply('I could not find you in the server.');
      return;
    }

    if (verificationMode === 'manual') {
      await message.reply('Verification is currently manual. Please wait for staff.');
      return;
    }

    if (verificationMode === 'offline') {
      await message.reply('Verification is currently offline. Please try again later.');
      return;
    }

    await verifyMember(member, 'DM');
  } catch (err) {
    console.error('Message error:', err);
  }
});

client.login(process.env.TOKEN);
