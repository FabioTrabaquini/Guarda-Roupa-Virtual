// Servidor HTTP do app: API de contas, anuncios, pedidos e mensagens, com persistencia SQLite.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { promisify } = require("node:util");
const { URL } = require("node:url");
const initializeSqlite = require("sql.js");

const PORT = process.env.PORT || 3000;
const scrypt = promisify(crypto.scrypt);
const sessionLifetime = 7 * 24 * 60 * 60 * 1000;
const loginAttempts = new Map();
const securityHeaders = {
    "Content-Security-Policy":
        "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com; script-src 'self'; connect-src 'self'",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
};
const allowedStaticFiles = new Set([
    "/",
    "/index.html",
    "/app.js",
    "/style.css",
    "/site.webmanifest",
    "/robots.txt",
    "/sitemap.xml",
]);
const dataDirectory = path.resolve(
    process.env.APP_DATA_DIR || path.join(__dirname, "data")
);
const databaseFile = path.join(dataDirectory, "marketplace.sqlite");
const uploadsDirectory = path.join(dataDirectory, "uploads");
fs.mkdirSync(dataDirectory, { recursive: true });

const productsFile = path.join(dataDirectory, "products.json");

// Importa o catalogo versionado apenas quando o banco local ainda nao foi inicializado.
function loadProducts() {
    if (!fs.existsSync(productsFile)) {
        const seedFile = path.join(__dirname, "products.json");
        if (!fs.existsSync(seedFile)) return [];
        fs.copyFileSync(seedFile, productsFile);
    }
    const products = JSON.parse(fs.readFileSync(productsFile, "utf8"));
    if (!Array.isArray(products))
        throw new Error("O catalogo local deve ser uma lista de produtos.");
    return products;
}

const seedProducts = loadProducts();
let database;
let persistenceQueue = Promise.resolve();

function persistDatabase() {
    const snapshot = Buffer.from(database.export());
    const temporaryFile = `${databaseFile}.${crypto.randomBytes(8).toString("hex")}.tmp`;
    const write = persistenceQueue.then(async () => {
        try {
            await fs.promises.writeFile(temporaryFile, snapshot, {
                flag: "wx",
            });
            await fs.promises.rename(temporaryFile, databaseFile);
        } finally {
            await fs.promises.rm(temporaryFile, { force: true });
        }
    });
    persistenceQueue = write.catch(() => {});
    return write;
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
    return queryAll(
        "SELECT data, stock, owner_id FROM products ORDER BY id"
    ).map(productFromRow);
}

function saveProduct(product) {
    database.run(
        "INSERT INTO products (id, data, owner_id, stock) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, owner_id = excluded.owner_id, stock = excluded.stock",
        [
            product.id,
            JSON.stringify(product),
            product.ownerId || null,
            product.stock,
        ]
    );
}

async function storeProductImages(product) {
    await fs.promises.mkdir(uploadsDirectory, { recursive: true });
    const storedImages = new Map();
    const storeImage = async (image) => {
        if (typeof image !== "string" || !image.startsWith("data:image/"))
            return image;
        if (storedImages.has(image)) return storedImages.get(image);

        const match = image.match(
            /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]*={0,2})$/
        );
        if (!match) throw new Error("Formato de imagem invalido.");
        const imageBuffer = Buffer.from(match[2], "base64");
        const extension = match[1] === "jpeg" ? "jpg" : match[1];
        const filename = `${crypto.createHash("sha256").update(imageBuffer).digest("hex")}.${extension}`;
        const filePath = path.join(uploadsDirectory, filename);
        if (!fs.existsSync(filePath)) {
            const temporaryPath = `${filePath}.${crypto.randomBytes(6).toString("hex")}.tmp`;
            try {
                await fs.promises.writeFile(temporaryPath, imageBuffer, {
                    flag: "wx",
                });
                await fs.promises.rename(temporaryPath, filePath);
            } catch (error) {
                if (!fs.existsSync(filePath)) throw error;
            } finally {
                await fs.promises.rm(temporaryPath, { force: true });
            }
        }
        const url = `/uploads/${filename}`;
        storedImages.set(image, url);
        return url;
    };

    product.image = await storeImage(product.image || "");
    product.images = await Promise.all((product.images || []).map(storeImage));
    return product;
}

async function migrateProductImages() {
    const products = queryAll("SELECT data, stock, owner_id FROM products");
    for (const row of products) {
        const product = productFromRow(row);
        const hasEmbeddedImage = [
            product.image,
            ...(product.images || []),
        ].some(
            (image) =>
                typeof image === "string" && image.startsWith("data:image/")
        );
        if (!hasEmbeddedImage) continue;
        await storeProductImages(product);
        saveProduct(product);
    }
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
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_hash TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS password_reset_expiry ON password_reset_tokens(expires_at);
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
            const seededProduct = {
                ...product,
                stock: Number.isInteger(product.stock) ? product.stock : 1,
                ownerId: null,
            };
            saveProduct(seededProduct);
        });
    }
    await migrateProductImages();
    await persistDatabase();
}

function publicUser(user) {
    return {
        id: user.id,
        email: user.email,
        nome: user.name,
        cidade: user.city,
    };
}

function parseCookies(request) {
    return Object.fromEntries(
        String(request.headers.cookie || "")
            .split(";")
            .map((cookie) => {
                const separator = cookie.indexOf("=");
                if (separator < 0) return ["", ""];
                const name = cookie.slice(0, separator).trim();
                try {
                    return [
                        name,
                        decodeURIComponent(cookie.slice(separator + 1).trim()),
                    ];
                } catch {
                    return [name, ""];
                }
            })
            .filter(([name]) => name)
    );
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
        void persistDatabase().catch((error) =>
            console.error("Falha ao remover sessao expirada.", error)
        );
        return null;
    }
    return {
        id: session.id,
        email: session.email,
        name: session.name,
        city: session.city,
        tokenHash,
    };
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
    const actual = await scrypt(
        password,
        Buffer.from(saltHex, "hex"),
        expected.length
    );
    return (
        expected.length === actual.length &&
        crypto.timingSafeEqual(expected, actual)
    );
}

