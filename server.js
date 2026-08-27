const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = process.env.PORT || 3000;

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

const productsFile = path.join(__dirname, "products.json");

function loadProducts() {
    try {
        return JSON.parse(fs.readFileSync(productsFile, "utf8"));
    } catch {
        fs.writeFileSync(productsFile, JSON.stringify(defaultProducts, null, 2));
        return [...defaultProducts];
    }
}

const products = loadProducts();

function sendJson(response, statusCode, data) {
    response.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
    });
    response.end(JSON.stringify(data));
}

function readBody(request) {
    return new Promise((resolve, reject) => {
        let body = "";

        request.on("data", (chunk) => {
            body += chunk;
            if (body.length > 1_000_000) {
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

    if (request.method === "GET" && requestUrl.pathname === "/api/products") {
        sendJson(response, 200, products);
        return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/products") {
        try {
            const data = await readBody(request);
            if (!data.nome || !data.categoria || Number(data.preco) <= 0) {
                sendJson(response, 400, { error: "Nome, categoria e preco valido sao obrigatorios." });
                return;
            }

            const product = {
                id: Date.now(),
                nome: String(data.nome).trim(),
                categoria: String(data.categoria).trim(),
                tamanho: String(data.tamanho || "").trim(),
                cor: String(data.cor || "").trim(),
                preco: Number(data.preco),
                estado: String(data.estado || "Usado").trim()
            };

            products.push(product);
            fs.writeFileSync(productsFile, JSON.stringify(products, null, 2));
            sendJson(response, 201, product);
        } catch (error) {
            sendJson(response, 400, { error: error.message });
        }
        return;
    }

    sendJson(response, 404, { error: "Rota nao encontrada." });
});

server.listen(PORT, () => {
    console.log(`Backend iniciado em http://localhost:${PORT}`);
});
