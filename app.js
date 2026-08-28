/* ================================================
   WARDROBE VIRTUAL — app.js
   ================================================ */

let PRODUCTS = [
    { id: 1, nome: "Camisa Social Preta", emoji: "👔", categoria: "Camisetas", marca: "Reserva", tamanho: "M", cor: "Preto", estado: "Excelente", preco: 59.99, aluguel: null, troca: false, local: "Londrina, PR", vendedor: "Léo Pereira", rating: 4.8, pop: 120, desc: "Camisa social preta, semi nova, ideal para ocasiões formais." },
    { id: 2, nome: "Calça Moletom Bench", emoji: "👖", categoria: "Calças", marca: "Bench", tamanho: "G", cor: "Preto", estado: "Excelente", preco: 89.90, aluguel: 19.90, troca: true, local: "Uraí, PR", vendedor: "Léo Pereira", rating: 4.9, pop: 200, desc: "Calça moletom preta em ótimo estado. Peça usada e muito bem cuidada. Perfeita para qualquer ocasião informal." },
    { id: 3, nome: "Tênis Feminino KNW", emoji: "👟", categoria: "Calçados", marca: "KNW", tamanho: "38", cor: "Preto", estado: "Bom", preco: 79.99, aluguel: null, troca: false, local: "Londrina, PR", vendedor: "Ana Souza", rating: 4.7, pop: 95, desc: "Tênis feminino confortável, pouco uso." },
    { id: 4, nome: "Tênis Masculino AIR", emoji: "👟", categoria: "Calçados", marca: "Nike", tamanho: "42", cor: "Preto", estado: "Excelente", preco: 199.90, aluguel: null, troca: true, local: "Santa Mariana, PR", vendedor: "Carlos M.", rating: 5.0, pop: 310, desc: "Tênis AIR original, super conservado." },
    { id: 5, nome: "Casaco Jeans Oversized", emoji: "🧥", categoria: "Casacos", marca: "Levi's", tamanho: "GG", cor: "Azul", estado: "Bom", preco: 120.00, aluguel: 25.00, troca: true, local: "Londrina, PR", vendedor: "Maria F.", rating: 4.6, pop: 80, desc: "Casaco jeans estiloso, corte oversized." },
    { id: 6, nome: "Vestido Festa Lilás", emoji: "👗", categoria: "Vestidos", marca: "Zara", tamanho: "P", cor: "Lilás", estado: "Novo", preco: 250.00, aluguel: 45.00, troca: false, local: "Cambé, PR", vendedor: "Julia R.", rating: 4.9, pop: 400, desc: "Vestido de festa lindíssimo, usado apenas uma vez. Ideal para aluguel!" },
    { id: 7, nome: "Camiseta Básica Branca", emoji: "👕", categoria: "Camisetas", marca: "Hering", tamanho: "M", cor: "Branco", estado: "Novo", preco: 29.90, aluguel: null, troca: true, local: "Londrina, PR", vendedor: "Pedro L.", rating: 4.5, pop: 60, desc: "Camiseta básica nova, com etiqueta." },
    { id: 8, nome: "Calça Cargo Verde", emoji: "👖", categoria: "Calças", marca: "C&A", tamanho: "40", cor: "Verde", estado: "Usado", preco: 45.00, aluguel: 12.00, troca: true, local: "Ibiporã, PR", vendedor: "Rafa T.", rating: 4.4, pop: 55, desc: "Calça cargo verde, confortável e com muito estilo para o dia a dia." }
];

const TESTIMONIALS = [
    { nome: "Renata", texto: "Consegui vender peça que estava guardada e ainda achei uma nova favorita!" },
    { nome: "Mateus", texto: "A experiência de aluguel foi rápida e muito prática." },
    { nome: "Aline", texto: "A plataforma é intuitiva e a comunidade é muito confiável." }
];

const state = {
    favorites: [2, 6],
    cart: [
        { id: 1, qty: 1 },
        { id: 3, qty: 1 }
    ],
    users: [],
    orders: [],
    publishedProducts: [],
    drafts: [],
    supportMessages: [],
    pendingImages: [],
    appliedCoupon: null,
    settings: { language: "pt-BR", currency: "BRL", payment: "Pix", notifications: true },
    currentUser: null,
    filters: {
        search: "",
        categoria: "",
        tamanho: "",
        modalidade: "",
        estado: "",
        ordenar: "recentes"
    }
};

const STORAGE_KEY = "guarda-roupa-virtual-state";
const API_BASE_URL = "http://localhost:3000/api";
let orderFilter = "todos";

async function loadProductsFromApi() {
    try {
        const response = await fetch(`${API_BASE_URL}/products`);
        if (!response.ok) throw new Error("Nao foi possivel carregar os produtos.");

        const apiProducts = (await response.json()).map((product) => ({ ...product, categoria: normalizeCategory(product.categoria) }));
        const productsById = new Map(apiProducts.map((product) => [Number(product.id), product]));
        PRODUCTS = PRODUCTS.map((product) => ({ ...product, ...(productsById.get(product.id) || {}) }));
        apiProducts.forEach((product) => {
            if (!PRODUCTS.some((localProduct) => localProduct.id === Number(product.id))) {
                PRODUCTS.push(product);
            }
        });
        renderHome();
        renderCatalog();
        renderFavorites();
    } catch {
        showToast("Servidor indisponivel. Usando dados locais.");
    }
}

async function sendProductToApi(product) {
    try {
        await fetch(`${API_BASE_URL}/products`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(product)
        });
    } catch {
        showToast("Produto salvo localmente; servidor indisponivel.");
    }
}

function saveState() {
    const savedState = {
        favorites: state.favorites,
        cart: state.cart,
        users: state.users,
        orders: state.orders,
        publishedProducts: state.publishedProducts,
        drafts: state.drafts,
        supportMessages: state.supportMessages,
        currentUser: state.currentUser,
        filters: state.filters,
        appliedCoupon: state.appliedCoupon,
        settings: state.settings
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedState));
}

