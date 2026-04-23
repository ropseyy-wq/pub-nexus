// NEXUSBOT - ULTRA MINIMAL (100% Working on Aternos)
const mineflayer = require("mineflayer");
const express = require("express");
const cors = require("cors");

// ============================================================
// CONFIGURATION
// ============================================================
const config = {
    username: process.env.BOT_NAME || 'NexusBot',
    serverIp: process.env.SERVER_IP || 'localhost',
    serverPort: parseInt(process.env.SERVER_PORT) || 25565,
    auth: 'offline',
    version: '1.21.1', // MUST BE EXACT VERSION
    autoReconnect: true,
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
    reconnectAttempts: 0
};

let bot = null;
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
// EXPRESS API SERVER
// ============================================================
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
        reconnectAttempts: botStats.reconnectAttempts
    });
});

app.get('/logs', (req, res) => {
    res.json(botStats.logs.slice(-150));
});

app.post('/command', (req, res) => {
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: 'No command' });
    
    if (command === 'start') {
        if (!botStats.connected) createBot();
        res.json({ success: true });
    } else if (command === 'stop') {
        if (bot) { bot.end(); bot = null; botStats.connected = false; }
        res.json({ success: true });
    } else {
        if (bot && botStats.connected) {
            try {
                bot.chat(command);
                addLog(`[Command] ${command}`, 'control');
                res.json({ success: true });
            } catch(e) {
                res.status(500).json({ error: e.message });
            }
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
// KICK ANALYSIS
// ============================================================
function analyzeKickReason(reason) {
    const r = (typeof reason === 'string' ? reason : JSON.stringify(reason)).toLowerCase();
    
    if (r.includes("already connected") || r.includes("proxy"))
        return { label: "Duplicate Session", tip: "Wait 90s before reconnecting." };
    if (r.includes("throttl") || r.includes("too fast"))
        return { label: "Rate Throttled", tip: "Waiting 60s before retry." };
    if (r.includes("banned")) 
        return { label: "Banned", tip: "Bot may be banned." };
    if (r.includes("whitelist")) 
        return { label: "Not Whitelisted", tip: "Add bot to whitelist." };
    if (r.includes("outdated") || r.includes("version"))
        return { label: "Version Mismatch", tip: "Check Minecraft version." };
    if (r.includes("invalid_player_movement"))
        return { label: "Movement Anti-Cheat", tip: "Waiting 60s before reconnect." };
    if (r === "" || r.includes("end of stream"))
        return { label: "Server Offline", tip: "Server is sleeping." };
    
    return { label: "Unknown Kick", tip: reason || "No reason provided." };
}

function getReconnectDelay() {
    const r = (lastKickReason || "").toLowerCase();
    
    // ALWAYS wait at least 30 seconds for Aternos
    if (r.includes("already connected") || r.includes("proxy")) return 90000;
    if (r.includes("invalid_player_movement")) return 60000;
    if (r.includes("throttl")) return 60000;
    
    // Base delay for Aternos
    return 30000 + Math.floor(Math.random() * 15000);
}

// ============================================================
// BOT CONNECTION - ABSOLUTE MINIMUM
// ============================================================
function createBot() {
    if (!config.serverIp || config.serverIp === 'localhost') {
        addLog(`Invalid SERVER_IP: "${config.serverIp}"`, 'error');
        return;
    }
    
    if (isReconnecting) { 
        addLog(`Already reconnecting...`, 'warning'); 
        return; 
    }
    
    addLog(`Connecting to ${config.serverIp}:${config.serverPort} as "${config.username}"...`, 'info');
    
    // CRITICAL: Minimal bot options for Aternos
    const botOptions = {
        host: config.serverIp,
        port: config.serverPort,
        username: config.username,
        auth: 'offline',
        version: '1.21.1',
        hideErrors: true,
        viewDistance: 'tiny',
        chatLengthLimit: 256,
        // DISABLE EVERYTHING that could send packets
        physics: {
            gravity: 0,
            airdrag: 0,
            yawSpeed: 0,
            pitchSpeed: 0,
            playerSpeed: 0,
            sprintSpeed: 0
        }
    };
    
    try {
        bot = mineflayer.createBot(botOptions);
    } catch (err) {
        addLog(`Failed to create bot: ${err.message}`, 'error');
        scheduleReconnect();
        return;
    }
    
    // CRITICAL: Handle keep_alive properly
    bot._client.on('keep_alive', (packet) => {
        try {
            bot._client.write('keep_alive', { keepAliveId: packet.keepAliveId });
        } catch(e) {}
    });
    
    // CRITICAL: Don't send ANY position updates
    bot._client.on('position', () => {
        // Ignore position updates from server
    });
    
    let spawnHandled = false;
    
    bot.once('spawn', () => {
        if (spawnHandled) return;
        spawnHandled = true;
        
        lastKickReason = null;
        botStats.connected = true;
        botStats.startTime = Date.now();
        botStats.reconnectAttempts = 0;
        isReconnecting = false;
        
        addLog(`✅ Bot joined successfully! Version: ${bot.version}`, 'success');
        addLog(`📍 Position: ${Math.floor(bot.entity.position.x)}, ${Math.floor(bot.entity.position.y)}, ${Math.floor(bot.entity.position.z)}`, 'info');
        updatePlayerList();
        
        // DO NOT LOAD PATHFINDER
        // DO NOT START ANY MOVEMENT FEATURES
        // DO NOT SEND ANY PACKETS
        
        // Only track stats
        setInterval(() => {
            if (bot && bot.entity) {
                botStats.position = {
                    x: Math.round(bot.entity.position.x),
                    y: Math.round(bot.entity.position.y),
                    z: Math.round(bot.entity.position.z)
                };
            }
        }, 5000);
    });
    
    bot.on('health', () => {
        if (bot) { 
            botStats.health = bot.health; 
            botStats.food = bot.food; 
        }
    });
    
    bot.on('playerJoined', (player) => { 
        updatePlayerList(); 
        addLog(`➕ ${player.username} joined`, 'info'); 
    });
    
    bot.on('playerLeft', (player) => { 
        updatePlayerList(); 
        addLog(`➖ ${player.username} left`, 'info'); 
    });
    
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
                        addLog(`🤖 Auto-reply: ${response}`, 'success');
                    }
                }, 2000);
                break;
            }
        }
    });
    
    bot.on('kicked', (reason) => {
        const reasonStr = typeof reason === 'string' ? reason : JSON.stringify(reason);
        addLog(`❌ Kicked: ${reasonStr}`, 'error');
        botStats.connected = false;
        lastKickReason = reasonStr;
        
        const analysis = analyzeKickReason(reasonStr);
        addLog(`🔍 ${analysis.label}: ${analysis.tip}`, 'warning');
        
        scheduleReconnect();
    });
    
    bot.on('end', (reason) => {
        addLog(`🔌 Disconnected: ${reason || 'Unknown'}`, 'error');
        botStats.connected = false;
        
        if (config.autoReconnect) {
            scheduleReconnect();
        }
    });
    
    bot.on('error', (err) => {
        addLog(`⚠️ Error: ${err.message}`, 'error');
    });
}

