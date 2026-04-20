// NEXUSBOT - Minecraft Bot with API Server (Full Control Version)
const mineflayer = require('mineflayer');
const express = require('express');
const cors = require('cors');

// Bot configuration with defaults
let config = {
    username: process.env.BOT_NAME || 'NexusBot',
    serverIp: process.env.SERVER_IP || 'localhost',
    serverPort: parseInt(process.env.SERVER_PORT) || 25565,
    auth: 'offline',
    modes: (process.env.BOT_MODES || '').split(',').filter(m => m && m.trim()),
    // Dynamic settings (can be changed via API)
    autoReconnect: true,
    antiAFK: true,
    autoFarm: false,
    autoMine: false,
    parkour: false,
    liquidWalker: false,
    chatResponses: {
        'hello': 'Hi there!',
        'how are you': 'I am a bot, but I am doing great!',
        'help': 'I can farm, mine, and more!'
    }
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

let bot = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
let activeIntervals = [];

function addLog(message, type = 'info') {
    const logEntry = { timestamp: new Date().toISOString(), message, type };
    botStats.logs.push(logEntry);
    if (botStats.logs.length > 200) botStats.logs.shift();
    console.log(`[${type.toUpperCase()}] ${message}`);
}

function clearIntervals() {
    activeIntervals.forEach(id => clearInterval(id));
    activeIntervals = [];
}

function addInterval(callback, delay) {
    const id = setInterval(callback, delay);
    activeIntervals.push(id);
    return id;
}

// API Server
const app = express();
app.use(cors());
app.use(express.json());

// Health endpoint
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
        blocksMined: botStats.blocksMined
    });
});

// Logs endpoint
app.get('/logs', (req, res) => {
    res.json(botStats.logs.slice(-100));
});

// Get all settings
app.get('/api/settings', (req, res) => {
    res.json({
        autoReconnect: config.autoReconnect,
        antiAFK: config.antiAFK,
        autoFarm: config.autoFarm,
        autoMine: config.autoMine,
        parkour: config.parkour,
        liquidWalker: config.liquidWalker,
        chatResponses: config.chatResponses
    });
});

// Update settings
app.post('/api/settings', (req, res) => {
    const { autoReconnect, antiAFK, autoFarm, autoMine, parkour, liquidWalker } = req.body;
    
    if (autoReconnect !== undefined) config.autoReconnect = autoReconnect;
    if (antiAFK !== undefined) config.antiAFK = antiAFK;
    if (autoFarm !== undefined) config.autoFarm = autoFarm;
    if (autoMine !== undefined) config.autoMine = autoMine;
    if (parkour !== undefined) config.parkour = parkour;
    if (liquidWalker !== undefined) config.liquidWalker = liquidWalker;
    
    addLog(`Settings updated via API`, 'success');
    
    // Restart features based on new settings
    if (bot && botStats.connected) {
        restartFeatures();
    }
    
    res.json({ success: true, config: { autoReconnect: config.autoReconnect, antiAFK: config.antiAFK, autoFarm: config.autoFarm, autoMine: config.autoMine, parkour: config.parkour, liquidWalker: config.liquidWalker } });
});

// Update chat responses
app.post('/api/chat', (req, res) => {
    const { responses } = req.body;
    if (responses) {
        config.chatResponses = { ...config.chatResponses, ...responses };
        addLog(`Chat responses updated: ${Object.keys(responses).length} rules`, 'success');
    }
    res.json({ success: true, chatResponses: config.chatResponses });
});

// Command endpoint
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

// Bot functions
function restartFeatures() {
    clearIntervals();
    
    if (config.autoFarm) startFarming();
    if (config.autoMine) startMining();
    if (config.parkour) startParkour();
    if (config.liquidWalker) startLiquidWalker();
    if (config.antiAFK) startAntiAFK();
}

function startAntiAFK() {
    addInterval(() => {
        if (bot && botStats.connected) {
            try { bot.swingArm(); } catch(e) {}
        }
    }, 15000);
    
    addInterval(() => {
        if (bot && botStats.connected) {
            try { bot.look(Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.5, true); } catch(e) {}
        }
    }, 10000);
}

