const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const DATA_FILE = 'database.json';

// Initial database structure
const defaultDB = {
    users: {
        admin: {
            password: '11448888',
            balanceUSD: 10000,
            balanceRUB: 0,
            currency: 'USD',
            holdings: {},
            isAdmin: true
        }
    },
    coins: [],
    exchangeRate: 92.50
};

// Load or create database
function loadDatabase() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            const db = JSON.parse(data);
            // Ensure admin always exists
            if (!db.users.admin) {
                db.users.admin = defaultDB.users.admin;
            }
            return db;
        }
    } catch (error) {
        console.log('Creating new database...');
    }
    return { ...defaultDB };
}

// Save database
function saveDatabase(db) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

let db = loadDatabase();

// Fetch real exchange rate
async function fetchExchangeRate() {
    try {
        const https = require('https');
        return new Promise((resolve) => {
            https.get('https://api.exchangerate-api.com/v4/latest/USD', (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        db.exchangeRate = json.rates.RUB;
                        saveDatabase(db);
                        resolve(db.exchangeRate);
                    } catch (e) {
                        resolve(db.exchangeRate);
                    }
                });
            }).on('error', () => resolve(db.exchangeRate));
        });
    } catch (error) {
        return db.exchangeRate;
    }
}

// Update exchange rate every 5 minutes
fetchExchangeRate();
setInterval(fetchExchangeRate, 300000);

// Simulate price fluctuations every 10 seconds
setInterval(() => {
    db.coins.forEach(coin => {
        if (coin.capitalization > 0) {
            const fluctuation = (Math.random() - 0.5) * 0.02;
            coin.price *= (1 + fluctuation);
            coin.change = ((coin.price - coin.initialPrice) / coin.initialPrice) * 100;
        }
    });
    saveDatabase(db);
}, 10000);

// Parse JSON body
function parseBody(req) {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                resolve(JSON.parse(body));
            } catch (e) {
                resolve({});
            }
        });
    });
}

// CORS headers
function setCORSHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// Send JSON response
function sendJSON(res, data, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

// Serve static files
function serveStatic(res, filePath) {
    const ext = path.extname(filePath);
    const contentTypes = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.json': 'application/json'
    };
    
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not Found');
            return;
        }
        res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
        res.end(data);
    });
}