function loadState() {
    try {
        const savedState = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (!savedState) return;

        Object.assign(state, savedState);
        state.publishedProducts = (state.publishedProducts || []).map((product) => ({ ...product, categoria: normalizeCategory(product.categoria) }));
        PRODUCTS = [...PRODUCTS, ...state.publishedProducts];
        state.settings = { language: "pt-BR", currency: "BRL", payment: "Pix", notifications: true, ...state.settings };
        updateCurrency();
    } catch {
        localStorage.removeItem(STORAGE_KEY);
    }
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

function normalizeCategory(category) {
    const value = String(category || "").trim().toLowerCase();
    return value === "calca" || value === "calcas" ? "Calças" : category;
}

function categoryLabel(category) {
    const labels = {
        "en-US": { Camisetas: "T-shirts", "Calças": "Pants", Calçados: "Shoes", Casacos: "Coats", Vestidos: "Dresses" },
        es: { Camisetas: "Camisetas", "Calças": "Pantalones", Calçados: "Calzado", Casacos: "Abrigos", Vestidos: "Vestidos" }
    };
    return labels[state.settings.language]?.[normalizeCategory(category)] || normalizeCategory(category);
}

function applyLoggedUser() {
    const firstname = document.getElementById("user-firstname");
    const profileName = document.getElementById("profile-name");
    const profileCity = document.getElementById("profile-city");

    const user = state.currentUser;
    const name = user ? user.nome : "Clayton";
    const firstName = name.split(" ")[0];

    if (firstname) firstname.textContent = firstName;
    if (profileName) profileName.textContent = name;
    if (profileCity && user?.cidade) profileCity.textContent = user.cidade;
}

let currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const COUPONS = {
    BEMVINDO10: { discount: 0.1, label: "10% de desconto" },
    MODACONSCIENTE: { discount: 15, label: "R$ 15,00 de desconto" }
};

const TRANSLATIONS = {
    "en-US": {
        "Início": "Home", "Buscar": "Search", "Pedidos": "Orders", "Perfil": "Profile", "Catálogo": "Catalog", "Carrinho": "Cart", "Checkout": "Checkout", "Configurações": "Settings", "Cupons e ofertas": "Coupons and offers", "Editar dados pessoais": "Edit personal details", "Meu guarda-roupa": "My wardrobe", "Meus pedidos": "My orders", "Favoritos": "Favorites", "Suporte": "Support", "Sair da conta": "Log out", "Aplicar": "Apply", "Remover": "Remove", "Finalizar compra": "Checkout", "Confirmar pagamento": "Confirm payment", "Salvar configurações": "Save settings", "Processando": "Processing", "Enviado": "Shipped", "Recebido": "Received", "Avaliar": "Rate", "Rastrear pedido": "Track order", "Solicitar reembolso": "Request refund", "Avançar etapa": "Advance status", "Idioma": "Language", "Moeda de compra": "Shopping currency", "Forma de pagamento preferida": "Preferred payment method", "Alterar foto": "Change photo", "Cupom de desconto": "Discount coupon", "Subtotal": "Subtotal", "Frete": "Shipping", "Grátis": "Free", "E-mail": "Email", "Senha": "Password", "Esqueci minha senha": "Forgot my password", "Entrar": "Sign in", "Não tem conta?": "No account?", "Cadastre-se": "Sign up", "Entrar como visitante (demo)": "Enter as visitor (demo)", "Criar": "Create", "conta": "account", "Junte-se à moda consciente 🌱": "Join conscious fashion 🌱", "Cadastrar": "Register", "Já tem conta?": "Already have an account?", "Recuperar": "Recover", "senha": "password", "Enviaremos um link para seu e-mail.": "We will send a link to your email.", "Enviar link": "Send link", "Voltar ao login": "Back to sign in", "Compre, troque ou alugue de forma sustentável.": "Buy, trade or rent sustainably.", "Moda consciente faz a diferença!": "Conscious fashion makes a difference!", "Dê um novo destino às roupas e transforme o mundo.": "Give clothes a new purpose and transform the world.", "Saiba mais": "Learn more", "Categorias": "Categories", "Ver todas": "View all", "Destaques": "Highlights", "Mais recentes": "Most recent", "O que dizem sobre nós": "What people say about us", "Moda circular, consciente e acessível.": "Circular, conscious and accessible fashion.", "Sobre": "About", "Termos": "Terms", "Privacidade": "Privacy", "Filtros": "Filters", "Buscar peças...": "Search items...", "Categoria": "Category", "Tamanho": "Size", "Modalidade": "Listing type", "Comprar": "Buy", "Alugar": "Rent", "Trocar": "Trade", "Estado": "Condition", "Novo": "New", "Excelente": "Excellent", "Bom": "Good", "Usado": "Used", "Mais recentes": "Most recent", "Menor preço": "Lowest price", "Maior preço": "Highest price", "Mais populares": "Most popular", "Melhor avaliados": "Highest rated", "Limpar filtros": "Clear filters", "Detalhes": "Details", "Adicionar": "Add", "No carrinho": "In cart", "Adicionar ao carrinho": "Add to cart", "Favoritar": "Add to favorites", "Pedido enviado": "Order shipped", "Nova oferta": "New offer", "Troca aprovada": "Trade approved", "Seu carrinho está vazio.": "Your cart is empty.", "Resumo do pedido": "Order summary", "Itens": "Items", "Entrega": "Delivery", "Em 2 a 4 dias": "In 2 to 4 days", "Forma de pagamento": "Payment method", "Selecione": "Select", "Pix (simulação)": "Pix (simulation)", "Cartão (simulação)": "Card (simulation)", "Boleto (simulação)": "Bank slip (simulation)", "Dados para entrega": "Delivery details", "Complete seus dados antes de finalizar a compra.": "Complete your details before checkout.", "Nome completo": "Full name", "Telefone": "Phone", "CEP": "ZIP code", "Rua": "Street", "Número": "Number", "Bairro": "Neighborhood", "Cidade": "City", "Complemento": "Additional details", "UF": "State", "Cadastrar cartão para compras futuras": "Save card for future purchases", "Número do cartão": "Card number", "Nome no cartão": "Name on card", "Validade": "Expiration date", "CVV": "CVV", "Continuar para pagamento": "Continue to payment", "Publicar item": "List item", "Fotos do item": "Item photos", "Adicionar fotos": "Add photos", "Até 8 fotos": "Up to 8 photos", "Nome do item": "Item name", "Marca": "Brand", "Cor": "Color", "Condição": "Condition", "Descrição": "Description", "Venda": "Sale", "Aluguel (R$/dia)": "Rent (per day)", "Preço (R$)": "Price", "Localidade": "Location", "Salvar rascunho": "Save draft", "Informações": "Information", "Detalhes": "Details", "Revisão": "Review", "Meus pedidos": "My orders", "Vendedor confiável": "Trusted seller", "Configurações salvas!": "Settings saved!", "Cupom inválido ou expirado.": "Invalid or expired coupon.", "Aplicar cupom": "Apply coupon", "Mensagem": "Message", "Assunto": "Subject", "Enviar mensagem": "Send message", "Alterar foto": "Change photo", "Rastrear pedido": "Track order", "Solicitar reembolso": "Request refund"
    },
    es: {
        "Início": "Inicio", "Buscar": "Buscar", "Pedidos": "Pedidos", "Perfil": "Perfil", "Catálogo": "Catálogo", "Carrinho": "Carrito", "Checkout": "Pago", "Configurações": "Configuración", "Cupons e ofertas": "Cupones y ofertas", "Editar dados pessoais": "Editar datos personales", "Meu guarda-roupa": "Mi armario", "Meus pedidos": "Mis pedidos", "Favoritos": "Favoritos", "Suporte": "Soporte", "Sair da conta": "Cerrar sesión", "Aplicar": "Aplicar", "Remover": "Eliminar", "Finalizar compra": "Finalizar compra", "Confirmar pagamento": "Confirmar pago", "Salvar configurações": "Guardar configuración", "Processando": "Procesando", "Enviado": "Enviado", "Recebido": "Recibido", "Avaliar": "Evaluar", "Rastrear pedido": "Rastrear pedido", "Solicitar reembolso": "Solicitar reembolso", "Avançar etapa": "Avanzar etapa", "Idioma": "Idioma", "Moeda de compra": "Moneda de compra", "Forma de pagamento preferida": "Forma de pago preferida", "Alterar foto": "Cambiar foto", "Cupom de desconto": "Cupón de descuento", "Subtotal": "Subtotal", "Frete": "Envío", "Grátis": "Gratis", "E-mail": "Correo electrónico", "Senha": "Contraseña", "Esqueci minha senha": "Olvidé mi contraseña", "Entrar": "Entrar", "Não tem conta?": "¿No tienes cuenta?", "Cadastre-se": "Regístrate", "Entrar como visitante (demo)": "Entrar como visitante (demo)", "Criar": "Crear", "conta": "cuenta", "Junte-se à moda consciente 🌱": "Únete a la moda consciente 🌱", "Cadastrar": "Registrarse", "Já tem conta?": "¿Ya tienes una cuenta?", "Recuperar": "Recuperar", "senha": "contraseña", "Enviaremos um link para seu e-mail.": "Enviaremos un enlace a tu correo.", "Enviar link": "Enviar enlace", "Voltar ao login": "Volver al inicio", "Compre, troque ou alugue de forma sustentável.": "Compra, intercambia o alquila de forma sostenible.", "Moda consciente faz a diferença!": "¡La moda consciente marca la diferencia!", "Dê um novo destino às roupas e transforme o mundo.": "Da un nuevo destino a la ropa y transforma el mundo.", "Saiba mais": "Saber más", "Categorias": "Categorías", "Ver todas": "Ver todas", "Destaques": "Destacados", "Mais recentes": "Más recientes", "O que dizem sobre nós": "Lo que dicen de nosotros", "Moda circular, consciente e acessível.": "Moda circular, consciente y accesible.", "Sobre": "Acerca de", "Termos": "Términos", "Privacidade": "Privacidad", "Filtros": "Filtros", "Buscar peças...": "Buscar prendas...", "Categoria": "Categoría", "Tamanho": "Talla", "Modalidade": "Modalidad", "Comprar": "Comprar", "Alugar": "Alquilar", "Trocar": "Intercambiar", "Estado": "Estado", "Novo": "Nuevo", "Excelente": "Excelente", "Bom": "Bueno", "Usado": "Usado", "Mais recentes": "Más recientes", "Menor preço": "Precio más bajo", "Maior preço": "Precio más alto", "Mais populares": "Más populares", "Melhor avaliados": "Mejor valorados", "Limpar filtros": "Limpiar filtros", "Detalhes": "Detalles", "Adicionar": "Añadir", "No carrinho": "En el carrito", "Adicionar ao carrinho": "Añadir al carrito", "Favoritar": "Añadir a favoritos", "Pedido enviado": "Pedido enviado", "Nova oferta": "Nueva oferta", "Troca aprovada": "Intercambio aprobado", "Seu carrinho está vazio.": "Tu carrito está vacío.", "Resumo do pedido": "Resumen del pedido", "Itens": "Artículos", "Entrega": "Entrega", "Em 2 a 4 dias": "En 2 a 4 días", "Forma de pagamento": "Forma de pago", "Selecione": "Selecciona", "Dados para entrega": "Datos de entrega", "Complete seus dados antes de finalizar a compra.": "Completa tus datos antes de finalizar la compra.", "Nome completo": "Nombre completo", "Telefone": "Teléfono", "CEP": "Código postal", "Rua": "Calle", "Número": "Número", "Bairro": "Barrio", "Cidade": "Ciudad", "Complemento": "Complemento", "UF": "Estado", "Cadastrar cartão para compras futuras": "Guardar tarjeta para futuras compras", "Número do cartão": "Número de tarjeta", "Nome no cartão": "Nombre en la tarjeta", "Validade": "Vencimiento", "Continuar para pagamento": "Continuar al pago", "Publicar item": "Publicar artículo", "Fotos do item": "Fotos del artículo", "Adicionar fotos": "Añadir fotos", "Até 8 fotos": "Hasta 8 fotos", "Nome do item": "Nombre del artículo", "Marca": "Marca", "Cor": "Color", "Condição": "Condición", "Descrição": "Descripción", "Venda": "Venta", "Preço (R$)": "Precio", "Localidade": "Ubicación", "Salvar rascunho": "Guardar borrador", "Informações": "Información", "Revisão": "Revisión", "Vendedor confiável": "Vendedor confiable", "Configurações salvas!": "¡Configuración guardada!", "Cupom inválido ou expirado.": "Cupón inválido o caducado.", "Mensagem": "Mensaje", "Assunto": "Asunto", "Enviar mensagem": "Enviar mensaje"
    }
};

function applyTranslations() {
    const dictionary = TRANSLATIONS[state.settings.language];
    document.documentElement.lang = state.settings.language;

    const translateValue = (value) => {
        const suffix = value.endsWith(" *") ? " *" : "";
        const baseValue = suffix ? value.slice(0, -2) : value;
        const canonical = Object.keys(TRANSLATIONS).reduce((result, language) => {
            const entries = TRANSLATIONS[language];
            return Object.entries(entries).find(([, translated]) => translated === baseValue)?.[0] || result;
        }, baseValue);
        return `${dictionary?.[canonical] || canonical}${suffix}`;
    };

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach((node) => {
        const original = node.nodeValue.trim();
        if (!original) return;

        const translated = translateValue(original);
        if (translated !== original) node.nodeValue = node.nodeValue.replace(original, translated);
    });

    document.querySelectorAll("[placeholder], [aria-label]").forEach((element) => {
        ["placeholder", "aria-label"].forEach((attribute) => {
            const value = element.getAttribute(attribute);
            if (!value) return;
            const translated = translateValue(value);
            if (translated !== value) element.setAttribute(attribute, translated);
        });
    });
}

function updateCurrency() {
    const locale = state.settings.currency === "USD" ? "en-US" : state.settings.currency === "EUR" ? "de-DE" : "pt-BR";
    currency = new Intl.NumberFormat(locale, { style: "currency", currency: state.settings.currency });
}

function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;

    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timeoutId);
    showToast.timeoutId = setTimeout(() => toast.classList.remove("show"), 2200);
}

