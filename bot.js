// NEXUSBOT - Stable Bot (Converted from Multi-Bot)
const mineflayer = require("mineflayer");
const { Movements, pathfinder } = require("mineflayer-pathfinder");
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

// ============================================================
// CONFIGURATION (from Railway environment variables)
// ============================================================
const config = {
    username: process.env.BOT_NAME || 'NexusBot',
    serverIp: process.env.SERVER_IP || 'localhost',
    serverPort: parseInt(process.env.SERVER_PORT) || 25565,
    auth: 'offline',
    version: process.env.MC_VERSION || false,
    autoReconnect: true,
    antiAFK: true,
    autoFarm: false,
    autoMine: false,
    parkour: false,
    liquidWalker: false,
    autoResponder: false,
    chatResponses: {
        'hello': 'Hi there!',
        'how are you': 'I am a bot!',
        'help': 'I am an AFK bot'
    }
};

// ============================================================
// BOT STATE
// ============================================================
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
let lastChatTime = 0;
let chatQueue = [];
let chatQueueTimer = null;
let reconnectTimeoutId = null;
let isReconnecting = false;
let lastKickReason = null;

// ============================================================
// LOGGING
// ============================================================
function addLog(message, type = 'info') {
    const logEntry = { timestamp: new Date().toISOString(), message, type };
    botStats.logs.push(logEntry);
    if (botStats.logs.length > 200) botStats.logs.shift();
    console.log(`[${type.toUpperCase()}] ${message}`);
}

// ============================================================
// SAFE CHAT (rate limited)
// ============================================================
function safeBotChat(message) {
    chatQueue.push(message);
    if (!chatQueueTimer) processQueue();
}

function processQueue() {
    if (!chatQueue.length) { chatQueueTimer = null; return; }
    const now = Date.now();
    const wait = Math.max(0, 1200 - (now - lastChatTime));
    chatQueueTimer = setTimeout(() => {
        if (bot && botStats.connected && chatQueue.length) {
            const msg = chatQueue.shift();
            try { bot.chat(msg); lastChatTime = Date.now(); } catch (_) {}
        }
        processQueue();
    }, wait);
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
// EXPRESS API SERVER (for your website)
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
    if (bot && botStats.connected) restartFeatures();
    res.json({ success: true });
});

// Update chat responses
app.post('/api/chat', (req, res) => {
    const { responses } = req.body;
    if (responses) {
        config.chatResponses = { ...config.chatResponses, ...responses };
        addLog(`Chat responses updated`, 'success');
    }
    res.json({ success: true });
});

// Command endpoint
app.post('/command', (req, res) => {
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: 'No command' });
    addLog(`[Command] ${command}`, 'control');
    if (command === 'start') {
        if (!botStats.connected) createBot();
        res.json({ success: true });
    } else if (command === 'stop') {
        if (bot) { clearIntervals(); bot.end(); bot = null; botStats.connected = false; }
        res.json({ success: true });
    } else if (command === 'restart') {
        if (bot) { clearIntervals(); bot.end(); bot = null; }
        botStats.connected = false;
        botStats.reconnectAttempts = 0;
        setTimeout(() => createBot(), 3000);
        res.json({ success: true });
    } else {
        if (bot && botStats.connected) {
            safeBotChat(command);
            res.json({ success: true });
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
    if (config.antiAFK) startAntiAFK();
    if (config.autoFarm) setTimeout(() => startFarming(), 5000);
    if (config.autoMine) setTimeout(() => startMining(), 8000);
    if (config.parkour) setTimeout(() => startParkour(), 10000);
    if (config.liquidWalker) setTimeout(() => startLiquidWalker(), 12000);
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
                if (!err) { botStats.blocksMined++; addLog(`Farmed ${crop.name}`, 'success'); }
            });
        }
    }, 8000);
}

function startMining() {
    const ores = ['coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'emerald_ore', 'copper_ore'];
    addInterval(() => {
        if (!bot || !bot.entity || !botStats.connected || !config.autoMine) return;
        const ore = bot.findBlock({ matching: (block) => ores.includes(block.name), maxDistance: 5 });
        if (ore) {
            bot.dig(ore, (err) => {
                if (!err) { botStats.blocksMined++; addLog(`Mined ${ore.name}`, 'success'); }
            });
        }
    }, 6000);
}

function startParkour() {
    addInterval(() => {
        if (!bot || !bot.entity || !botStats.connected || !config.parkour) return;
        bot.setControlState('forward', true);
        setTimeout(() => bot.setControlState('forward', false), 800);
    }, 15000);
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
    }, 5000);
}

// ============================================================
// KICK ANALYSIS (from Multi-Bot)
// ============================================================
function analyzeKickReason(reason) {
    const r = (reason || "").toLowerCase();
    if (r.includes("already connected") || r.includes("proxy"))
        return { label: "Duplicate Session", tip: "Wait 60-90s before reconnecting." };
    if (r.includes("throttl") || r.includes("too fast") || r.includes("wait before"))
        return { label: "Rate Throttled", tip: "Server throttled reconnects. Waiting longer." };
    if (r.includes("banned")) return { label: "Banned", tip: "Bot may be banned." };
    if (r.includes("whitelist")) return { label: "Not Whitelisted", tip: "Add bot to whitelist." };
    if (r.includes("outdated") || r.includes("version"))
        return { label: "Version Mismatch", tip: "Update Minecraft version." };
    if (r.includes("timeout") || r.includes("timed out"))
        return { label: "Connection Timeout", tip: "Server took too long to respond." };
    if (r === "" || r.includes("end of stream"))
        return { label: "Server Offline", tip: "Server is sleeping or starting up." };
    return { label: "Unknown Kick", tip: reason || "No reason provided." };
}

