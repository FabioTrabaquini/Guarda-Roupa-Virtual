const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { URL } = require("node:url");
const initializeSqlite = require("sql.js");

const PORT = process.env.PORT || 3000;
const scrypt = promisify(crypto.scrypt);
const sessionLifetime = 7 * 24 * 60 * 60 * 1000;
const loginAttempts = new Map();
const dataDirectory = path.resolve(process.env.APP_DATA_DIR || path.join(__dirname, "data"));
const databaseFile = path.join(dataDirectory, "marketplace.sqlite");
fs.mkdirSync(dataDirectory, { recursive: true });

// PRODUTOS USADOS COMO FALLBACK QUANDO O ARQUIVO AINDA NAO EXISTE
const defaultProducts = [
    {
        id: 1,
        nome: "Camisa Social Preta",
        categoria: "Camisetas",
        tamanho: "M",
        cor: "Preto",
        preco: 59.99,
        estado: "Excelente",
        emoji: "👔"
    },
    {
        id: 2,
        nome: "Calça Moletom Bench",
        categoria: "Calças",
        tamanho: "G",
        cor: "Preto",
        preco: 89.90,
        estado: "Excelente",
        emoji: "👖"
    }
];

const productsFile = path.join(dataDirectory, "products.json");

// LEITURA E INICIALIZACAO DO BANCO DE PRODUTOS EM JSON
function loadProducts() {
    try {
        if (!fs.existsSync(productsFile) && fs.existsSync(path.join(__dirname, "products.json"))) {
            fs.copyFileSync(path.join(__dirname, "products.json"), productsFile);
        }
        return JSON.parse(fs.readFileSync(productsFile, "utf8"));
    } catch {
        fs.writeFileSync(productsFile, JSON.stringify(defaultProducts, null, 2));
        return [...defaultProducts];
    }
}

const seedProducts = loadProducts();
let database;

function persistDatabase() {
    const temporaryFile = `${databaseFile}.tmp`;
    fs.writeFileSync(temporaryFile, Buffer.from(database.export()));
    fs.renameSync(temporaryFile, databaseFile);
}

function queryOne(sql, values = []) {
    const statement = database.prepare(sql);
    statement.bind(values);
    const row = statement.step() ? statement.getAsObject() : null;
    statement.free();
    return row;
}

function queryAll(sql, values = []) {
    const statement = database.prepare(sql);
    statement.bind(values);
    const rows = [];
    while (statement.step()) rows.push(statement.getAsObject());
    statement.free();
    return rows;
}

function productFromRow(row) {
    return { ...JSON.parse(row.data), stock: row.stock, ownerId: row.owner_id };
}

function getProducts() {
    return queryAll("SELECT data, stock, owner_id FROM products ORDER BY id").map(productFromRow);
}

function saveProduct(product) {
    database.run(
        "INSERT INTO products (id, data, owner_id, stock) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, owner_id = excluded.owner_id, stock = excluded.stock",
        [product.id, JSON.stringify(product), product.ownerId || null, product.stock]
    );
}

function getOrder(row) {
    return JSON.parse(row.data);
}