function setLoginError(message) {
    const errorBox = document.getElementById("login-error");
    if (!errorBox) return;

    if (!message) {
        errorBox.textContent = "";
        errorBox.classList.add("hidden");
        return;
    }

    errorBox.textContent = message;
    errorBox.classList.remove("hidden");
}

function updateCartBadge() {
    const badge = document.getElementById("cart-count");
    if (!badge) return;

    const total = state.cart.reduce((sum, item) => sum + item.qty, 0);
    badge.textContent = String(total);
}

function formatPrice(value) {
    return currency.format(Number(value || 0));
}

function getProductById(id) {
    return PRODUCTS.find((product) => product.id === Number(id));
}

function productVisual(product, className) {
    const image = product.image && /^(data:image\/|https?:\/\/)/.test(product.image)
        ? `<img class="${className}" src="${escapeHtml(product.image)}" alt="${escapeHtml(product.nome)}" />`
        : product.emoji;
    return image;
}

function buildProductCard(product) {
    const inFavorites = state.favorites.includes(product.id);
    const inCart = state.cart.some((item) => item.id === product.id);

    return `
        <article class="product-card" data-action="details" data-id="${product.id}" tabindex="0" role="button" aria-label="Ver detalhes de ${escapeHtml(product.nome)}">
            <div class="product-image">${productVisual(product, "product-photo")}</div>
            <button class="favorite-btn ${inFavorites ? "active" : ""}" data-action="toggle-favorite" data-id="${product.id}" aria-label="Favoritar item">
                <i class="${inFavorites ? "fa-solid fa-heart" : "fa-regular fa-heart"}"></i>
            </button>
            <div class="product-body">
                <div class="product-topline">
                    <span class="tag">${escapeHtml(categoryLabel(product.categoria))}</span>
                    <span class="rating">★ ${product.rating}</span>
                </div>
                <h3>${escapeHtml(product.nome)}</h3>
                <p>${escapeHtml(product.local)}</p>
                <div class="price-row">
                    <strong>${formatPrice(product.preco)}</strong>
                    ${product.aluguel ? `<span>${formatPrice(product.aluguel)}/dia</span>` : ""}
                </div>
                <div class="product-meta">
                    <span>${escapeHtml(product.estado)}</span>
                    <span>${escapeHtml(product.tamanho)}</span>
                    <span>${escapeHtml(product.cor)}</span>
                </div>
            </div>
            <div class="product-actions">
                <button class="btn btn-outline btn-sm" data-action="details" data-id="${product.id}">Detalhes</button>
                <button class="btn btn-primary btn-sm" data-action="add-cart" data-id="${product.id}">
                    ${inCart ? "No carrinho" : "Adicionar"}
                </button>
            </div>
        </article>
    `;
}

