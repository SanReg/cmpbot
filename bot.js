const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ActivityType } = require('discord.js');
const mongoose = require('mongoose');
const express = require('express');
require('dotenv').config();

// Setup HTTP server for health checks
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    bot: client.user ? client.user.tag : 'Not logged in',
    uptime: process.uptime(),
    serviceStatus: serviceStatus.isOnline ? 'online' : 'offline',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`🌐 Health check server running on http://localhost:${PORT}/health`);
});

const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ] 
});

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// Store service status
let serviceStatus = {
  isOnline: false,
  updatedAt: new Date(),
  message: "We are currently unavailable!",
};

// Store last status message ID
let lastStatusMessageId = null;
const statusChannelId = '1431278456859131955';
const allowedChannelId = '1431278456859131955';
let lastPostedStatus = null; // null until first post

// Poll service status every 10 seconds
async function pollServiceStatus() {
  try {
    const db = mongoose.connection.db;
    const collection = db.collection('servicestatuses');
    const statusDoc = await collection.findOne({});

    if (statusDoc) {
      serviceStatus = {
        isOnline: statusDoc.isOnline,
        updatedAt: statusDoc.updatedAt,
        message: statusDoc.message || (statusDoc.isOnline ? 'All services are online!' : "We are currently unavailable!"),
      };
      console.log(`📊 Status updated: ${statusDoc.isOnline ? '🟢 Online' : '🔴 Offline'}`);
      
      // Update bot's status
      if (client.user) {
        client.user.setPresence({
          activities: [{ 
            name: statusDoc.isOnline ? 'Service: 🟢 Online' : 'Service: 🔴 Offline', 
            type: ActivityType.Watching 
          }],
          status: 'online',
        });
      }

      // Post status to channel only if status changed since last post
      try {
        if (lastPostedStatus !== statusDoc.isOnline) {
          const channel = await client.channels.fetch(statusChannelId);

          // Delete previous message if exists
          if (lastStatusMessageId) {
            try {
              const oldMessage = await channel.messages.fetch(lastStatusMessageId);
              await oldMessage.delete();
              console.log('✅ Old status message deleted');
            } catch (err) {
              console.log('⚠️ Could not delete old message:', err.message);
            }
          }

          // Build and send new status message
          const wrongEmoji = '<a:wrong:1461015481447092286>';
          const rightEmoji = '<a:right:1461015446005223520>';
          
          let embedColor, fields;

          if (statusDoc.isOnline) {
            embedColor = 0x00FF00;
            fields = [
              {
                name: `🧾 Similarity Checker – ${rightEmoji} Online`,
                value: '',
                inline: false
              },
              {
                name: `🤖 AI Checker – ${rightEmoji} Online`,
                value: '',
                inline: false
              },
              {
                name: '⏱️ Results',
                value: '15-20 mins',
                inline: false
              }
            ];
          } else {
            embedColor = 0xFF0000;
            fields = [
              {
                name: `🧾 Similarity Checker – ${wrongEmoji} Offline`,
                value: '',
                inline: false
              },
              {
                name: `🤖 AI Checker – ${wrongEmoji} Offline`,
                value: '',
                inline: false
              },
              {
                name: 'Message',
                value: serviceStatus.message,
                inline: false
              },
              {
                name: '📝 We\'ll be back online soon! ⚡',
                value: 'You can still upload your files - they\'ll be checked ASAP once we\'re back.',
                inline: false
              },
              {
                name: '📌 Note',
                value: 'You can check the status via the bot profile or using /status command!',
                inline: false
              }
            ];
          }

          const newMessage = await channel.send({
            embeds: [{
              color: embedColor,
              title: '📊・Service Status Update',
              fields: fields
            }],
          });

          lastStatusMessageId = newMessage.id;
          lastPostedStatus = statusDoc.isOnline;
          console.log('✅ New status message posted (status changed)');
        } else {
          console.log('ℹ️ Status unchanged; no new post');
        }
      } catch (error) {
        console.error('❌ Error posting to channel:', error.message);
      }
    }
  } catch (error) {
    console.error('❌ Poll error:', error);
  }
}

// Start polling when connected
let pollInterval;
mongoose.connection.on('connected', () => {
  console.log('🔄 Starting status polling...');
  pollServiceStatus(); // Initial poll
  pollInterval = setInterval(pollServiceStatus, 10000); // Poll every 10 seconds
});

mongoose.connection.on('disconnected', () => {
  if (pollInterval) clearInterval(pollInterval);
});

// Define slash commands
const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Replies with Pong!'),
  
  new SlashCommandBuilder()
    .setName('hello')
    .setDescription('Says hello to the user'),
  
  new SlashCommandBuilder()
    .setName('user')
    .setDescription('Shows user information'),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Check service status'),
];

// Register slash commands
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Registering slash commands...');
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands },
    );
    console.log('Slash commands registered successfully!');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
})();

