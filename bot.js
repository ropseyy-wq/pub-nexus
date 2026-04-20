// NEXUSBOT - Minecraft Bot with API Server
const mineflayer = require('mineflayer');
const express = require('express');
const cors = require('cors');

const config = {
    username: process.env.BOT_NAME || 'NexusBot',
    serverIp: process.env.SERVER_IP || 'localhost',
    serverPort: parseInt(process.env.SERVER_PORT) || 25565,
    auth: process.env.AUTH_TYPE || 'offline',
    password: process.env.PASSWORD || '',
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
        blocksMined: botStats.blocksMined
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

const PORT = process.env.API_PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    addLog(`[API] Server running on port ${PORT}`);
});

const bot = mineflayer.createBot({
    host: config.serverIp,
    port: config.serverPort,
    username: config.username,
    auth: config.auth,
    password: config.password
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

bot.on('health', () => {
    botStats.health = bot.health;
    botStats.food = bot.food;
});

bot.on('playerJoined', () => updatePlayerList());
bot.on('playerLeft', () => updatePlayerList());

function updatePlayerList() {
    if (bot.players) {
        botStats.players = Object.values(bot.players)
            .filter(p => p.username !== bot.username)
            .map(p => ({ username: p.username, ping: p.ping }));
    }
}

bot.on('inventory', () => {
    if (bot.inventory && bot.inventory.slots) {
        botStats.inventory = bot.inventory.slots.slice(36, 45).map((item, i) => {
            if (!item) return null;
            return { slot: i, name: item.name, displayName: item.displayName || item.name, count: item.count };
        }).filter(i => i !== null);
    }
});

bot.once('spawn', () => {
    botStats.connected = true;
    botStats.startTime = Date.now();
    addLog('✅ Bot has joined the server!', 'success');
    updatePlayerList();
    
    if (config.modes.includes('FARM')) startFarming();
    if (config.modes.includes('MINE')) startMining();
    if (config.modes.includes('PARKOUR')) startParkour();
    if (config.modes.includes('LIQUID_WALKER')) startLiquidWalker();
});

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

function startParkour() {
    setInterval(() => {
        if (!bot.entity || !botStats.connected) return;
        bot.setControlState('forward', true);
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), 500);
    }, 3000);
}

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

bot.on('end', (reason) => {
    botStats.connected = false;
    addLog(`❌ Disconnected: ${reason || 'Unknown'}`, 'error');
    setTimeout(() => process.exit(1), 10000);
});

bot.on('error', (err) => addLog(`⚠️ Error: ${err.message}`, 'error'));
bot.on('kicked', (reason) => addLog(`👢 Kicked: ${reason}`, 'error'));

addLog('🤖 Bot is connecting to server...');