function renderCategories() {
    const container = document.getElementById("categories-list");
    if (!container) return;

    const categories = [...new Set(PRODUCTS.map((product) => normalizeCategory(product.categoria)))];
    container.innerHTML = categories.map((categoria) => `
        <button class="category-pill" data-action="filter-category" data-category="${categoria}">
            ${escapeHtml(categoryLabel(categoria))}
        </button>
    `).join("");
}

function renderTestimonials() {
    const container = document.getElementById("testimonials");
    if (!container) return;

    container.innerHTML = TESTIMONIALS.map((item) => `
        <div class="testimonial">
            <div class="stars">★★★★★</div>
            <p>“${item.texto}”</p>
            <strong>${item.nome}</strong>
        </div>
    `).join("");
}

function getFilteredProducts() {
    const { search, categoria, tamanho, modalidade, estado, ordenar } = state.filters;

    let result = [...PRODUCTS].filter((product) => {
        const matchesSearch = !search || product.nome.toLowerCase().includes(search.toLowerCase()) || String(product.desc || "").toLowerCase().includes(search.toLowerCase());
        const matchesCategoria = !categoria || product.categoria === categoria;
        const matchesTamanho = !tamanho || product.tamanho === tamanho;
        const matchesEstado = !estado || product.estado === estado;

        let matchesModalidade = true;
        if (modalidade === "venda") matchesModalidade = product.preco !== null;
        if (modalidade === "aluguel") matchesModalidade = !!product.aluguel;
        if (modalidade === "troca") matchesModalidade = !!product.troca;

        return matchesSearch && matchesCategoria && matchesTamanho && matchesEstado && matchesModalidade;
    });

    switch (ordenar) {
        case "menor":
            result.sort((a, b) => a.preco - b.preco);
            break;
        case "maior":
            result.sort((a, b) => b.preco - a.preco);
            break;
        case "populares":
            result.sort((a, b) => b.pop - a.pop);
            break;
        case "avaliados":
            result.sort((a, b) => b.rating - a.rating);
            break;
        default:
            result.sort((a, b) => b.id - a.id);
            break;
    }

    return result;
}

function renderHome() {
    const homeProducts = PRODUCTS.slice(0, 4);
    const recentProducts = PRODUCTS.slice(-3).reverse();

    const homeProductsNode = document.getElementById("home-products");
    const recentNode = document.getElementById("home-recent");

    if (homeProductsNode) homeProductsNode.innerHTML = homeProducts.map(buildProductCard).join("");
    if (recentNode) recentNode.innerHTML = recentProducts.map(buildProductCard).join("");

    renderCategories();
    renderTestimonials();
}

function renderCatalog() {
    const container = document.getElementById("catalog-products");
    const counter = document.getElementById("results-count");
    if (!container) return;

    const filtered = getFilteredProducts();
    container.innerHTML = filtered.length ? filtered.map(buildProductCard).join("") : "<p class='empty-state'>Nenhuma peça encontrada com esses filtros.</p>";

    if (counter) counter.textContent = `${filtered.length} itens encontrados`;
}

function renderFavorites() {
    const container = document.getElementById("fav-products");
    if (!container) return;

    const favorites = PRODUCTS.filter((product) => state.favorites.includes(product.id));
    container.innerHTML = favorites.length ? favorites.map(buildProductCard).join("") : "<p class='empty-state'>Você ainda não marcou nenhum favorito.</p>";
}

function getCartSubtotal() {
    return state.cart.reduce((sum, entry) => {
        const product = getProductById(entry.id);
        return sum + (product ? product.preco * entry.qty : 0);
    }, 0);
}

function getCouponDiscount(subtotal = getCartSubtotal()) {
    const coupon = state.appliedCoupon && COUPONS[state.appliedCoupon];
    if (!coupon) return 0;
    return coupon.discount < 1 ? subtotal * coupon.discount : Math.min(subtotal, coupon.discount);
}

function applyCoupon() {
    const input = document.getElementById("coupon-input");
    const code = input?.value.trim().toUpperCase();
    if (!COUPONS[code]) {
        showToast("Cupom inválido ou expirado.");
        return;
    }
    state.appliedCoupon = code;
    saveState();
    renderCart();
    showToast(`Cupom aplicado: ${COUPONS[code].label}`);
}

function removeCoupon() {
    state.appliedCoupon = null;
    saveState();
    renderCart();
}

function useCoupon(code) {
    state.appliedCoupon = code;
    saveState();
    showScreen("screen-carrinho");
    renderCart();
    showToast(`Cupom ${code} selecionado.`);
}

function renderOrders() {
    const orders = document.getElementById("orders-list");
    if (!orders) return;

    const allOrders = state.orders.length ? state.orders : [
        { id: "1042", name: "Camisa Social Preta", status: "em transporte", total: 59.99 },
        { id: "1038", name: "Calça Moletom Bench", status: "entregue", total: 89.90 }
    ];
    const ordersToRender = allOrders.filter((order) => {
        const stage = order.stage ?? (order.status === "entregue" ? 3 : 1);
        if (orderFilter === "todos") return true;
        if (orderFilter === "processando") return stage === 0;
        if (orderFilter === "enviado") return stage === 1;
        if (orderFilter === "recebido") return stage === 2;
        if (orderFilter === "avaliar") return stage >= 3;
        if (orderFilter === "reembolso") return stage >= 2;
        return true;
    });

    orders.innerHTML = ordersToRender.length ? ordersToRender.map((order) => {
        const stage = order.stage ?? (order.status === "entregue" ? 3 : 1);
        return `
        <div class="card order-card">
            <h3>Pedido #${escapeHtml(order.id)}</h3>
            <p>${escapeHtml(order.name)} · Status: ${escapeHtml(order.status)}</p>
            <strong>${formatPrice(order.total)}</strong>
            <div class="order-actions">
                <button class="btn btn-outline btn-sm" data-action="track-order" data-id="${escapeHtml(order.id)}">Rastrear pedido</button>
                ${state.orders.includes(order) && stage < 3 ? `<button class="btn btn-outline btn-sm" data-action="advance-order" data-id="${escapeHtml(order.id)}">Avançar etapa</button>` : ""}
            </div>
        </div>
    `;
    }).join("") : `<p class="empty-state">Nenhum pedido nesta categoria.</p>`;

    document.querySelectorAll(".order-filter").forEach((button) => {
        button.classList.toggle("active", button.dataset.filter === orderFilter);
    });
}