async function createSession(userId, response) {
    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = Date.now() + sessionLifetime;
    database.run("DELETE FROM sessions WHERE expires_at <= ?", [Date.now()]);
    database.run(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
        [tokenHash, userId, expiresAt]
    );
    await persistDatabase();
    response.setHeader(
        "Set-Cookie",
        sessionCookie(token, Math.floor(sessionLifetime / 1000))
    );
}

async function createPasswordResetToken(userId) {
    const token = crypto.randomBytes(24).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = Date.now() + 15 * 60 * 1000;
    database.run("DELETE FROM password_reset_tokens WHERE user_id = ?", [
        userId,
    ]);
    database.run(
        "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)",
        [userId, tokenHash, expiresAt, new Date().toISOString()]
    );
    await persistDatabase();
    return token;
}

async function sendPasswordResetEmail(email, token) {
    const publicBaseUrl = process.env.PUBLIC_BASE_URL;
    const apiKey = process.env.EMAIL_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!publicBaseUrl || !apiKey || !from) {
        const error = new Error(
            "Recuperação de senha não está configurada. Entre em contato com o suporte."
        );
        error.statusCode = 503;
        throw error;
    }

    const resetUrl = new URL("/", publicBaseUrl);
    resetUrl.searchParams.set("resetToken", token);
    const response = await fetch(
        process.env.EMAIL_API_URL || "https://api.resend.com/emails",
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                from,
                to: [email],
                subject: "Redefina sua senha do Guarda-Roupa Virtual",
                html: `<p>Recebemos uma solicitação para redefinir sua senha.</p><p><a href="${resetUrl.href}">Criar uma nova senha</a></p><p>O link expira em 15 minutos. Se você não solicitou a redefinição, ignore esta mensagem.</p>`,
            }),
        }
    );
    if (!response.ok) {
        const error = new Error(
            "Não foi possível enviar o e-mail de recuperação. Tente novamente mais tarde."
        );
        error.statusCode = 502;
        throw error;
    }
}

// RESPOSTAS HTTP E LEITURA DO CORPO DAS REQUISICOES
function sendJson(response, statusCode, data) {
    response.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        ...securityHeaders,
    });
    response.end(statusCode === 204 ? undefined : JSON.stringify(data));
}

function readBody(request) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let bodyBytes = 0;
        let settled = false;

        const rejectTooLarge = () => {
            if (settled) return;
            settled = true;
            const error = new Error("Corpo da requisicao muito grande.");
            error.statusCode = 413;
            reject(error);
            request.resume();
        };

        if (Number(request.headers["content-length"]) > 6_000_000) {
            rejectTooLarge();
            return;
        }

        request.on("data", (chunk) => {
            if (settled) return;
            bodyBytes += chunk.length;
            if (bodyBytes > 6_000_000) {
                rejectTooLarge();
                return;
            }
            chunks.push(chunk);
        });

        request.on("end", () => {
            if (settled) return;
            settled = true;
            if (bodyBytes === 0) {
                resolve({});
                return;
            }

            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch {
                reject(new Error("JSON invalido."));
            }
        });

        request.on("error", (error) => {
            if (!settled) {
                settled = true;
                reject(error);
            }
        });
    });
}

