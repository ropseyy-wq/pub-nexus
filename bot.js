// NEXUSBOT - Minecraft Bot with API Server
const mineflayer = require('mineflayer');
const express = require('express');
const cors = require('cors');

// Read settings from environment variables
const config = {
    username: process.env.BOT_NAME || 'NexusBot',
    serverIp: process.env.SERVER_IP || 'localhost',
    serverPort: parseInt(process.env.SERVER_PORT) || 25565,
    auth: process.env.AUTH_TYPE || 'offline',
    password: process.env.PASSWORD || '',
    modes: (process.env.BOT_MODES || '').split(',')
};

// Bot stats
let botStats = {
    connected: false,
    health: 20,
    food: 20,
    position: { x: 0, y: 0, z: 0 },
    ping: 0,
    players: [],
    inventory: [],
    logs: [],
    startTime: Date.now(),
    blocksMined: 0,
    fishCaught: 0
};

// Chat history
let chatHistory = [];

// Add log function
function addLog(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const logEntry = { timestamp, message, type };
    botStats.logs.push(logEntry);
    if (botStats.logs.length > 200) botStats.logs.shift();
    console.log(message);
}

// Create Express app
const app = express();
app.use(cors());
app.use(express.json());

// API Routes
app.get('/health', (req, res) => {
    res.json({
        status: botStats.connected ? 'connected' : 'disconnected',
        uptime: Math.floor((Date.now() - botStats.startTime) / 1000),
        health: botStats.health,
        food: botStats.food,
        position: botStats.position,
        ping: botStats.ping,
        players: botStats.players,
        inventory: botStats.inventory,
        blocksMined: botStats.blocksMined,
        serverIp: config.serverIp,
        serverPort: config.serverPort,
        botName: config.username
    });
});

app.get('/logs', (req, res) => {
    res.json(botStats.logs.slice(-100));
});

app.get('/chat', (req, res) => {
    res.json(chatHistory.slice(-50));
});

app.post('/command', (req, res) => {
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: 'No command' });
    if (bot && botStats.connected) {
        bot.chat(command);
        addLog(`[Command] ${command}`, 'control');
        res.json({ success: true, message: `Sent: ${command}` });
    } else {
        res.status(503).json({ error: 'Bot not connected' });
    }
});

// Start API server
const PORT = process.env.API_PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    addLog(`[API] Server running on port ${PORT}`);
});

// Create Minecraft bot
addLog('='.repeat(50));
addLog('🤖 NEXUSBOT STARTING...');
addLog('='.repeat(50));
addLog(`Bot Name: ${config.username}`);
addLog(`Server: ${config.serverIp}:${config.serverPort}`);
addLog(`Modes: ${config.modes.join(', ') || 'None'}`);
addLog('='.repeat(50));

const bot = mineflayer.createBot({
    host: config.serverIp,
    port: config.serverPort,
    username: config.username,
    auth: config.auth,
    password: config.password
});

// Update bot stats periodically
setInterval(() => {
    if (bot && bot.entity) {
        botStats.position = {
            x: Math.round(bot.entity.position.x * 10) / 10,
            y: Math.round(bot.entity.position.y * 10) / 10,
            z: Math.round(bot.entity.position.z * 10) / 10
        };
        botStats.ping = bot.player?.ping || 0;
    }
}, 2000);

// Health tracking
bot.on('health', () => {
    botStats.health = bot.health;
    botStats.food = bot.food;
});

// Player tracking
bot.on('playerJoined', (player) => {
    updatePlayerList();
});

bot.on('playerLeft', (player) => {
    updatePlayerList();
});

function updatePlayerList() {
    if (bot.players) {
        botStats.players = Object.values(bot.players)
            .filter(p => p.username !== bot.username)
            .map(p => ({ username: p.username, ping: p.ping }));
    }
}

// Inventory tracking
bot.on('inventory', () => {
    if (bot.inventory && bot.inventory.slots) {
        botStats.inventory = bot.inventory.slots.slice(36, 45).map((item, i) => {
            if (!item) return null;
            return {
                slot: i,
                name: item.name,
                displayName: item.displayName || item.name,
                count: item.count
            };
        }).filter(i => i !== null);
    }
});

// Chat tracking
bot.on('chat', (username, message) => {
    if (username !== bot.username) {
        chatHistory.push({ username, message, time: Date.now() });
        if (chatHistory.length > 100) chatHistory.shift();
    }
    
    // Auto-Responder
    if (config.modes.includes('AUTO_RESPONDER')) {
        const msg = message.toLowerCase();
        if (msg.includes('hello') || msg.includes('hi')) {
            setTimeout(() => bot.chat(`Hello ${username}! 👋`), 1000);
        } else if (msg.includes('how are you')) {
            setTimeout(() => bot.chat(`I'm doing great! Mining blocks 😊`), 1000);
        } else if (msg.includes('what are you doing')) {
            setTimeout(() => bot.chat(`Just mining and farming! 🤖`), 1000);
        } else if (msg.includes('good bot')) {
            setTimeout(() => bot.chat(`Thank you ${username}! 🎉`), 1000);
        }
    }
});

