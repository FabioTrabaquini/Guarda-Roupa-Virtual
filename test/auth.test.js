// Testes de integracao para autenticacao, permissoes, pedidos, estoque e privacidade do chat.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { test } = require("node:test");
const initializeSqlite = require("sql.js");

const projectDirectory = path.resolve(__dirname, "..");

async function availablePort() {
    const listener = net.createServer();
    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
    const { port } = listener.address();
    await new Promise((resolve, reject) =>
        listener.close((error) => (error ? reject(error) : resolve()))
    );
    return port;
}

async function bootServer(dataDirectory, extraEnv = {}) {
    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const process = spawn(global.process.execPath, ["server.js"], {
        cwd: projectDirectory,
        env: {
            ...global.process.env,
            PORT: String(port),
            APP_DATA_DIR: dataDirectory,
            PUBLIC_BASE_URL: baseUrl,
            ...extraEnv,
        },
        stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    process.stdout.on("data", (chunk) => {
        output += chunk.toString();
    });
    process.stderr.on("data", (chunk) => {
        output += chunk.toString();
    });

    for (let attempt = 0; attempt < 60; attempt += 1) {
        if (process.exitCode !== null)
            throw new Error(`Server exited early: ${output}`);
        try {
            const response = await fetch(`${baseUrl}/api/health`);
            if (response.ok) return { process, baseUrl, output: () => output };
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    process.kill();
    throw new Error(`Server did not start: ${output}`);
}

async function stopServer(server) {
    if (!server || server.process.exitCode !== null) return;
    const exited = once(server.process, "exit");
    server.process.kill();
    await exited;
}

function sessionCookie(response) {
    const value = response.headers.get("set-cookie") || "";
    const match = value.match(/(?:^|;\s*)sid=([^;]*)/);
    assert.ok(match, "Expected the server to issue a session cookie");
    return `sid=${match[1]}`;
}

async function request(
    server,
    route,
    {
        method = "GET",
        body,
        cookie,
        origin = server.baseUrl,
        extraHeaders = {},
    } = {}
) {
    const headers = { Origin: origin, ...extraHeaders };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (cookie) headers.Cookie = cookie;
    return fetch(`${server.baseUrl}${route}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}

test("account authentication and listing ownership are enforced by the server", async (t) => {
    const dataDirectory = fs.mkdtempSync(
        path.join(os.tmpdir(), "guarda-roupa-auth-")
    );
    let server = await bootServer(dataDirectory);
    t.after(async () => {
        await stopServer(server);
        fs.rmSync(dataDirectory, { recursive: true, force: true });
    });

    const firstEmail = `first-${Date.now()}@example.edu`;
    const firstPassword = "senha-forte-123";
    const invalidRegistration = await request(server, "/api/auth/register", {
        method: "POST",
        body: {
            nome: "Pessoa Um",
            email: firstEmail,
            senha: "curta",
            cidade: "Londrina",
        },
    });
    assert.equal(invalidRegistration.status, 400);

    const anonymousProduct = await request(server, "/api/products", {
        method: "POST",
        body: { nome: "Produto indevido", categoria: "Casacos", preco: 10 },
    });
    assert.equal(anonymousProduct.status, 401);

    const maliciousOrigin = await request(server, "/api/auth/logout", {
        method: "POST",
        origin: "https://attacker.example",
    });
    assert.equal(maliciousOrigin.status, 403);

    const registration = await request(server, "/api/auth/register", {
        method: "POST",
        body: {
            nome: "Pessoa Um",
            email: firstEmail,
            senha: firstPassword,
            cidade: "Londrina, PR",
        },
    });
    assert.equal(registration.status, 201);
    const firstUser = await registration.json();
    assert.equal(firstUser.email, firstEmail);
    assert.equal("senha" in firstUser, false);
    assert.match(registration.headers.get("set-cookie"), /HttpOnly/);
    assert.match(registration.headers.get("set-cookie"), /SameSite=Strict/);
    const firstCookie = sessionCookie(registration);

    const malformedProductId = await request(
        server,
        "/api/products/not-a-number",
        {
            method: "PUT",
            cookie: firstCookie,
            body: { nome: "ID inválido", categoria: "Casacos", preco: 10 },
        }
    );
    assert.equal(malformedProductId.status, 400);

    const invalidStock = await request(server, "/api/products", {
        method: "POST",
        cookie: firstCookie,
        body: {
            nome: "Estoque inválido",
            categoria: "Casacos",
            preco: 10,
            stock: "inválido",
        },
    });
    assert.equal(invalidStock.status, 400);

    const oversizedBody = await request(server, "/api/products", {
        method: "POST",
        cookie: firstCookie,
        body: {
            nome: "Corpo grande",
            categoria: "Casacos",
            preco: 10,
            description: "x".repeat(6_000_001),
        },
    });
    assert.equal(oversizedBody.status, 413);

    const duplicate = await request(server, "/api/auth/register", {
        method: "POST",
        body: {
            nome: "Pessoa Um",
            email: firstEmail,
            senha: firstPassword,
            cidade: "Londrina",
        },
    });
    assert.equal(duplicate.status, 409);

    const recoveryRequest = await request(server, "/api/auth/recover", {
        method: "POST",
        body: { email: firstEmail },
    });
    assert.equal(recoveryRequest.status, 503);
    const recoveryPayload = await recoveryRequest.json();
    assert.match(recoveryPayload.error, /não está configurada/i);
    assert.equal("resetToken" in recoveryPayload, false);

    const recoveryForUnknown = await request(server, "/api/auth/recover", {
        method: "POST",
        body: { email: `missing-${Date.now()}@example.edu` },
    });
    assert.equal(recoveryForUnknown.status, 503);

    const forbiddenRepoFile = await fetch(`${server.baseUrl}/server.js`);
    assert.equal(forbiddenRepoFile.status, 403);
    assert.equal((await fetch(`${server.baseUrl}/package.json`)).status, 403);
    assert.equal((await fetch(`${server.baseUrl}/.git/config`)).status, 403);
    const forbiddenSeedFile = await fetch(`${server.baseUrl}/products.json`);
    assert.equal(forbiddenSeedFile.status, 403);
    const catalog = await (await request(server, "/api/products")).json();
    const seedCatalog = JSON.parse(
        fs.readFileSync(path.join(projectDirectory, "products.json"), "utf8")
    );
    assert.deepEqual(
        catalog.map(({ id, nome }) => ({ id, nome })),
        seedCatalog.map(({ id, nome }) => ({ id, nome }))
    );

    const homePage = await (await fetch(server.baseUrl)).text();
    assert.ok(
        homePage.includes(`<link rel="canonical" href="${server.baseUrl}/"`)
    );
    assert.ok(
        homePage.includes(
            `<meta property="og:url" content="${server.baseUrl}/"`
        )
    );
    const productPage = await (
        await fetch(`${server.baseUrl}/produto/1-camisa-social-preta`)
    ).text();
    assert.ok(
        productPage.includes(
            `<link rel="canonical" href="${server.baseUrl}/produto/1-camisa-social-preta"`
        )
    );
    assert.ok(
        productPage.includes(
            `<meta property="og:image" content="${server.baseUrl}/imagens/arara.png"`
        )
    );
    assert.ok(productPage.includes('"@type":"Product"'));
    assert.ok(productPage.includes('"name":"Camisa Social Preta"'));
    const sitemap = await (await fetch(`${server.baseUrl}/sitemap.xml`)).text();
    assert.ok(
        sitemap.includes(`${server.baseUrl}/produto/1-camisa-social-preta`)
    );
    assert.equal(sitemap.includes("example.com"), false);

    const malformedRequest = await fetch(`${server.baseUrl}/%`);
    assert.equal(malformedRequest.status, 400);

    const initialSession = await request(server, "/api/auth/me", {
        cookie: firstCookie,
    });
    assert.equal(initialSession.status, 200);

    const SQL = await initializeSqlite();
    const database = new SQL.Database(
        fs.readFileSync(path.join(dataDirectory, "marketplace.sqlite"))
    );
    const storedHash = database.exec("SELECT password_hash FROM users")[0]
        .values[0][0];
    database.close();
    assert.match(storedHash, /^scrypt:/);
    assert.notEqual(storedHash, firstPassword);

    const badLogin = await request(server, "/api/auth/login", {
        method: "POST",
        body: { email: firstEmail, senha: "senha-errada" },
    });
    assert.equal(badLogin.status, 401);

    const secondEmail = `second-${Date.now()}@example.edu`;
    const secondRegistration = await request(server, "/api/auth/register", {
        method: "POST",
        body: {
            nome: "Pessoa Dois",
            email: secondEmail,
            senha: firstPassword,
            cidade: "Cambé, PR",
        },
    });
    assert.equal(secondRegistration.status, 201);
    const secondUser = await secondRegistration.json();
    const secondCookie = sessionCookie(secondRegistration);

    const listingResponse = await request(server, "/api/products", {
        method: "POST",
        cookie: firstCookie,
        body: {
            nome: "Jaqueta universitária",
            categoria: "Casacos",
            preco: 45,
            ownerEmail: "forjado@example.com",
        },
    });
    assert.equal(listingResponse.status, 201);
    const listing = await listingResponse.json();
    assert.equal(listing.ownerEmail, firstEmail);

    const mismatchedProductId = await request(
        server,
        `/api/products/${listing.id}`,
        {
            method: "PUT",
            cookie: firstCookie,
            body: {
                id: listing.id + 1,
                nome: "ID divergente",
                categoria: "Casacos",
                preco: 10,
            },
        }
    );
    assert.equal(mismatchedProductId.status, 400);

    const firstMessageResponse = await request(server, "/api/messages", {
        method: "POST",
        cookie: secondCookie,
        body: {
            productId: listing.id,
            message: "A peça ainda está disponível?",
        },
    });
    assert.equal(firstMessageResponse.status, 201);
    assert.equal((await firstMessageResponse.json()).recipientId, firstUser.id);
    const sellerConversations = await request(server, "/api/conversations", {
        cookie: firstCookie,
    });
    const sellerConversation = (await sellerConversations.json())[0];
    assert.equal(sellerConversation.otherUserId, secondUser.id);
    assert.equal(sellerConversation.otherName, "Pessoa Dois");

    const sellerReply = await request(server, "/api/messages", {
        method: "POST",
        cookie: firstCookie,
        body: {
            productId: listing.id,
            otherUserId: secondUser.id,
            message: "Sim, está disponível.",
        },
    });
    assert.equal(sellerReply.status, 201);
    const buyerMessages = await request(
        server,
        `/api/messages?productId=${listing.id}&otherUserId=${firstUser.id}`,
        { cookie: secondCookie }
    );
    assert.equal((await buyerMessages.json()).length, 2);

    const rentalListingResponse = await request(server, "/api/products", {
        method: "POST",
        cookie: firstCookie,
        body: {
            nome: "Vestido para festa",
            categoria: "Vestidos",
            preco: null,
            aluguel: 8,
        },
    });
    assert.equal(rentalListingResponse.status, 201);
    const rentalListing = await rentalListingResponse.json();
    assert.equal(rentalListing.preco, null);
    const rentalCheckout = await request(server, "/api/orders", {
        method: "POST",
        cookie: secondCookie,
        extraHeaders: { "Idempotency-Key": "checkout-rental-not-sale" },
        body: { items: [{ productId: rentalListing.id, qty: 1 }] },
    });
    assert.equal(rentalCheckout.status, 409);

    const forbiddenEdit = await request(server, `/api/products/${listing.id}`, {
        method: "PUT",
        cookie: secondCookie,
        body: { nome: "Tentativa de edição", categoria: "Casacos", preco: 1 },
    });
    assert.equal(forbiddenEdit.status, 403);

    const forbiddenDelete = await request(
        server,
        `/api/products/${listing.id}`,
        {
            method: "DELETE",
            cookie: secondCookie,
        }
    );
    assert.equal(forbiddenDelete.status, 403);

    const orderKey = "checkout-demo-key-0001";
    const orderRequest = {
        method: "POST",
        cookie: secondCookie,
        extraHeaders: { "Idempotency-Key": orderKey },
        body: {
            items: [{ productId: listing.id, qty: 1 }],
            couponCode: "BEMVINDO10",
        },
    };
    const createdOrderResponse = await request(
        server,
        "/api/orders",
        orderRequest
    );
    assert.equal(createdOrderResponse.status, 201);
    const createdOrder = await createdOrderResponse.json();
    assert.equal(createdOrder.status, "demonstracao");
    assert.equal(createdOrder.total, 40.5);

    const duplicateOrderResponse = await request(
        server,
        "/api/orders",
        orderRequest
    );
    assert.equal(duplicateOrderResponse.status, 200);
    assert.equal((await duplicateOrderResponse.json()).id, createdOrder.id);

    const productsAfterOrder = await (
        await request(server, "/api/products")
    ).json();
    assert.equal(
        productsAfterOrder.find((product) => product.id === listing.id).stock,
        0
    );

    const deleteReservedListing = await request(
        server,
        `/api/products/${listing.id}`,
        {
            method: "DELETE",
            cookie: firstCookie,
        }
    );
    assert.equal(deleteReservedListing.status, 409);

    const oversell = await request(server, "/api/orders", {
        method: "POST",
        cookie: secondCookie,
        extraHeaders: { "Idempotency-Key": "checkout-demo-key-0002" },
        body: { items: [{ productId: listing.id, qty: 1 }] },
    });
    assert.equal(oversell.status, 409);
    assert.equal(
        (await (await request(server, "/api/products")).json()).find(
            (product) => product.id === listing.id
        ).stock,
        0
    );

    const invalidCoupon = await request(server, "/api/orders", {
        method: "POST",
        cookie: secondCookie,
        extraHeaders: { "Idempotency-Key": "checkout-demo-key-0003" },
        body: {
            items: [{ productId: listing.id, qty: 1 }],
            couponCode: "FAKE",
        },
    });
    assert.equal(invalidCoupon.status, 400);

    const sellerOrders = await request(server, "/api/orders", {
        cookie: firstCookie,
    });
    assert.deepEqual(await sellerOrders.json(), []);
    const foreignCancel = await request(
        server,
        `/api/orders/${createdOrder.id}/cancel`,
        {
            method: "PATCH",
            cookie: firstCookie,
        }
    );
    assert.equal(foreignCancel.status, 404);

    const cancelOrder = () =>
        request(server, `/api/orders/${createdOrder.id}/cancel`, {
            method: "PATCH",
            cookie: secondCookie,
        });
    const cancelledResponse = await cancelOrder();
    assert.equal(cancelledResponse.status, 200);
    assert.equal((await cancelledResponse.json()).status, "cancelado");
    assert.equal((await cancelOrder()).status, 200);
    assert.equal(
        (await (await request(server, "/api/products")).json()).find(
            (product) => product.id === listing.id
        ).stock,
        1
    );

    const thirdRegistration = await request(server, "/api/auth/register", {
        method: "POST",
        body: {
            nome: "Pessoa Três",
            email: `third-${Date.now()}@example.edu`,
            senha: firstPassword,
            cidade: "Londrina",
        },
    });
    assert.equal(thirdRegistration.status, 201);
    const thirdCookie = sessionCookie(thirdRegistration);
    const thirdMessage = await request(server, "/api/messages", {
        method: "POST",
        cookie: thirdCookie,
        body: { productId: listing.id, message: "Posso retirar no campus?" },
    });
    assert.equal(thirdMessage.status, 201);
    const separateConversations = await request(server, "/api/conversations", {
        cookie: firstCookie,
    });
    assert.equal((await separateConversations.json()).length, 2);
    const privateMessages = await request(
        server,
        `/api/messages?productId=${listing.id}&otherUserId=${secondUser.id}`,
        { cookie: thirdCookie }
    );
    assert.equal(privateMessages.status, 404);

    const simultaneousOrders = await Promise.all([
        request(server, "/api/orders", {
            method: "POST",
            cookie: secondCookie,
            extraHeaders: { "Idempotency-Key": "checkout-demo-key-race-a" },
            body: { items: [{ productId: listing.id, qty: 1 }] },
        }),
        request(server, "/api/orders", {
            method: "POST",
            cookie: thirdCookie,
            extraHeaders: { "Idempotency-Key": "checkout-demo-key-race-b" },
            body: { items: [{ productId: listing.id, qty: 1 }] },
        }),
    ]);
    assert.deepEqual(
        simultaneousOrders.map((response) => response.status).sort(),
        [201, 409]
    );
    assert.equal(
        (await (await request(server, "/api/products")).json()).find(
            (product) => product.id === listing.id
        ).stock,
        0
    );

    const profileUpdate = await request(server, "/api/auth/profile", {
        method: "PATCH",
        cookie: firstCookie,
        body: { nome: "Pessoa Um Atualizada", cidade: "Uraí, PR" },
    });
    assert.equal(profileUpdate.status, 200);
    assert.equal((await profileUpdate.json()).nome, "Pessoa Um Atualizada");

    await stopServer(server);
    server = await bootServer(dataDirectory);
    const restoredSession = await request(server, "/api/auth/me", {
        cookie: firstCookie,
    });
    assert.equal(restoredSession.status, 200);
    assert.equal((await restoredSession.json()).cidade, "Uraí, PR");
    const restoredOrders = await request(server, "/api/orders", {
        cookie: secondCookie,
    });
    assert.ok(
        (await restoredOrders.json()).some(
            (order) => order.status === "cancelado"
        )
    );
    const restoredMessages = await request(
        server,
        `/api/messages?productId=${listing.id}&otherUserId=${firstUser.id}`,
        { cookie: secondCookie }
    );
    assert.equal((await restoredMessages.json()).length, 2);
    const restoredConversations = await request(server, "/api/conversations", {
        cookie: firstCookie,
    });
    assert.equal((await restoredConversations.json()).length, 2);

    const logout = await request(server, "/api/auth/logout", {
        method: "POST",
        cookie: firstCookie,
    });
    assert.equal(logout.status, 200);
    const revokedSession = await request(server, "/api/auth/me", {
        cookie: firstCookie,
    });
    assert.equal(revokedSession.status, 401);
});

test("password recovery emails a one-time token and replaces the password", async (t) => {
    const dataDirectory = fs.mkdtempSync(
        path.join(os.tmpdir(), "guarda-roupa-recovery-")
    );
    let deliveredEmail = "";
    const mailServer = http.createServer((request, response) => {
        const chunks = [];
        request.on("data", (chunk) => chunks.push(chunk));
        request.on("end", () => {
            deliveredEmail = Buffer.concat(chunks).toString("utf8");
            response.writeHead(200, { "Content-Type": "application/json" });
            response.end(JSON.stringify({ id: "email-test" }));
        });
    });
    mailServer.listen(0, "127.0.0.1");
    await once(mailServer, "listening");
    const mailPort = mailServer.address().port;
    let server;

    t.after(async () => {
        await stopServer(server);
        await new Promise((resolve) => mailServer.close(resolve));
        fs.rmSync(dataDirectory, { recursive: true, force: true });
    });

    server = await bootServer(dataDirectory, {
        EMAIL_API_URL: `http://127.0.0.1:${mailPort}/emails`,
        EMAIL_API_KEY: "test-api-key",
        EMAIL_FROM: "Guarda-Roupa <no-reply@example.test>",
    });
    const email = `recovery-${Date.now()}@example.edu`;
    const originalPassword = "senha-original-123";
    const registration = await request(server, "/api/auth/register", {
        method: "POST",
        body: {
            nome: "Pessoa Recuperando",
            email,
            senha: originalPassword,
            cidade: "Londrina",
        },
    });
    assert.equal(registration.status, 201);

    const recovery = await request(server, "/api/auth/recover", {
        method: "POST",
        body: { email },
    });
    assert.equal(recovery.status, 200);
    const recoveryPayload = await recovery.json();
    assert.equal("resetToken" in recoveryPayload, false);
    assert.match(deliveredEmail, new RegExp(email));

    const emailPayload = JSON.parse(deliveredEmail);
    const resetLink = emailPayload.html.match(/href="([^"]+)"/)?.[1];
    assert.ok(
        resetLink,
        "Expected a password reset link in the delivered email"
    );
    const resetToken = new URL(resetLink).searchParams.get("resetToken");
    assert.ok(resetToken);

    const reset = await request(server, "/api/auth/reset", {
        method: "POST",
        body: { token: resetToken, senha: "senha-nova-456" },
    });
    assert.equal(reset.status, 200);
    assert.equal((await reset.json()).ok, true);

    const replay = await request(server, "/api/auth/reset", {
        method: "POST",
        body: { token: resetToken, senha: "senha-outra-789" },
    });
    assert.equal(replay.status, 400);

    const oldPasswordLogin = await request(server, "/api/auth/login", {
        method: "POST",
        body: { email, senha: originalPassword },
    });
    assert.equal(oldPasswordLogin.status, 401);
    const newPasswordLogin = await request(server, "/api/auth/login", {
        method: "POST",
        body: { email, senha: "senha-nova-456" },
    });
    assert.equal(newPasswordLogin.status, 200);
});

test("startup preserves corrupt runtime catalog data instead of replacing it", async (t) => {
    const dataDirectory = fs.mkdtempSync(
        path.join(os.tmpdir(), "guarda-roupa-corrupt-seed-")
    );
    const runtimeCatalog = path.join(dataDirectory, "products.json");
    const corruptData = "{invalid json";
    fs.writeFileSync(runtimeCatalog, corruptData);
    let server;
    let startupError;
    t.after(async () => {
        await stopServer(server);
        fs.rmSync(dataDirectory, { recursive: true, force: true });
    });

    try {
        server = await bootServer(dataDirectory);
    } catch (error) {
        startupError = error;
    }

    assert.equal(
        server,
        undefined,
        "server must refuse to start with corrupt persisted catalog data"
    );
    assert.match(startupError?.message || "", /Server exited early/);
    assert.equal(fs.readFileSync(runtimeCatalog, "utf8"), corruptData);
});

test("product images are stored as files and never kept as base64 in SQLite", async (t) => {
    const dataDirectory = fs.mkdtempSync(
        path.join(os.tmpdir(), "guarda-roupa-product-images-")
    );
    const server = await bootServer(dataDirectory);
    t.after(async () => {
        await stopServer(server);
        fs.rmSync(dataDirectory, { recursive: true, force: true });
    });

    const registration = await request(server, "/api/auth/register", {
        method: "POST",
        body: {
            nome: "Pessoa com foto",
            email: `image-${Date.now()}@example.edu`,
            senha: "senha-imagem-123",
            cidade: "Londrina",
        },
    });
    const cookie = sessionCookie(registration);
    const imageBytes = Buffer.from("image-content-for-storage-test");
    const imageData = `data:image/jpeg;base64,${imageBytes.toString("base64")}`;
    const productResponse = await request(server, "/api/products", {
        method: "POST",
        cookie,
        body: {
            nome: "Peça com foto",
            categoria: "Casacos",
            preco: 25,
            image: imageData,
            images: [imageData],
        },
    });
    assert.equal(productResponse.status, 201);
    const product = await productResponse.json();
    assert.match(product.image, /^\/uploads\/[a-f0-9]{64}\.jpg$/);
    assert.equal(product.images[0], product.image);

    const storedFile = path.join(
        dataDirectory,
        "uploads",
        path.basename(product.image)
    );
    assert.deepEqual(fs.readFileSync(storedFile), imageBytes);
    const servedImage = await fetch(`${server.baseUrl}${product.image}`);
    assert.equal(servedImage.status, 200);
    assert.deepEqual(Buffer.from(await servedImage.arrayBuffer()), imageBytes);

    const SQL = await initializeSqlite();
    const database = new SQL.Database(
        fs.readFileSync(path.join(dataDirectory, "marketplace.sqlite"))
    );
    const storedProduct = database.exec(
        `SELECT data FROM products WHERE id = ${Number(product.id)}`
    )[0].values[0][0];
    database.close();
    assert.equal(storedProduct.includes("data:image/"), false);
});