function filterOrders(filter) {
    orderFilter = filter;
    renderOrders();
}

function renderProfile() {
    const profileName = document.getElementById("profile-name");
    const profileCity = document.getElementById("profile-city");
    const avatar = document.getElementById("profile-avatar");

    const user = state.currentUser || { nome: "Clayton", cidade: "Londrina, PR" };

    if (profileName) profileName.textContent = user.nome;
    if (profileCity) profileCity.textContent = user.cidade;
    if (avatar) {
        avatar.innerHTML = user.photo
            ? `<img src="${escapeHtml(user.photo)}" alt="Foto de perfil de ${escapeHtml(user.nome)}" />`
            : escapeHtml(user.nome.charAt(0).toUpperCase());
    }

    const firstname = document.getElementById("user-firstname");
    if (firstname) firstname.textContent = user.nome.split(" ")[0];
}

function renderCart() {
    const container = document.getElementById("cart-content");
    if (!container) return;

    if (!state.cart.length) {
        container.innerHTML = "<p class='empty-state'>Seu carrinho está vazio.</p>";
        return;
    }

    const items = state.cart.map((entry) => {
        const product = getProductById(entry.id);
        if (!product) return "";
        return `
            <div class="cart-item card">
                <div class="cart-item-left">
                    <div class="mini-emoji">${product.emoji}</div>
                    <div>
                        <h4>${escapeHtml(product.nome)}</h4>
                                    <p>${escapeHtml(product.tamanho)} · ${escapeHtml(product.cor)}</p>
                    </div>
                </div>
                <div class="cart-item-right">
                    <strong>${formatPrice(product.preco * entry.qty)}</strong>
                    <div class="qty-control">
                        <button data-action="decrease-qty" data-id="${product.id}">-</button>
                        <span>${entry.qty}</span>
                        <button data-action="increase-qty" data-id="${product.id}">+</button>
                    </div>
                </div>
            </div>
        `;
    }).join("");

    const subtotal = getCartSubtotal();
    const discount = getCouponDiscount(subtotal);
    const total = subtotal - discount;

    container.innerHTML = `
        ${items}
        <div class="summary-box card">
            <div class="coupon-row"><input id="coupon-input" placeholder="Cupom de desconto" /><button type="button" class="btn btn-outline btn-sm" onclick="applyCoupon()">Aplicar</button></div>
            ${state.appliedCoupon ? `<div class="summary-row coupon-applied"><span>${escapeHtml(state.appliedCoupon)} <button type="button" onclick="removeCoupon()">Remover</button></span><strong>-${formatPrice(discount)}</strong></div>` : ""}
            <div class="summary-row"><span>Subtotal</span><strong>${formatPrice(subtotal)}</strong></div>
            <div class="summary-row"><span>Frete</span><strong>Grátis</strong></div>
            <div class="summary-row total"><span>Total</span><strong>${formatPrice(total)}</strong></div>
            <button class="btn btn-primary btn-full" onclick="startCheckout()">Finalizar compra</button>
        </div>
    `;
}

function renderCheckout() {
    const container = document.getElementById("checkout-content");
    if (!container) return;

    const total = getCartSubtotal() - getCouponDiscount();

    container.innerHTML = `
        <form class="card checkout-card" id="checkout-form">
            <h3>Resumo do pedido</h3>
            <div class="summary-row"><span>Itens</span><strong>${state.cart.reduce((sum, item) => sum + item.qty, 0)}</strong></div>
            <div class="summary-row"><span>Entrega</span><strong>Em 2 a 4 dias</strong></div>
            <div class="summary-row total"><span>Total</span><strong>${formatPrice(total)}</strong></div>
            <div class="checkout-address"><strong>Entrega para</strong><span>${escapeHtml(state.currentUser?.endereco || "")}, ${escapeHtml(state.currentUser?.cidade || "")}</span></div>
            <div class="input-group"><label for="checkout-payment">Forma de pagamento</label><select id="checkout-payment" required><option value="">Selecione</option><option ${state.settings.payment === "Pix" ? "selected" : ""}>Pix (simulação)</option><option ${state.settings.payment === "Cartão" ? "selected" : ""}>Cartão (simulação)</option><option ${state.settings.payment === "Boleto" ? "selected" : ""}>Boleto (simulação)</option></select></div>
            <button class="btn btn-primary btn-full" type="submit">Confirmar pagamento</button>
        </form>
    `;
    document.getElementById("checkout-form")?.addEventListener("submit", finalizePurchase);
}

function hasDeliveryData() {
    const user = state.currentUser;
    return [user?.nome, user?.cpf, user?.telefone, user?.cep, user?.rua, user?.numero, user?.bairro, user?.cidade, user?.uf]
        .every((value) => typeof value === "string" && value.trim().length > 0);
}

function fillPersonalDataForm() {
    const user = state.currentUser || {};
    const values = {
        "dados-nome": user.nome || "",
        "dados-cpf": user.cpf || "",
        "dados-telefone": user.telefone || "",
        "dados-cep": user.cep || "",
        "dados-rua": user.rua || "",
        "dados-numero": user.numero || "",
        "dados-bairro": user.bairro || "",
        "dados-cidade": user.cidade || "",
        "dados-uf": user.uf || "",
        "dados-complemento": user.complemento || ""
    };

    Object.entries(values).forEach(([id, value]) => {
        const field = document.getElementById(id);
        if (field) field.value = value;
    });
}

function startCheckout() {
    if (!state.cart.length) {
        showToast("Seu carrinho está vazio.");
        return;
    }

    if (!state.currentUser) {
        state.currentUser = { nome: "Visitante" };
    }

    if (!hasDeliveryData()) {
        fillPersonalDataForm();
        showScreen("screen-dados");
        return;
    }

    renderCheckout();
    showScreen("screen-checkout");
}

function handlePersonalData(event) {
    event.preventDefault();
    const user = state.currentUser || {};
    user.nome = document.getElementById("dados-nome")?.value.trim();
    user.cpf = document.getElementById("dados-cpf")?.value.trim();
    user.telefone = document.getElementById("dados-telefone")?.value.trim();
    user.cep = document.getElementById("dados-cep")?.value.trim();
    user.rua = document.getElementById("dados-rua")?.value.trim();
    user.numero = document.getElementById("dados-numero")?.value.trim();
    user.bairro = document.getElementById("dados-bairro")?.value.trim();
    user.cidade = document.getElementById("dados-cidade")?.value.trim();
    user.uf = document.getElementById("dados-uf")?.value.trim().toUpperCase();
    user.complemento = document.getElementById("dados-complemento")?.value.trim();
    const cardEnabled = document.getElementById("dados-cadastrar-cartao")?.checked;
    const cardNumber = document.getElementById("dados-cartao-numero")?.value.replace(/\D/g, "");

    if (!hasDeliveryData()) {
        showToast("Preencha todos os dados obrigatórios.");
        return;
    }

    if (cardEnabled && (!cardNumber || !document.getElementById("dados-cartao-nome")?.value.trim() || !document.getElementById("dados-cartao-validade")?.value.trim() || !document.getElementById("dados-cartao-cvv")?.value.trim())) {
        showToast("Preencha todos os dados do cartão ou desmarque a opção.");
        return;
    }

    user.endereco = `${user.rua}, ${user.numero} - ${user.bairro}`;
    user.cartao = cardEnabled ? { last4: cardNumber.slice(-4), nome: document.getElementById("dados-cartao-nome").value.trim(), validade: document.getElementById("dados-cartao-validade").value.trim() } : null;

    state.currentUser = user;
    const savedUser = state.users.find((item) => item.email === user.email);
    if (savedUser) Object.assign(savedUser, user);
    saveState();
    applyLoggedUser();
    renderProfile();
    renderCheckout();
    showScreen("screen-checkout");
}