function getPublicBaseUrl() {
    const baseUrl = new URL(
        process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`
    );
    if (!["http:", "https:"].includes(baseUrl.protocol))
        throw new Error("PUBLIC_BASE_URL deve usar HTTP ou HTTPS.");
    return baseUrl.origin;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function slugify(value) {
    return String(value || "produto")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function productUrl(product, baseUrl) {
    return new URL(`/produto/${product.id}-${slugify(product.nome)}`, baseUrl)
        .href;
}

function renderHomePage(baseUrl) {
    let html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
    const homeUrl = new URL("/", baseUrl).href;
    const imageUrl = new URL("/imagens/arara.png", baseUrl).href;
    const structuredData = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "Guarda Roupa Virtual",
        description:
            "Marketplace de moda circular para comprar, trocar e alugar roupas.",
        url: homeUrl,
    }).replaceAll("<", "\\u003c");

    html = html.replace(
        /<link rel="canonical" href="[^"]*"\s*\/>/i,
        `<link rel="canonical" href="${escapeHtml(homeUrl)}" />`
    );
    html = html.replace(
        /<meta property="og:url" content="[^"]*"\s*\/>/i,
        `<meta property="og:url" content="${escapeHtml(homeUrl)}" />`
    );
    html = html.replace(
        /<meta property="og:image" content="[^"]*"\s*\/>/i,
        `<meta property="og:image" content="${escapeHtml(imageUrl)}" />`
    );
    html = html.replace(
        /<script type="application\/ld\+json" id="structured-data">[\s\S]*?<\/script>/i,
        `<script type="application/ld+json" id="structured-data">${structuredData}</script>`
    );
    return html;
}

function renderProductPage(product, baseUrl) {
    let html = renderHomePage(baseUrl);
    const canonical = productUrl(product, baseUrl);
    const description =
        product.desc || `Confira ${product.nome} no Guarda Roupa Virtual.`;
    const imagePath =
        product.image &&
        /^\/(?:imagens|uploads)\/[A-Za-z0-9._/-]+$/.test(product.image)
            ? product.image
            : "/imagens/arara.png";
    const imageUrl = new URL(imagePath, baseUrl).href;
    const productData = {
        "@context": "https://schema.org",
        "@type": "Product",
        name: product.nome,
        description,
        category: product.categoria,
        image: [imageUrl],
        ...(product.marca
            ? { brand: { "@type": "Brand", name: product.marca } }
            : {}),
        ...(product.preco !== null && Number.isFinite(Number(product.preco))
            ? {
                  offers: {
                      "@type": "Offer",
                      priceCurrency: "BRL",
                      price: Number(product.preco).toFixed(2),
                      availability:
                          Number(product.stock) > 0
                              ? "https://schema.org/InStock"
                              : "https://schema.org/OutOfStock",
                      url: canonical,
                  },
              }
            : {}),
    };
    const structuredData = JSON.stringify(productData).replaceAll(
        "<",
        "\\u003c"
    );

    html = html.replace(
        /<title>[^<]*<\/title>/i,
        `<title>${escapeHtml(product.nome)} | Guarda Roupa Virtual</title>`
    );
    html = html.replace(
        /<link rel="canonical" href="[^"]*"\s*\/>/i,
        `<link rel="canonical" href="${escapeHtml(canonical)}" />`
    );
    html = html.replace(
        /<meta name="description" content="[^"]*"\s*\/>/i,
        `<meta name="description" content="${escapeHtml(description)}" />`
    );
    html = html.replace(
        /<meta property="og:title" content="[^"]*"\s*\/>/i,
        `<meta property="og:title" content="${escapeHtml(product.nome)} | Guarda Roupa Virtual" />`
    );
    html = html.replace(
        /<meta property="og:description" content="[^"]*"\s*\/>/i,
        `<meta property="og:description" content="${escapeHtml(description)}" />`
    );
    html = html.replace(
        /<meta property="og:url" content="[^"]*"\s*\/>/i,
        `<meta property="og:url" content="${escapeHtml(canonical)}" />`
    );
    html = html.replace(
        /<meta property="og:image" content="[^"]*"\s*\/>/i,
        `<meta property="og:image" content="${escapeHtml(imageUrl)}" />`
    );
    html = html.replace(
        /<script type="application\/ld\+json" id="structured-data">[\s\S]*?<\/script>/i,
        `<script type="application/ld+json" id="structured-data">${structuredData}</script>`
    );
    return html;
}

function renderSitemap(baseUrl) {
    const productLocations = getProducts().map(
        (product) =>
            `    <url><loc>${escapeHtml(productUrl(product, baseUrl))}</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>`
    );
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n    <url><loc>${escapeHtml(new URL("/", baseUrl).href)}</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n${productLocations.join("\n")}\n</urlset>`;
}

// ROTAS DA API E SERVIDOR DE ARQUIVOS ESTATICOS
const server = http.createServer(async (request, response) => {
    const startedAt = Date.now();
    let requestUrl;
    try {
        requestUrl = new URL(request.url, `http://${request.headers.host}`);
    } catch {
        sendJson(response, 400, { error: "URL invalida." });
        return;
    }
    response.once("finish", () => {
        console.info(
            `${request.method} ${requestUrl.pathname} ${response.statusCode} ${Date.now() - startedAt}ms`
        );
    });

    if (request.method === "OPTIONS") {
        sendJson(response, 204, null);
        return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/health") {
        sendJson(response, 200, {
            status: "ok",
            service: "guarda-roupa-virtual",
        });
        return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/robots.txt") {
        const baseUrl = getPublicBaseUrl();
        response.writeHead(200, {
            "Content-Type": "text/plain; charset=utf-8",
            ...securityHeaders,
        });
        response.end(
            `User-agent: *\nAllow: /\nSitemap: ${baseUrl}/sitemap.xml\n`
        );
        return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/sitemap.xml") {
        const baseUrl = getPublicBaseUrl();
        response.writeHead(200, {
            "Content-Type": "application/xml; charset=utf-8",
            ...securityHeaders,
        });
        response.end(renderSitemap(baseUrl));
        return;
    }

    if (
        request.method === "GET" &&
        ["/", "/index.html"].includes(requestUrl.pathname)
    ) {
        response.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-cache",
            ...securityHeaders,
        });
        response.end(renderHomePage(getPublicBaseUrl()));
        return;
    }

    const productPageMatch =
        request.method === "GET" &&
        requestUrl.pathname.match(/^\/produto\/(\d+)(?:-[^/]*)?\/?$/);
    if (productPageMatch) {
        const product = getProducts().find(
            (item) => Number(item.id) === Number(productPageMatch[1])
        );
        if (!product) {
            response.writeHead(404, {
                "Content-Type": "text/plain; charset=utf-8",
                ...securityHeaders,
            });
            response.end("Produto nao encontrado.");
            return;
        }
        const baseUrl = getPublicBaseUrl();
        response.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-cache",
            ...securityHeaders,
            "Referrer-Policy": "no-referrer",
        });
        response.end(renderProductPage(product, baseUrl));
        return;
    }

    if (
        request.method === "POST" &&
        [
            "/api/auth/register",
            "/api/auth/login",
            "/api/auth/logout",
            "/api/auth/recover",
            "/api/auth/reset",
        ].includes(requestUrl.pathname)
    ) {
        if (!isSameOrigin(request)) {
            sendJson(response, 403, {
                error: "Origem da requisicao invalida.",
            });
            return;
        }

        if (requestUrl.pathname === "/api/auth/logout") {
            const user = getCurrentUser(request);
            if (user) {
                database.run("DELETE FROM sessions WHERE token_hash = ?", [
                    user.tokenHash,
                ]);
                await persistDatabase();
            }
            response.setHeader("Set-Cookie", sessionCookie("", 0));
            sendJson(response, 200, { ok: true });
            return;
        }

        if (requestUrl.pathname === "/api/auth/recover") {
            if (isLoginRateLimited(request)) {
                sendJson(response, 429, {
                    error: "Muitas tentativas. Tente novamente em 15 minutos.",
                });
                return;
            }
            try {
                const data = await readBody(request);
                const email = String(data.email || "")
                    .trim()
                    .toLowerCase();
                const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
                if (!validEmail) {
                    sendJson(response, 400, {
                        error: "Informe um e-mail válido.",
                    });
                    return;
                }

                if (
                    !process.env.PUBLIC_BASE_URL ||
                    !process.env.EMAIL_API_KEY ||
                    !process.env.EMAIL_FROM
                ) {
                    sendJson(response, 503, {
                        error: "Recuperação de senha não está configurada. Entre em contato com o suporte.",
                    });
                    return;
                }

                const user = queryOne("SELECT id FROM users WHERE email = ?", [
                    email,
                ]);
                if (user) {
                    const resetToken = await createPasswordResetToken(user.id);
                    try {
                        await sendPasswordResetEmail(email, resetToken);
                    } catch (error) {
                        database.run(
                            "DELETE FROM password_reset_tokens WHERE user_id = ?",
                            [user.id]
                        );
                        await persistDatabase();
                        sendJson(response, error.statusCode || 502, {
                            error: error.message,
                        });
                        return;
                    }
                }
                sendJson(response, 200, {
                    ok: true,
                    message:
                        "Se a conta existir, enviaremos um link de recuperação para o e-mail informado.",
                });
                return;
            } catch (error) {
                sendJson(response, 400, { error: error.message });
            }
            return;
        }

        if (requestUrl.pathname === "/api/auth/reset") {
            if (isLoginRateLimited(request)) {
                sendJson(response, 429, {
                    error: "Muitas tentativas. Tente novamente em 15 minutos.",
                });
                return;
            }
            try {
                const data = await readBody(request);
                const token = String(data.token || "");
                const password = String(data.senha || "");
                if (
                    token.length < 32 ||
                    token.length > 128 ||
                    password.length < 8 ||
                    password.length > 128
                ) {
                    sendJson(response, 400, {
                        error: "Token inválido ou senha fora do limite de 8 a 128 caracteres.",
                    });
                    return;
                }

                const tokenHash = crypto
                    .createHash("sha256")
                    .update(token)
                    .digest("hex");
                const reset = queryOne(
                    "SELECT user_id, expires_at FROM password_reset_tokens WHERE token_hash = ?",
                    [tokenHash]
                );
                if (!reset || reset.expires_at <= Date.now()) {
                    if (reset) {
                        database.run(
                            "DELETE FROM password_reset_tokens WHERE token_hash = ?",
                            [tokenHash]
                        );
                        await persistDatabase();
                    }
                    sendJson(response, 400, {
                        error: "O link expirou ou já foi utilizado. Solicite outro.",
                    });
                    return;
                }

                const passwordHash = await hashPassword(password);
                database.run("BEGIN");
                try {
                    database.run(
                        "UPDATE users SET password_hash = ? WHERE id = ?",
                        [passwordHash, reset.user_id]
                    );
                    database.run(
                        "DELETE FROM password_reset_tokens WHERE user_id = ?",
                        [reset.user_id]
                    );
                    database.run("DELETE FROM sessions WHERE user_id = ?", [
                        reset.user_id,
                    ]);
                    database.run("COMMIT");
                    await persistDatabase();
                } catch (error) {
                    database.run("ROLLBACK");
                    throw error;
                }
                sendJson(response, 200, { ok: true });
            } catch (error) {
                sendJson(response, error.statusCode || 400, {
                    error: error.message,
                });
            }
            return;
        }

        if (isLoginRateLimited(request)) {
            sendJson(response, 429, {
                error: "Muitas tentativas. Tente novamente em 15 minutos.",
            });
            return;
        }

        try {
            const data = await readBody(request);
            const email = String(data.email || "")
                .trim()
                .toLowerCase();
            const password = String(data.senha || "");

            if (requestUrl.pathname === "/api/auth/register") {
                const name = String(data.nome || "").trim();
                const city = String(data.cidade || "").trim();
                if (
                    !name ||
                    name.length > 100 ||
                    !city ||
                    city.length > 100 ||
                    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
                    email.length > 254 ||
                    password.length < 8 ||
                    password.length > 128
                ) {
                    sendJson(response, 400, {
                        error: "Informe nome, e-mail valido, cidade e senha de 8 a 128 caracteres.",
                    });
                    return;
                }
                if (queryOne("SELECT id FROM users WHERE email = ?", [email])) {
                    sendJson(response, 409, {
                        error: "Este e-mail ja esta cadastrado.",
                    });
                    return;
                }
                const passwordHash = await hashPassword(password);
                try {
                    database.run(
                        "INSERT INTO users (email, password_hash, name, city, created_at) VALUES (?, ?, ?, ?, ?)",
                        [
                            email,
                            passwordHash,
                            name,
                            city,
                            new Date().toISOString(),
                        ]
                    );
                } catch (error) {
                    if (String(error.message).includes("UNIQUE")) {
                        sendJson(response, 409, {
                            error: "Este e-mail ja esta cadastrado.",
                        });
                        return;
                    }
                    throw error;
                }
                const user = queryOne(
                    "SELECT id, email, name, city FROM users WHERE email = ?",
                    [email]
                );
                loginAttempts.delete(rateLimitKey(request));
                await createSession(user.id, response);
                sendJson(response, 201, publicUser(user));
                return;
            }

            const user = queryOne(
                "SELECT id, email, password_hash, name, city FROM users WHERE email = ?",
                [email]
            );
            if (
                !user ||
                !(await verifyPassword(password, user.password_hash))
            ) {
                sendJson(response, 401, {
                    error: "E-mail ou senha incorretos.",
                });
                return;
            }
            loginAttempts.delete(rateLimitKey(request));
            await createSession(user.id, response);
            sendJson(response, 200, publicUser(user));
        } catch (error) {
            sendJson(response, error.statusCode || 400, {
                error: error.message,
            });
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

    if (
        request.method === "PATCH" &&
        requestUrl.pathname === "/api/auth/profile"
    ) {
        if (!isSameOrigin(request)) {
            sendJson(response, 403, {
                error: "Origem da requisicao invalida.",
            });
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
                sendJson(response, 400, {
                    error: "Informe nome e cidade validos.",
                });
                return;
            }
            database.run("UPDATE users SET name = ?, city = ? WHERE id = ?", [
                name,
                city,
                user.id,
            ]);
            await persistDatabase();
            sendJson(
                response,
                200,
                publicUser(
                    queryOne(
                        "SELECT id, email, name, city FROM users WHERE id = ?",
                        [user.id]
                    )
                )
            );
        } catch (error) {
            sendJson(response, 400, { error: error.message });
        }
        return;
    }

    if (
        request.method === "GET" &&
        requestUrl.pathname === "/api/conversations"
    ) {
        const user = getCurrentUser(request);
        if (!user) {
            sendJson(response, 401, { error: "Autenticacao necessaria." });
            return;
        }
        const messages = queryAll(
            `
            SELECT messages.product_id, messages.sender_id, messages.recipient_id, messages.body, messages.created_at,
                products.data AS product_data, sender.name AS sender_name, recipient.name AS recipient_name
            FROM messages
            JOIN products ON products.id = messages.product_id
            JOIN users AS sender ON sender.id = messages.sender_id
            JOIN users AS recipient ON recipient.id = messages.recipient_id
            WHERE messages.sender_id = ? OR messages.recipient_id = ?
            ORDER BY messages.id DESC
        `,
            [user.id, user.id]
        );
        const conversations = new Map();
        messages.forEach((message) => {
            const productId = Number(message.product_id);
            const isSender = Number(message.sender_id) === Number(user.id);
            const otherUserId = isSender
                ? Number(message.recipient_id)
                : Number(message.sender_id);
            const key = `${productId}:${otherUserId}`;
            if (conversations.has(key)) return;
            const otherName = isSender
                ? message.recipient_name
                : message.sender_name;
            conversations.set(key, {
                productId,
                otherUserId,
                productName: JSON.parse(message.product_data).nome,
                otherName,
                message: message.body,
                createdAt: message.created_at,
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
        const product = queryOne("SELECT owner_id FROM products WHERE id = ?", [
            productId,
        ]);
        if (!Number.isSafeInteger(productId) || !product) {
            sendJson(response, 404, { error: "Anuncio nao encontrado." });
            return;
        }
        if (!product.owner_id) {
            sendJson(response, 409, {
                error: "Este anuncio nao possui uma conta de vendedor para conversar.",
            });
            return;
        }
        const ownerId = Number(product.owner_id);
        if (Number(user.id) !== ownerId && otherUserId !== ownerId) {
            sendJson(response, 404, { error: "Conversa nao encontrada." });
            return;
        }
        if (
            Number(user.id) === ownerId &&
            (!Number.isSafeInteger(otherUserId) ||
                otherUserId <= 0 ||
                otherUserId === ownerId)
        ) {
            sendJson(response, 400, {
                error: "Selecione uma conversa valida.",
            });
            return;
        }
        const messages = queryAll(
            `
            SELECT messages.id, messages.product_id, messages.sender_id, messages.recipient_id, messages.body, messages.created_at, users.name AS sender_name
            FROM messages JOIN users ON users.id = messages.sender_id
            WHERE messages.product_id = ? AND ((messages.sender_id = ? AND messages.recipient_id = ?) OR (messages.sender_id = ? AND messages.recipient_id = ?))
            ORDER BY messages.id
        `,
            [productId, user.id, otherUserId, otherUserId, user.id]
        );
        sendJson(response, 200, messages);
        return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/messages") {
        if (!isSameOrigin(request)) {
            sendJson(response, 403, {
                error: "Origem da requisicao invalida.",
            });
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
            const product = queryOne(
                "SELECT owner_id FROM products WHERE id = ?",
                [productId]
            );
            if (!Number.isSafeInteger(productId) || !product) {
                sendJson(response, 404, { error: "Anuncio nao encontrado." });
                return;
            }
            const ownerId = Number(product.owner_id);
            if (!ownerId || !body || body.length > 2000) {
                sendJson(response, 400, {
                    error: "Mensagem ou conversa invalida.",
                });
                return;
            }
            let recipientId = ownerId;
            if (Number(user.id) === ownerId) {
                recipientId = Number(data.otherUserId);
                const previous = queryOne(
                    "SELECT id FROM messages WHERE product_id = ? AND ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)) LIMIT 1",
                    [productId, user.id, recipientId, recipientId, user.id]
                );
                if (
                    !Number.isSafeInteger(recipientId) ||
                    recipientId <= 0 ||
                    recipientId === ownerId ||
                    !previous
                ) {
                    sendJson(response, 409, {
                        error: "Aguarde o comprador iniciar a conversa.",
                    });
                    return;
                }
            } else if (
                data.otherUserId &&
                Number(data.otherUserId) !== ownerId
            ) {
                sendJson(response, 404, { error: "Conversa nao encontrada." });
                return;
            }
            if (recipientId === Number(user.id)) {
                sendJson(response, 400, { error: "Destinatario invalido." });
                return;
            }
            const createdAt = new Date().toISOString();
            database.run(
                "INSERT INTO messages (product_id, sender_id, recipient_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
                [productId, user.id, recipientId, body, createdAt]
            );
            const messageId = queryOne("SELECT last_insert_rowid() AS id").id;
            await persistDatabase();
            sendJson(response, 201, {
                id: messageId,
                productId,
                senderId: user.id,
                recipientId,
                body,
                createdAt,
                senderName: user.name,
            });
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
        const orders = queryAll(
            "SELECT data FROM orders WHERE user_id = ? ORDER BY created_at DESC",
            [user.id]
        ).map(getOrder);
        sendJson(response, 200, orders);
        return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/orders") {
        if (!isSameOrigin(request)) {
            sendJson(response, 403, {
                error: "Origem da requisicao invalida.",
            });
            return;
        }
        const user = getCurrentUser(request);
        if (!user) {
            sendJson(response, 401, {
                error: "Entre na conta para criar um pedido.",
            });
            return;
        }

        const idempotencyKey = String(
            request.headers["idempotency-key"] || ""
        ).trim();
        if (idempotencyKey.length < 8 || idempotencyKey.length > 100) {
            sendJson(response, 400, { error: "Chave de pedido invalida." });
            return;
        }

        let transactionStarted = false;
        try {
            const data = await readBody(request);
            if (
                !Array.isArray(data.items) ||
                data.items.length < 1 ||
                data.items.length > 50
            ) {
                sendJson(response, 400, {
                    error: "O pedido precisa conter de 1 a 50 itens.",
                });
                return;
            }
            const quantities = new Map();
            for (const item of data.items) {
                const productId = Number(item.productId);
                const quantity = Number(item.qty);
                if (
                    !Number.isSafeInteger(productId) ||
                    !Number.isInteger(quantity) ||
                    quantity < 1 ||
                    quantity > 20
                ) {
                    sendJson(response, 400, {
                        error: "Quantidade ou produto invalido.",
                    });
                    return;
                }
                quantities.set(
                    productId,
                    (quantities.get(productId) || 0) + quantity
                );
            }
            if ([...quantities.values()].some((quantity) => quantity > 20)) {
                sendJson(response, 400, {
                    error: "Quantidade maxima por produto excedida.",
                });
                return;
            }
            const coupon = String(data.couponCode || "")
                .trim()
                .toUpperCase();
            if (coupon && !["BEMVINDO10", "MODACONSCIENTE"].includes(coupon)) {
                const error = new Error("Cupom invalido ou expirado.");
                error.statusCode = 400;
                throw error;
            }

            database.run("BEGIN IMMEDIATE");
            transactionStarted = true;
            const existingOrder = queryOne(
                "SELECT data FROM orders WHERE user_id = ? AND idempotency_key = ?",
                [user.id, idempotencyKey]
            );
            if (existingOrder) {
                database.run("COMMIT");
                transactionStarted = false;
                sendJson(response, 200, getOrder(existingOrder));
                return;
            }

            const orderItems = [];
            let subtotalCents = 0;
            for (const [productId, quantity] of quantities) {
                const row = queryOne(
                    "SELECT data, stock, owner_id FROM products WHERE id = ?",
                    [productId]
                );
                if (!row) {
                    const error = new Error(
                        "Uma das pecas nao esta mais disponivel."
                    );
                    error.statusCode = 409;
                    throw error;
                }
                const product = productFromRow(row);
                if (Number(row.owner_id) === Number(user.id)) {
                    const error = new Error(
                        "Voce nao pode comprar seu proprio anuncio."
                    );
                    error.statusCode = 409;
                    throw error;
                }
                if (!Number.isFinite(product.preco) || product.preco <= 0) {
                    const error = new Error(
                        "O item nao esta anunciado para venda."
                    );
                    error.statusCode = 409;
                    throw error;
                }
                if (row.stock < quantity) {
                    const error = new Error(
                        `Estoque insuficiente para ${product.nome}.`
                    );
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
                    price: priceCents / 100,
                });
                product.stock = row.stock - quantity;
                saveProduct(product);
            }

            let discountCents = 0;
            if (coupon === "BEMVINDO10")
                discountCents = Math.round(subtotalCents * 0.1);
            if (coupon === "MODACONSCIENTE")
                discountCents = Math.min(subtotalCents, 1500);
            const totalCents = Math.max(0, subtotalCents - discountCents);
            const order = {
                id: crypto.randomUUID(),
                name: `${orderItems.length} item(ns)`,
                status: "demonstracao",
                stage: 0,
                total: totalCents / 100,
                createdAt: new Date().toISOString(),
                items: orderItems,
            };
            database.run(
                "INSERT INTO orders (id, user_id, idempotency_key, status, created_at, data) VALUES (?, ?, ?, ?, ?, ?)",
                [
                    order.id,
                    user.id,
                    idempotencyKey,
                    order.status,
                    order.createdAt,
                    JSON.stringify(order),
                ]
            );
            database.run("COMMIT");
            transactionStarted = false;
            await persistDatabase();
            sendJson(response, 201, order);
        } catch (error) {
            if (transactionStarted) database.run("ROLLBACK");
            sendJson(response, error.statusCode || 400, {
                error: error.message,
            });
        }
        return;
    }

    const cancelOrderMatch =
        request.method === "PATCH" &&
        requestUrl.pathname.match(/^\/api\/orders\/([^/]+)\/cancel$/);
    if (cancelOrderMatch) {
        if (!isSameOrigin(request)) {
            sendJson(response, 403, {
                error: "Origem da requisicao invalida.",
            });
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
            const row = queryOne(
                "SELECT data FROM orders WHERE id = ? AND user_id = ?",
                [orderId, user.id]
            );
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
                const error = new Error(
                    "Este pedido nao pode mais ser cancelado."
                );
                error.statusCode = 409;
                throw error;
            }
            for (const item of order.items) {
                const productRow = queryOne(
                    "SELECT data, stock, owner_id FROM products WHERE id = ?",
                    [item.id]
                );
                if (!productRow) continue;
                const product = productFromRow(productRow);
                product.stock = productRow.stock + item.qty;
                saveProduct(product);
            }
            order.status = "cancelado";
            database.run(
                "UPDATE orders SET status = ?, data = ? WHERE id = ?",
                [order.status, JSON.stringify(order), order.id]
            );
            database.run("COMMIT");
            transactionStarted = false;
            await persistDatabase();
            sendJson(response, 200, order);
        } catch (error) {
            if (transactionStarted) database.run("ROLLBACK");
            sendJson(response, error.statusCode || 400, {
                error: error.message,
            });
        }
        return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/products") {
        sendJson(response, 200, getProducts());
        return;
    }

    if (
        (request.method === "POST" || request.method === "PUT") &&
        (requestUrl.pathname === "/api/products" ||
            requestUrl.pathname.startsWith("/api/products/"))
    ) {
        if (!isSameOrigin(request)) {
            sendJson(response, 403, {
                error: "Origem da requisicao invalida.",
            });
            return;
        }
        const user = getCurrentUser(request);
        if (!user) {
            sendJson(response, 401, {
                error: "Entre na conta para gerenciar anuncios.",
            });
            return;
        }
        const productIdMatch = requestUrl.pathname.match(
            /^\/api\/products\/(\d+)$/
        );
        if (
            (request.method === "POST" &&
                requestUrl.pathname !== "/api/products") ||
            (request.method === "PUT" && !productIdMatch)
        ) {
            sendJson(response, 400, {
                error: "Rota ou identificador do produto invalido.",
            });
            return;
        }
        const routeId = productIdMatch ? Number(productIdMatch[1]) : null;
        if (
            request.method === "PUT" &&
            (!Number.isSafeInteger(routeId) || routeId <= 0)
        ) {
            sendJson(response, 400, {
                error: "Identificador do produto invalido.",
            });
            return;
        }
        try {
            const data = await readBody(request);
            const name = typeof data.nome === "string" ? data.nome.trim() : "";
            const category =
                typeof data.categoria === "string" ? data.categoria.trim() : "";
            const price =
                data.preco === null || data.preco === undefined
                    ? null
                    : Number(data.preco);
            const rentalPrice =
                data.aluguel === null || data.aluguel === undefined
                    ? null
                    : Number(data.aluguel);
            const stock = data.stock === undefined ? 1 : Number(data.stock);
            const rawImages = data.images === undefined ? [] : data.images;
            const image =
                data.image === undefined ? rawImages[0] || "" : data.image;
            const hasValidImage = (value) => {
                if (typeof value !== "string") return false;
                if (value === "") return true;
                const dataUri = value.match(
                    /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]*={0,2})$/
                );
                if (dataUri)
                    return (
                        Buffer.from(dataUri[1], "base64").length <= 2_000_000
                    );
                return (
                    /^\/(?:imagens|uploads)\/[A-Za-z0-9._/-]+$/.test(value) &&
                    !value.split("/").includes("..")
                );
            };
            const allImages = [
                image,
                ...(Array.isArray(rawImages) ? rawImages : []),
            ];
            const uniqueImages = [
                ...new Set(
                    allImages.filter(
                        (value) =>
                            typeof value === "string" &&
                            value.startsWith("data:image/")
                    )
                ),
            ];
            const totalImageBytes = uniqueImages.reduce(
                (total, value) =>
                    total +
                    Buffer.from(value.slice(value.indexOf(",") + 1), "base64")
                        .length,
                0
            );
            const description =
                typeof data.desc === "string" ? data.desc.trim() : "";
            if (
                !name ||
                name.length > 120 ||
                !category ||
                category.length > 60 ||
                (price !== null && (!Number.isFinite(price) || price <= 0)) ||
                (rentalPrice !== null &&
                    (!Number.isFinite(rentalPrice) || rentalPrice <= 0)) ||
                (price === null && rentalPrice === null && !data.troca) ||
                !Number.isSafeInteger(stock) ||
                stock < 0 ||
                !Array.isArray(rawImages) ||
                rawImages.length > 8 ||
                !hasValidImage(image) ||
                rawImages.some((value) => !hasValidImage(value)) ||
                totalImageBytes > 4_000_000 ||
                description.length > 3000 ||
                (request.method === "PUT" &&
                    data.id !== undefined &&
                    Number(data.id) !== routeId)
            ) {
                sendJson(response, 400, {
                    error: "Dados do produto invalidos.",
                });
                return;
            }

            const product = {
                id: request.method === "PUT" ? routeId : Date.now(),
                nome: name,
                marca: String(data.marca || "Sem marca").trim(),
                categoria: category,
                tamanho: String(data.tamanho || "").trim(),
                cor: String(data.cor || "").trim(),
                preco: price,
                aluguel: rentalPrice,
                troca: Boolean(data.troca),
                local: String(data.local || "Nao informada").trim(),
                vendedor: user.name,
                rating: 0,
                pop: 0,
                desc: description,
                image,
                images: rawImages,
                measurements: {
                    bust: Number(data.measurements?.bust) || null,
                    waist: Number(data.measurements?.waist) || null,
                    hip: Number(data.measurements?.hip) || null,
                    length: Number(data.measurements?.length) || null,
                    fit: String(data.measurements?.fit || "").trim(),
                },
                estado: String(data.estado || "Usado").trim(),
                emoji: String(data.emoji || "👕"),
                stock,
                ownerEmail: user.email,
                ownerId: user.id,
            };

            const existing = queryOne(
                "SELECT data, stock, owner_id FROM products WHERE id = ?",
                [product.id]
            );
            if (request.method === "PUT" && !existing) {
                sendJson(response, 404, { error: "Produto nao encontrado." });
                return;
            }
            if (request.method === "POST" && existing) {
                sendJson(response, 409, {
                    error: "Ja existe um produto com esse identificador.",
                });
                return;
            }
            if (
                request.method === "PUT" &&
                Number(existing.owner_id) !== Number(user.id)
            ) {
                sendJson(response, 403, {
                    error: "Voce nao pode editar este anuncio.",
                });
                return;
            }
            if (request.method === "PUT") product.stock = existing.stock;
            await storeProductImages(product);
            saveProduct(product);
            await persistDatabase();
            sendJson(response, request.method === "PUT" ? 200 : 201, product);
        } catch (error) {
            sendJson(response, error.statusCode || 400, {
                error: error.message,
            });
        }
        return;
    }

    if (
        request.method === "DELETE" &&
        requestUrl.pathname.startsWith("/api/products/")
    ) {
        if (!isSameOrigin(request)) {
            sendJson(response, 403, {
                error: "Origem da requisicao invalida.",
            });
            return;
        }
        const user = getCurrentUser(request);
        if (!user) {
            sendJson(response, 401, {
                error: "Entre na conta para gerenciar anuncios.",
            });
            return;
        }
        const deleteMatch = requestUrl.pathname.match(
            /^\/api\/products\/(\d+)$/
        );
        const id = deleteMatch ? Number(deleteMatch[1]) : NaN;
        if (!Number.isSafeInteger(id) || id <= 0) {
            sendJson(response, 400, {
                error: "Identificador do produto invalido.",
            });
            return;
        }
        const product = queryOne("SELECT owner_id FROM products WHERE id = ?", [
            id,
        ]);
        if (!product) {
            sendJson(response, 404, { error: "Produto nao encontrado." });
            return;
        }
        if (Number(product.owner_id) !== Number(user.id)) {
            sendJson(response, 403, {
                error: "Voce nao pode excluir este anuncio.",
            });
            return;
        }
        const hasActiveReservation = queryAll(
            "SELECT data FROM orders WHERE status = 'demonstracao'"
        ).some((order) =>
            getOrder(order).items.some((item) => Number(item.id) === id)
        );
        if (hasActiveReservation) {
            sendJson(response, 409, {
                error: "Cancele a reserva de demonstracao antes de excluir este anuncio.",
            });
            return;
        }
        database.run("DELETE FROM products WHERE id = ?", [id]);
        await persistDatabase();
        sendJson(response, 204, null);
        return;
    }

    if (request.method === "GET") {
        const isProductPage = /^\/produto\/\d+(?:-[^/]*)?\/?$/.test(
            requestUrl.pathname
        );
        let requestedPath;
        try {
            requestedPath = decodeURIComponent(
                requestUrl.pathname === "/" || isProductPage
                    ? "/index.html"
                    : requestUrl.pathname
            );
        } catch {
            response.writeHead(400, {
                "Content-Type": "text/plain; charset=utf-8",
            });
            response.end("URL invalida.");
            return;
        }

        const uploadedImageMatch = requestedPath.match(
            /^\/uploads\/([a-f0-9]{64}\.(?:jpg|png|webp))$/
        );
        const isAllowedStaticPath =
            allowedStaticFiles.has(requestedPath) ||
            requestedPath.startsWith("/imagens/") ||
            Boolean(uploadedImageMatch);
        if (!isAllowedStaticPath) {
            response.writeHead(403, securityHeaders);
            response.end("Acesso negado.");
            return;
        }

        const filePath = uploadedImageMatch
            ? path.join(uploadsDirectory, uploadedImageMatch[1])
            : path.resolve(__dirname, `.${requestedPath}`);
        const relativePath = path.relative(__dirname, filePath);
        const protectedPath = relativePath
            .split(path.sep)
            .some(
                (part) =>
                    part.startsWith(".") ||
                    part === "node_modules" ||
                    part === path.basename(dataDirectory)
            );
        if (
            !uploadedImageMatch &&
            (relativePath.startsWith("..") ||
                path.isAbsolute(relativePath) ||
                protectedPath)
        ) {
            response.writeHead(403, securityHeaders);
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
                ".webp": "image/webp",
            };
            const content = fs.readFileSync(filePath);
            const etag = `"${crypto.createHash("sha1").update(content).digest("base64url")}"`;
            const extension = path.extname(filePath).toLowerCase();
            const isHashedUpload = Boolean(uploadedImageMatch);
            const cacheControl = isHashedUpload
                ? "public, max-age=31536000, immutable"
                : "public, max-age=3600, must-revalidate";
            if (request.headers["if-none-match"] === etag) {
                response.writeHead(304, {
                    ETag: etag,
                    "Cache-Control": cacheControl,
                    ...securityHeaders,
                });
                response.end();
                return;
            }
            const headers = {
                "Content-Type":
                    contentTypes[extension] || "application/octet-stream",
                "Cache-Control": cacheControl,
                ETag: etag,
                ...securityHeaders,
            };
            const compressible =
                /\.(?:css|html|js|json|txt|webmanifest|xml)$/.test(extension);
            if (
                compressible &&
                /\bgzip\b/.test(request.headers["accept-encoding"] || "")
            ) {
                headers["Content-Encoding"] = "gzip";
                headers.Vary = "Accept-Encoding";
                response.writeHead(200, headers);
                response.end(zlib.gzipSync(content));
                return;
            }
            response.writeHead(200, headers);
            response.end(content);
        } catch {
            response.writeHead(404, securityHeaders);
            response.end("Arquivo nao encontrado.");
        }
        return;
    }

    sendJson(response, 404, { error: "Rota nao encontrada." });
});

initializeDatabase()
    .then(() => {
        server.listen(PORT, () => {
            console.log(`Backend iniciado em http://localhost:${PORT}`);
        });
    })
    .catch((error) => {
        console.error("Falha ao iniciar o banco de dados.", error);
        process.exitCode = 1;
    });

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
        console.info(`Recebido ${signal}; encerrando o servidor.`);
        server.close(async () => {
            try {
                if (database) await persistDatabase();
                process.exit(0);
            } catch (error) {
                console.error(
                    "Falha ao salvar o banco durante o encerramento.",
                    error
                );
                process.exit(1);
            }
        });
    });
}
