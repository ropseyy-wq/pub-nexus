// NEXUSBOT - Minecraft Bot
const mineflayer = require('mineflayer');

// Read settings from environment variables
const config = {
    username: process.env.BOT_NAME || 'NexusBot',
    serverIp: process.env.SERVER_IP || 'localhost',
    serverPort: parseInt(process.env.SERVER_PORT) || 25565,
    auth: process.env.AUTH_TYPE || 'offline',
    password: process.env.PASSWORD || '',
    modes: (process.env.BOT_MODES || '').split(',')
};

console.log('='.repeat(50));
console.log('🤖 NEXUSBOT STARTING...');
console.log('='.repeat(50));
console.log(`Bot Name: ${config.username}`);
console.log(`Server: ${config.serverIp}:${config.serverPort}`);
console.log(`Modes: ${config.modes.join(', ') || 'None'}`);
console.log('='.repeat(50));

// Create bot
const bot = mineflayer.createBot({
    host: config.serverIp,
    port: config.serverPort,
    username: config.username,
    auth: config.auth,
    password: config.password
});

// Stats
let stats = {
    blocksMined: 0,
    fishCaught: 0,
    stepsTaken: 0,
    startTime: Date.now()
};

// When bot spawns in game
bot.once('spawn', () => {
    console.log('✅ Bot has joined the server!');
    
    // Send startup message
    bot.chat('🤖 NexusBot has joined!');
    
    // Enable modes
    if (config.modes.includes('FARM')) {
        console.log('🌾 Auto-Farm mode activated');
        startFarming();
    }
    
    if (config.modes.includes('MINE')) {
        console.log('⛏️ Auto-Mine mode activated');
        startMining();
    }
    
    if (config.modes.includes('PARKOUR')) {
        console.log('🏃 Parkour mode activated');
        startParkour();
    }
    
    if (config.modes.includes('LIQUID_WALKER')) {
        console.log('🪣 Liquid Walker mode activated');
        startLiquidWalker();
    }
    
    if (config.modes.includes('AUTO_RESPONDER')) {
        console.log('💬 Auto-Responder mode activated');
    }
});

// Auto-Farm function
function startFarming() {
    setInterval(() => {
        if (!bot.entity) return;
        
        // Find nearby crops
        const crop = bot.findBlock({
            matching: (block) => {
                const name = block.name;
                return name === 'wheat' || name === 'carrots' || name === 'potatoes' || name === 'beetroots';
            },
            maxDistance: 5
        });
        
        if (crop) {
            bot.dig(crop, (err) => {
                if (!err) {
                    stats.blocksMined++;
                    console.log(`🌾 Farmed ${crop.name}`);
                    // Replant
                    const seed = bot.inventory.findInventoryItem(item => 
                        item.name.includes('seeds') || item.name.includes('potato') || item.name.includes('carrot')
                    );
                    if (seed) {
                        bot.equip(seed, 'hand');
                        bot.placeBlock(crop.position, (err) => {});
                    }
                }
            });
        }
    }, 5000);
}

// Auto-Mine function
function startMining() {
    setInterval(() => {
        if (!bot.entity) return;
        
        // Find ores to mine
        const ores = ['coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'emerald_ore', 'copper_ore'];
        const ore = bot.findBlock({
            matching: (block) => ores.includes(block.name),
            maxDistance: 5
        });
        
        if (ore) {
            bot.dig(ore, (err) => {
                if (!err) {
                    stats.blocksMined++;
                    console.log(`⛏️ Mined ${ore.name}`);
                }
            });
        }
    }, 3000);
}

// Parkour mode - auto run and jump
function startParkour() {
    setInterval(() => {
        if (!bot.entity) return;
        
        bot.setControlState('forward', true);
        bot.setControlState('jump', true);
        
        setTimeout(() => {
            bot.setControlState('jump', false);
        }, 500);
    }, 3000);
}

// Liquid Walker - place blocks under feet in water/lava
function startLiquidWalker() {
    setInterval(() => {
        if (!bot.entity) return;
        
        const blockBelow = bot.blockAt(bot.entity.position.offset(0, -1, 0));
        if (blockBelow && (blockBelow.name === 'water' || blockBelow.name === 'lava')) {
            const cobble = bot.inventory.findInventoryItem(item => item.name === 'cobblestone');
            if (cobble) {
                bot.equip(cobble, 'hand');
                bot.placeBlock(blockBelow.position, (err) => {
                    if (!err) console.log('🪣 Placed block on liquid');
                });
            }
        }
    }, 1000);
}

// Auto-Responder
bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    
    const msg = message.toLowerCase();
    
    if (config.modes.includes('AUTO_RESPONDER')) {
        if (msg.includes('hello') || msg.includes('hi')) {
            setTimeout(() => bot.chat(`Hello ${username}! 👋`), 1000);
        }
        else if (msg.includes('how are you')) {
            setTimeout(() => bot.chat(`I'm doing great! Mining blocks 😊`), 1000);
        }
        else if (msg.includes('what are you doing')) {
            setTimeout(() => bot.chat(`Just mining and farming! 🤖`), 1000);
        }
        else if (msg.includes('good bot')) {
            setTimeout(() => bot.chat(`Thank you ${username}! 🎉`), 1000);
        }
    }
});

// Show stats every 5 minutes
setInterval(() => {
    const uptime = Math.floor((Date.now() - stats.startTime) / 1000);
    console.log(`📊 STATS - Mined: ${stats.blocksMined} | Uptime: ${uptime}s`);
}, 300000);

// Anti-AFK - random movements
setInterval(() => {
    if (!bot.entity) return;
    const random = Math.random();
    if (random < 0.3) {
        bot.setControlState('forward', true);
        setTimeout(() => bot.setControlState('forward', false), 1000);
    }
    if (random > 0.7) {
        bot.look(Math.random() * Math.PI * 2, Math.random() - 0.5);
    }
}, 15000);

// Handle disconnections
bot.on('end', (reason) => {
    console.log(`❌ Disconnected: ${reason || 'Unknown'}`);
    console.log('🔄 Attempting to reconnect in 10 seconds...');
    setTimeout(() => process.exit(1), 10000);
});

bot.on('error', (err) => {
    console.log(`⚠️ Error: ${err.message}`);
});

bot.on('kicked', (reason) => {
    console.log(`👢 Kicked: ${reason}`);
});

console.log('🤖 Bot is connecting to server...');