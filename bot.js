// NEXUSBOT - Minecraft Bot with API Server
const mineflayer = require('mineflayer');
const express = require('express');
const cors = require('cors');

const config = {
    username: process.env.BOT_NAME || 'NexusBot',
    serverIp: process.env.SERVER_IP || 'localhost',
    serverPort: parseInt(process.env.SERVER_PORT) || 25565,
    auth: 'offline',
    modes: (process.env.BOT_MODES || '').split(',')
};

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
    blocksMined: 0
};

function addLog(message, type = 'info') {
    const logEntry = { timestamp: new Date().toISOString(), message, type };
    botStats.logs.push(logEntry);
    if (botStats.logs.length > 200) botStats.logs.shift();
    console.log(message);
}

// Start API server FIRST (always runs even if bot fails)
const app = express();
app.use(cors());
app.use(express.json());

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
        config: {
            serverIp: config.serverIp,
            serverPort: config.serverPort,
            username: config.username
        }
    });
});

app.get('/logs', (req, res) => {
    res.json(botStats.logs.slice(-100));
});

app.post('/command', (req, res) => {
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: 'No command' });
    if (bot && botStats.connected) {
        bot.chat(command);
        addLog(`[Command] ${command}`, 'control');
        res.json({ success: true });
    } else {
        res.status(503).json({ error: 'Bot not connected' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    addLog(`[API] Server running on port ${PORT}`);
});

// Create bot function
let bot = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;

function createBot() {
    if (!config.serverIp || config.serverIp === 'localhost' || config.serverIp === 'mc.example.com') {
        addLog(`⚠️ Invalid server IP: ${config.serverIp}. Please set SERVER_IP environment variable.`, 'warning');
        botStats.connected = false;
        return;
    }
    
    addLog(`🤖 Bot connecting to ${config.serverIp}:${config.serverPort}...`, 'info');
    
    bot = mineflayer.createBot({
        host: config.serverIp,
        port: config.serverPort,
        username: config.username,
        auth: config.auth
    });

    bot.on('connect', () => {
        addLog(`✅ Connected to ${config.serverIp}:${config.serverPort}`, 'success');
        reconnectAttempts = 0;
    });

    bot.on('spawn', () => {
        botStats.connected = true;
        botStats.startTime = Date.now();
        addLog('✅ Bot has joined the server!', 'success');
        updatePlayerList();
        
        if (config.modes.includes('FARM')) startFarming();
        if (config.modes.includes('MINE')) startMining();
        if (config.modes.includes('PARKOUR')) startParkour();
        if (config.modes.includes('LIQUID_WALKER')) startLiquidWalker();
    });

    bot.on('health', () => {
        botStats.health = bot.health;
        botStats.food = bot.food;
    });

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

    bot.on('playerJoined', () => updatePlayerList());
    bot.on('playerLeft', () => updatePlayerList());

    bot.on('end', (reason) => {
        botStats.connected = false;
        addLog(`❌ Disconnected: ${reason || 'Unknown'}`, 'error');
        
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            addLog(`🔄 Reconnecting in 15 seconds... (Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`, 'warning');
            setTimeout(() => {
                if (bot) bot = null;
                createBot();
            }, 15000);
        } else {
            addLog(`❌ Max reconnection attempts reached. Bot stopped.`, 'error');
        }
    });

    bot.on('error', (err) => {
        addLog(`⚠️ Error: ${err.message}`, 'error');
        botStats.connected = false;
    });

    bot.on('kicked', (reason) => {
        addLog(`👢 Kicked: ${reason}`, 'error');
        botStats.connected = false;
    });
}

function updatePlayerList() {
    if (bot && bot.players) {
        botStats.players = Object.values(bot.players)
            .filter(p => p.username !== bot.username)
            .map(p => ({ username: p.username, ping: p.ping }));
    }
}

function startFarming() {
    setInterval(() => {
        if (!bot || !bot.entity || !botStats.connected) return;
        const crop = bot.findBlock({
            matching: (block) => ['wheat', 'carrots', 'potatoes', 'beetroots'].includes(block.name),
            maxDistance: 5
        });
        if (crop) {
            bot.dig(crop, (err) => {
                if (!err) {
                    botStats.blocksMined++;
                    addLog(`🌾 Farmed ${crop.name}`, 'success');
                }
            });
        }
    }, 5000);
}

function startMining() {
    const ores = ['coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'emerald_ore', 'copper_ore'];
    setInterval(() => {
        if (!bot || !bot.entity || !botStats.connected) return;
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

function startParkour() {
    setInterval(() => {
        if (!bot || !bot.entity || !botStats.connected) return;
        bot.setControlState('forward', true);
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), 500);
    }, 3000);
}

function startLiquidWalker() {
    setInterval(() => {
        if (!bot || !bot.entity || !botStats.connected) return;
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

// Start the bot
addLog(`Starting NexusBot...`, 'info');
addLog(`Target: ${config.serverIp}:${config.serverPort}`, 'info');
addLog(`Username: ${config.username}`, 'info');
addLog(`Modes: ${config.modes.join(', ') || 'None'}`, 'info');

createBot();