// Create server
const server = http.createServer(async (req, res) => {
    setCORSHeaders(res);
    
    // Handle preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    const url = req.url;

    // Serve index.html
    if (url === '/' || url === '/index.html') {
        serveStatic(res, 'index.html');
        return;
    }

    // API Routes
    if (url.startsWith('/api/')) {
        const body = req.method === 'POST' ? await parseBody(req) : {};

        // Register
        if (url === '/api/register' && req.method === 'POST') {
            const { username, password, currency } = body;
            
            if (!username || !password) {
                return sendJSON(res, { error: 'Заполните все поля' }, 400);
            }
            if (username === 'admin') {
                return sendJSON(res, { error: 'Этот логин занят' }, 400);
            }
            if (db.users[username]) {
                return sendJSON(res, { error: 'Пользователь уже существует' }, 400);
            }

            db.users[username] = {
                password,
                balanceUSD: 0,
                balanceRUB: 0,
                currency: currency || 'USD',
                holdings: {},
                isAdmin: false
            };
            saveDatabase(db);
            
            return sendJSON(res, { success: true, user: { username, ...db.users[username], password: undefined } });
        }

        // Login
        if (url === '/api/login' && req.method === 'POST') {
            const { username, password } = body;
            
            if (!username || !password) {
                return sendJSON(res, { error: 'Заполните все поля' }, 400);
            }
            if (!db.users[username] || db.users[username].password !== password) {
                return sendJSON(res, { error: 'Неверный логин или пароль' }, 401);
            }

            const user = { ...db.users[username], password: undefined };
            return sendJSON(res, { success: true, user: { username, ...user } });
        }

        // Get user data
        if (url === '/api/user' && req.method === 'POST') {
            const { username } = body;
            if (!db.users[username]) {
                return sendJSON(res, { error: 'Пользователь не найден' }, 404);
            }
            const user = { ...db.users[username], password: undefined };
            return sendJSON(res, { success: true, user: { username, ...user } });
        }

        // Get all coins
        if (url === '/api/coins' && req.method === 'GET') {
            return sendJSON(res, { coins: db.coins, exchangeRate: db.exchangeRate });
        }

        // Get exchange rate
        if (url === '/api/rate' && req.method === 'GET') {
            return sendJSON(res, { rate: db.exchangeRate });
        }

        // Deposit
        if (url === '/api/deposit' && req.method === 'POST') {
            const { username, amount, currency } = body;
            
            if (!db.users[username]) {
                return sendJSON(res, { error: 'Пользователь не найден' }, 404);
            }
            if (!amount || amount <= 0) {
                return sendJSON(res, { error: 'Неверная сумма' }, 400);
            }

            if (currency === 'USD') {
                db.users[username].balanceUSD += amount;
            } else {
                db.users[username].balanceRUB += amount;
            }
            saveDatabase(db);

            return sendJSON(res, { success: true, user: { ...db.users[username], password: undefined } });
        }

        // Exchange currency
        if (url === '/api/exchange' && req.method === 'POST') {
            const { username, from, amount } = body;
            const user = db.users[username];
            
            if (!user) {
                return sendJSON(res, { error: 'Пользователь не найден' }, 404);
            }
            if (!amount || amount <= 0) {
                return sendJSON(res, { error: 'Неверная сумма' }, 400);
            }

            if (from === 'USD') {
                if (user.balanceUSD < amount) {
                    return sendJSON(res, { error: 'Недостаточно долларов' }, 400);
                }
                user.balanceUSD -= amount;
                user.balanceRUB += amount * db.exchangeRate;
            } else {
                if (user.balanceRUB < amount) {
                    return sendJSON(res, { error: 'Недостаточно рублей' }, 400);
                }
                user.balanceRUB -= amount;
                user.balanceUSD += amount / db.exchangeRate;
            }
            saveDatabase(db);

            return sendJSON(res, { success: true, user: { ...user, password: undefined } });
        }

        // Send money
        if (url === '/api/send' && req.method === 'POST') {
            const { username, recipient, amount, currency } = body;
            const sender = db.users[username];
            const receiver = db.users[recipient];
            
            if (!sender) {
                return sendJSON(res, { error: 'Отправитель не найден' }, 404);
            }
            if (!receiver) {
                return sendJSON(res, { error: 'Получатель не найден' }, 404);
            }
            if (username === recipient) {
                return sendJSON(res, { error: 'Нельзя отправить себе' }, 400);
            }
            if (!amount || amount <= 0) {
                return sendJSON(res, { error: 'Неверная сумма' }, 400);
            }

            if (currency === 'USD') {
                if (sender.balanceUSD < amount) {
                    return sendJSON(res, { error: 'Недостаточно средств' }, 400);
                }
                sender.balanceUSD -= amount;
                receiver.balanceUSD += amount;
            } else {
                if (sender.balanceRUB < amount) {
                    return sendJSON(res, { error: 'Недостаточно средств' }, 400);
                }
                sender.balanceRUB -= amount;
                receiver.balanceRUB += amount;
            }
            saveDatabase(db);

            return sendJSON(res, { success: true, user: { ...sender, password: undefined } });
        }

        // Create coin (admin only)
        if (url === '/api/coin/create' && req.method === 'POST') {
            const { username, name, ticker, description, icon, price } = body;
            
            if (!db.users[username]?.isAdmin) {
                return sendJSON(res, { error: 'Доступ запрещён' }, 403);
            }
            if (!name || !ticker || !price) {
                return sendJSON(res, { error: 'Заполните обязательные поля' }, 400);
            }
            if (db.coins.find(c => c.ticker === ticker.toUpperCase())) {
                return sendJSON(res, { error: 'Коин с таким тикером уже существует' }, 400);
            }

            const newCoin = {
                name,
                ticker: ticker.toUpperCase(),
                description: description || '',
                icon: icon || `https://via.placeholder.com/48/8b5cf6/fff?text=${ticker.toUpperCase()}`,
                price: parseFloat(price),
                initialPrice: parseFloat(price),
                capitalization: 0,
                change: 0
            };
            db.coins.push(newCoin);
            saveDatabase(db);

            return sendJSON(res, { success: true, coin: newCoin });
        }

        // Buy coin
        if (url === '/api/coin/buy' && req.method === 'POST') {
            const { username, ticker, amount } = body;
            const user = db.users[username];
            const coin = db.coins.find(c => c.ticker === ticker);
            
            if (!user) {
                return sendJSON(res, { error: 'Пользователь не найден' }, 404);
            }
            if (!coin) {
                return sendJSON(res, { error: 'Коин не найден' }, 404);
            }
            if (!amount || amount <= 0) {
                return sendJSON(res, { error: 'Неверная сумма' }, 400);
            }
            if (user.balanceUSD < amount) {
                return sendJSON(res, { error: 'Недостаточно долларов' }, 400);
            }

            const coins = amount / coin.price;
            user.balanceUSD -= amount;
            user.holdings[ticker] = (user.holdings[ticker] || 0) + coins;

            // Update price and capitalization
            coin.capitalization += amount;
            const priceChange = (Math.random() * 0.05 + 0.01);
            coin.price *= (1 + priceChange);
            coin.change = ((coin.price - coin.initialPrice) / coin.initialPrice) * 100;

            saveDatabase(db);
            return sendJSON(res, { success: true, user: { ...user, password: undefined }, coin });
        }

        // Sell coin
        if (url === '/api/coin/sell' && req.method === 'POST') {
            const { username, ticker, amount } = body;
            const user = db.users[username];
            const coin = db.coins.find(c => c.ticker === ticker);
            
            if (!user) {
                return sendJSON(res, { error: 'Пользователь не найден' }, 404);
            }
            if (!coin) {
                return sendJSON(res, { error: 'Коин не найден' }, 404);
            }
            if (!amount || amount <= 0) {
                return sendJSON(res, { error: 'Неверная сумма' }, 400);
            }

            const sellCoins = amount / coin.price;
            const holding = user.holdings[ticker] || 0;

            if (sellCoins > holding) {
                return sendJSON(res, { error: 'Недостаточно монет' }, 400);
            }

            user.holdings[ticker] -= sellCoins;
            user.balanceUSD += amount;

            // Update price and capitalization
            coin.capitalization -= amount;
            if (coin.capitalization < 0) coin.capitalization = 0;
            const priceChange = (Math.random() * 0.05 + 0.01);
            coin.price *= (1 - priceChange);
            if (coin.price < 0.0001) coin.price = 0.0001;
            coin.change = ((coin.price - coin.initialPrice) / coin.initialPrice) * 100;

            saveDatabase(db);
            return sendJSON(res, { success: true, user: { ...user, password: undefined }, coin });
        }

        // Take all (admin only)
        if (url === '/api/takeall' && req.method === 'POST') {
            const { username } = body;
            
            if (!db.users[username]?.isAdmin) {
                return sendJSON(res, { error: 'Доступ запрещён' }, 403);
            }

            let totalCap = 0;
            db.coins.forEach(coin => {
                totalCap += coin.capitalization;
                coin.capitalization = 0;
                coin.price = 0.0001;
                coin.change = -99.99;
            });

            db.users.admin.balanceUSD += totalCap;
            saveDatabase(db);

            return sendJSON(res, { success: true, amount: totalCap, user: { ...db.users.admin, password: undefined } });
        }

        // Update user currency preference
        if (url === '/api/user/currency' && req.method === 'POST') {
            const { username, currency } = body;
            if (!db.users[username]) {
                return sendJSON(res, { error: 'Пользователь не найден' }, 404);
            }
            db.users[username].currency = currency;
            saveDatabase(db);
            return sendJSON(res, { success: true });
        }

        // 404 for unknown API routes
        return sendJSON(res, { error: 'Not Found' }, 404);
    }

    // 404 for other routes
    res.writeHead(404);
    res.end('Not Found');
});

server.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════╗
║                                                   ║
║   🚀 CryptoVault Server запущен!                  ║
║                                                   ║
║   📍 Адрес: http://localhost:${PORT}                 ║
║                                                   ║
║   👤 Админ: admin / 11448888                      ║
║                                                   ║
╚═══════════════════════════════════════════════════╝
    `);
});
