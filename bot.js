"use strict";

// ============================================================
// NEXUSBOT - Single File with Environment Variables
// ============================================================

const mineflayer = require("mineflayer");
const { Movements, pathfinder, goals } = require("mineflayer-pathfinder");
const { GoalBlock } = goals;
const express = require("express");
const http = require("http");
const https = require("https");
const fs = require("fs");

// ============================================================
// CONFIGURATION FROM ENVIRONMENT VARIABLES
// ============================================================
const config = {
    // Bot account settings
    username: process.env.BOT_NAME || 'NexusBot',
    password: process.env.BOT_PASSWORD || '',
    auth: process.env.BOT_AUTH || 'offline',
    
    // Server settings
    serverIp: process.env.SERVER_IP || 'localhost',
    serverPort: parseInt(process.env.SERVER_PORT) || 25565,
    serverVersion: process.env.MC_VERSION || false,
    
    // Feature toggles
    autoReconnect: process.env.AUTO_RECONNECT !== 'false',
    antiAFK: process.env.ANTI_AFK !== 'false',
    autoAuth: process.env.AUTO_AUTH === 'true',
    authPassword: process.env.AUTH_PASSWORD || '',
    autoResponder: process.env.AUTO_RESPONDER === 'true',
    tryCreative: process.env.TRY_CREATIVE === 'true',
    
    // Delays
    reconnectDelay: 3000,
    maxReconnectDelay: 30000,
    
    // Position (optional)
    goToPosition: {
        enabled: false,
        x: 0,
        y: 64,
        z: 0
    }
};

// ============================================================
// CHAT RESPONSES
// ============================================================
const chatResponses = {
    'hello': 'Hi there!',
    'how are you': 'I am a bot!',
    'help': 'I am an AFK bot',
    'ping': 'Pong!'
};