async function initializeDatabase() {
    const SQL = await initializeSqlite();
    database = fs.existsSync(databaseFile)
        ? new SQL.Database(fs.readFileSync(databaseFile))
        : new SQL.Database();
    database.run("PRAGMA foreign_keys = ON");
    database.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            name TEXT NOT NULL,
            city TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY,
            data TEXT NOT NULL,
            owner_id INTEGER REFERENCES users(id),
            stock INTEGER NOT NULL CHECK(stock >= 0)
        );
        CREATE TABLE IF NOT EXISTS orders (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            idempotency_key TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            data TEXT NOT NULL,
            UNIQUE(user_id, idempotency_key)
        );
        CREATE INDEX IF NOT EXISTS orders_by_user ON orders(user_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
            sender_id INTEGER NOT NULL REFERENCES users(id),
            recipient_id INTEGER NOT NULL REFERENCES users(id),
            body TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS messages_by_participants ON messages(sender_id, recipient_id, product_id, id);
    `);
    if (queryOne("SELECT COUNT(*) AS count FROM products").count === 0) {
        seedProducts.forEach((product) => {
            const seededProduct = { ...product, stock: Number.isInteger(product.stock) ? product.stock : 1, ownerId: null };
            saveProduct(seededProduct);
        });
    }
    persistDatabase();
}

function publicUser(user) {
    return { id: user.id, email: user.email, nome: user.name, cidade: user.city };
}

function parseCookies(request) {
    return Object.fromEntries(String(request.headers.cookie || "").split(";").map((cookie) => {
        const separator = cookie.indexOf("=");
        if (separator < 0) return ["", ""];
        const name = cookie.slice(0, separator).trim();
        try {
            return [name, decodeURIComponent(cookie.slice(separator + 1).trim())];
        } catch {
            return [name, ""];
        }
    }).filter(([name]) => name));
}

function sessionCookie(token, maxAge) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return `sid=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function getCurrentUser(request) {
    const token = parseCookies(request).sid;
    if (!token) return null;
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const session = queryOne(
        "SELECT users.id, users.email, users.name, users.city, sessions.expires_at FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ?",
        [tokenHash]
    );
    if (!session) return null;
    if (session.expires_at <= Date.now()) {
        database.run("DELETE FROM sessions WHERE token_hash = ?", [tokenHash]);
        persistDatabase();
        return null;
    }
    return { id: session.id, email: session.email, name: session.name, city: session.city, tokenHash };
}

function isSameOrigin(request) {
    const origin = request.headers.origin;
    if (!origin) return true;
    try {
        return new URL(origin).host === request.headers.host;
    } catch {
        return false;
    }
}

function rateLimitKey(request) {
    return request.socket.remoteAddress || "unknown";
}

function isLoginRateLimited(request) {
    const key = rateLimitKey(request);
    const now = Date.now();
    const attempts = loginAttempts.get(key);
    if (!attempts || attempts.resetAt <= now) {
        loginAttempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
        return false;
    }
    attempts.count += 1;
    return attempts.count > 10;
}

async function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = await scrypt(password, salt, 64);
    return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

async function verifyPassword(password, storedHash) {
    const [algorithm, saltHex, hashHex] = String(storedHash).split(":");
    if (algorithm !== "scrypt" || !saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, "hex");
    const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function createSession(userId, response) {
    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = Date.now() + sessionLifetime;
    database.run("DELETE FROM sessions WHERE expires_at <= ?", [Date.now()]);
    database.run("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)", [tokenHash, userId, expiresAt]);
    persistDatabase();
    response.setHeader("Set-Cookie", sessionCookie(token, Math.floor(sessionLifetime / 1000)));
}

// RESPOSTAS HTTP E LEITURA DO CORPO DAS REQUISICOES
function sendJson(response, statusCode, data) {
    response.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "same-origin"
    });
    response.end(statusCode === 204 ? undefined : JSON.stringify(data));
}

function readBody(request) {
    return new Promise((resolve, reject) => {
        let body = "";

        request.on("data", (chunk) => {
            body += chunk;
            if (body.length > 6_000_000) {
                request.destroy();
                reject(new Error("Corpo da requisicao muito grande."));
            }
        });

        request.on("end", () => {
            if (!body) {
                resolve({});
                return;
            }

            try {
                resolve(JSON.parse(body));
            } catch {
                reject(new Error("JSON invalido."));
            }
        });

        request.on("error", reject);
    });
}