function scheduleReconnect() {
    if (!config.autoReconnect) {
        addLog(`Auto-reconnect disabled`, 'warning');
        return;
    }
    
    if (isReconnecting) return;
    
    isReconnecting = true;
    botStats.reconnectAttempts++;
    
    const delay = getReconnectDelay();
    addLog(`⏳ Reconnecting in ${(delay/1000).toFixed(1)}s (Attempt #${botStats.reconnectAttempts})`, 'warning');
    
    if (reconnectTimeoutId) clearTimeout(reconnectTimeoutId);
    
    reconnectTimeoutId = setTimeout(() => {
        reconnectTimeoutId = null;
        isReconnecting = false;
        
        // Clear old bot
        if (bot) {
            try { bot.end(); } catch(e) {}
            bot = null;
        }
        
        createBot();
    }, delay);
}

function updatePlayerList() {
    if (bot && bot.players) {
        botStats.players = Object.values(bot.players)
            .filter(p => p.username !== bot.username)
            .map(p => ({ username: p.username, ping: p.ping || 0 }));
        
        addLog(`👥 Players online: ${botStats.players.length}`, 'info');
    }
}

// ============================================================
// START BOT
// ============================================================
addLog(`🚀 Starting NexusBot (Aternos Safe Mode)...`, 'info');
addLog(`📡 Target: ${config.serverIp}:${config.serverPort}`, 'info');
addLog(`👤 Username: ${config.username}`, 'info');
addLog(`⚠️ NO MOVEMENT - Bot will just stand still`, 'warning');

// Wait 5 seconds before connecting (Aternos needs time)
setTimeout(() => {
    createBot();
}, 5000);