function fillSettingsForm() {
    const language = document.getElementById("setting-language");
    const currencySelect = document.getElementById("setting-currency");
    const payment = document.getElementById("setting-payment");
    if (language) language.value = state.settings.language;
    if (currencySelect) currencySelect.value = state.settings.currency;
    if (payment) payment.value = state.settings.payment;
}

function handleSettings(event) {
    event.preventDefault();
    state.settings.language = document.getElementById("setting-language")?.value || "pt-BR";
    state.settings.currency = document.getElementById("setting-currency")?.value || "BRL";
    state.settings.payment = document.getElementById("setting-payment")?.value || "Pix";
    state.settings.notifications = Boolean(document.getElementById("setting-notifications")?.checked);
    document.documentElement.lang = state.settings.language;
    const notifications = document.getElementById("setting-notifications");
    if (notifications) notifications.checked = state.settings.notifications !== false;
    updateCurrency();
    applyTranslations();
    saveState();
    renderHome();
    renderCatalog();
    renderCart();
    renderOrders();
    showToast("Configurações salvas!");
}

function handleOrderAction(action, orderId) {
    const order = state.orders.find((item) => String(item.id) === String(orderId));
    if (!order) {
        showToast(action === "track-order" ? "Pedido em transporte. Código de rastreio: GV" + orderId : "Ação disponível para pedidos reais.");
        return;
    }
    if (action === "track-order") showToast(`Pedido ${order.id}: ${order.status}. Código GV${order.id}`);
    if (action === "advance-order") {
        order.stage = Math.min(3, (order.stage ?? 0) + 1);
        order.status = ["processando", "enviado", "recebido", "recebido"][order.stage];
        showToast(`Pedido atualizado: ${order.status}.`);
    }
    if (action === "refund-order") {
        order.refundStatus = "solicitado";
        showToast("Solicitação de reembolso enviada.");
    }
    if (action === "rate-order") {
        const rating = window.prompt("Avalie o pedido de 1 a 5:", "5");
        if (rating) order.rating = Math.min(5, Math.max(1, Number(rating)));
    }
    saveState();
    renderOrders();
}

function renderDetails(productId) {
    const container = document.getElementById("detalhes-content");
    if (!container) return;

    const product = getProductById(productId);
    if (!product) {
        container.innerHTML = "<p class='empty-state'>Produto não encontrado.</p>";
        return;
    }

    container.innerHTML = `
        <div class="details-card card">
            <div class="details-hero">${productVisual(product, "details-photo")}</div>
            <h1>${escapeHtml(product.nome)}</h1>
            <p class="details-meta">${escapeHtml(product.categoria)} · ${escapeHtml(product.tamanho)} · ${escapeHtml(product.cor)}</p>
            <div class="price-row big">
                <strong>${formatPrice(product.preco)}</strong>
                ${product.aluguel ? `<span>${formatPrice(product.aluguel)}/dia</span>` : ""}
            </div>
            <p>${escapeHtml(product.desc)}</p>
            <div class="details-info">
                <span>Estado: ${escapeHtml(product.estado)}</span>
                <span>Vendedor: ${escapeHtml(product.vendedor)}</span>
                <span>Local: ${escapeHtml(product.local)}</span>
            </div>
            <div class="btn-row">
                <button class="btn btn-outline" data-action="toggle-favorite" data-id="${product.id}">Favoritar</button>
                <button class="btn btn-primary" data-action="add-cart" data-id="${product.id}">Adicionar ao carrinho</button>
            </div>
        </div>
    `;
}

function filterByCategory(category) {
    state.filters.categoria = category;
    const categoriaSelect = document.getElementById("f-categoria");
    if (categoriaSelect) categoriaSelect.value = category;
    document.getElementById("side-menu")?.classList.add("hidden");
    document.getElementById("notification-panel")?.classList.add("hidden");
    showScreen("screen-catalogo");
    renderCatalog();
}

function toggleMenu() {
    const menu = document.getElementById("side-menu");
    const panel = document.getElementById("notification-panel");
    if (!menu) return;

    if (panel && !panel.classList.contains("hidden")) {
        panel.classList.add("hidden");
    }

    menu.classList.toggle("hidden");
}

function toggleNotifications() {
    const panel = document.getElementById("notification-panel");
    const menu = document.getElementById("side-menu");
    if (!panel) return;

    if (menu && !menu.classList.contains("hidden")) {
        menu.classList.add("hidden");
    }

    panel.classList.toggle("hidden");
}

function toggleFilters() {
    const panel = document.getElementById("filters-panel");
    if (!panel) return;
    panel.classList.toggle("hidden");
}

function clearFilters() {
    state.filters = {
        search: "",
        categoria: "",
        tamanho: "",
        modalidade: "",
        estado: "",
        ordenar: "recentes"
    };

    document.getElementById("search-input").value = "";
    document.getElementById("f-categoria").value = "";
    document.getElementById("f-tamanho").value = "";
    document.getElementById("f-modalidade").value = "";
    document.getElementById("f-estado").value = "";
    document.getElementById("f-ordenar").value = "recentes";
    renderCatalog();
    saveState();
}

function applyFilters() {
    const searchInput = document.getElementById("search-input");
    const categoria = document.getElementById("f-categoria");
    const tamanho = document.getElementById("f-tamanho");
    const modalidade = document.getElementById("f-modalidade");
    const estado = document.getElementById("f-estado");
    const ordenar = document.getElementById("f-ordenar");

    state.filters.search = searchInput ? searchInput.value : "";
    state.filters.categoria = categoria ? categoria.value : "";
    state.filters.tamanho = tamanho ? tamanho.value : "";
    state.filters.modalidade = modalidade ? modalidade.value : "";
    state.filters.estado = estado ? estado.value : "";
    state.filters.ordenar = ordenar ? ordenar.value : "recentes";

    renderCatalog();
    saveState();
}

function searchFromHome(event) {
    event.preventDefault();

    const homeSearchInput = document.getElementById("home-search-input");
    const catalogSearchInput = document.getElementById("search-input");
    const search = homeSearchInput ? homeSearchInput.value.trim() : "";

    if (catalogSearchInput) catalogSearchInput.value = search;
    state.filters.search = search;
    showScreen("screen-catalogo");
    renderCatalog();
    saveState();
}

function toggleFavorite(productId) {
    const id = Number(productId);
    const index = state.favorites.indexOf(id);

    if (index >= 0) {
        state.favorites.splice(index, 1);
        showToast("Item removido dos favoritos");
    } else {
        state.favorites.push(id);
        showToast("Item adicionado aos favoritos");
    }

    renderHome();
    renderCatalog();
    renderFavorites();
    renderDetails(id);
    saveState();
}

