"use strict";

const mineflayer = require("mineflayer");
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

// ============================================================
// CONFIGURATION
// ============================================================
const config = {
    username: process.env.BOT_NAME || 'NexusBot',
    serverIp: process.env.SERVER_IP || 'localhost',
    serverPort: parseInt(process.env.SERVER_PORT) || 25565,
    auth: 'offline',
    version: process.env.MC_VERSION || '1.20.4',
    // Features (can be toggled via API)
    autoReconnect: true,
    antiAFK: true,
    autoFarm: false,
    autoMine: false,
    parkour: false,
    liquidWalker: false,
    autoResponder: false,
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
    logs: [],
    startTime: Date.now(),
    blocksMined: 0,
    reconnectAttempts: 0
};

let bot = null;
let activeIntervals = [];

// ============================================================
// LOGGING
// ============================================================
function addLog(message, type = 'info') {
    const logEntry = { 
        timestamp: new Date().toISOString(), 
        message: message, 
        type: type 
    };
    botStats.logs.push(logEntry);
    if (botStats.logs.length > 200) botStats.logs.shift();
    console.log(`[${type.toUpperCase()}] ${message}`);
}

// ============================================================
// INTERVAL MANAGEMENT
// ============================================================
function clearIntervals() {
    activeIntervals.forEach(id => clearInterval(id));
    activeIntervals = [];
}

function addInterval(callback, delay) {
    const id = setInterval(callback, delay);
    activeIntervals.push(id);
    return id;
}

// ============================================================
// EXPRESS API SERVER
// ============================================================
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
        blocksMined: botStats.blocksMined,
        reconnectAttempts: botStats.reconnectAttempts
    });
});

// Logs endpoint
app.get('/logs', (req, res) => {
    res.json(botStats.logs.slice(-150));
});

// Get settings
app.get('/api/settings', (req, res) => {
    res.json({
        autoReconnect: config.autoReconnect,
        antiAFK: config.antiAFK,
        autoFarm: config.autoFarm,
        autoMine: config.autoMine,
        parkour: config.parkour,
        liquidWalker: config.liquidWalker,
        autoResponder: config.autoResponder,
        chatResponses: config.chatResponses
    });
});