// ============================================================
// LOGGER
// ============================================================
let logs = [];
function addLog(message) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}`;
    logs.push({ timestamp, message });
    if (logs.length > 500) logs.shift();
    console.log(logEntry);
}
function getLogs() { return logs; }

// ============================================================
// EXPRESS APP
// ============================================================
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

// ============================================================
// BOT STATE
// ============================================================
let bot = null;
let botState = {
    connected: false,
    startTime: Date.now(),
    reconnectAttempts: 0,
    ping: null,
    health: null,
    food: null,
    players: [],
    position: null,
    lastKickAnalysis: null
};

let activeIntervals = [];
let reconnectTimeoutId = null;
let connectionTimeoutId = null;
let isReconnecting = false;
let lastKickReason = null;
let botRunning = true;

// Chat history
let chatHistory = [];
function addChat(username, message) {
    chatHistory.push({ username, message, time: Date.now() });
    if (chatHistory.length > 50) chatHistory = chatHistory.slice(-50);
}

// Chat queue for rate limiting
const CHAT_COOLDOWN_MS = 1200;
let lastChatTime = 0;
let chatQueue = [];
let chatQueueTimer = null;

function safeBotChat(message) {
    chatQueue.push(message);
    if (!chatQueueTimer) processQueue();
}

function processQueue() {
    if (!chatQueue.length) { 
        chatQueueTimer = null; 
        return; 
    }
    const now = Date.now();
    const wait = Math.max(0, CHAT_COOLDOWN_MS - (now - lastChatTime));
    chatQueueTimer = setTimeout(() => {
        if (bot && botState.connected && chatQueue.length) {
            const msg = chatQueue.shift();
            try { 
                bot.chat(msg); 
                lastChatTime = Date.now(); 
            } catch (_) {}
        }
        processQueue();
    }, wait);
}

// ============================================================
// API ENDPOINTS
// ============================================================
app.get("/health", (req, res) => {
    const players = bot && bot.players 
        ? Object.values(bot.players).map(p => ({ 
            username: p.username, 
            ping: p.ping 
        })).filter(p => p.username)
        : [];
    
    res.json({
        status: botState.connected ? "connected" : "disconnected",
        uptime: Math.floor((Date.now() - botState.startTime) / 1000),
        coords: botState.position,
        reconnectAttempts: botState.reconnectAttempts,
        memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024,
        ping: botState.ping,
        health: botState.health,
        food: botState.food,
        players: players,
        lastKickAnalysis: botState.lastKickAnalysis,
        serverIp: config.serverIp,
        serverPort: config.serverPort,
        botRunning: botRunning
    });
});

app.get("/chat-history", (req, res) => res.json(chatHistory));
app.get("/logs-json", (req, res) => res.json(getLogs().slice(-100)));
app.get("/ping", (req, res) => res.send("pong"));

app.post("/start", (req, res) => {
    if (botRunning) return res.json({ success: false, msg: "Already running" });
    botRunning = true; 
    createBot();
    addLog("[Control] Bot started");
    res.json({ success: true });
});

app.post("/stop", (req, res) => {
    if (!botRunning) return res.json({ success: false, msg: "Already stopped" });
    botRunning = false;
    if (bot) { 
        try { bot.end(); } catch (_) {} 
        bot = null; 
    }
    clearAllIntervals(); 
    clearBotTimeouts(); 
    isReconnecting = false;
    addLog("[Control] Bot stopped");
    res.json({ success: true });
});

app.post("/command", (req, res) => {
    const cmd = (req.body.command || "").trim();
    if (!cmd) return res.json({ success: false, msg: "Empty command." });
    addLog(`[Console] > ${cmd}`);
    if (!bot || typeof bot.chat !== "function") {
        return res.json({ 
            success: false, 
            msg: bot ? "Bot still connecting." : "Bot not running." 
        });
    }
    try {
        safeBotChat(cmd);
        return res.json({ success: true, msg: `Sent: ${cmd}` });
    } catch (err) {
        return res.json({ success: false, msg: err.message });
    }
});

// Simple dashboard HTML
app.get("/", (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>${config.username} Dashboard</title>
    <style>
        body { font-family: monospace; background: #0a0f1a; color: #f1f5f9; padding: 20px; }
        .status { padding: 20px; border-radius: 8px; margin: 20px 0; }
        .online { background: #052e16; border: 2px solid #16a34a; }
        .offline { background: #1c0a0a; border: 2px solid #dc2626; }
        button { padding: 10px 20px; margin: 5px; border: none; border-radius: 5px; cursor: pointer; }
        .start { background: #15803d; color: white; }
        .stop { background: #dc2626; color: white; }
        .log { background: #111827; padding: 10px; margin: 10px 0; max-height: 300px; overflow-y: auto; }
        input { padding: 10px; width: 300px; background: #111827; border: 1px solid #1f2937; color: white; }
    </style>
</head>
<body>
    <h1>🤖 ${config.username} Bot Control</h1>
    <div id="status" class="status offline">
        <h2>Status: <span id="status-text">Disconnected</span></h2>
        <p>Server: ${config.serverIp}:${config.serverPort}</p>
        <p>Uptime: <span id="uptime">0s</span></p>
        <p>Players: <span id="players">0</span></p>
        <p>Health: <span id="health">--/20</span> | Food: <span id="food">--/20</span></p>
    </div>
    <div>
        <button class="start" onclick="fetch('/start', {method:'POST'})">▶ Start</button>
        <button class="stop" onclick="fetch('/stop', {method:'POST'})">■ Stop</button>
    </div>
    <div>
        <h3>Send Command</h3>
        <input id="cmd" placeholder="Type a command or message...">
        <button onclick="sendCmd()">Send</button>
    </div>
    <div>
        <h3>Logs</h3>
        <div id="logs" class="log">Loading...</div>
    </div>
    <script>
        function sendCmd() {
            const cmd = document.getElementById('cmd').value;
            fetch('/command', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({command: cmd})
            });
            document.getElementById('cmd').value = '';
        }
        function update() {
            fetch('/health').then(r => r.json()).then(data => {
                document.getElementById('status').className = 'status ' + data.status;
                document.getElementById('status-text').textContent = data.status === 'connected' ? 'Connected' : 'Disconnected';
                document.getElementById('uptime').textContent = Math.floor(data.uptime) + 's';
                document.getElementById('players').textContent = data.players.length;
                document.getElementById('health').textContent = (data.health || '--') + '/20';
                document.getElementById('food').textContent = (data.food || '--') + '/20';
            });
            fetch('/logs-json').then(r => r.json()).then(logs => {
                document.getElementById('logs').innerHTML = logs.map(l => 
                    '<div>' + (typeof l === 'string' ? l : l.message) + '</div>'
                ).join('');
            });
        }
        setInterval(update, 3000);
        update();
    </script>
</body>
</html>
    `);
});