// ROTAS DA API E SERVIDOR DE ARQUIVOS ESTATICOS
const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "OPTIONS") {
        sendJson(response, 204, null);
        return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/health") {
        sendJson(response, 200, { status: "ok", service: "guarda-roupa-virtual" });
        return;
    }

    if (request.method === "POST" && ["/api/auth/register", "/api/auth/login", "/api/auth/logout"].includes(requestUrl.pathname)) {
        if (!isSameOrigin(request)) {
            sendJson(response, 403, { error: "Origem da requisicao invalida." });
            return;
        }

        if (requestUrl.pathname === "/api/auth/logout") {
            const user = getCurrentUser(request);
            if (user) {
                database.run("DELETE FROM sessions WHERE token_hash = ?", [user.tokenHash]);
                persistDatabase();
            }
            response.setHeader("Set-Cookie", sessionCookie("", 0));
            sendJson(response, 200, { ok: true });
            return;
        }

        if (isLoginRateLimited(request)) {
            sendJson(response, 429, { error: "Muitas tentativas. Tente novamente em 15 minutos." });
            return;
        }

        try {
            const data = await readBody(request);
            const email = String(data.email || "").trim().toLowerCase();
            const password = String(data.senha || "");

            if (requestUrl.pathname === "/api/auth/register") {
                const name = String(data.nome || "").trim();
                const city = String(data.cidade || "").trim();
                if (!name || name.length > 100 || !city || city.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || password.length < 8 || password.length > 128) {
                    sendJson(response, 400, { error: "Informe nome, e-mail valido, cidade e senha de 8 a 128 caracteres." });
                    return;
                }
                if (queryOne("SELECT id FROM users WHERE email = ?", [email])) {
                    sendJson(response, 409, { error: "Este e-mail ja esta cadastrado." });
                    return;
                }
                const passwordHash = await hashPassword(password);
                try {
                    database.run("INSERT INTO users (email, password_hash, name, city, created_at) VALUES (?, ?, ?, ?, ?)", [email, passwordHash, name, city, new Date().toISOString()]);
                } catch (error) {
                    if (String(error.message).includes("UNIQUE")) {
                        sendJson(response, 409, { error: "Este e-mail ja esta cadastrado." });
                        return;
                    }
                    throw error;
                }
                const user = queryOne("SELECT id, email, name, city FROM users WHERE email = ?", [email]);
                loginAttempts.delete(rateLimitKey(request));
                createSession(user.id, response);
                sendJson(response, 201, publicUser(user));
                return;
            }

            const user = queryOne("SELECT id, email, password_hash, name, city FROM users WHERE email = ?", [email]);
            if (!user || !(await verifyPassword(password, user.password_hash))) {
                sendJson(response, 401, { error: "E-mail ou senha incorretos." });
                return;
            }
            loginAttempts.delete(rateLimitKey(request));
            createSession(user.id, response);
            sendJson(response, 200, publicUser(user));
        } catch (error) {
            sendJson(response, 400, { error: error.message });
        }
        return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/auth/me") {
        const user = getCurrentUser(request);
        if (!user) {
            sendJson(response, 401, { error: "Autenticacao necessaria." });
            return;
        }
        sendJson(response, 200, publicUser(user));
        return;
    }

    if (request.method === "PATCH" && requestUrl.pathname === "/api/auth/profile") {
        if (!isSameOrigin(request)) {
            sendJson(response, 403, { error: "Origem da requisicao invalida." });
            return;
        }
        const user = getCurrentUser(request);
        if (!user) {
            sendJson(response, 401, { error: "Autenticacao necessaria." });
            return;
        }
        try {
            const data = await readBody(request);
            const name = String(data.nome || "").trim();
            const city = String(data.cidade || "").trim();
            if (!name || name.length > 100 || !city || city.length > 100) {
                sendJson(response, 400, { error: "Informe nome e cidade validos." });
                return;
            }
            database.run("UPDATE users SET name = ?, city = ? WHERE id = ?", [name, city, user.id]);
            persistDatabase();
            sendJson(response, 200, publicUser(queryOne("SELECT id, email, name, city FROM users WHERE id = ?", [user.id])));
        } catch (error) {
            sendJson(response, 400, { error: error.message });
        }
        return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/conversations") {
        const user = getCurrentUser(request);
        if (!user) {
            sendJson(response, 401, { error: "Autenticacao necessaria." });
            return;
        }
        const messages = queryAll(`
            SELECT messages.product_id, messages.sender_id, messages.recipient_id, messages.body, messages.created_at,
                products.data AS product_data, sender.name AS sender_name, recipient.name AS recipient_name
            FROM messages
            JOIN products ON products.id = messages.product_id
            JOIN users AS sender ON sender.id = messages.sender_id
            JOIN users AS recipient ON recipient.id = messages.recipient_id
            WHERE messages.sender_id = ? OR messages.recipient_id = ?
            ORDER BY messages.id DESC
        `, [user.id, user.id]);
        const conversations = new Map();
        messages.forEach((message) => {
            const productId = Number(message.product_id);
            const isSender = Number(message.sender_id) === Number(user.id);
            const otherUserId = isSender ? Number(message.recipient_id) : Number(message.sender_id);
            const key = `${productId}:${otherUserId}`;
            if (conversations.has(key)) return;
            const otherName = isSender ? message.recipient_name : message.sender_name;
            conversations.set(key, {
                productId,
                otherUserId,
                productName: JSON.parse(message.product_data).nome,
                otherName,
                message: message.body,
                createdAt: message.created_at
            });
        });
        sendJson(response, 200, [...conversations.values()]);
        return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/messages") {
        const user = getCurrentUser(request);
        if (!user) {
            sendJson(response, 401, { error: "Autenticacao necessaria." });
            return;
        }
        const productId = Number(requestUrl.searchParams.get("productId"));
        let otherUserId = Number(requestUrl.searchParams.get("otherUserId"));
        const product = queryOne("SELECT owner_id FROM products WHERE id = ?", [productId]);
        if (!Number.isSafeInteger(productId) || !product) {
            sendJson(response, 404, { error: "Anuncio nao encontrado." });
            return;
        }
        if (!product.owner_id) {
            sendJson(response, 409, { error: "Este anuncio nao possui uma conta de vendedor para conversar." });
            return;
        }
        const ownerId = Number(product.owner_id);
        if (Number(user.id) !== ownerId && otherUserId !== ownerId) {
            sendJson(response, 404, { error: "Conversa nao encontrada." });
            return;
        }
        if (Number(user.id) === ownerId && (!Number.isSafeInteger(otherUserId) || otherUserId <= 0 || otherUserId === ownerId)) {
            sendJson(response, 400, { error: "Selecione uma conversa valida." });
            return;
        }
        const messages = queryAll(`
            SELECT messages.id, messages.product_id, messages.sender_id, messages.recipient_id, messages.body, messages.created_at, users.name AS sender_name
            FROM messages JOIN users ON users.id = messages.sender_id
            WHERE messages.product_id = ? AND ((messages.sender_id = ? AND messages.recipient_id = ?) OR (messages.sender_id = ? AND messages.recipient_id = ?))
            ORDER BY messages.id
        `, [productId, user.id, otherUserId, otherUserId, user.id]);
        sendJson(response, 200, messages);
        return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/messages") {
        if (!isSameOrigin(request)) {
            sendJson(response, 403, { error: "Origem da requisicao invalida." });
            return;
        }
        const user = getCurrentUser(request);
        if (!user) {
            sendJson(response, 401, { error: "Autenticacao necessaria." });
            return;
        }
        try {
            const data = await readBody(request);
            const productId = Number(data.productId);
            const body = String(data.message || "").trim();
            const product = queryOne("SELECT owner_id FROM products WHERE id = ?", [productId]);
            if (!Number.isSafeInteger(productId) || !product) {
                sendJson(response, 404, { error: "Anuncio nao encontrado." });
                return;
            }
            const ownerId = Number(product.owner_id);
            if (!ownerId || !body || body.length > 2000) {
                sendJson(response, 400, { error: "Mensagem ou conversa invalida." });
                return;
            }
            let recipientId = ownerId;
            if (Number(user.id) === ownerId) {
                recipientId = Number(data.otherUserId);
                const previous = queryOne("SELECT id FROM messages WHERE product_id = ? AND ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)) LIMIT 1", [productId, user.id, recipientId, recipientId, user.id]);
                if (!Number.isSafeInteger(recipientId) || recipientId <= 0 || recipientId === ownerId || !previous) {
                    sendJson(response, 409, { error: "Aguarde o comprador iniciar a conversa." });
                    return;
                }
            } else if (data.otherUserId && Number(data.otherUserId) !== ownerId) {
                sendJson(response, 404, { error: "Conversa nao encontrada." });
                return;
            }
            if (recipientId === Number(user.id)) {
                sendJson(response, 400, { error: "Destinatario invalido." });
                return;
            }
            const createdAt = new Date().toISOString();
            database.run("INSERT INTO messages (product_id, sender_id, recipient_id, body, created_at) VALUES (?, ?, ?, ?, ?)", [productId, user.id, recipientId, body, createdAt]);
            const messageId = queryOne("SELECT last_insert_rowid() AS id").id;
            persistDatabase();
            sendJson(response, 201, { id: messageId, productId, senderId: user.id, recipientId, body, createdAt, senderName: user.name });
        } catch (error) {
            sendJson(response, 400, { error: error.message });
        }
        return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/orders") {
        const user = getCurrentUser(request);
        if (!user) {
            sendJson(response, 401, { error: "Autenticacao necessaria." });
            return;
        }
        const orders = queryAll("SELECT data FROM orders WHERE user_id = ? ORDER BY created_at DESC", [user.id]).map(getOrder);
        sendJson(response, 200, orders);
        return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/orders") {
        if (!isSameOrigin(request)) {
            sendJson(response, 403, { error: "Origem da requisicao invalida." });
            return;
        }
        const user = getCurrentUser(request);
        if (!user) {
            sendJson(response, 401, { error: "Entre na conta para criar um pedido." });
            return;
        }

        const idempotencyKey = String(request.headers["idempotency-key"] || "").trim();
        if (idempotencyKey.length < 8 || idempotencyKey.length > 100) {
            sendJson(response, 400, { error: "Chave de pedido invalida." });
            return;
        }

        let transactionStarted = false;
        try {
            const data = await readBody(request);
            if (!Array.isArray(data.items) || data.items.length < 1 || data.items.length > 50) {
                sendJson(response, 400, { error: "O pedido precisa conter de 1 a 50 itens." });
                return;
            }
            const quantities = new Map();
            for (const item of data.items) {
                const productId = Number(item.productId);
                const quantity = Number(item.qty);
                if (!Number.isSafeInteger(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
                    sendJson(response, 400, { error: "Quantidade ou produto invalido." });
                    return;
                }
                quantities.set(productId, (quantities.get(productId) || 0) + quantity);
            }
            if ([...quantities.values()].some((quantity) => quantity > 20)) {
                sendJson(response, 400, { error: "Quantidade maxima por produto excedida." });
                return;
            }
            const coupon = String(data.couponCode || "").trim().toUpperCase();
            if (coupon && !["BEMVINDO10", "MODACONSCIENTE"].includes(coupon)) {
                const error = new Error("Cupom invalido ou expirado.");
                error.statusCode = 400;
                throw error;
            }

            database.run("BEGIN IMMEDIATE");
            transactionStarted = true;
            const existingOrder = queryOne("SELECT data FROM orders WHERE user_id = ? AND idempotency_key = ?", [user.id, idempotencyKey]);
            if (existingOrder) {
                database.run("COMMIT");
                transactionStarted = false;
                sendJson(response, 200, getOrder(existingOrder));
                return;
            }

            const orderItems = [];
            let subtotalCents = 0;
            for (const [productId, quantity] of quantities) {
                const row = queryOne("SELECT data, stock, owner_id FROM products WHERE id = ?", [productId]);
                if (!row) {
                    const error = new Error("Uma das pecas nao esta mais disponivel.");
                    error.statusCode = 409;
                    throw error;
                }
                const product = productFromRow(row);
                if (Number(row.owner_id) === Number(user.id)) {
                    const error = new Error("Voce nao pode comprar seu proprio anuncio.");
                    error.statusCode = 409;
                    throw error;
                }
                if (!Number.isFinite(product.preco) || product.preco <= 0) {
                    const error = new Error("O item nao esta anunciado para venda.");
                    error.statusCode = 409;
                    throw error;
                }
                if (row.stock < quantity) {
                    const error = new Error(`Estoque insuficiente para ${product.nome}.`);
                    error.statusCode = 409;
                    throw error;
                }
                const priceCents = Math.round(product.preco * 100);
                subtotalCents += priceCents * quantity;
                orderItems.push({
                    id: product.id,
                    name: product.nome,
                    qty: quantity,
                    seller: product.vendedor || "",
                    price: priceCents / 100
                });
                product.stock = row.stock - quantity;
                saveProduct(product);
            }

            let discountCents = 0;
            if (coupon === "BEMVINDO10") discountCents = Math.round(subtotalCents * 0.1);
            if (coupon === "MODACONSCIENTE") discountCents = Math.min(subtotalCents, 1500);
            const totalCents = Math.max(0, subtotalCents - discountCents);
            const order = {
                id: crypto.randomUUID(),
                name: `${orderItems.length} item(ns)`,
                status: "demonstracao",
                stage: 0,
                total: totalCents / 100,
                createdAt: new Date().toISOString(),
                items: orderItems
            };
            database.run(
                "INSERT INTO orders (id, user_id, idempotency_key, status, created_at, data) VALUES (?, ?, ?, ?, ?, ?)",
                [order.id, user.id, idempotencyKey, order.status, order.createdAt, JSON.stringify(order)]
            );
            database.run("COMMIT");
            transactionStarted = false;
            persistDatabase();
            sendJson(response, 201, order);
        } catch (error) {
            if (transactionStarted) database.run("ROLLBACK");
            sendJson(response, error.statusCode || 400, { error: error.message });
        }
        return;
    }

    const cancelOrderMatch = request.method === "PATCH" && requestUrl.pathname.match(/^\/api\/orders\/([^/]+)\/cancel$/);
    if (cancelOrderMatch) {
        if (!isSameOrigin(request)) {
            sendJson(response, 403, { error: "Origem da requisicao invalida." });
            return;
        }
        const user = getCurrentUser(request);
        if (!user) {
            sendJson(response, 401, { error: "Autenticacao necessaria." });
            return;
        }
        let transactionStarted = false;
        try {
            const orderId = decodeURIComponent(cancelOrderMatch[1]);
            database.run("BEGIN IMMEDIATE");
            transactionStarted = true;
            const row = queryOne("SELECT data FROM orders WHERE id = ? AND user_id = ?", [orderId, user.id]);
            if (!row) {
                database.run("ROLLBACK");
                sendJson(response, 404, { error: "Pedido nao encontrado." });
                return;
            }
            const order = getOrder(row);
            if (order.status === "cancelado") {
                database.run("COMMIT");
                transactionStarted = false;
                sendJson(response, 200, order);
                return;
            }
            if (order.status !== "demonstracao") {
                const error = new Error("Este pedido nao pode mais ser cancelado.");
                error.statusCode = 409;
                throw error;
            }
            for (const item of order.items) {
                const productRow = queryOne("SELECT data, stock, owner_id FROM products WHERE id = ?", [item.id]);
                if (!productRow) continue;
                const product = productFromRow(productRow);
                product.stock = productRow.stock + item.qty;
                saveProduct(product);
            }
            order.status = "cancelado";
            database.run("UPDATE orders SET status = ?, data = ? WHERE id = ?", [order.status, JSON.stringify(order), order.id]);
            database.run("COMMIT");
            transactionStarted = false;
            persistDatabase();
            sendJson(response, 200, order);
        } catch (error) {
            if (transactionStarted) database.run("ROLLBACK");
            sendJson(response, error.statusCode || 400, { error: error.message });
        }
        return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/products") {
        sendJson(response, 200, getProducts());
        return;
    }

    if ((request.method === "POST" || request.method === "PUT") && (requestUrl.pathname === "/api/products" || requestUrl.pathname.startsWith("/api/products/"))) {
        if (!isSameOrigin(request)) {
            sendJson(response, 403, { error: "Origem da requisicao invalida." });
            return;
        }
        const user = getCurrentUser(request);
        if (!user) {
            sendJson(response, 401, { error: "Entre na conta para gerenciar anuncios." });
            return;
        }
        try {
            const data = await readBody(request);
            const price = data.preco === null || data.preco === undefined || data.preco === "" ? null : Number(data.preco);
            const rentalPrice = data.aluguel === null || data.aluguel === undefined || data.aluguel === "" ? null : Number(data.aluguel);
            if (!data.nome || !data.categoria || (price !== null && (!Number.isFinite(price) || price <= 0)) || (rentalPrice !== null && (!Number.isFinite(rentalPrice) || rentalPrice <= 0)) || Number(data.stock || 0) < 0) {
                sendJson(response, 400, { error: "Dados do produto invalidos." });
                return;
            }

            const product = {
                id: request.method === "PUT" ? Number(requestUrl.pathname.split("/").pop()) : Number(data.id) || Date.now(),
                nome: String(data.nome).trim(),
                marca: String(data.marca || "Sem marca").trim(),
                categoria: String(data.categoria).trim(),
                tamanho: String(data.tamanho || "").trim(),
                cor: String(data.cor || "").trim(),
                preco: price,
                aluguel: rentalPrice,
                troca: Boolean(data.troca),
                local: String(data.local || "Nao informada").trim(),
                vendedor: String(data.vendedor || "Visitante").trim(),
                rating: Number(data.rating) || 5,
                pop: Number(data.pop) || 0,
                desc: String(data.desc || "").trim(),
                image: String(data.image || ""),
                images: Array.isArray(data.images) ? data.images.slice(0, 8).filter((image) => typeof image === "string" && /^data:image\/(?:jpeg|png|webp);base64,/.test(image)) : [],
                measurements: {
                    bust: Number(data.measurements?.bust) || null,
                    waist: Number(data.measurements?.waist) || null,
                    hip: Number(data.measurements?.hip) || null,
                    length: Number(data.measurements?.length) || null,
                    fit: String(data.measurements?.fit || "").trim()
                },
                estado: String(data.estado || "Usado").trim(),
                emoji: String(data.emoji || "👕"),
                stock: Number.isInteger(data.stock) ? data.stock : 1,
                ownerEmail: user.email,
                ownerId: user.id
            };

            const existing = queryOne("SELECT data, stock, owner_id FROM products WHERE id = ?", [product.id]);
            if (request.method === "PUT" && !existing) {
                sendJson(response, 404, { error: "Produto nao encontrado." });
                return;
            }
            if (request.method === "POST" && existing) {
                sendJson(response, 409, { error: "Ja existe um produto com esse identificador." });
                return;
            }
            if (request.method === "PUT" && Number(existing.owner_id) !== Number(user.id)) {
                sendJson(response, 403, { error: "Voce nao pode editar este anuncio." });
                return;
            }
            if (request.method === "PUT") product.stock = existing.stock;
            saveProduct(product);
            persistDatabase();
            sendJson(response, request.method === "PUT" ? 200 : 201, product);
        } catch (error) {
            sendJson(response, 400, { error: error.message });
        }
        return;
    }

    if (request.method === "DELETE" && requestUrl.pathname.startsWith("/api/products/")) {
        if (!isSameOrigin(request)) {
            sendJson(response, 403, { error: "Origem da requisicao invalida." });
            return;
        }
        const user = getCurrentUser(request);
        if (!user) {
            sendJson(response, 401, { error: "Entre na conta para gerenciar anuncios." });
            return;
        }
        const id = Number(requestUrl.pathname.split("/").pop());
        const product = queryOne("SELECT owner_id FROM products WHERE id = ?", [id]);
        if (!product) {
            sendJson(response, 404, { error: "Produto nao encontrado." });
            return;
        }
        if (Number(product.owner_id) !== Number(user.id)) {
            sendJson(response, 403, { error: "Voce nao pode excluir este anuncio." });
            return;
        }
        const hasActiveReservation = queryAll("SELECT data FROM orders WHERE status = 'demonstracao'")
            .some((order) => getOrder(order).items.some((item) => Number(item.id) === id));
        if (hasActiveReservation) {
            sendJson(response, 409, { error: "Cancele a reserva de demonstracao antes de excluir este anuncio." });
            return;
        }
        database.run("DELETE FROM products WHERE id = ?", [id]);
        persistDatabase();
        sendJson(response, 204, null);
        return;
    }

    if (request.method === "GET") {
        const isProductPage = /^\/produto\/\d+(?:-[^/]*)?\/?$/.test(requestUrl.pathname);
        const requestedPath = decodeURIComponent(requestUrl.pathname === "/" || isProductPage ? "/index.html" : requestUrl.pathname);
        const filePath = path.resolve(__dirname, `.${requestedPath}`);
        const relativePath = path.relative(__dirname, filePath);
        const protectedPath = relativePath.split(path.sep).some((part) => part.startsWith(".") || part === "node_modules" || part === path.basename(dataDirectory));
        if (relativePath.startsWith("..") || path.isAbsolute(relativePath) || protectedPath) {
            response.writeHead(403);
            response.end("Acesso negado.");
            return;
        }

        try {
            const contentTypes = {
                ".css": "text/css; charset=utf-8",
                ".html": "text/html; charset=utf-8",
                ".js": "text/javascript; charset=utf-8",
                ".json": "application/json; charset=utf-8",
                ".webmanifest": "application/manifest+json; charset=utf-8",
                ".txt": "text/plain; charset=utf-8",
                ".xml": "application/xml; charset=utf-8",
                ".jpeg": "image/jpeg",
                ".jpg": "image/jpeg",
                ".png": "image/png",
                ".webp": "image/webp"
            };
            const content = fs.readFileSync(filePath);
            response.writeHead(200, { "Content-Type": contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
            response.end(content);
        } catch {
            response.writeHead(404);
            response.end("Arquivo nao encontrado.");
        }
        return;
    }

    sendJson(response, 404, { error: "Rota nao encontrada." });
});

initializeDatabase().then(() => {
    server.listen(PORT, () => {
        console.log(`Backend iniciado em http://localhost:${PORT}`);
    });
}).catch((error) => {
    console.error("Falha ao iniciar o banco de dados.", error);
    process.exitCode = 1;
});