// Update settings
app.post('/api/settings', (req, res) => {
    const { autoReconnect, antiAFK, autoFarm, autoMine, parkour, liquidWalker, autoResponder } = req.body;
    
    if (autoReconnect !== undefined) config.autoReconnect = autoReconnect;
    if (antiAFK !== undefined) config.antiAFK = antiAFK;
    if (autoFarm !== undefined) config.autoFarm = autoFarm;
    if (autoMine !== undefined) config.autoMine = autoMine;
    if (parkour !== undefined) config.parkour = parkour;
    if (liquidWalker !== undefined) config.liquidWalker = liquidWalker;
    if (autoResponder !== undefined) config.autoResponder = autoResponder;
    
    addLog(`Settings updated via API`, 'success');
    
    if (bot && botStats.connected) {
        restartFeatures();
    }
    
    res.json({ success: true });
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
    
    addLog(`[Command] ${command}`, 'control');
    
    if (command === 'start') {
        if (!botStats.connected) {
            createBot();
        }
        res.json({ success: true, message: 'Start command received' });
    } 
    else if (command === 'stop') {
        if (bot) {
            clearIntervals();
            bot.end();
            bot = null;
            botStats.connected = false;
        }
        res.json({ success: true, message: 'Stop command received' });
    }
    else if (command === 'restart') {
        if (bot) {
            clearIntervals();
            bot.end();
            bot = null;
        }
        botStats.connected = false;
        botStats.reconnectAttempts = 0;
        setTimeout(() => createBot(), 3000);
        res.json({ success: true, message: 'Restart command received' });
    }
    else {
        if (bot && botStats.connected) {
            bot.chat(command);
            res.json({ success: true, message: 'Message sent' });
        } else {
            res.status(503).json({ error: 'Bot not connected' });
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    addLog(`[API] Server running on port ${PORT}`);
});

// ============================================================
// BOT FEATURES
// ============================================================
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
        if (bot && botStats.connected && config.antiAFK) {
            try { bot.swingArm(); } catch(e) {}
        }
    }, 15000);
    
    addInterval(() => {
        if (bot && botStats.connected && config.antiAFK) {
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

// ============================================================
// BOT CONNECTION (STABLE VERSION)
// ============================================================
function createBot() {
    if (!config.serverIp || config.serverIp === 'localhost' || config.serverIp === 'mc.example.com') {
        addLog(`⚠️ Invalid SERVER_IP: "${config.serverIp}". Please set a valid Minecraft server IP.`, 'error');
        return;
    }
    
    addLog(`🤖 Bot connecting to ${config.serverIp}:${config.serverPort} as "${config.username}"...`, 'info');
    
    // Unique cache folder to prevent Microsoft auth conflicts
    const cacheFolder = path.join(__dirname, `./auth_cache_${config.username.replace(/[^a-z0-9]/gi, '_')}`);
    if (!fs.existsSync(cacheFolder)) fs.mkdirSync(cacheFolder, { recursive: true });
    
    try {
        bot = mineflayer.createBot({
            host: config.serverIp,
            port: config.serverPort,
            username: config.username,
            auth: config.auth,
            version: config.version,
            profilesFolder: cacheFolder,
            viewDistance: 'normal',
            hideErrors: false
        });
    } catch (err) {
        addLog(`❌ Failed to create bot: ${err.message}`, 'error');
        scheduleReconnect();
        return;
    }
    
    bot.on('connect', () => {
        addLog(`✅ Connected to ${config.serverIp}:${config.serverPort}`, 'success');
    });
    
    bot.on('spawn', () => {
        botStats.connected = true;
        botStats.startTime = Date.now();
        botStats.reconnectAttempts = 0;
        addLog(`✅ Bot has joined the server!`, 'success');
        updatePlayerList();
        
        // Wait 3 seconds then start features
        setTimeout(() => {
            restartFeatures();
        }, 3000);
    });
    
    bot.on('health', () => {
        if (bot) {
            botStats.health = bot.health;
            botStats.food = bot.food;
        }
    });
    
    // Position tracking
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
        addLog(`👤 Player joined: ${player.username}`, 'info');
    });
    
    bot.on('playerLeft', (player) => {
        updatePlayerList();
        addLog(`👤 Player left: ${player.username}`, 'info');
    });
    
    // Chat handler for auto-responses
    bot.on('chat', (username, message) => {
        if (username === bot.username) return;
        addLog(`💬 <${username}> ${message}`, 'info');
        
        if (!config.autoResponder) return;
        
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
        scheduleReconnect();
    });
    
    bot.on('error', (err) => {
        addLog(`⚠️ Error: ${err.message}`, 'error');
    });
    
    bot.on('kicked', (reason) => {
        const reasonStr = typeof reason === 'string' ? reason : JSON.stringify(reason);
        addLog(`👢 Kicked: ${reasonStr}`, 'error');
        botStats.connected = false;
        clearIntervals();
        scheduleReconnect();
    });
}

function scheduleReconnect() {
    if (!config.autoReconnect) {
        addLog(`Auto-reconnect is disabled. Bot will not reconnect.`, 'warning');
        return;
    }
    
    if (botStats.reconnectAttempts >= 10) {
        addLog(`❌ Max reconnection attempts (10) reached. Bot stopped.`, 'error');
        return;
    }
    
    botStats.reconnectAttempts++;
    const delay = Math.min(5000 * botStats.reconnectAttempts, 30000);
    addLog(`🔄 Reconnecting in ${delay/1000} seconds... (Attempt ${botStats.reconnectAttempts}/10)`, 'warning');
    
    setTimeout(() => {
        if (bot) {
            try { bot.removeAllListeners(); } catch(e) {}
            bot = null;
        }
        createBot();
    }, delay);
}

function updatePlayerList() {
    if (bot && bot.players) {
        botStats.players = Object.values(bot.players)
            .filter(p => p.username !== bot.username)
            .map(p => ({ username: p.username, ping: p.ping }));
    }
}

// ============================================================
// START BOT
// ============================================================
addLog(`🚀 Starting NexusBot v2...`, 'info');
addLog(`📡 Target: ${config.serverIp}:${config.serverPort}`, 'info');
addLog(`🤖 Username: ${config.username}`, 'info');
addLog(`🔌 Auth: ${config.auth}`, 'info');
addLog(`📦 Version: ${config.version}`, 'info');

createBot();