// ============================================================
// KICK ANALYSIS
// ============================================================
function analyzeKickReason(reason) {
    const r = (reason || "").toLowerCase();
    if (r.includes("already connected") || r.includes("proxy"))
        return { label: "Duplicate Session", tip: "Wait 60-90s before reconnecting." };
    if (r.includes("throttl") || r.includes("too fast"))
        return { label: "Rate Throttled", tip: "Server throttled reconnects." };
    if (r.includes("banned"))
        return { label: "Banned", tip: "Bot may be banned." };
    if (r.includes("whitelist"))
        return { label: "Not Whitelisted", tip: "Add bot to whitelist." };
    if (r.includes("outdated") || r.includes("version"))
        return { label: "Version Mismatch", tip: "Update Minecraft version." };
    if (r.includes("timeout") || r.includes("timed out"))
        return { label: "Connection Timeout", tip: "Server took too long to respond." };
    if (r === "" || r.includes("end of stream"))
        return { label: "Server Offline", tip: "Server is sleeping." };
    return { label: "Unknown Kick", tip: reason || "No reason provided." };
}

function getReconnectDelay() {
    const r = (lastKickReason || "").toLowerCase();
    if (r.includes("already connected") || r.includes("proxy")) 
        return 65000 + Math.floor(Math.random() * 15000);
    if (lastKickReason === "") 
        return 30000 + Math.floor(Math.random() * 10000);
    
    const base = config.reconnectDelay;
    const max = config.maxReconnectDelay;
    return Math.min(base * Math.pow(2, botState.reconnectAttempts), max) + 
           Math.floor(Math.random() * 2000);
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================
function clearBotTimeouts() {
    if (reconnectTimeoutId) { 
        clearTimeout(reconnectTimeoutId); 
        reconnectTimeoutId = null; 
    }
    if (connectionTimeoutId) { 
        clearTimeout(connectionTimeoutId); 
        connectionTimeoutId = null; 
    }
}

function clearAllIntervals() {
    activeIntervals.forEach(id => clearInterval(id));
    activeIntervals = [];
}

function addInterval(cb, delay) {
    const id = setInterval(cb, delay);
    activeIntervals.push(id);
    return id;
}

// ============================================================
// BOT CREATION
// ============================================================
function createBot() {
    if (!botRunning) return;
    if (isReconnecting) { 
        addLog("[Bot] Already reconnecting..."); 
        return; 
    }
    
    if (bot) {
        clearAllIntervals();
        try { bot.removeAllListeners(); bot.end(); } catch (_) {}
        bot = null;
    }
    
    addLog(`[Bot] Connecting to ${config.serverIp}:${config.serverPort} as ${config.username}`);
    
    try {
        const botOptions = {
            username: config.username,
            password: config.password || undefined,
            auth: config.auth,
            host: config.serverIp,
            port: config.serverPort,
            version: config.serverVersion || false,
            hideErrors: false,
            keepAlive: false,
            checkTimeoutInterval: 600000
        };
        
        bot = mineflayer.createBot(botOptions);
        
        bot._client.on("keep_alive", packet => {
            try { 
                bot._client.write("keep_alive", { keepAliveId: packet.keepAliveId }); 
            } catch (_) {}
        });
        
        bot.loadPlugin(pathfinder);
        clearBotTimeouts();
        
        connectionTimeoutId = setTimeout(() => {
            if (!botState.connected) {
                addLog("[Bot] Connection timeout 150s");
                try { bot.removeAllListeners(); bot.end(); } catch (_) {}
                bot = null;
                scheduleReconnect();
            }
        }, 150000);
        
        let spawnHandled = false;
        
        bot.once("spawn", () => {
            if (spawnHandled) return;
            spawnHandled = true;
            lastKickReason = null;
            clearBotTimeouts();
            
            botState.connected = true;
            botState.startTime = Date.now();
            botState.reconnectAttempts = 0;
            botState.lastKickAnalysis = null;
            isReconnecting = false;
            
            addLog(`[Bot] ✅ Spawned! Version: ${bot.version}`);
            
            // Setup pathfinder
            try {
                const mcData = require('minecraft-data')(bot.version);
                const defaultMove = new Movements(bot, mcData);
                defaultMove.allowFreeMotion = false;
                defaultMove.canDig = false;
                defaultMove.liquidCost = 1000;
                defaultMove.fallDamageCost = 1000;
                bot.pathfinder.setMovements(defaultMove);
                addLog("[Bot] Pathfinder initialized");
            } catch (err) {
                addLog(`[Bot] Pathfinder failed: ${err.message}`);
            }
            
            // Track ping and position
            addInterval(() => {
                if (bot && botState.connected) {
                    botState.ping = bot.player?.ping ?? null;
                }
            }, 5000);
            
            addInterval(() => {
                if (bot && bot.entity) {
                    botState.position = bot.entity.position;
                }
            }, 2000);
            
            // Health tracking
            bot.on("health", () => {
                botState.health = bot.health;
                botState.food = bot.food;
            });
            
            // Chat tracking
            bot.on("chat", (username, message) => {
                if (username !== bot.username) {
                    addChat(username, message);
                    addLog(`[Chat] <${username}> ${message}`);
                    
                    // Auto-responder
                    if (config.autoResponder) {
                        const lowerMsg = message.toLowerCase();
                        for (const [keyword, response] of Object.entries(chatResponses)) {
                            if (lowerMsg.includes(keyword.toLowerCase())) {
                                setTimeout(() => {
                                    if (bot && botState.connected) {
                                        bot.chat(response);
                                        addLog(`[AutoReply] To ${username}: ${response}`);
                                    }
                                }, 1000);
                                break;
                            }
                        }
                    }
                }
            });
            
            // Player tracking
            bot.on("playerJoined", (player) => {
                updatePlayerList();
                addLog(`[Player] ${player.username} joined`);
            });
            
            bot.on("playerLeft", (player) => {
                updatePlayerList();
                addLog(`[Player] ${player.username} left`);
            });
            
            updatePlayerList();
            
            // Initialize features
            initializeFeatures();
            
            // Try creative mode if enabled
            if (config.tryCreative) {
                setTimeout(() => {
                    if (bot && botState.connected) {
                        safeBotChat("/gamemode creative");
                    }
                }, 3000);
            }
        });
        
        bot.on("kicked", reason => {
            const kr = typeof reason === "object" ? JSON.stringify(reason) : String(reason || "");
            addLog(`[Bot] ❌ Kicked: ${kr}`);
            botState.connected = false;
            clearAllIntervals();
            
            let kt = kr;
            try { kt = JSON.parse(kr).text || kr; } catch (_) {}
            lastKickReason = kt;
            botState.lastKickAnalysis = analyzeKickReason(kt);
            addLog(`[KickAnalyzer] ${botState.lastKickAnalysis.label}: ${botState.lastKickAnalysis.tip}`);
        });
        
        bot.on("end", reason => {
            addLog(`[Bot] Disconnected: ${reason || "Unknown"}`);
            botState.connected = false;
            clearAllIntervals();
            if (botRunning) scheduleReconnect();
        });
        
        bot.on("error", err => {
            addLog(`[Bot] Error: ${err.message}`);
        });
        
    } catch (err) {
        addLog(`[Bot] Failed to create: ${err.message}`);
        scheduleReconnect();
    }
}

function scheduleReconnect() {
    if (!botRunning || !config.autoReconnect) return;
    clearBotTimeouts();
    if (isReconnecting) return;
    
    isReconnecting = true;
    botState.reconnectAttempts++;
    const delay = getReconnectDelay();
    
    addLog(`[Bot] Reconnecting in ${(delay/1000).toFixed(1)}s (attempt #${botState.reconnectAttempts})`);
    
    reconnectTimeoutId = setTimeout(() => {
        reconnectTimeoutId = null;
        isReconnecting = false;
        lastKickReason = null;
        createBot();
    }, delay);
}

function updatePlayerList() {
    if (bot && bot.players) {
        botState.players = Object.values(bot.players)
            .filter(p => p.username !== bot.username)
            .map(p => ({ username: p.username, ping: p.ping }));
    }
}

function initializeFeatures() {
    addLog("[Features] Initializing...");
    
    // Auto-auth
    if (config.autoAuth && config.authPassword) {
        const pw = config.authPassword;
        let authHandled = false;
        
        const tryAuth = (type) => {
            if (authHandled || !bot || !botState.connected) return;
            authHandled = true;
            if (type === "register") {
                safeBotChat(`/register ${pw} ${pw}`);
                addLog("[Auth] /register sent");
            } else {
                safeBotChat(`/login ${pw}`);
                addLog("[Auth] /login sent");
            }
        };
        
        bot.on("messagestr", msg => {
            if (authHandled) return;
            const m = msg.toLowerCase();
            if (m.includes("/register") || m.includes("register ")) tryAuth("register");
            else if (m.includes("/login") || m.includes("login ")) tryAuth("login");
        });
        
        setTimeout(() => {
            if (!authHandled && bot && botState.connected) {
                safeBotChat(`/login ${pw}`);
                authHandled = true;
            }
        }, 10000);
    }
    
    // Anti-AFK
    if (config.antiAFK) {
        addInterval(() => {
            if (!bot || !botState.connected) return;
            try { bot.swingArm(); } catch (_) {}
        }, 15000 + Math.floor(Math.random() * 15000));
        
        addInterval(() => {
            if (!bot || !botState.connected) return;
            try { bot.setQuickBarSlot(Math.floor(Math.random() * 9)); } catch (_) {}
        }, 20000 + Math.floor(Math.random() * 20000));
        
        addInterval(() => {
            if (!bot || !botState.connected) return;
            try {
                bot.look(Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.5, true);
            } catch (_) {}
        }, 10000 + Math.floor(Math.random() * 10000));
    }
    
    addLog("[Features] All initialized!");
}

// ============================================================
// ERROR HANDLING
// ============================================================
process.on("uncaughtException", err => {
    const msg = err?.message || String(err) || "Unknown";
    try { addLog(`[FATAL] ${msg}`); } catch (_) {}
    const isNet = ["PartialReadError", "ECONNRESET", "EPIPE", "ETIMEDOUT", "timed out", "write after end"]
        .some(k => msg.includes(k));
    
    try { clearAllIntervals(); } catch (_) {}
    try { botState.connected = false; } catch (_) {}
    try {
        if (isReconnecting) {
            isReconnecting = false;
            if (reconnectTimeoutId) {
                clearTimeout(reconnectTimeoutId);
                reconnectTimeoutId = null;
            }
        }
    } catch (_) {}
    
    setTimeout(() => {
        try { scheduleReconnect(); } catch (e) {}
    }, isNet ? 5000 : 10000);
});

process.on("unhandledRejection", reason => {
    const msg = String(reason);
    addLog(`[FATAL] Rejection: ${msg}`);
    const isNet = ["ETIMEDOUT", "ECONNRESET", "EPIPE", "ENOTFOUND", "timed out", "PartialReadError"]
        .some(k => msg.includes(k));
    
    if (isNet && !isReconnecting) {
        clearAllIntervals();
        botState.connected = false;
        if (bot) { try { bot.end(); } catch (_) {} bot = null; }
        scheduleReconnect();
    }
});

process.on("SIGTERM", () => addLog("[System] SIGTERM - ignoring"));
process.on("SIGINT", () => addLog("[System] SIGINT - ignoring"));

// ============================================================
// START SERVER AND BOT
// ============================================================
const server = app.listen(PORT, "0.0.0.0", () => {
    addLog(`[Server] HTTP server started on port ${PORT}`);
});

server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
        addLog(`[Server] Port ${PORT} in use, trying ${PORT + 1}`);
        server.listen(PORT + 1, "0.0.0.0");
    } else {
        addLog(`[Server] Error: ${err.message}`);
    }
});