// Handle interactions (slash commands)
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'ping') {
    await interaction.reply('Pong!');
  } 
  else if (commandName === 'hello') {
    await interaction.reply(`Hello ${interaction.user.username}!`);
  } 
  else if (commandName === 'user') {
    await interaction.reply({
      embeds: [{
        color: 0x0099ff,
        title: 'User Information',
        description: `User: ${interaction.user.username}\nID: ${interaction.user.id}`,
      }],
    });
  }
  else if (commandName === 'status') {
    try {
      const status = serviceStatus.isOnline ? '🟢 **Online**' : '🔴 **Offline**';
      const defaultMessage = serviceStatus.isOnline ? 'All services are online!' : "We are currently unavailable!";
      
      const fields = [
        { name: 'Message', value: defaultMessage, inline: false }
      ];

      // Add custom message if it exists in database
      if (serviceStatus.message && serviceStatus.message !== defaultMessage) {
        fields.push({ name: 'Additional Info', value: serviceStatus.message, inline: false });
      }

      await interaction.reply({
        embeds: [{
          color: serviceStatus.isOnline ? 0x00FF00 : 0xFF0000,
          title: 'Service Status',
          description: status,
          fields: fields,
        }],
      });
    } catch (error) {
      console.error('Status command error:', error);
      await interaction.reply('❌ Error fetching status');
    }
  }
});

// Handle message commands
client.on('messageCreate', async (message) => {
  // Debug logging
  console.log(`📨 Message: "${message.content}" from ${message.author.tag}`);
  
  // Ignore bot messages
  if (message.author.bot) return;

  // Restrict commands to the allowed channel only
  if (!message.channel || message.channel.id !== allowedChannelId) return;

  if (message.content === '!check') {
    console.log('✅ !check command detected');
    const wrongEmoji = '<a:wrong:1461015481447092286>';
    const rightEmoji = '<a:right:1461015446005223520>';
    
    try {
      let embedColor, fields;

      if (serviceStatus.isOnline) {
        // Online status
        embedColor = 0x00FF00;
        fields = [
          {
            name: `🧾 Similarity Checker – ${rightEmoji} Online`,
            value: '',
            inline: false
          },
          {
            name: `🤖 AI Checker – ${rightEmoji} Online`,
            value: '',
            inline: false
          },
          {
            name: '⏱️ Results',
            value: '15-20 mins',
            inline: false
          }
        ];
      } else {
        // Offline status
        embedColor = 0xFF0000;
        fields = [
          {
            name: `🧾 Similarity Checker – ${wrongEmoji} Offline`,
            value: '',
            inline: false
          },
          {
            name: `🤖 AI Checker – ${wrongEmoji} Offline`,
            value: '',
            inline: false
          },
          {
            name: 'Message',
            value: serviceStatus.message,
            inline: false
          },
          {
            name: '📝 We\'ll be back online soon! ⚡',
            value: 'You can still upload your files - they\'ll be checked ASAP once we\'re back.',
            inline: false
          },
          {
            name: '📌 Note',
            value: 'You can check the status via the bot profile or using /status command!',
            inline: false
          }
        ];
      }

      await message.channel.send({
        embeds: [{
          color: embedColor,
          title: '📊・Service Status Update',
          fields: fields
        }],
      });
      console.log('✅ Message sent');
    } catch (error) {
      console.error('❌ Error:', error);
    }
  }
  
  if (message.content === '!online') {
    console.log('✅ !online command detected');
    const rightEmoji = '<a:right:1461015446005223520>';
    
    try {
      await message.channel.send({
        embeds: [{
          color: 0x00FF00,
          title: '📊・Service Status Update',
          fields: [
            {
              name: `🧾 Similarity Checker – ${rightEmoji} Online`,
              value: '',
              inline: false
            },
            {
              name: `🤖 AI Checker – ${rightEmoji} Online`,
              value: '',
              inline: false
            },
            {
              name: '⏱️ Results',
              value: '15-20 mins',
              inline: false
            }
          ]
        }],
      });
      console.log('✅ Online message sent');
    } catch (error) {
      console.error('❌ Error:', error);
    }
  }

  if (message.content === '!offline') {
    console.log('✅ !offline command detected');
    const wrongEmoji = '<a:wrong:1461015481447092286>';
    
    try {
      await message.channel.send({
        embeds: [{
          color: 0xFF0000,
          title: '📊・Service Status Update',
          fields: [
            {
              name: `🧾 Similarity Checker – ${wrongEmoji} Offline`,
              value: '',
              inline: false
            },
            {
              name: `🤖 AI Checker – ${wrongEmoji} Offline`,
              value: '',
              inline: false
            },
            {
              name: 'Message',
              value: serviceStatus.message,
              inline: false
            },
            {
              name: '📝 We\'ll be back online soon! ⚡',
              value: 'You can still upload your files - they\'ll be checked ASAP once we\'re back.',
              inline: false
            },
            {
              name: '📌 Note',
              value: 'You can check the status via the bot profile or using /status command!',
              inline: false
            }
          ]
        }],
      });
      console.log('✅ Offline message sent');
    } catch (error) {
      console.error('❌ Error:', error);
    }
  }
});

client.once('ready', () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
  // Set initial status
  client.user.setPresence({
    activities: [{ 
      name: serviceStatus.isOnline ? 'Service: 🟢 Online' : 'Service: 🔴 Offline', 
      type: ActivityType.Watching 
    }],
    status: 'online',
  });
});

client.login(process.env.DISCORD_TOKEN);