function startFarming() {
    addInterval(() => {
        if (!bot || !bot.entity || !botStats.connected || !config.autoFarm) return;
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
    addInterval(() => {
        if (!bot || !bot.entity || !botStats.connected || !config.autoMine) return;
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
    addInterval(() => {
        if (!bot || !bot.entity || !botStats.connected || !config.parkour) return;
        bot.setControlState('forward', true);
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), 500);
    }, 3000);
}

function startLiquidWalker() {
    addInterval(() => {
        if (!bot || !bot.entity || !botStats.connected || !config.liquidWalker) return;
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

function createBot() {
    if (!config.serverIp || config.serverIp === 'localhost' || config.serverIp === 'mc.example.com') {
        addLog(`⚠️ Invalid SERVER_IP: "${config.serverIp}". Please set a valid Minecraft server IP.`, 'error');
        return;
    }
    
    addLog(`🤖 Bot connecting to ${config.serverIp}:${config.serverPort} as "${config.username}"...`, 'info');
    
    bot = mineflayer.createBot({
        host: config.serverIp,
        port: config.serverPort,
        username: config.username,
        auth: config.auth,
        version: '1.20.4'
    });

    bot.on('connect', () => {
        addLog(`✅ Connected to ${config.serverIp}:${config.serverPort}`, 'success');
        reconnectAttempts = 0;
    });

    bot.once('spawn', () => {
        botStats.connected = true;
        botStats.startTime = Date.now();
        addLog('✅ Bot has joined the server!', 'success');
        updatePlayerList();
        
        // Wait 3 seconds then start features
        setTimeout(() => {
            restartFeatures();
        }, 3000);
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

    bot.on('playerJoined', (player) => {
        updatePlayerList();
        addLog(`📥 Player joined: ${player.username}`, 'info');
    });
    
    bot.on('playerLeft', (player) => {
        updatePlayerList();
        addLog(`📤 Player left: ${player.username}`, 'info');
    });

    // Chat handler for auto-responses
    bot.on('chat', (username, message) => {
        if (username === bot.username) return;
        addLog(`💬 <${username}> ${message}`, 'info');
        
        // Check for auto-responses
        const lowerMsg = message.toLowerCase();
        for (const [keyword, response] of Object.entries(config.chatResponses)) {
            if (lowerMsg.includes(keyword.toLowerCase())) {
                setTimeout(() => {
                    if (bot && botStats.connected) {
                        bot.chat(response);
                        addLog(`🤖 Auto-reply to ${username}: ${response}`, 'success');
                    }
                }, 1000);
                break;
            }
        }
    });

    bot.on('end', (reason) => {
        botStats.connected = false;
        addLog(`❌ Disconnected: ${reason || 'Unknown'}`, 'error');
        clearIntervals();
        
        if (config.autoReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            addLog(`🔄 Reconnecting in 10 seconds... (Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`, 'warning');
            setTimeout(() => {
                bot = null;
                createBot();
            }, 10000);
        }
    });

    bot.on('error', (err) => {
        addLog(`⚠️ Error: ${err.message}`, 'error');
    });

    bot.on('kicked', (reason) => {
        addLog(`👢 Kicked: ${reason}`, 'error');
        botStats.connected = false;
        clearIntervals();
        
        if (config.autoReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            addLog(`🔄 Reconnecting in 15 seconds... (Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`, 'warning');
            setTimeout(() => {
                bot = null;
                createBot();
            }, 15000);
        }
    });
}

function updatePlayerList() {
    if (bot && bot.players) {
        botStats.players = Object.values(bot.players)
            .filter(p => p.username !== bot.username)
            .map(p => ({ username: p.username, ping: p.ping }));
    }
}

// Start everything
addLog(`🚀 Starting NexusBot...`, 'info');
addLog(`📡 Target: ${config.serverIp}:${config.serverPort}`, 'info');
addLog(`🤖 Username: ${config.username}`, 'info');
addLog(`⚙️ Modes: ${config.modes.length ? config.modes.join(', ') : 'None'}`, 'info');

createBot();