// Self-ping to keep alive on Railway/Render
function startSelfPing() {
    const url = process.env.RENDER_EXTERNAL_URL || process.env.RAILWAY_STATIC_URL;
    if (!url) {
        addLog("[KeepAlive] No external URL - self-ping disabled");
        return;
    }
    setInterval(() => {
        const p = url.startsWith("https") ? https : http;
        p.get(url + "/ping", () => {}).on("error", e => 
            addLog(`[KeepAlive] Ping failed: ${e.message}`)
        );
    }, 10 * 60 * 1000);
    addLog("[KeepAlive] Self-ping started");
}
startSelfPing();

// Memory logging
setInterval(() => {
    addLog(`[Memory] Heap: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`);
}, 5 * 60 * 1000);

// Console input
const readline = require("readline");
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
});

rl.on("line", line => {
    if (!bot || !botState.connected) {
        addLog("[Console] Bot not connected");
        return;
    }
    const t = line.trim();
    if (t.startsWith("say ")) safeBotChat(t.slice(4));
    else if (t.startsWith("cmd ")) safeBotChat("/" + t.slice(4));
    else if (t === "status") {
        addLog(`Connected: ${botState.connected}, Uptime: ${Math.floor((Date.now() - botState.startTime) / 1000)}s`);
    } else {
        safeBotChat(t);
    }
});

// ============================================================
// START BOT
// ============================================================
addLog("=".repeat(50));
addLog("  NexusBot v1.0 - Single File Version");
addLog("=".repeat(50));
addLog(`Server: ${config.serverIp}:${config.serverPort}`);
addLog(`Username: ${config.username}`);
addLog(`Auth: ${config.auth}`);
addLog(`Version: ${config.serverVersion || "auto-detect"}`);
addLog("=".repeat(50));

createBot();
