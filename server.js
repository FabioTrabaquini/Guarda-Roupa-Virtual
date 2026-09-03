const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = process.env.PORT || 3000;

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

const productsFile = path.join(__dirname, "products.json");

// LEITURA E INICIALIZACAO DO BANCO DE PRODUTOS EM JSON
function loadProducts() {
    try {
        return JSON.parse(fs.readFileSync(productsFile, "utf8"));
    } catch {
        fs.writeFileSync(productsFile, JSON.stringify(defaultProducts, null, 2));
        return [...defaultProducts];
    }
}

const products = loadProducts();

// RESPOSTAS HTTP E LEITURA DO CORPO DAS REQUISICOES
function sendJson(response, statusCode, data) {
    response.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
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

    if (request.method === "GET" && requestUrl.pathname === "/api/products") {
        sendJson(response, 200, products);
        return;
    }

    if ((request.method === "POST" || request.method === "PUT") && (requestUrl.pathname === "/api/products" || requestUrl.pathname.startsWith("/api/products/"))) {
        try {
            const data = await readBody(request);
            if (!data.nome || !data.categoria || (data.preco !== null && Number(data.preco) < 0) || Number(data.stock || 0) < 0) {
                sendJson(response, 400, { error: "Dados do produto invalidos." });
                return;
            }

            const product = {
                id: request.method === "PUT" ? Number(requestUrl.pathname.split("/").pop()) : Date.now(),
                nome: String(data.nome).trim(),
                marca: String(data.marca || "Sem marca").trim(),
                categoria: String(data.categoria).trim(),
                tamanho: String(data.tamanho || "").trim(),
                cor: String(data.cor || "").trim(),
                preco: Number(data.preco),
                aluguel: Number(data.aluguel || 0) || null,
                troca: Boolean(data.troca),
                local: String(data.local || "Nao informada").trim(),
                vendedor: String(data.vendedor || "Visitante").trim(),
                rating: Number(data.rating) || 5,
                pop: Number(data.pop) || 0,
                desc: String(data.desc || "").trim(),
                image: String(data.image || ""),
                estado: String(data.estado || "Usado").trim(),
                emoji: String(data.emoji || "👕"),
                stock: Number.isInteger(data.stock) ? data.stock : 1,
                ownerEmail: String(data.ownerEmail || "").trim()
            };

            const existingIndex = products.findIndex((item) => Number(item.id) === product.id);
            if (request.method === "PUT" && existingIndex < 0) {
                sendJson(response, 404, { error: "Produto nao encontrado." });
                return;
            }
            if (existingIndex >= 0) products[existingIndex] = product;
            else products.push(product);
            fs.writeFileSync(productsFile, JSON.stringify(products, null, 2));
            sendJson(response, existingIndex >= 0 ? 200 : 201, product);
        } catch (error) {
            sendJson(response, 400, { error: error.message });
        }
        return;
    }

    if (request.method === "DELETE" && requestUrl.pathname.startsWith("/api/products/")) {
        const id = Number(requestUrl.pathname.split("/").pop());
        const index = products.findIndex((product) => Number(product.id) === id);
        if (index < 0) {
            sendJson(response, 404, { error: "Produto nao encontrado." });
            return;
        }
        products.splice(index, 1);
        fs.writeFileSync(productsFile, JSON.stringify(products, null, 2));
        sendJson(response, 204, null);
        return;
    }

    if (request.method === "GET") {
        const requestedPath = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
        const filePath = path.resolve(__dirname, `.${requestedPath}`);
        const relativePath = path.relative(__dirname, filePath);
        if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
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

server.listen(PORT, () => {
    console.log(`Backend iniciado em http://localhost:${PORT}`);
});