// When bot spawns
bot.once('spawn', () => {
    botStats.connected = true;
    botStats.startTime = Date.now();
    addLog('✅ Bot has joined the server!', 'success');
    bot.chat('🤖 NexusBot has joined!');
    
    updatePlayerList();
    
    // Enable modes
    if (config.modes.includes('FARM')) {
        addLog('🌾 Auto-Farm mode activated', 'info');
        startFarming();
    }
    if (config.modes.includes('MINE')) {
        addLog('⛏️ Auto-Mine mode activated', 'info');
        startMining();
    }
    if (config.modes.includes('PARKOUR')) {
        addLog('🏃 Parkour mode activated', 'info');
        startParkour();
    }
    if (config.modes.includes('LIQUID_WALKER')) {
        addLog('🪣 Liquid Walker mode activated', 'info');
        startLiquidWalker();
    }
});

// Auto-Farm
function startFarming() {
    setInterval(() => {
        if (!bot.entity || !botStats.connected) return;
        const crop = bot.findBlock({
            matching: (block) => ['wheat', 'carrots', 'potatoes', 'beetroots'].includes(block.name),
            maxDistance: 5
        });
        if (crop) {
            bot.dig(crop, (err) => {
                if (!err) {
                    botStats.blocksMined++;
                    addLog(`🌾 Farmed ${crop.name}`, 'success');
                    const seed = bot.inventory.findInventoryItem(item => 
                        item.name.includes('seeds') || item.name.includes('potato') || item.name.includes('carrot')
                    );
                    if (seed) {
                        bot.equip(seed, 'hand');
                        bot.placeBlock(crop.position, () => {});
                    }
                }
            });
        }
    }, 5000);
}

// Auto-Mine
function startMining() {
    const ores = ['coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'emerald_ore', 'copper_ore'];
    setInterval(() => {
        if (!bot.entity || !botStats.connected) return;
        const ore = bot.findBlock({ matching: (block) => ores.includes(block.name), maxDistance: 5 });
        if (ore) {
            bot.dig(ore, (err) => {
                if (!err) {
                    botStats.blocksMined++;
                    addLog(`⛏️ Mined ${ore.name}`, 'success');
                }
            });
        }
    }, 3000);
}

// Parkour mode
function startParkour() {
    setInterval(() => {
        if (!bot.entity || !botStats.connected) return;
        bot.setControlState('forward', true);
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), 500);
    }, 3000);
}

// Liquid Walker
function startLiquidWalker() {
    setInterval(() => {
        if (!bot.entity || !botStats.connected) return;
        const blockBelow = bot.blockAt(bot.entity.position.offset(0, -1, 0));
        if (blockBelow && (blockBelow.name === 'water' || blockBelow.name === 'lava')) {
            const cobble = bot.inventory.findInventoryItem(item => item.name === 'cobblestone');
            if (cobble) {
                bot.equip(cobble, 'hand');
                bot.placeBlock(blockBelow.position, () => {});
            }
        }
    }, 1000);
}

// Anti-AFK
setInterval(() => {
    if (!bot.entity || !botStats.connected) return;
    const random = Math.random();
    if (random < 0.3) {
        bot.setControlState('forward', true);
        setTimeout(() => bot.setControlState('forward', false), 1000);
    }
    if (random > 0.7) {
        bot.look(Math.random() * Math.PI * 2, Math.random() - 0.5);
    }
}, 15000);

// Stats log every 5 minutes
setInterval(() => {
    const uptime = Math.floor((Date.now() - botStats.startTime) / 1000);
    addLog(`📊 STATS - Mined: ${botStats.blocksMined} | Uptime: ${uptime}s`, 'info');
}, 300000);

// Handle disconnections
bot.on('end', (reason) => {
    botStats.connected = false;
    addLog(`❌ Disconnected: ${reason || 'Unknown'}`, 'error');
    addLog('🔄 Attempting to reconnect in 10 seconds...', 'warn');
    setTimeout(() => process.exit(1), 10000);
});

bot.on('error', (err) => {
    addLog(`⚠️ Error: ${err.message}`, 'error');
});

bot.on('kicked', (reason) => {
    botStats.connected = false;
    addLog(`👢 Kicked: ${reason}`, 'error');
});

addLog('🤖 Bot is connecting to server...');