function addToCart(productId) {
    const id = Number(productId);
    const item = state.cart.find((entry) => entry.id === id);

    if (item) {
        item.qty += 1;
    } else {
        state.cart.push({ id, qty: 1 });
    }

    updateCartBadge();
    renderCart();
    renderCheckout();
    renderHome();
    renderCatalog();
    saveState();
    showToast("Item adicionado ao carrinho");
}

function changeQty(productId, direction) {
    const item = state.cart.find((entry) => entry.id === Number(productId));
    if (!item) return;

    if (direction === "increase") item.qty += 1;
    else item.qty -= 1;

    if (item.qty <= 0) {
        state.cart = state.cart.filter((entry) => entry.id !== Number(productId));
    }

    updateCartBadge();
    renderCart();
    renderCheckout();
    saveState();
}

function finalizePurchase(event) {
    event?.preventDefault();
    if (!state.cart.length) {
        showToast("Seu carrinho está vazio.");
        return;
    }

    const subtotal = state.cart.reduce((sum, entry) => {
        const product = getProductById(entry.id);
        return sum + (product ? product.preco * entry.qty : 0);
    }, 0);
    const total = subtotal - getCouponDiscount(subtotal);
    state.orders.unshift({
        id: String(Date.now()).slice(-6),
        name: `${state.cart.length} item(ns)`,
        status: "processando",
        stage: 0,
        total
    });
    state.cart = [];
    updateCartBadge();
    renderCart();
    renderCheckout();
    renderOrders();
    saveState();
    showScreen("screen-home");
    showToast("Pedido confirmado com sucesso!");
}

function navTo(element, screen) {
    document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item === element));
    showScreen(screen);
}

function loginDemo() {
    showToast("Entrando como visitante");
    showScreen("screen-home");
}

function handleLogin(event) {
    event.preventDefault();
    const emailInput = document.getElementById("login-email");
    const senhaInput = document.getElementById("login-senha");
    const email = normalizeEmail(emailInput?.value);
    const senha = senhaInput?.value.trim();

    if (emailInput) emailInput.setCustomValidity("");
    if (senhaInput) senhaInput.setCustomValidity("");

    if (!email || !senha) {
        setLoginError("Preencha e-mail e senha.");
        showToast("Preencha e-mail e senha.");
        return;
    }

    const user = state.users.find((item) => normalizeEmail(item.email) === email && item.senha === senha);

    if (!user) {
        setLoginError("E-mail ou senha está errada.");
        showToast("E-mail ou senha está errada.");
        if (emailInput) emailInput.setCustomValidity("E-mail ou senha está errada.");
        if (senhaInput) senhaInput.setCustomValidity("E-mail ou senha está errada.");
        return;
    }

    if (emailInput) emailInput.setCustomValidity("");
    if (senhaInput) senhaInput.setCustomValidity("");
    setLoginError("");
    state.currentUser = user;
    saveState();
    applyLoggedUser();
    renderProfile();
    showScreen("screen-home");
    showToast("Login realizado com sucesso!");
}

function handleCadastro(event) {
    event.preventDefault();
    const nome = document.getElementById("cad-nome")?.value.trim();
    const email = normalizeEmail(document.getElementById("cad-email")?.value);
    const senha = document.getElementById("cad-senha")?.value;
    const confirma = document.getElementById("cad-confirma")?.value;
    const cidade = document.getElementById("cad-cidade")?.value.trim();

    if (!nome || !email || !senha || !confirma || !cidade) {
        showToast("Preencha todos os campos obrigatórios.");
        return;
    }

    if (senha.length < 6) {
        showToast("A senha deve ter pelo menos 6 caracteres.");
        return;
    }

    if (senha !== confirma) {
        showToast("As senhas não conferem.");
        return;
    }

    const exists = state.users.some((user) => normalizeEmail(user.email) === email);
    if (exists) {
        showToast("Este e-mail já está cadastrado.");
        return;
    }

    state.users.push({
        nome,
        email,
        senha,
        cidade
    });

    saveState();
    showToast("Cadastro realizado com sucesso!");
    document.getElementById("form-cadastro")?.reset();
    showScreen("screen-login");
}

function handleRecover(event) {
    event.preventDefault();
    showToast("Link de recuperação enviado!");
    showScreen("screen-login");
}

function handleSupport(event) {
    event.preventDefault();
    const subject = document.getElementById("support-subject")?.value;
    const message = document.getElementById("support-message")?.value.trim();
    if (!message) return;

    state.supportMessages.push({ subject, message, createdAt: new Date().toISOString() });
    saveState();
    event.target.reset();
    showToast("Mensagem enviada para o suporte!");
}

function logout() {
    state.currentUser = null;
    saveState();
    renderProfile();
    showToast("Você saiu da conta.");
    showScreen("screen-login");
}

function showScreen(screenId, options = {}) {
    if (screenId === "screen-checkout" && (!state.cart.length || !hasDeliveryData())) {
        startCheckout();
        return;
    }

    document.getElementById("side-menu")?.classList.add("hidden");
    document.getElementById("notification-panel")?.classList.add("hidden");

    document.getElementById("app-header-brand")?.classList.toggle("hidden", screenId === "screen-home");
    if (screenId === "screen-dados") fillPersonalDataForm();

    if (!options.fromHistory && window.location.hash !== `#${screenId}`) {
        const method = options.replace ? "replaceState" : "pushState";
        window.history[method]({ screenId }, "", `#${screenId}`);
    }

    const screens = document.querySelectorAll(".screen");
    screens.forEach((screen) => {
        const isActive = screen.id === screenId;
        screen.classList.toggle("active", isActive);
    });

    const authScreens = ["screen-login", "screen-cadastro", "screen-recuperar"];
    const appScreens = [
        "screen-home",
        "screen-catalogo",
        "screen-detalhes",
        "screen-dados",
        "screen-carrinho",
        "screen-checkout",
        "screen-publicar",
        "screen-favoritos",
        "screen-pedidos",
        "screen-perfil",
        "screen-suporte"
        , "screen-configuracoes"
        , "screen-cupons"
    ];

    const app = document.getElementById("app");
    if (app) {
        const shouldShowApp = appScreens.includes(screenId);
        app.classList.toggle("hidden", !shouldShowApp);
    }

    if (screenId === "screen-login" || screenId === "screen-cadastro" || screenId === "screen-recuperar") {
        document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
    }

    const navItem = document.querySelector(`.nav-item[data-screen="${screenId}"]`);
    if (navItem) {
        document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item === navItem));
    }
}