function getReconnectDelay() {
    const r = (lastKickReason || "").toLowerCase();
    if (r.includes("already connected") || r.includes("proxy")) return 65000;
    if (lastKickReason === "") return 30000;
    const base = 3000;
    const max = 30000;
    return Math.min(base * Math.pow(2, botStats.reconnectAttempts), max) + Math.floor(Math.random() * 2000);
}

// ============================================================
// BOT CONNECTION (STABLE - from Multi-Bot)
// ============================================================
function createBot() {
    if (!config.serverIp || config.serverIp === 'localhost' || config.serverIp === 'mc.example.com') {
        addLog(`Invalid SERVER_IP: "${config.serverIp}". Please set a valid Minecraft server IP.`, 'error');
        return;
    }
    
    if (isReconnecting) { addLog(`Already reconnecting...`, 'warning'); return; }
    
    addLog(`Connecting to ${config.serverIp}:${config.serverPort} as "${config.username}"...`, 'info');
    
    const cacheFolder = path.join(__dirname, `./auth_cache_${config.username.replace(/[^a-z0-9]/gi, '_')}`);
    if (!fs.existsSync(cacheFolder)) fs.mkdirSync(cacheFolder, { recursive: true });
    
    const botOptions = {
        host: config.serverIp,
        port: config.serverPort,
        username: config.username,
        auth: config.auth,
        profilesFolder: cacheFolder,
        viewDistance: 'normal',
        hideErrors: false,
        keepAlive: false,
        checkTimeoutInterval: 600000
    };
    
    if (config.version) botOptions.version = config.version;
    
    try {
        bot = mineflayer.createBot(botOptions);
    } catch (err) {
        addLog(`Failed to create bot: ${err.message}`, 'error');
        scheduleReconnect();
        return;
    }
    
    bot.loadPlugin(pathfinder);
    
    let spawnHandled = false;
    
    bot.once('spawn', () => {
        if (spawnHandled) return;
        spawnHandled = true;
        lastKickReason = null;
        botStats.connected = true;
        botStats.startTime = Date.now();
        botStats.reconnectAttempts = 0;
        isReconnecting = false;
        addLog(`Bot has joined the server! Version: ${bot.version}`, 'success');
        updatePlayerList();
        
        // Setup pathfinder movements
        try {
            const mcData = require('minecraft-data')(bot.version);
            const defaultMove = new Movements(bot, mcData);
            defaultMove.allowFreeMotion = false;
            defaultMove.canDig = false;
            bot.pathfinder.setMovements(defaultMove);
        } catch (err) {
            addLog(`Pathfinder setup failed: ${err.message}`, 'warning');
        }
        
        setTimeout(() => { restartFeatures(); }, 5000);
    });
    
    bot.on('connect', () => {
        addLog(`Connected to ${config.serverIp}:${config.serverPort}`, 'success');
    });
    
    bot.on('health', () => {
        if (bot) { botStats.health = bot.health; botStats.food = bot.food; }
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
    
    bot.on('playerJoined', (player) => { updatePlayerList(); addLog(`Player joined: ${player.username}`, 'info'); });
    bot.on('playerLeft', (player) => { updatePlayerList(); addLog(`Player left: ${player.username}`, 'info'); });
    
    bot.on('chat', (username, message) => {
        if (username === bot.username) return;
        addLog(`<${username}> ${message}`, 'info');
        if (!config.autoResponder) return;
        const lowerMsg = message.toLowerCase();
        for (const [keyword, response] of Object.entries(config.chatResponses)) {
            if (lowerMsg.includes(keyword.toLowerCase())) {
                setTimeout(() => {
                    if (bot && botStats.connected) {
                        bot.chat(response);
                        addLog(`Auto-reply to ${username}: ${response}`, 'success');
                    }
                }, 1000);
                break;
            }
        }
    });
    
    bot.on('kicked', (reason) => {
        const reasonStr = typeof reason === 'string' ? reason : JSON.stringify(reason);
        addLog(`Kicked: ${reasonStr}`, 'error');
        botStats.connected = false;
        clearIntervals();
        lastKickReason = reasonStr;
        const analysis = analyzeKickReason(reasonStr);
        addLog(`[Analysis] ${analysis.label}: ${analysis.tip}`, 'warning');
        scheduleReconnect();
    });
    
    bot.on('end', (reason) => {
        addLog(`Disconnected: ${reason || 'Unknown'}`, 'error');
        botStats.connected = false;
        clearIntervals();
        scheduleReconnect();
    });
    
    bot.on('error', (err) => {
        addLog(`Error: ${err.message}`, 'error');
    });
}

function scheduleReconnect() {
    if (!config.autoReconnect) {
        addLog(`Auto-reconnect is disabled. Bot will not reconnect.`, 'warning');
        return;
    }
    if (isReconnecting) return;
    isReconnecting = true;
    botStats.reconnectAttempts++;
    const delay = getReconnectDelay();
    addLog(`Reconnecting in ${(delay/1000).toFixed(1)}s (Attempt #${botStats.reconnectAttempts})`, 'warning');
    reconnectTimeoutId = setTimeout(() => {
        reconnectTimeoutId = null;
        isReconnecting = false;
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
addLog(`Starting NexusBot (Stable Multi-Bot Core)...`, 'info');
addLog(`Target: ${config.serverIp}:${config.serverPort}`, 'info');
addLog(`Username: ${config.username}`, 'info');
addLog(`Auth: ${config.auth}`, 'info');

createBot();