function attachEvents() {
    document.addEventListener("click", (event) => {
        const button = event.target.closest("[data-action]");
        if (button) {
            const action = button.dataset.action;
            const id = button.dataset.id;
            const category = button.dataset.category;
            const filter = button.dataset.filter;

            if (action === "add-cart") addToCart(id);
            if (action === "details") {
                showScreen("screen-detalhes");
                renderDetails(id);
            }
            if (action === "toggle-favorite") toggleFavorite(id);
            if (action === "increase-qty") changeQty(id, "increase");
            if (action === "decrease-qty") changeQty(id, "decrease");
            if (action === "filter-category") {
                filterByCategory(category);
            }
            if (action === "filter-orders") filterOrders(filter);
            if (["track-order", "advance-order", "refund-order", "rate-order"].includes(action)) {
                handleOrderAction(action, id);
            }
        }

        if (!event.target.closest("#side-menu") && !event.target.closest("#btn-menu") && !event.target.closest(".side-menu-nav button")) {
            document.getElementById("side-menu")?.classList.add("hidden");
        }

        if (!event.target.closest("#notification-panel") && !event.target.closest("#btn-notify")) {
            document.getElementById("notification-panel")?.classList.add("hidden");
        }
    });

    document.addEventListener("keydown", (event) => {
        const card = event.target.closest(".product-card");
        if (!card || event.target !== card || !["Enter", " "].includes(event.key)) return;

        event.preventDefault();
        showScreen("screen-detalhes");
        renderDetails(card.dataset.id);
    });

    const btnMenu = document.getElementById("btn-menu");
    if (btnMenu) {
        btnMenu.addEventListener("click", toggleMenu);
    }

    const btnNotify = document.getElementById("btn-notify");
    if (btnNotify) {
        btnNotify.addEventListener("click", toggleNotifications);
    }

    const formLogin = document.getElementById("form-login");
    const formCadastro = document.getElementById("form-cadastro");
    const formRecover = document.getElementById("form-recuperar");
    const formHomeSearch = document.getElementById("home-search-form");
    const formPublicar = document.getElementById("form-publicar");
    const formPersonalData = document.getElementById("form-dados");
    const formSettings = document.getElementById("form-configuracoes");
    const formSuporte = document.getElementById("form-suporte");
    const photoInput = document.getElementById("pub-fotos");
    const saveDraftButton = document.getElementById("save-draft");
    const cardToggle = document.getElementById("dados-cadastrar-cartao");
    const cardFields = document.getElementById("card-fields");
    const profilePhotoInput = document.getElementById("profile-photo");

    const loginEmail = document.getElementById("login-email");
    const loginSenha = document.getElementById("login-senha");
    if (loginEmail) {
        loginEmail.addEventListener("input", () => {
            loginEmail.setCustomValidity("");
            setLoginError("");
        });
    }
    if (loginSenha) {
        loginSenha.addEventListener("input", () => {
            loginSenha.setCustomValidity("");
            setLoginError("");
        });
    }

    if (formLogin) formLogin.addEventListener("submit", handleLogin);
    if (formCadastro) formCadastro.addEventListener("submit", handleCadastro);
    if (formRecover) formRecover.addEventListener("submit", handleRecover);
    if (formHomeSearch) formHomeSearch.addEventListener("submit", searchFromHome);
    if (formPersonalData) formPersonalData.addEventListener("submit", handlePersonalData);
    if (formSettings) {
        fillSettingsForm();
        formSettings.addEventListener("submit", handleSettings);
    }
    if (formSuporte) formSuporte.addEventListener("submit", handleSupport);

    if (cardToggle && cardFields) {
        cardToggle.addEventListener("change", () => cardFields.classList.toggle("hidden", !cardToggle.checked));
    }

    if (profilePhotoInput) {
        profilePhotoInput.addEventListener("change", () => {
            const file = profilePhotoInput.files?.[0];
            if (!file) return;

            const reader = new FileReader();
            reader.addEventListener("load", () => {
                if (!state.currentUser) state.currentUser = { nome: "Visitante" };
                state.currentUser.photo = reader.result;
                const savedUser = state.users.find((user) => user.email === state.currentUser.email);
                if (savedUser) savedUser.photo = reader.result;
                saveState();
                renderProfile();
                showToast("Foto de perfil atualizada!");
            });
            reader.readAsDataURL(file);
        });
    }

    if (saveDraftButton) {
        saveDraftButton.addEventListener("click", () => {
            state.drafts.push({
                name: document.getElementById("pub-nome")?.value.trim(),
                category: document.getElementById("pub-categoria")?.value,
                description: document.getElementById("pub-desc")?.value.trim(),
                savedAt: new Date().toISOString()
            });
            saveState();
            showToast("Rascunho salvo neste navegador.");
        });
    }

    if (photoInput) {
        photoInput.addEventListener("change", () => {
            const preview = document.getElementById("photo-preview");
            if (!preview) return;
            preview.innerHTML = "";
            state.pendingImages = [];
            [...photoInput.files].slice(0, 8).forEach((file) => {
                const reader = new FileReader();
                reader.addEventListener("load", () => {
                    state.pendingImages.push(reader.result);
                    const image = document.createElement("img");
                    image.alt = `Pré-visualização de ${file.name}`;
                    image.src = reader.result;
                    preview.appendChild(image);
                });
                reader.readAsDataURL(file);
            });
        });
    }

    if (formPublicar) {
        formPublicar.addEventListener("submit", (event) => {
            event.preventDefault();
            const name = document.getElementById("pub-nome")?.value.trim();
            const description = document.getElementById("pub-desc")?.value.trim();
            const price = Number(document.getElementById("pub-preco")?.value || 0);
            if (!name || !description || price <= 0) {
                showToast("Preencha nome, descrição e um preço válido.");
                return;
            }

            const publishedProduct = {
                id: Date.now(),
                nome: name,
                emoji: "👕",
                categoria: normalizeCategory(document.getElementById("pub-categoria")?.value || "Camisetas"),
                marca: document.getElementById("pub-marca")?.value.trim() || "Sem marca",
                tamanho: document.getElementById("pub-tamanho")?.value || "G",
                cor: document.getElementById("pub-cor")?.value.trim() || "Não informada",
                estado: document.getElementById("pub-condicao")?.value || "Excelente",
                preco: price,
                aluguel: Number(document.getElementById("pub-aluguel-valor")?.value || 0) || null,
                troca: document.getElementById("pub-troca")?.checked || false,
                local: document.getElementById("pub-local")?.value.trim() || "Não informada",
                vendedor: state.currentUser?.nome || "Visitante",
                rating: 5,
                pop: 0,
                desc: description,
                image: state.pendingImages[0] || ""
            };
            state.publishedProducts.push(publishedProduct);
            PRODUCTS.push(publishedProduct);
            sendProductToApi(publishedProduct);
            saveState();
            renderHome();
            renderCatalog();
            showToast("Item publicado com sucesso!");
            state.pendingImages = [];
            formPublicar.reset();
            showScreen("screen-home");
        });
    }
}

document.addEventListener("DOMContentLoaded", () => {
    loadState();
    if (!state.users.some((user) => user.email === "clayton@teste.com")) {
        state.users.push({
            nome: "Clayton", email: "clayton@teste.com", senha: "123456", cidade: "Londrina, PR"
        });
    }
    saveState();

    if (state.currentUser) applyLoggedUser();
    applyTranslations();

    updateCartBadge();
    renderHome();
    renderCatalog();
    renderFavorites();
    renderCart();
    renderCheckout();
    renderOrders();
    renderProfile();
    attachEvents();
    showScreen(window.location.hash.slice(1) || "screen-login", { replace: true });
    loadProductsFromApi();

    const translationObserver = new MutationObserver(() => applyTranslations());
    translationObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
});

window.addEventListener("popstate", () => {
    const screenId = window.location.hash.slice(1) || "screen-home";
    showScreen(screenId, { fromHistory: true });
});

window.showScreen = showScreen;
window.loginDemo = loginDemo;
window.navTo = navTo;
window.toggleFilters = toggleFilters;
window.clearFilters = clearFilters;
window.applyFilters = applyFilters;
window.logout = logout;
window.filterByCategory = filterByCategory;
window.toggleMenu = toggleMenu;
window.toggleNotifications = toggleNotifications;

