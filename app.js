/*
 * Controla a interface do marketplace: estado da sessao, catalogo, filtros,
 * anuncios, checkout demonstrativo, pedidos e comunicacao com a API.
 */

let PRODUCTS = [];

const TESTIMONIALS = [
    {
        nome: "Renata",
        texto: "Consegui vender peça que estava guardada e ainda achei uma nova favorita!",
    },
    {
        nome: "Mateus",
        texto: "A experiência de aluguel foi rápida e muito prática.",
    },
    {
        nome: "Aline",
        texto: "A plataforma é intuitiva e a comunidade é muito confiável.",
    },
];

const state = {
    favorites: [],
    savedSearches: [],
    cart: [],
    orders: [],
    publishedProducts: [],
    drafts: [],
    supportMessages: [],
    conversations: [],
    reviews: [],
    notifications: [],
    pendingImages: [],
    appliedCoupon: null,
    settings: {
        language: "pt-BR",
        currency: "BRL",
        payment: "Pix",
        notifications: true,
        seller: false,
        theme: "light",
    },
    userData: {},
    currentUser: null,
    pendingOrderKey: null,
    filters: {
        search: "",
        categoria: "",
        tamanho: "",
        modalidade: "",
        estado: "",
        precoMin: "",
        precoMax: "",
        local: "",
        ordenar: "recentes",
    },
};

const STORAGE_KEY = "guarda-roupa-virtual-state";
const API_BASE_URL = "/api";
const authScreens = [
    "screen-login",
    "screen-cadastro",
    "screen-recuperar",
    "screen-reset",
];
const appScreens = [
    "screen-home",
    "screen-catalogo",
    "screen-detalhes",
    "screen-vendedor",
    "screen-chat",
    "screen-mensagens",
    "screen-dados",
    "screen-carrinho",
    "screen-checkout",
    "screen-publicar",
    "screen-favoritos",
    "screen-meus-produtos",
    "screen-pedidos",
    "screen-perfil",
    "screen-tema",
    "screen-suporte",
    "screen-configuracoes",
    "screen-cupons",
];
let orderFilter = "todos";
let editingProductId = null;
let screenHistory = [];

// CONTROLE DE USUARIO E DADOS SALVOS
function currentUserKey() {
    return normalizeEmail(state.currentUser?.email) || "visitor";
}

function activateUserData() {
    const key = currentUserKey();
    if (!state.userData[key]) {
        state.userData[key] = {
            favorites: key === "visitor" ? [...state.favorites] : [],
            cart: key === "visitor" ? [...state.cart] : [],
            orders: key === "visitor" ? [...state.orders] : [],
            publishedProducts:
                key === "visitor" ? [...state.publishedProducts] : [],
            drafts: key === "visitor" ? [...state.drafts] : [],
            supportMessages:
                key === "visitor" ? [...state.supportMessages] : [],
            savedSearches:
                key === "visitor" ? [...(state.savedSearches || [])] : [],
            notifications: key === "visitor" ? [...state.notifications] : [],
            pendingOrderKey: key === "visitor" ? state.pendingOrderKey : null,
        };
    }
    const data = state.userData[key];
    state.favorites = data.favorites || [];
    state.cart = data.cart || [];
    state.orders = [];
    state.publishedProducts = [];
    state.drafts = data.drafts || [];
    state.supportMessages = data.supportMessages || [];
    state.savedSearches = data.savedSearches || [];
    state.notifications = data.notifications || [];
    state.pendingOrderKey = data.pendingOrderKey || null;
    state.conversations = [];
    updateMessageBadge();
}

function persistUserData() {
    state.userData[currentUserKey()] = {
        favorites: state.favorites,
        cart: state.cart,
        drafts: state.drafts,
        supportMessages: state.supportMessages,
        savedSearches: state.savedSearches,
        notifications: state.notifications,
        pendingOrderKey: state.pendingOrderKey,
    };
}

async function apiRequest(endpoint, options = {}) {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        credentials: "same-origin",
        headers: {
            ...(options.headers || {}),
            ...(options.body ? { "Content-Type": "application/json" } : {}),
        },
    });
    const data = response.status === 204 ? null : await response.json();
    if (!response.ok) {
        const error = new Error(
            data?.error || "Não foi possível concluir a solicitação."
        );
        error.status = response.status;
        throw error;
    }
    return data;
}

async function restoreServerSession() {
    try {
        return await apiRequest("/auth/me");
    } catch {
        return null;
    }
}

async function loadProductsFromApi() {
    try {
        const apiProducts = (await apiRequest("/products")).map((product) => ({
            ...product,
            categoria: normalizeCategory(product.categoria),
            stock: Number.isInteger(product.stock) ? product.stock : 1,
        }));
        PRODUCTS = apiProducts;
        if (state.currentUser?.id) {
            state.publishedProducts = apiProducts.filter(
                (product) =>
                    Number(product.ownerId) === Number(state.currentUser.id)
            );
            saveState();
            renderMyProducts();
        }
        renderHome();
        renderCatalog();
        renderFavorites();
    } catch {
        showToast("Servidor indisponível. O catálogo não foi carregado.");
    }
}

async function loadOrdersFromApi() {
    if (!state.currentUser?.id) return;
    try {
        state.orders = await apiRequest("/orders");
        renderOrders();
        saveState();
    } catch (error) {
        showToast(error.message);
    }
}

// COMUNICACAO COM A API DE PRODUTOS
async function sendProductToApi(product, method = "POST") {
    const endpoint = method === "PUT" ? `/products/${product.id}` : "/products";
    return apiRequest(endpoint, { method, body: JSON.stringify(product) });
}

// PERSISTENCIA DO ESTADO NO NAVEGADOR
function safeStorageRead(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function safeStorageWrite(key, value) {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch {
        return false;
    }
}

function safeStorageRemove(key) {
    try {
        localStorage.removeItem(key);
    } catch {
        // Fallback silencioso para navegadores que bloqueiam storage.
    }
}

function saveState() {
    persistUserData();
    const savedState = {
        reviews: state.reviews,
        filters: state.filters,
        appliedCoupon: state.appliedCoupon,
        settings: state.settings,
        userData: state.userData,
    };

    const serialized = JSON.stringify(savedState);
    if (!safeStorageWrite(STORAGE_KEY, serialized)) {
        const reducedState = {
            ...savedState,
            reviews: [],
            notifications: [],
            supportMessages: [],
            drafts: [],
            userData: {
                [currentUserKey()]: {
                    ...((savedState.userData || {})[currentUserKey()] || {}),
                    notifications: [],
                    supportMessages: [],
                    drafts: [],
                },
            },
        };
        safeStorageWrite(STORAGE_KEY, JSON.stringify(reducedState));
    }
}

function loadState() {
    try {
        const savedState = JSON.parse(safeStorageRead(STORAGE_KEY));
        if (!savedState) return;

        Object.assign(state, savedState);
        state.currentUser = null;
        state.pendingOrderKey = null;
        state.favorites = [];
        state.cart = [];
        state.orders = [];
        state.publishedProducts = [];
        state.drafts = [];
        state.supportMessages = [];
        state.savedSearches = [];
        state.notifications = [];
        state.settings = {
            language: "pt-BR",
            currency: "BRL",
            payment: "Pix",
            notifications: true,
            seller: false,
            ...state.settings,
        };
        const storedUserData =
            state.userData && typeof state.userData === "object"
                ? state.userData
                : {};
        state.userData = Object.fromEntries(
            Object.entries(storedUserData).map(([key, data]) => [
                key,
                {
                    favorites: Array.isArray(data?.favorites)
                        ? data.favorites
                        : [],
                    cart: Array.isArray(data?.cart) ? data.cart : [],
                    drafts: Array.isArray(data?.drafts) ? data.drafts : [],
                    supportMessages: Array.isArray(data?.supportMessages)
                        ? data.supportMessages
                        : [],
                    savedSearches: Array.isArray(data?.savedSearches)
                        ? data.savedSearches
                        : [],
                    notifications: Array.isArray(data?.notifications)
                        ? data.notifications
                        : [],
                    pendingOrderKey: data?.pendingOrderKey || null,
                },
            ])
        );
        if (
            !state.userData.visitor &&
            (Array.isArray(savedState.favorites) ||
                Array.isArray(savedState.cart))
        ) {
            state.userData.visitor = {
                favorites: Array.isArray(savedState.favorites)
                    ? savedState.favorites
                    : [],
                cart: Array.isArray(savedState.cart) ? savedState.cart : [],
                drafts: Array.isArray(savedState.drafts)
                    ? savedState.drafts
                    : [],
                supportMessages: Array.isArray(savedState.supportMessages)
                    ? savedState.supportMessages
                    : [],
                savedSearches: Array.isArray(savedState.savedSearches)
                    ? savedState.savedSearches
                    : [],
                notifications: Array.isArray(savedState.notifications)
                    ? savedState.notifications
                    : [],
                pendingOrderKey: null,
            };
        }
        updateCurrency();
    } catch {
        safeStorageRemove(STORAGE_KEY);
    }
}

// FUNCOES AUXILIARES DE TEXTO, CATEGORIA E USUARIO
function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function normalizeEmail(email) {
    return String(email || "")
        .trim()
        .toLowerCase();
}

function normalizeCategory(category) {
    const value = String(category || "")
        .trim()
        .toLowerCase();
    return value === "calca" || value === "calcas" ? "Calças" : category;
}

function categoryLabel(category) {
    const labels = {
        "en-US": {
            Camisetas: "T-shirts",
            Calças: "Pants",
            Calçados: "Shoes",
            Casacos: "Coats",
            Vestidos: "Dresses",
            Outros: "Other",
        },
        es: {
            Camisetas: "Camisetas",
            Calças: "Pantalones",
            Calçados: "Calzado",
            Casacos: "Abrigos",
            Vestidos: "Vestidos",
            Outros: "Otros",
        },
    };
    return (
        labels[state.settings.language]?.[normalizeCategory(category)] ||
        normalizeCategory(category)
    );
}

function applyLoggedUser() {
    const firstname = document.getElementById("user-firstname");
    const profileName = document.getElementById("profile-name");
    const profileCity = document.getElementById("profile-city");

    const user = state.currentUser;
    const name = user ? user.nome : "Visitante";
    const firstName = name.split(" ")[0];

    if (firstname) firstname.textContent = firstName;
    if (profileName) profileName.textContent = name;
    if (profileCity && user?.cidade) profileCity.textContent = user.cidade;
    document
        .querySelector(".seller-status")
        ?.classList.toggle("hidden", state.settings.seller !== true);
}

// IDIOMA, MOEDA E MENSAGENS DE INTERFACE
let currency = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
});

const COUPONS = {
    BEMVINDO10: { discount: 0.1, label: "10% de desconto" },
    MODACONSCIENTE: { discount: 15, label: "R$ 15,00 de desconto" },
};

const TRANSLATIONS = {
    "en-US": {
        Início: "Home",
        Buscar: "Search",
        Pedidos: "Orders",
        Perfil: "Profile",
        Catálogo: "Catalog",
        Carrinho: "Cart",
        Checkout: "Checkout",
        Configurações: "Settings",
        "Cupons e ofertas": "Coupons and offers",
        "Editar dados pessoais": "Edit personal details",
        "Meu guarda-roupa": "My wardrobe",
        "Meus pedidos": "My orders",
        Favoritos: "Favorites",
        Suporte: "Support",
        "Sair da conta": "Log out",
        Aplicar: "Apply",
        Remover: "Remove",
        "Finalizar compra": "Checkout",
        "Confirmar pagamento": "Confirm payment",
        "Salvar configurações": "Save settings",
        Processando: "Processing",
        Enviado: "Shipped",
        Recebido: "Received",
        Avaliar: "Rate",
        "Rastrear pedido": "Track order",
        "Solicitar reembolso": "Request refund",
        "Avançar etapa": "Advance status",
        Idioma: "Language",
        "Moeda de compra": "Shopping currency",
        "Forma de pagamento preferida": "Preferred payment method",
        "Alterar foto": "Change photo",
        "Cupom de desconto": "Discount coupon",
        Subtotal: "Subtotal",
        Frete: "Shipping",
        Grátis: "Free",
        "E-mail": "Email",
        Senha: "Password",
        "Esqueci minha senha": "Forgot my password",
        Entrar: "Sign in",
        "Não tem conta?": "No account?",
        "Cadastre-se": "Sign up",
        "Entrar como visitante (demo)": "Enter as visitor (demo)",
        Criar: "Create",
        conta: "account",
        "Junte-se à moda consciente 🌱": "Join conscious fashion 🌱",
        Cadastrar: "Register",
        "Já tem conta?": "Already have an account?",
        Recuperar: "Recover",
        senha: "password",
        "Enviaremos um link para seu e-mail.":
            "We will send a link to your email.",
        "Enviar link": "Send link",
        "Voltar ao login": "Back to sign in",
        "Compre, troque ou alugue de forma sustentável.":
            "Buy, trade or rent sustainably.",
        "Moda consciente faz a diferença!":
            "Conscious fashion makes a difference!",
        "Dê um novo destino às roupas e transforme o mundo.":
            "Give clothes a new purpose and transform the world.",
        "Saiba mais": "Learn more",
        Categorias: "Categories",
        "Ver todas": "View all",
        Destaques: "Highlights",
        "Mais recentes": "Most recent",
        "O que dizem sobre nós": "What people say about us",
        "Moda circular, consciente e acessível.":
            "Circular, conscious and accessible fashion.",
        Sobre: "About",
        Termos: "Terms",
        Privacidade: "Privacy",
        Filtros: "Filters",
        "Buscar peças...": "Search items...",
        Categoria: "Category",
        Tamanho: "Size",
        Modalidade: "Listing type",
        Comprar: "Buy",
        Alugar: "Rent",
        Trocar: "Trade",
        Estado: "Condition",
        Novo: "New",
        Excelente: "Excellent",
        Bom: "Good",
        Usado: "Used",
        "Mais recentes": "Most recent",
        "Menor preço": "Lowest price",
        "Maior preço": "Highest price",
        "Mais populares": "Most popular",
        "Melhor avaliados": "Highest rated",
        "Limpar filtros": "Clear filters",
        Detalhes: "Details",
        Adicionar: "Add",
        "No carrinho": "In cart",
        "Adicionar ao carrinho": "Add to cart",
        Favoritar: "Add to favorites",
        "Pedido enviado": "Order shipped",
        "Nova oferta": "New offer",
        "Troca aprovada": "Trade approved",
        "Seu carrinho está vazio.": "Your cart is empty.",
        "Resumo do pedido": "Order summary",
        Itens: "Items",
        Entrega: "Delivery",
        "Em 2 a 4 dias": "In 2 to 4 days",
        "Forma de pagamento": "Payment method",
        Selecione: "Select",
        "Pix (simulação)": "Pix (simulation)",
        "Cartão (simulação)": "Card (simulation)",
        "Boleto (simulação)": "Bank slip (simulation)",
        "Dados para entrega": "Delivery details",
        "Complete seus dados antes de finalizar a compra.":
            "Complete your details before checkout.",
        "Nome completo": "Full name",
        Telefone: "Phone",
        CEP: "ZIP code",
        Rua: "Street",
        Número: "Number",
        Bairro: "Neighborhood",
        Cidade: "City",
        Complemento: "Additional details",
        UF: "State",
        "Cadastrar cartão para compras futuras":
            "Save card for future purchases",
        "Número do cartão": "Card number",
        "Nome no cartão": "Name on card",
        Validade: "Expiration date",
        CVV: "CVV",
        "Continuar para pagamento": "Continue to payment",
        "Publicar item": "List item",
        "Fotos do item": "Item photos",
        "Adicionar fotos": "Add photos",
        "Até 8 fotos": "Up to 8 photos",
        "Nome do item": "Item name",
        Marca: "Brand",
        Cor: "Color",
        Condição: "Condition",
        Descrição: "Description",
        Venda: "Sale",
        "Aluguel (R$/dia)": "Rent (per day)",
        "Preço (R$)": "Price",
        Localidade: "Location",
        "Salvar rascunho": "Save draft",
        Informações: "Information",
        Detalhes: "Details",
        Revisão: "Review",
        "Meus pedidos": "My orders",
        "Vendedor confiável": "Trusted seller",
        "Configurações salvas!": "Settings saved!",
        "Cupom inválido ou expirado.": "Invalid or expired coupon.",
        "Aplicar cupom": "Apply coupon",
        Mensagem: "Message",
        Assunto: "Subject",
        "Enviar mensagem": "Send message",
        "Alterar foto": "Change photo",
        "Rastrear pedido": "Track order",
        "Solicitar reembolso": "Request refund",
    },
    es: {
        Início: "Inicio",
        Buscar: "Buscar",
        Pedidos: "Pedidos",
        Perfil: "Perfil",
        Catálogo: "Catálogo",
        Carrinho: "Carrito",
        Checkout: "Pago",
        Configurações: "Configuración",
        "Cupons e ofertas": "Cupones y ofertas",
        "Editar dados pessoais": "Editar datos personales",
        "Meu guarda-roupa": "Mi armario",
        "Meus pedidos": "Mis pedidos",
        Favoritos: "Favoritos",
        Suporte: "Soporte",
        "Sair da conta": "Cerrar sesión",
        Aplicar: "Aplicar",
        Remover: "Eliminar",
        "Finalizar compra": "Finalizar compra",
        "Confirmar pagamento": "Confirmar pago",
        "Salvar configurações": "Guardar configuración",
        Processando: "Procesando",
        Enviado: "Enviado",
        Recebido: "Recibido",
        Avaliar: "Evaluar",
        "Rastrear pedido": "Rastrear pedido",
        "Solicitar reembolso": "Solicitar reembolso",
        "Avançar etapa": "Avanzar etapa",
        Idioma: "Idioma",
        "Moeda de compra": "Moneda de compra",
        "Forma de pagamento preferida": "Forma de pago preferida",
        "Alterar foto": "Cambiar foto",
        "Cupom de desconto": "Cupón de descuento",
        Subtotal: "Subtotal",
        Frete: "Envío",
        Grátis: "Gratis",
        "E-mail": "Correo electrónico",
        Senha: "Contraseña",
        "Esqueci minha senha": "Olvidé mi contraseña",
        Entrar: "Entrar",
        "Não tem conta?": "¿No tienes cuenta?",
        "Cadastre-se": "Regístrate",
        "Entrar como visitante (demo)": "Entrar como visitante (demo)",
        Criar: "Crear",
        conta: "cuenta",
        "Junte-se à moda consciente 🌱": "Únete a la moda consciente 🌱",
        Cadastrar: "Registrarse",
        "Já tem conta?": "¿Ya tienes una cuenta?",
        Recuperar: "Recuperar",
        senha: "contraseña",
        "Enviaremos um link para seu e-mail.":
            "Enviaremos un enlace a tu correo.",
        "Enviar link": "Enviar enlace",
        "Voltar ao login": "Volver al inicio",
        "Compre, troque ou alugue de forma sustentável.":
            "Compra, intercambia o alquila de forma sostenible.",
        "Moda consciente faz a diferença!":
            "¡La moda consciente marca la diferencia!",
        "Dê um novo destino às roupas e transforme o mundo.":
            "Da un nuevo destino a la ropa y transforma el mundo.",
        "Saiba mais": "Saber más",
        Categorias: "Categorías",
        "Ver todas": "Ver todas",
        Destaques: "Destacados",
        "Mais recentes": "Más recientes",
        "O que dizem sobre nós": "Lo que dicen de nosotros",
        "Moda circular, consciente e acessível.":
            "Moda circular, consciente y accesible.",
        Sobre: "Acerca de",
        Termos: "Términos",
        Privacidade: "Privacidad",
        Filtros: "Filtros",
        "Buscar peças...": "Buscar prendas...",
        Categoria: "Categoría",
        Tamanho: "Talla",
        Modalidade: "Modalidad",
        Comprar: "Comprar",
        Alugar: "Alquilar",
        Trocar: "Intercambiar",
        Estado: "Estado",
        Novo: "Nuevo",
        Excelente: "Excelente",
        Bom: "Bueno",
        Usado: "Usado",
        "Mais recentes": "Más recientes",
        "Menor preço": "Precio más bajo",
        "Maior preço": "Precio más alto",
        "Mais populares": "Más populares",
        "Melhor avaliados": "Mejor valorados",
        "Limpar filtros": "Limpiar filtros",
        Detalhes: "Detalles",
        Adicionar: "Añadir",
        "No carrinho": "En el carrito",
        "Adicionar ao carrinho": "Añadir al carrito",
        Favoritar: "Añadir a favoritos",
        "Pedido enviado": "Pedido enviado",
        "Nova oferta": "Nueva oferta",
        "Troca aprovada": "Intercambio aprobado",
        "Seu carrinho está vazio.": "Tu carrito está vacío.",
        "Resumo do pedido": "Resumen del pedido",
        Itens: "Artículos",
        Entrega: "Entrega",
        "Em 2 a 4 dias": "En 2 a 4 días",
        "Forma de pagamento": "Forma de pago",
        Selecione: "Selecciona",
        "Dados para entrega": "Datos de entrega",
        "Complete seus dados antes de finalizar a compra.":
            "Completa tus datos antes de finalizar la compra.",
        "Nome completo": "Nombre completo",
        Telefone: "Teléfono",
        CEP: "Código postal",
        Rua: "Calle",
        Número: "Número",
        Bairro: "Barrio",
        Cidade: "Ciudad",
        Complemento: "Complemento",
        UF: "Estado",
        "Cadastrar cartão para compras futuras":
            "Guardar tarjeta para futuras compras",
        "Número do cartão": "Número de tarjeta",
        "Nome no cartão": "Nombre en la tarjeta",
        Validade: "Vencimiento",
        "Continuar para pagamento": "Continuar al pago",
        "Publicar item": "Publicar artículo",
        "Fotos do item": "Fotos del artículo",
        "Adicionar fotos": "Añadir fotos",
        "Até 8 fotos": "Hasta 8 fotos",
        "Nome do item": "Nombre del artículo",
        Marca: "Marca",
        Cor: "Color",
        Condição: "Condición",
        Descrição: "Descripción",
        Venda: "Venta",
        "Preço (R$)": "Precio",
        Localidade: "Ubicación",
        "Salvar rascunho": "Guardar borrador",
        Informações: "Información",
        Revisão: "Revisión",
        "Vendedor confiável": "Vendedor confiable",
        "Configurações salvas!": "¡Configuración guardada!",
        "Cupom inválido ou expirado.": "Cupón inválido o caducado.",
        Mensagem: "Mensaje",
        Assunto: "Asunto",
        "Enviar mensagem": "Enviar mensaje",
    },
};

function applyTranslations() {
    const dictionary = TRANSLATIONS[state.settings.language];
    document.documentElement.lang = state.settings.language;

    const translateValue = (value) => {
        const suffix = value.endsWith(" *") ? " *" : "";
        const baseValue = suffix ? value.slice(0, -2) : value;
        const canonical = Object.keys(TRANSLATIONS).reduce(
            (result, language) => {
                const entries = TRANSLATIONS[language];
                return (
                    Object.entries(entries).find(
                        ([, translated]) => translated === baseValue
                    )?.[0] || result
                );
            },
            baseValue
        );
        return `${dictionary?.[canonical] || canonical}${suffix}`;
    };

    const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT
    );
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach((node) => {
        const original = node.nodeValue.trim();
        if (!original) return;

        const translated = translateValue(original);
        if (translated !== original)
            node.nodeValue = node.nodeValue.replace(original, translated);
    });

    document
        .querySelectorAll("[placeholder], [aria-label]")
        .forEach((element) => {
            ["placeholder", "aria-label"].forEach((attribute) => {
                const value = element.getAttribute(attribute);
                if (!value) return;
                const translated = translateValue(value);
                if (translated !== value)
                    element.setAttribute(attribute, translated);
            });
        });
}

function updateCurrency() {
    const locale =
        state.settings.currency === "USD"
            ? "en-US"
            : state.settings.currency === "EUR"
              ? "de-DE"
              : "pt-BR";
    currency = new Intl.NumberFormat(locale, {
        style: "currency",
        currency: state.settings.currency,
    });
}

function applyTheme() {
    const theme = state.settings?.theme || "light";
    document.body.classList.toggle("theme-dark", theme === "dark");
    document.body.classList.toggle("theme-light", theme === "light");
}

function handleTheme(event) {
    event.preventDefault();
    const selectedTheme =
        document.getElementById("theme-mode")?.value || "light";
    state.settings.theme = selectedTheme;

    const settingsTheme = document.getElementById("setting-theme");
    if (settingsTheme) settingsTheme.value = selectedTheme;

    applyTheme();
    saveState();
    renderHome();
    renderCatalog();
    renderCart();
    renderOrders();
    showScreen("screen-perfil");
    showToast("Tema salvo!");
}

function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;

    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timeoutId);
    showToast.timeoutId = setTimeout(
        () => toast.classList.remove("show"),
        2200
    );
}

function showInfoDialog(title, message) {
    const dialog = document.getElementById("info-dialog");
    const titleElement = document.getElementById("info-dialog-title");
    const messageElement = document.getElementById("info-dialog-message");
    if (!dialog || !titleElement || !messageElement) return;

    titleElement.textContent = title;
    messageElement.textContent = message;
    dialog.showModal();
}

function closeInfoDialog() {
    document.getElementById("info-dialog")?.close();
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
    badge.classList.toggle("hidden", total < 1);
}

function updateFavoriteBadge() {
    const badge = document.getElementById("favorite-count");
    if (!badge) return;

    const total = state.favorites.length;
    badge.textContent = String(total);
    badge.classList.toggle("hidden", total < 1);
}

function updateNotificationBadge() {
    const badge = document.getElementById("notification-count");
    if (!badge) return;

    const unread = state.notifications.filter(
        (notification) => !notification.read
    ).length;
    badge.textContent = String(unread);
    badge.classList.toggle("hidden", unread < 1);
}

// NOTIFICACOES E FORMATACAO DE VALORES
function renderNotifications() {
    const container = document.getElementById("notifications-list");
    if (!container) return;

    const notifications = state.notifications;
    container.innerHTML = notifications.length
        ? notifications
              .map(
                  (notification) => `
        <div class="notification-item ${notification.read ? "" : "unread"}" ${notification.productId ? `data-action="open-notification-product" data-id="${Number(notification.productId)}" role="button" tabindex="0"` : ""}>
            <strong>${escapeHtml(notification.title)}</strong>
            <span>${escapeHtml(notification.message)}</span>
        </div>
    `
              )
              .join("")
        : '<p class="empty-state">Nenhuma notificação nova.</p>';
    updateNotificationBadge();
}

function addNotification(title, message, metadata = {}) {
    state.notifications.unshift({
        title,
        message,
        ...metadata,
        read: false,
        createdAt: new Date().toISOString(),
    });
    saveState();
    renderNotifications();
}

function formatPrice(value) {
    return currency.format(Number(value || 0));
}

function getProductById(id) {
    return PRODUCTS.find((product) => product.id === Number(id));
}

function slugify(value) {
    return String(value || "produto")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function productPath(product) {
    return `/produto/${product.id}-${slugify(product.nome)}`;
}

function productIdFromPath(pathname) {
    const match = pathname.match(/^\/produto\/(\d+)(?:-[^/]*)?\/?$/);
    return match ? Number(match[1]) : null;
}

function openProductDetails(productId, options = {}) {
    const product = getProductById(productId);
    if (!product) return;

    showScreen("screen-detalhes", { ...options, url: productPath(product) });
    renderDetails(product.id);
}

function productVisual(product, className) {
    const image =
        product.image &&
        /^(data:image\/|https?:\/\/|\/(?:uploads|imagens)\/)/.test(
            product.image
        )
            ? `<img class="${className}" src="${escapeHtml(product.image)}" alt="${escapeHtml(product.nome)}" loading="lazy" decoding="async" />`
            : product.emoji;
    return image;
}

async function prepareProductImage(file) {
    const bitmap = await createImageBitmap(file);
    const originalWidth = bitmap.width;
    const originalHeight = bitmap.height;
    const scale = Math.min(1, 1000 / Math.max(originalWidth, originalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(originalWidth * scale);
    canvas.height = Math.round(originalHeight * scale);
    canvas
        .getContext("2d")
        .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const sample = document.createElement("canvas");
    sample.width = 32;
    sample.height = 32;
    const sampleContext = sample.getContext("2d", { willReadFrequently: true });
    sampleContext.drawImage(canvas, 0, 0, sample.width, sample.height);
    const pixels = sampleContext.getImageData(
        0,
        0,
        sample.width,
        sample.height
    ).data;
    const luminance = [];
    for (let index = 0; index < pixels.length; index += 4) {
        luminance.push(
            0.2126 * pixels[index] +
                0.7152 * pixels[index + 1] +
                0.0722 * pixels[index + 2]
        );
    }
    const brightness =
        luminance.reduce((sum, value) => sum + value, 0) / luminance.length;
    const contrast = Math.sqrt(
        luminance.reduce((sum, value) => sum + (value - brightness) ** 2, 0) /
            luminance.length
    );
    return {
        src: canvas.toDataURL("image/jpeg", 0.62),
        originalWidth,
        originalHeight,
        smallFile: file.size < 60 * 1024,
        brightness,
        contrast,
    };
}

function updateSeo(screenId = "screen-home", product = null) {
    const baseTitle = "Guarda Roupa Virtual | Moda circular";
    const title = product
        ? `${product.nome} | Guarda Roupa Virtual`
        : screenId === "screen-catalogo"
          ? "Catálogo de roupas | Guarda Roupa Virtual"
          : baseTitle;
    const description =
        product?.desc ||
        "Compre, troque ou alugue roupas de forma consciente no Guarda Roupa Virtual.";
    const canonical = new URL(window.location.href);
    canonical.hash = "";

    document.title = title;
    document
        .querySelector('meta[name="description"]')
        ?.setAttribute("content", description);
    document
        .querySelector('meta[property="og:title"]')
        ?.setAttribute("content", title);
    document
        .querySelector('meta[property="og:description"]')
        ?.setAttribute("content", description);
    document
        .querySelector('link[rel="canonical"]')
        ?.setAttribute("href", canonical.href);

    const structuredData = product
        ? {
              "@context": "https://schema.org",
              "@type": "Product",
              name: product.nome,
              description,
              category: product.categoria,
              image:
                  product.image && /^(https?:\/\/)/.test(product.image)
                      ? [product.image]
                      : undefined,
              brand: product.marca
                  ? { "@type": "Brand", name: product.marca }
                  : undefined,
              offers: isForSale(product)
                  ? {
                        "@type": "Offer",
                        priceCurrency: "BRL",
                        price: Number(product.preco).toFixed(2),
                        availability:
                            Number(product.stock) > 0
                                ? "https://schema.org/InStock"
                                : "https://schema.org/OutOfStock",
                        url: canonical.href,
                    }
                  : undefined,
              aggregateRating: product.rating
                  ? {
                        "@type": "AggregateRating",
                        ratingValue: Number(product.rating),
                        bestRating: 5,
                        ratingCount: Math.max(1, Number(product.pop) || 1),
                    }
                  : undefined,
          }
        : {
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "Guarda Roupa Virtual",
              description:
                  "Marketplace de moda circular para comprar, trocar e alugar roupas.",
              url: canonical.href,
          };

    const jsonLd = document.getElementById("structured-data");
    if (jsonLd) jsonLd.textContent = JSON.stringify(structuredData);
}

function isForSale(product) {
    const price = Number(product?.preco);
    return (
        product?.preco !== null &&
        product?.preco !== undefined &&
        product?.preco !== "" &&
        Number.isFinite(price) &&
        price > 0
    );
}

function buildProductMeta(product, stock) {
    const meta = [
        escapeHtml(product.estado),
        escapeHtml(product.tamanho),
        escapeHtml(product.cor),
        stock > 0
            ? `${stock} disponível${stock === 1 ? "" : "is"}`
            : "Indisponível",
    ];

    return meta
        .slice(0, 3)
        .map((item) => `<span>${item}</span>`)
        .join("");
}

function buildProductCard(product) {
    const inFavorites = state.favorites.includes(product.id);
    const inCart = state.cart.some((item) => item.id === product.id);
    const isOwner =
        product.ownerEmail &&
        product.ownerEmail === normalizeEmail(state.currentUser?.email);
    const stock = Number.isInteger(product.stock) ? product.stock : 1;

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
                    <strong>${isForSale(product) ? formatPrice(product.preco) : product.aluguel ? `${formatPrice(product.aluguel)}/dia` : "Disponível para troca"}</strong>
                    ${isForSale(product) && product.aluguel ? `<span>${formatPrice(product.aluguel)}/dia</span>` : ""}
                </div>
                <div class="product-meta">
                    ${buildProductMeta(product, stock)}
                </div>
            </div>
            <div class="product-actions">
                <button class="btn btn-outline btn-sm" data-action="details" data-id="${product.id}">Detalhes</button>
                ${isForSale(product) ? `<button class="btn btn-primary btn-sm" data-action="add-cart" data-id="${product.id}" ${stock < 1 ? "disabled" : ""}>${stock < 1 ? "Indisponível" : inCart ? "No carrinho" : "Adicionar"}</button>` : `<span class="btn btn-outline btn-sm" aria-disabled="true">${product.aluguel ? "Aluguel em breve" : "Troca em breve"}</span>`}
                ${isOwner ? `<button class="btn btn-ghost btn-sm" data-action="edit-product" data-id="${product.id}">Editar</button><button class="btn btn-danger btn-sm" data-action="delete-product" data-id="${product.id}">Excluir</button>` : ""}
            </div>
        </article>
    `;
}

// RENDERIZACAO DA HOME, CATALOGO E PRODUTOS
function renderCategories() {
    const container = document.getElementById("categories-list");
    if (!container) return;

    const categories = [
        ...new Set(
            PRODUCTS.map((product) => normalizeCategory(product.categoria))
        ),
    ];
    container.innerHTML = categories
        .map(
            (categoria) => `
        <button class="category-pill" data-action="filter-category" data-category="${categoria}">
            ${escapeHtml(categoryLabel(categoria))}
        </button>
    `
        )
        .join("");
}

function renderTestimonials() {
    const container = document.getElementById("testimonials");
    if (!container) return;

    container.innerHTML = TESTIMONIALS.map(
        (item) => `
        <div class="testimonial">
            <div class="stars">★★★★★</div>
            <p>“${item.texto}”</p>
            <strong>${item.nome}</strong>
        </div>
    `
    ).join("");
}

function getFilteredProducts() {
    const {
        search,
        categoria,
        tamanho,
        modalidade,
        estado,
        precoMin,
        precoMax,
        local,
        ordenar,
    } = state.filters;

    let result = [...PRODUCTS].filter((product) => {
        const matchesSearch =
            !search ||
            product.nome.toLowerCase().includes(search.toLowerCase()) ||
            String(product.desc || "")
                .toLowerCase()
                .includes(search.toLowerCase());
        const matchesCategoria = !categoria || product.categoria === categoria;
        const matchesTamanho = !tamanho || product.tamanho === tamanho;
        const matchesEstado = !estado || product.estado === estado;
        const matchesMinPrice =
            !precoMin || Number(product.preco) >= Number(precoMin);
        const matchesMaxPrice =
            !precoMax || Number(product.preco) <= Number(precoMax);
        const matchesLocal =
            !local ||
            String(product.local || "")
                .toLowerCase()
                .includes(local.toLowerCase());

        let matchesModalidade = true;
        if (modalidade === "venda") matchesModalidade = isForSale(product);
        if (modalidade === "aluguel") matchesModalidade = !!product.aluguel;
        if (modalidade === "troca") matchesModalidade = !!product.troca;

        return (
            matchesSearch &&
            matchesCategoria &&
            matchesTamanho &&
            matchesEstado &&
            matchesModalidade &&
            matchesMinPrice &&
            matchesMaxPrice &&
            matchesLocal
        );
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

// RENDERIZACAO DAS TELAS PRINCIPAIS
function renderHome() {
    const homeProducts = PRODUCTS.slice(0, 4);
    const recentProducts = PRODUCTS.slice(-3).reverse();

    const homeProductsNode = document.getElementById("home-products");
    const recentNode = document.getElementById("home-recent");

    if (homeProductsNode)
        homeProductsNode.innerHTML = homeProducts
            .map(buildProductCard)
            .join("");
    if (recentNode)
        recentNode.innerHTML = recentProducts.map(buildProductCard).join("");

    renderImpactSummary();
    renderCategories();
    renderTestimonials();
}

function renderCatalog() {
    const container = document.getElementById("catalog-products");
    const counter = document.getElementById("results-count");
    if (!container) return;

    const filtered = getFilteredProducts();
    container.innerHTML = filtered.length
        ? filtered.map(buildProductCard).join("")
        : "<p class='empty-state'>Nenhuma peça encontrada com esses filtros.</p>";

    if (counter) counter.textContent = `${filtered.length} itens encontrados`;
    renderSavedSearches();
}

function getAllLocalOrders() {
    const ordersByOwner = new Map();
    Object.entries(state.userData || {}).forEach(([owner, userData]) => {
        (userData.orders || []).forEach((order) =>
            ordersByOwner.set(`${owner}:${order.id}`, order)
        );
    });
    if (!state.userData?.[currentUserKey()]) {
        state.orders.forEach((order) =>
            ordersByOwner.set(`${currentUserKey()}:${order.id}`, order)
        );
    }
    return [...ordersByOwner.values()];
}

function getCompletedReuseCount() {
    return getAllLocalOrders()
        .filter(
            (order) => Number(order.stage) >= 3 || order.status === "entregue"
        )
        .reduce(
            (total, order) =>
                total +
                (order.items || []).reduce(
                    (quantity, item) => quantity + Number(item.qty || 1),
                    0
                ),
            0
        );
}

function renderImpactSummary() {
    const summary = document.getElementById("impact-summary");
    if (!summary) return;
    const reused = getCompletedReuseCount();
    const published = PRODUCTS.length;
    const waterLiters = (reused * 2700).toLocaleString("pt-BR");
    const emissionsKg = (reused * 2).toLocaleString("pt-BR");
    summary.innerHTML = `
        <div><strong>${published}</strong><span>peças disponíveis para circular</span></div>
        <div><strong>${reused}</strong><span>peças reutilizadas em pedidos concluídos</span></div>
        <div><strong>${waterLiters} L</strong><span>de água estimada</span></div>
        <div><strong>${emissionsKg} kg</strong><span>de CO₂e estimado</span></div>
        <p>Estimativa ilustrativa: considera até 2.700 L de água e 2 kg de CO₂e por peça reutilizada, como referência de uma camiseta de algodão. Não é uma medição do ciclo de vida; o impacto real varia por material, produção e transporte.</p>
    `;
}

function saveCurrentSearch() {
    const filters = { ...state.filters };
    if (
        !Object.values(filters).some((value) => value && value !== "recentes")
    ) {
        showToast("Defina ao menos um filtro antes de salvar a busca.");
        return;
    }
    const id = `${Date.now()}`;
    const label =
        [filters.search, filters.categoria, filters.tamanho, filters.local]
            .filter(Boolean)
            .join(" · ") || "Busca com filtros";
    const alertedProductIds = PRODUCTS.filter((product) =>
        productMatchesSearchFilters(product, filters)
    ).map((product) => product.id);
    state.savedSearches.unshift({ id, label, filters, alertedProductIds });
    saveState();
    renderSavedSearches();
    showToast("Busca salva. Avisaremos quando surgir uma peça compatível.");
}

function renderSavedSearches() {
    const container = document.getElementById("saved-searches-list");
    if (!container) return;
    container.innerHTML = state.savedSearches.length
        ? state.savedSearches
              .map(
                  (search) => `
        <div class="saved-search-row">
            <button class="saved-search-apply" data-action="apply-saved-search" data-id="${escapeHtml(search.id)}">${escapeHtml(search.label)}</button>
            <button class="icon-btn" data-action="delete-saved-search" data-id="${escapeHtml(search.id)}" aria-label="Excluir busca salva" title="Excluir busca salva"><i class="fa-solid fa-trash"></i></button>
        </div>
    `
              )
              .join("")
        : '<p class="empty-state">Buscas salvas aparecem aqui.</p>';
}

function applySavedSearch(searchId) {
    const search = state.savedSearches.find(
        (item) => item.id === String(searchId)
    );
    if (!search) return;
    state.filters = { ...state.filters, ...search.filters };
    fillCatalogFilters();
    showScreen("screen-catalogo", { keepFilters: true });
    renderCatalog();
}

function fillCatalogFilters() {
    const values = {
        "search-input": "search",
        "f-categoria": "categoria",
        "f-tamanho": "tamanho",
        "f-modalidade": "modalidade",
        "f-estado": "estado",
        "f-preco-min": "precoMin",
        "f-preco-max": "precoMax",
        "f-local": "local",
        "f-ordenar": "ordenar",
    };
    Object.entries(values).forEach(([id, key]) => {
        const field = document.getElementById(id);
        if (field) field.value = state.filters[key] || "";
    });
}

function checkSavedSearchAlerts(product) {
    state.savedSearches.forEach((search) => {
        const matches = productMatchesSearchFilters(
            product,
            search.filters || {}
        );
        if (matches && !(search.alertedProductIds || []).includes(product.id)) {
            search.alertedProductIds = [
                ...(search.alertedProductIds || []),
                product.id,
            ];
            addNotification(
                "Peça compatível com sua busca",
                `${product.nome} combina com “${search.label}”.`,
                { type: "saved-search", productId: product.id }
            );
        }
    });
}

function productMatchesSearchFilters(product, filters) {
    return (
        (!filters.search ||
            `${product.nome} ${product.desc || ""}`
                .toLowerCase()
                .includes(filters.search.toLowerCase())) &&
        (!filters.categoria ||
            normalizeCategory(product.categoria) ===
                normalizeCategory(filters.categoria)) &&
        (!filters.tamanho || product.tamanho === filters.tamanho) &&
        (!filters.estado || product.estado === filters.estado) &&
        (!filters.local ||
            String(product.local || "")
                .toLowerCase()
                .includes(filters.local.toLowerCase())) &&
        (!filters.precoMin ||
            (isForSale(product) &&
                Number(product.preco) >= Number(filters.precoMin))) &&
        (!filters.precoMax ||
            (isForSale(product) &&
                Number(product.preco) <= Number(filters.precoMax))) &&
        (!filters.modalidade ||
            (filters.modalidade === "venda" && isForSale(product)) ||
            (filters.modalidade === "aluguel" && !!product.aluguel) ||
            (filters.modalidade === "troca" && !!product.troca))
    );
}

function renderFavorites() {
    const container = document.getElementById("fav-products");
    if (!container) return;

    const sharedIds = new URLSearchParams(window.location.search)
        .get("wishlist")
        ?.split(",")
        .map(Number)
        .filter(Number.isFinite);
    const favorites = PRODUCTS.filter((product) =>
        (sharedIds ? sharedIds : state.favorites).includes(Number(product.id))
    );
    container.innerHTML = favorites.length
        ? favorites.map(buildProductCard).join("")
        : "<p class='empty-state'>Você ainda não marcou nenhum favorito.</p>";
}

async function shareWishlist() {
    if (!state.favorites.length) {
        showToast("Adicione peças aos favoritos antes de compartilhar.");
        return;
    }
    const link = new URL(window.location.href);
    link.search = "";
    link.hash = "";
    link.searchParams.set("wishlist", state.favorites.join(","));
    try {
        if (navigator.share)
            await navigator.share({
                title: "Minha lista de favoritos",
                url: link.href,
            });
        else {
            await navigator.clipboard.writeText(link.href);
            showToast("Link da lista copiado.");
        }
    } catch (error) {
        if (error.name !== "AbortError")
            showInfoDialog("Compartilhar lista", link.href);
    }
}

function getSellerMetrics(sellerName) {
    const sellerReviews = (state.reviews || []).filter(
        (review) => review.seller === sellerName
    );
    const ratings = sellerReviews.map((review) => Number(review.rating));
    const completedSales = getAllLocalOrders().reduce((total, order) => {
        if (Number(order.stage) < 3 && order.status !== "entregue")
            return total;
        return (
            total +
            (order.items || [])
                .filter((item) => item.seller === sellerName)
                .reduce((quantity, item) => quantity + Number(item.qty || 1), 0)
        );
    }, 0);
    return {
        rating: ratings.length
            ? (
                  ratings.reduce((sum, rating) => sum + rating, 0) /
                  ratings.length
              ).toFixed(1)
            : null,
        completedSales,
        reviews: sellerReviews
            .sort(
                (first, second) =>
                    new Date(second.createdAt) - new Date(first.createdAt)
            )
            .slice(0, 3),
    };
}

function renderMyProducts() {
    const container = document.getElementById("my-products");
    if (!container) return;

    const ownProducts = state.publishedProducts.filter(
        (product) =>
            product.ownerEmail === normalizeEmail(state.currentUser?.email)
    );
    container.innerHTML = ownProducts.length
        ? ownProducts.map(buildProductCard).join("")
        : "<p class='empty-state'>Você ainda não publicou nenhum produto.</p>";
}

// GERENCIAMENTO DOS PRODUTOS PUBLICADOS PELO USUARIO
async function deleteProduct(productId) {
    const id = Number(productId);
    const product = state.publishedProducts.find((item) => item.id === id);
    if (
        !product ||
        product.ownerEmail !== normalizeEmail(state.currentUser?.email)
    )
        return;
    if (!window.confirm(`Excluir "${product.nome}"?`)) return;

    try {
        await apiRequest(`/products/${id}`, { method: "DELETE" });
    } catch (error) {
        showToast(error.message);
        return;
    }

    state.publishedProducts = state.publishedProducts.filter(
        (item) => item.id !== id
    );
    PRODUCTS = PRODUCTS.filter((item) => item.id !== id);
    state.cart = state.cart.filter((item) => item.id !== id);
    state.favorites = state.favorites.filter((item) => item !== id);
    saveState();
    renderHome();
    renderCatalog();
    renderFavorites();
    renderMyProducts();
    updateCartBadge();
    showToast("Anúncio excluído.");
}

function startEditProduct(productId) {
    const product = state.publishedProducts.find(
        (item) => item.id === Number(productId)
    );
    if (
        !product ||
        product.ownerEmail !== normalizeEmail(state.currentUser?.email)
    )
        return;
    state.pendingImages = [];
    const photoInput = document.getElementById("pub-fotos");
    if (photoInput) photoInput.value = "";
    editingProductId = product.id;
    showScreen("screen-publicar");
    const values = {
        "pub-nome": product.nome,
        "pub-marca": product.marca,
        "pub-cor": product.cor,
        "pub-desc": product.desc,
        "pub-preco": String(product.preco).replace(".", ","),
        "pub-aluguel-valor": product.aluguel || "",
        "pub-local": product.local,
        "pub-busto": product.measurements?.bust || "",
        "pub-cintura": product.measurements?.waist || "",
        "pub-quadril": product.measurements?.hip || "",
        "pub-comprimento": product.measurements?.length || "",
        "pub-caimento": product.measurements?.fit || "",
    };
    Object.entries(values).forEach(([id, value]) => {
        const field = document.getElementById(id);
        if (field) field.value = value;
    });
    ["pub-categoria", "pub-tamanho", "pub-condicao"].forEach((id) => {
        const field = document.getElementById(id);
        if (field)
            field.value =
                product[
                    id === "pub-categoria"
                        ? "categoria"
                        : id === "pub-tamanho"
                          ? "tamanho"
                          : "estado"
                ];
    });
    document.getElementById("pub-troca").checked = Boolean(product.troca);
    document.getElementById("pub-venda").checked = product.preco !== null;
    document.getElementById("pub-aluguel").checked = Boolean(product.aluguel);
    const existingImages = product.images?.length
        ? product.images
        : product.image
          ? [product.image]
          : [];
    const preview = document.getElementById("photo-preview");
    if (preview)
        preview.innerHTML = existingImages
            .map(
                (image, index) =>
                    `<img src="${escapeHtml(image)}" alt="Foto atual ${index + 1} do anúncio" />`
            )
            .join("");
    const quality = document.getElementById("photo-quality");
    if (quality)
        quality.innerHTML = `<strong>${existingImages.length} foto${existingImages.length === 1 ? "" : "s"} no anúncio</strong><ul><li>Selecione novas fotos somente se quiser substituir as atuais.</li></ul>`;
    showToast("Edite os dados e publique novamente.");
}

function getCartSubtotal() {
    return state.cart.reduce((sum, entry) => {
        const product = getProductById(entry.id);
        return (
            sum +
            (product && isForSale(product) ? product.preco * entry.qty : 0)
        );
    }, 0);
}

// CUPONS E CALCULO DO CARRINHO
function getCouponDiscount(subtotal = getCartSubtotal()) {
    const coupon = state.appliedCoupon && COUPONS[state.appliedCoupon];
    if (!coupon) return 0;
    return coupon.discount < 1
        ? subtotal * coupon.discount
        : Math.min(subtotal, coupon.discount);
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

// PEDIDOS E PERFIL DO USUARIO
function renderOrders() {
    const orders = document.getElementById("orders-list");
    if (!orders) return;

    const allOrders = state.orders;
    const ordersToRender = allOrders.filter((order) => {
        if (orderFilter === "todos") return true;
        if (orderFilter === "ativos") return order.status !== "cancelado";
        if (orderFilter === "cancelados") return order.status === "cancelado";
        return true;
    });

    orders.innerHTML = ordersToRender.length
        ? ordersToRender
              .map((order) => {
                  const isDemo = order.status === "demonstracao";
                  const isCancelled = order.status === "cancelado";
                  const status = isDemo
                      ? "Demonstração (sem pagamento)"
                      : isCancelled
                        ? "Cancelado"
                        : order.status;
                  return `
        <div class="card order-card">
            <h3>Pedido #${escapeHtml(order.id)}</h3>
            <p>${escapeHtml(order.items?.map((item) => item.name).join(", ") || order.name)} · Status: ${escapeHtml(status)}</p>
            <strong>${formatPrice(order.total)}</strong>
            ${isDemo ? `<p class="page-intro">Nenhuma cobrança ou envio foi feito. O estoque fica reservado apenas nesta demonstração.</p><div class="order-actions"><button class="btn btn-outline btn-sm" data-action="cancel-demo-order" data-id="${escapeHtml(order.id)}">Cancelar e liberar estoque</button></div>` : ""}
            ${isCancelled ? '<p class="page-intro">A reserva foi cancelada e o estoque foi liberado.</p>' : ""}
        </div>
    `;
              })
              .join("")
        : `<p class="empty-state">Nenhum pedido nesta categoria.</p>`;

    document.querySelectorAll(".order-filter").forEach((button) => {
        button.classList.toggle(
            "active",
            button.dataset.filter === orderFilter
        );
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
    const profileThemeStatus = document.getElementById("profile-theme-status");

    const user = state.currentUser || {
        nome: "Visitante",
        cidade: "Londrina, PR",
    };

    if (profileName) profileName.textContent = user.nome;
    if (profileCity) profileCity.textContent = user.cidade;
    if (avatar) {
        avatar.innerHTML = user.photo
            ? `<img src="${escapeHtml(user.photo)}" alt="Foto de perfil de ${escapeHtml(user.nome)}" />`
            : escapeHtml(user.nome.charAt(0).toUpperCase());
    }

    if (profileThemeStatus) {
        profileThemeStatus.textContent =
            state.settings.theme === "dark" ? "Escuro" : "Claro";
    }

    const firstname = document.getElementById("user-firstname");
    if (firstname) firstname.textContent = user.nome.split(" ")[0];
    document
        .querySelector(".seller-status")
        ?.classList.toggle("hidden", state.settings.seller !== true);
}

function renderCart() {
    const container = document.getElementById("cart-content");
    if (!container) return;

    state.cart = state.cart.filter((entry) =>
        isForSale(getProductById(entry.id))
    );

    if (!state.cart.length) {
        container.innerHTML =
            "<p class='empty-state'>Seu carrinho está vazio.</p>";
        return;
    }

    const items = state.cart
        .map((entry) => {
            const product = getProductById(entry.id);
            if (!product) return "";
            return `
            <div class="cart-item card">
                <div class="cart-item-left">
                    <div class="mini-emoji">${productVisual(product, "cart-product-photo")}</div>
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
        })
        .join("");

    const subtotal = getCartSubtotal();
    const discount = getCouponDiscount(subtotal);
    const total = subtotal - discount;
    const couponOptions = Object.entries(COUPONS)
        .map(
            ([code, coupon]) =>
                `<option value="${escapeHtml(code)}" ${state.appliedCoupon === code ? "selected" : ""}>${escapeHtml(code)} - ${escapeHtml(coupon.label)}</option>`
        )
        .join("");
    const couponPicker = couponOptions
        ? `<select id="coupon-select" aria-label="Escolher cupom"><option value="">Escolher cupom disponível</option>${couponOptions}</select>`
        : "";

    container.innerHTML = `
        ${items}
        <div class="summary-box card">
            <div class="coupon-row">${couponPicker}<input id="coupon-input" placeholder="Cupom de desconto" /><button type="button" class="btn btn-outline btn-sm" data-action="apply-coupon">Aplicar</button></div>
            ${state.appliedCoupon ? `<div class="summary-row coupon-applied"><span>${escapeHtml(state.appliedCoupon)} <button type="button" data-action="remove-coupon">Remover</button></span><strong>-${formatPrice(discount)}</strong></div>` : ""}
            <div class="summary-row"><span>Subtotal</span><strong>${formatPrice(subtotal)}</strong></div>
            <div class="summary-row"><span>Frete</span><strong>Grátis</strong></div>
            <div class="summary-row total"><span>Total</span><strong>${formatPrice(total)}</strong></div>
            <button class="btn btn-primary btn-full" type="button" data-action="start-checkout">Finalizar compra</button>
        </div>
    `;

    document
        .getElementById("coupon-select")
        ?.addEventListener("change", (event) => {
            const input = document.getElementById("coupon-input");
            if (input) input.value = event.target.value;
        });
}

// CHECKOUT, DADOS PESSOAIS E CONFIGURACOES
function renderCheckout() {
    const container = document.getElementById("checkout-content");
    if (!container) return;

    const total = getCartSubtotal() - getCouponDiscount();

    container.innerHTML = `
        <form class="card checkout-card" id="checkout-form">
            <p class="page-intro">Demonstração: nenhum pagamento ou envio real será realizado. O estoque será reservado localmente até o cancelamento.</p>
            <h3>Resumo do pedido</h3>
            <div class="summary-row"><span>Itens</span><strong>${state.cart.reduce((sum, item) => sum + item.qty, 0)}</strong></div>
            <div class="summary-row total"><span>Total</span><strong>${formatPrice(total)}</strong></div>
            <button class="btn btn-primary btn-full" type="submit">Registrar pedido de demonstração</button>
        </form>
    `;
    document
        .getElementById("checkout-form")
        ?.addEventListener("submit", finalizePurchase);
}

function fillPersonalDataForm() {
    const user = state.currentUser || {};
    const values = {
        "dados-nome": user.nome || "",
        "dados-cidade": user.cidade || "",
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

    if (!state.currentUser?.id) {
        showToast("Entre em uma conta para registrar o pedido.");
        showScreen("screen-login");
        return;
    }

    renderCheckout();
    showScreen("screen-checkout");
}

async function handlePersonalData(event) {
    event.preventDefault();
    const user = state.currentUser || {};
    user.nome = document.getElementById("dados-nome")?.value.trim();
    user.cidade = document.getElementById("dados-cidade")?.value.trim();
    if (!user.nome || !user.cidade) {
        showToast("Informe seu nome e cidade.");
        return;
    }

    if (state.currentUser?.id) {
        try {
            const account = await apiRequest("/auth/profile", {
                method: "PATCH",
                body: JSON.stringify({ nome: user.nome, cidade: user.cidade }),
            });
            Object.assign(user, account);
        } catch (error) {
            showToast(error.message);
            return;
        }
    }
    state.currentUser = user;
    saveState();
    applyLoggedUser();
    renderProfile();
    showScreen("screen-perfil");
}

function fillSettingsForm() {
    const language = document.getElementById("setting-language");
    const currencySelect = document.getElementById("setting-currency");
    const payment = document.getElementById("setting-payment");
    const seller = document.getElementById("setting-seller");
    const theme = document.getElementById("setting-theme");
    if (language) language.value = state.settings.language;
    if (currencySelect) currencySelect.value = state.settings.currency;
    if (payment) payment.value = state.settings.payment;
    if (seller) seller.checked = state.settings.seller === true;
    if (theme) theme.value = state.settings.theme || "light";
}

function fillThemeForm() {
    const themeMode = document.getElementById("theme-mode");
    if (themeMode) themeMode.value = state.settings.theme || "light";
}

function handleSettings(event) {
    event.preventDefault();
    state.settings.language =
        document.getElementById("setting-language")?.value || "pt-BR";
    state.settings.currency =
        document.getElementById("setting-currency")?.value || "BRL";
    state.settings.payment =
        document.getElementById("setting-payment")?.value || "Pix";
    state.settings.seller = Boolean(
        document.getElementById("setting-seller")?.checked
    );
    state.settings.notifications = Boolean(
        document.getElementById("setting-notifications")?.checked
    );
    state.settings.theme =
        document.getElementById("setting-theme")?.value || "light";
    document.documentElement.lang = state.settings.language;
    const notifications = document.getElementById("setting-notifications");
    if (notifications)
        notifications.checked = state.settings.notifications !== false;
    updateCurrency();
    applyTranslations();
    applyTheme();
    saveState();
    renderHome();
    renderCatalog();
    renderCart();
    renderOrders();
    showToast("Configurações salvas!");
}

async function handleOrderAction(action, orderId) {
    if (action !== "cancel-demo-order") {
        showToast(
            "Rastreio e entrega ficam indisponíveis enquanto o pedido for uma demonstração."
        );
        return;
    }
    try {
        const order = await apiRequest(
            `/orders/${encodeURIComponent(orderId)}/cancel`,
            { method: "PATCH" }
        );
        state.orders = state.orders.map((item) =>
            String(item.id) === String(orderId) ? order : item
        );
        await loadProductsFromApi();
        saveState();
        renderOrders();
        renderHome();
        showToast("Pedido cancelado. O estoque foi liberado.");
    } catch (error) {
        showToast(error.message);
    }
}

function submitOrderReview(event) {
    event.preventDefault();
    const form = event.target;
    const order = state.orders.find(
        (item) => String(item.id) === form.dataset.orderId
    );
    const rating = Number(new FormData(form).get("rating"));
    const text = String(new FormData(form).get("text") || "").trim();
    if (!order || Number(order.stage) < 3 || order.rating) {
        showToast("Esta compra não está disponível para avaliação.");
        return;
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        showToast("Selecione uma nota de 1 a 5.");
        return;
    }
    order.rating = rating;
    order.review = text;
    (order.items || []).forEach((item) => {
        if (item.seller)
            state.reviews.push({
                orderId: order.id,
                productId: item.id,
                seller: item.seller,
                author: state.currentUser?.nome || "Comprador",
                rating,
                text,
                createdAt: new Date().toISOString(),
            });
    });
    saveState();
    renderOrders();
    showToast("Avaliação publicada no perfil do vendedor.");
}

// DETALHES DO PRODUTO, VENDEDOR E CHAT
function renderDetails(productId) {
    const container = document.getElementById("detalhes-content");
    if (!container) return;

    const product = getProductById(productId);
    if (!product) {
        updateSeo("screen-detalhes");
        container.innerHTML =
            "<p class='empty-state'>Produto não encontrado.</p>";
        return;
    }

    updateSeo("screen-detalhes", product);

    const recommendedProducts = PRODUCTS.filter(
        (item) => item.id !== product.id
    )
        .sort((first, second) => {
            const score = (candidate) =>
                Number(
                    normalizeCategory(candidate.categoria) ===
                        normalizeCategory(product.categoria)
                ) *
                    3 +
                Number(candidate.tamanho === product.tamanho) * 2 +
                Number(candidate.local === product.local) +
                Number(candidate.rating || 0) / 10;
            return score(second) - score(first);
        })
        .slice(0, 4);

    const measurements = product.measurements || {};
    const measurementValues = [
        ["Busto", measurements.bust],
        ["Cintura", measurements.waist],
        ["Quadril", measurements.hip],
        ["Comprimento", measurements.length],
    ].filter(([, value]) => Number(value) > 0);
    const productImages = product.images?.length
        ? product.images
        : product.image
          ? [product.image]
          : [];
    container.innerHTML = `
        <div class="details-card card">
            <div class="detail-gallery">${productImages.length ? productImages.map((image, index) => `<img class="details-photo" src="${escapeHtml(image)}" alt="${escapeHtml(product.nome)} - foto ${index + 1}" loading="lazy" />`).join("") : productVisual(product, "details-photo")}</div>
            <h1>${escapeHtml(product.nome)}</h1>
            <p class="details-meta">${escapeHtml(product.categoria)} · ${escapeHtml(product.tamanho)} · ${escapeHtml(product.cor)}</p>
            <div class="price-row big">
                <strong>${isForSale(product) ? formatPrice(product.preco) : product.aluguel ? `${formatPrice(product.aluguel)}/dia` : "Disponível para troca"}</strong>
                ${isForSale(product) && product.aluguel ? `<span>${formatPrice(product.aluguel)}/dia</span>` : ""}
            </div>
            <p>${escapeHtml(product.desc)}</p>
            <div class="details-info">
                <span>Estado: ${escapeHtml(product.estado)}</span>
                <span>Vendedor: ${escapeHtml(product.vendedor)}</span>
                <span>Local: ${escapeHtml(product.local)}</span>
            </div>
            ${measurementValues.length || measurements.fit ? `<section class="fit-details"><h2>Medidas e caimento</h2>${measurementValues.length ? `<dl>${measurementValues.map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)} cm</dd></div>`).join("")}</dl>` : ""}${measurements.fit ? `<p>${escapeHtml(measurements.fit)}</p>` : ""}<small>Compare com uma peça sua para escolher com mais segurança.</small></section>` : ""}
            <div class="btn-row">
                <button class="btn btn-outline" data-action="view-seller" data-id="${product.id}">Ver perfil do vendedor</button>
                <button class="btn btn-outline" data-action="toggle-favorite" data-id="${product.id}">Favoritar</button>
                ${isForSale(product) ? `<button class="btn btn-primary" data-action="add-cart" data-id="${product.id}">Adicionar ao carrinho</button>` : `<p class="page-intro">${product.aluguel ? "Reservas de aluguel ainda não estão disponíveis." : "Propostas de troca ainda não estão disponíveis."}</p>`}
            </div>
        </div>
        <section class="recommendations">
            <h2 class="page-title">Você também pode gostar</h2>
            <div class="products-grid">${recommendedProducts.map(buildProductCard).join("")}</div>
        </section>
    `;
}

function renderSellerProfile(productId) {
    const container = document.getElementById("vendedor-content");
    const product = getProductById(productId);
    if (!container || !product) return;

    const sellerProducts = PRODUCTS.filter(
        (item) => item.vendedor === product.vendedor
    );
    const metrics = getSellerMetrics(product.vendedor);
    container.innerHTML = `
        <button class="btn btn-outline seller-back" data-action="back-to-details" data-id="${product.id}">
            <i class="fa-solid fa-arrow-left"></i> Voltar ao produto
        </button>
        <section class="seller-profile card">
            <div class="seller-avatar">${escapeHtml(product.vendedor.charAt(0).toUpperCase())}</div>
            <h1>${escapeHtml(product.vendedor)}</h1>
            <p>${escapeHtml(product.local)}</p>
            <div class="profile-rating">${metrics.rating ? `★ ${metrics.rating}` : "Sem avaliações verificadas"} · <span>${metrics.completedSales} vendas concluídas</span></div>
            <p class="seller-response">Mensagens enviadas por este chat ficam ligadas ao anúncio.</p>
            ${metrics.reviews.length ? `<section class="seller-reviews"><h2>Avaliações de compradores</h2>${metrics.reviews.map((review) => `<article><strong>★ ${review.rating} · ${escapeHtml(review.author || "Comprador")}</strong><p>${escapeHtml(review.text || "Compra concluída.")}</p></article>`).join("")}</section>` : `<p class="seller-response">As avaliações dos pedidos concluídos aparecerão aqui.</p>`}
            ${product.ownerId && Number(product.ownerId) !== Number(state.currentUser?.id) ? `<button class="btn btn-primary" data-action="open-chat" data-id="${product.id}" data-user-id="${product.ownerId}"><i class="fa-regular fa-comments"></i> Abrir chat</button>` : `<p class="seller-response">${product.ownerId ? "Veja as conversas recebidas na área de mensagens." : "Chat indisponível para este anúncio de demonstração."}</p>`}
        </section>
        <section class="recommendations">
            <h2 class="page-title">Produtos deste vendedor</h2>
            <div class="products-grid">${sellerProducts.map(buildProductCard).join("")}</div>
        </section>
    `;
}

async function renderChat(productId, otherUserId) {
    const container = document.getElementById("chat-content");
    const product = getProductById(productId);
    if (!container || !product) return;
    if (!state.currentUser?.id) {
        showToast("Entre em uma conta para acessar as mensagens.");
        showScreen("screen-login");
        return;
    }
    if (!product.ownerId) {
        container.innerHTML =
            '<p class="empty-state">Chat indisponível para este anúncio de demonstração.</p>';
        return;
    }

    const isSeller = Number(product.ownerId) === Number(state.currentUser.id);
    const conversationUserId = Number(
        otherUserId || (isSeller ? 0 : product.ownerId)
    );
    if (!conversationUserId) {
        container.innerHTML =
            '<p class="empty-state">Abra uma conversa recebida para responder ao comprador.</p>';
        return;
    }
    let messages;
    try {
        messages = await apiRequest(
            `/messages?productId=${encodeURIComponent(product.id)}&otherUserId=${conversationUserId}`
        );
    } catch (error) {
        container.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
        return;
    }
    const conversation = state.conversations.find(
        (item) =>
            Number(item.productId) === Number(product.id) &&
            Number(item.otherUserId) === conversationUserId
    );
    const conversationName = isSeller
        ? conversation?.otherName || "Comprador"
        : product.vendedor;
    container.innerHTML = `
        <button class="btn btn-outline chat-back" data-action="back-to-seller" data-id="${product.id}">
            <i class="fa-solid fa-arrow-left"></i> Voltar ao perfil
        </button>
        <section class="chat-window card">
            <header class="chat-header">
                <div class="seller-avatar">${escapeHtml(conversationName.charAt(0).toUpperCase())}</div>
                <div>
                    <h1>Chat com ${escapeHtml(conversationName)}</h1>
                    <p>Sobre: ${escapeHtml(product.nome)}</p>
                </div>
            </header>
            <div class="chat-messages">
                ${
                    messages.length
                        ? messages
                              .map(
                                  (item) => `
                    <div class="chat-bubble ${Number(item.sender_id) === Number(state.currentUser.id) ? "buyer" : "seller"}">
                        <p>${escapeHtml(item.body)}</p>
                        <small>${Number(item.sender_id) === Number(state.currentUser.id) ? "Você" : escapeHtml(item.sender_name)}</small>
                    </div>
                `
                              )
                              .join("")
                        : '<p class="empty-state">Nenhuma mensagem ainda. Inicie a conversa.</p>'
                }
            </div>
            <form class="seller-message-form" data-product-id="${product.id}" data-user-id="${conversationUserId}">
                <div class="input-group">
                    <label for="seller-message">Mensagem</label>
                    <textarea id="seller-message" rows="3" required placeholder="Digite sua mensagem..."></textarea>
                </div>
                <button class="btn btn-primary" type="submit"><i class="fa-regular fa-paper-plane"></i> Enviar</button>
            </form>
        </section>
    `;
}

function updateMessageBadge() {
    const badge = document.getElementById("message-count");
    if (!badge) return;
    const total = state.conversations.length;
    badge.textContent = String(total);
    badge.classList.toggle("hidden", total < 1);
}

async function renderMessages() {
    const container = document.getElementById("messages-list");
    if (!container) return;
    if (!state.currentUser?.id) {
        state.conversations = [];
        container.innerHTML =
            '<p class="empty-state">Entre em uma conta para ver suas conversas.</p>';
        updateMessageBadge();
        return;
    }
    try {
        state.conversations = await apiRequest("/conversations");
    } catch (error) {
        container.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
        return;
    }
    container.innerHTML = state.conversations.length
        ? state.conversations
              .map((conversation) => {
                  return `
            <button class="message-conversation" data-action="open-chat" data-id="${conversation.productId}" data-user-id="${conversation.otherUserId}">
                <span class="seller-avatar">${escapeHtml(conversation.otherName.charAt(0).toUpperCase())}</span>
                <span class="message-conversation-body">
                    <strong>${escapeHtml(conversation.otherName)}</strong>
                    <small>${escapeHtml(conversation.productName)}</small>
                    <span>${escapeHtml(conversation.message)}</span>
                </span>
                <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
            </button>
        `;
              })
              .join("")
        : '<p class="empty-state">Você ainda não conversou com nenhum vendedor.</p>';
    updateMessageBadge();
}

async function handleSellerMessage(event) {
    event.preventDefault();
    const form = event.target;
    const message = form.querySelector("textarea")?.value.trim();
    if (!message) return;
    const productId = Number(form.dataset.productId);
    const otherUserId = Number(form.dataset.userId);
    try {
        await apiRequest("/messages", {
            method: "POST",
            body: JSON.stringify({ productId, otherUserId, message }),
        });
    } catch (error) {
        showToast(error.message);
        return;
    }
    form.reset();
    await renderMessages();
    await renderChat(productId, otherUserId);
    showToast("Mensagem enviada ao outro participante.");
}

// NAVEGACAO, MENU, FILTROS E BUSCA
function filterByCategory(category) {
    state.filters.categoria = category;
    const categoriaSelect = document.getElementById("f-categoria");
    if (categoriaSelect) categoriaSelect.value = category;
    document.getElementById("side-menu")?.classList.add("hidden");
    document.getElementById("notification-panel")?.classList.add("hidden");
    showScreen("screen-catalogo", { keepFilters: true });
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

    const isOpening = panel.classList.contains("hidden");
    panel.classList.toggle("hidden");
    if (isOpening) renderNotifications();
}

function markAllNotificationsRead() {
    state.notifications.forEach((notification) => {
        notification.read = true;
    });
    saveState();
    renderNotifications();
    showToast("Todas as notificações foram marcadas como lidas.");
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
        ordenar: "recentes",
    };

    document.getElementById("search-input").value = "";
    document.getElementById("f-categoria").value = "";
    document.getElementById("f-tamanho").value = "";
    document.getElementById("f-modalidade").value = "";
    document.getElementById("f-estado").value = "";
    document.getElementById("f-preco-min").value = "";
    document.getElementById("f-preco-max").value = "";
    document.getElementById("f-local").value = "";
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
    const precoMin = document.getElementById("f-preco-min");
    const precoMax = document.getElementById("f-preco-max");
    const local = document.getElementById("f-local");
    const ordenar = document.getElementById("f-ordenar");

    state.filters.search = searchInput ? searchInput.value : "";
    state.filters.categoria = categoria ? categoria.value : "";
    state.filters.tamanho = tamanho ? tamanho.value : "";
    state.filters.modalidade = modalidade ? modalidade.value : "";
    state.filters.estado = estado ? estado.value : "";
    state.filters.precoMin = precoMin ? precoMin.value : "";
    state.filters.precoMax = precoMax ? precoMax.value : "";
    state.filters.local = local ? local.value : "";
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
    showScreen("screen-catalogo", { keepFilters: true });
    renderCatalog();
    saveState();
}

// FAVORITOS, CARRINHO E FINALIZACAO DA COMPRA
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
    updateFavoriteBadge();
    saveState();
}

function addToCart(productId) {
    const id = Number(productId);
    const product = getProductById(id);
    if (!product || !isForSale(product)) {
        showToast("Este anúncio não está disponível para venda.");
        return;
    }
    if (Number(product.stock || 0) < 1) {
        showToast("Esta peça não está disponível.");
        return;
    }
    const item = state.cart.find((entry) => entry.id === id);

    if (item) {
        if (item.qty >= Number(product.stock || 1)) {
            showToast("Você atingiu o limite disponível desta peça.");
            return;
        }
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

    const product = getProductById(productId);
    if (direction === "increase") {
        if (product && item.qty >= Number(product.stock || 1)) {
            showToast("Você atingiu o limite disponível desta peça.");
            return;
        }
        item.qty += 1;
    } else item.qty -= 1;

    if (item.qty <= 0) {
        state.cart = state.cart.filter(
            (entry) => entry.id !== Number(productId)
        );
    }

    updateCartBadge();
    renderCart();
    renderCheckout();
    saveState();
}

async function finalizePurchase(event) {
    event?.preventDefault();
    if (!state.cart.length) {
        showToast("Seu carrinho está vazio.");
        return;
    }
    if (!state.currentUser?.id) {
        showToast("Entre em uma conta para registrar o pedido.");
        showScreen("screen-login");
        return;
    }

    state.pendingOrderKey ||=
        window.crypto?.randomUUID?.() ||
        `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    saveState();
    let order;
    try {
        order = await apiRequest("/orders", {
            method: "POST",
            headers: { "Idempotency-Key": state.pendingOrderKey },
            body: JSON.stringify({
                items: state.cart.map((item) => ({
                    productId: item.id,
                    qty: item.qty,
                })),
                couponCode: state.appliedCoupon,
            }),
        });
    } catch (error) {
        showToast(error.message);
        if (error.status === 409) {
            await loadProductsFromApi();
            renderCart();
        }
        if (error.status === 401) showScreen("screen-login");
        return;
    }

    state.orders.unshift(order);
    state.cart = [];
    state.appliedCoupon = null;
    state.pendingOrderKey = null;
    updateCartBadge();
    renderCart();
    renderCheckout();
    await loadProductsFromApi();
    await loadOrdersFromApi();
    addNotification(
        "Pedido de demonstração",
        `O pedido #${order.id} foi salvo no servidor; nenhum pagamento ou envio foi realizado.`
    );
    saveState();
    showScreen("screen-pedidos");
    showToast("Pedido de demonstração salvo. Nenhum pagamento foi realizado.");
}

// LOGIN, CADASTRO, RECUPERACAO E SAIDA
function navTo(element, screen) {
    document
        .querySelectorAll(".nav-item")
        .forEach((item) => item.classList.toggle("active", item === element));
    showScreen(screen);
}

function loginDemo() {
    state.currentUser = {
        nome: "Visitante",
        email: "visitor@demo.local",
        cidade: "Londrina, PR",
    };
    activateUserData();
    saveState();
    applyLoggedUser();
    renderProfile();
    showToast("Entrando como visitante");
    showScreen("screen-home");
}

async function handleLogin(event) {
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

    let user;
    try {
        user = await apiRequest("/auth/login", {
            method: "POST",
            body: JSON.stringify({ email, senha }),
        });
    } catch (error) {
        setLoginError(error.message);
        showToast(error.message);
        if (emailInput) emailInput.setCustomValidity(error.message);
        if (senhaInput) senhaInput.setCustomValidity(error.message);
        return;
    }

    if (emailInput) emailInput.setCustomValidity("");
    if (senhaInput) senhaInput.setCustomValidity("");
    setLoginError("");
    state.currentUser = user;
    activateUserData();
    await loadOrdersFromApi();
    await renderMessages();
    saveState();
    applyLoggedUser();
    renderProfile();
    showScreen("screen-home");
    showToast("Login realizado com sucesso!");
}

async function handleCadastro(event) {
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

    if (senha.length < 8) {
        showToast("A senha deve ter pelo menos 8 caracteres.");
        return;
    }

    if (senha !== confirma) {
        showToast("As senhas não conferem.");
        return;
    }

    try {
        state.currentUser = await apiRequest("/auth/register", {
            method: "POST",
            body: JSON.stringify({ nome, email, senha, cidade }),
        });
    } catch (error) {
        showToast(error.message);
        return;
    }
    activateUserData();
    await loadOrdersFromApi();
    await renderMessages();

    saveState();
    showToast("Cadastro realizado com sucesso!");
    document.getElementById("form-cadastro")?.reset();
    applyLoggedUser();
    renderProfile();
    showScreen("screen-home");
}

async function handleRecover(event) {
    event.preventDefault();
    const emailInput = document.getElementById("recover-email");
    const email = normalizeEmail(emailInput?.value);

    if (!email) {
        showToast("Informe um e-mail válido.");
        if (emailInput) emailInput.focus();
        return;
    }

    try {
        await apiRequest("/auth/recover", {
            method: "POST",
            body: JSON.stringify({ email }),
        });
    } catch (error) {
        showToast(error.message);
        return;
    }

    showToast(
        "Se a conta existir, enviaremos um link de recuperação para o e-mail informado."
    );
    event.target.reset();
    showScreen("screen-login");
}

async function handlePasswordReset(event) {
    event.preventDefault();
    const token = new URLSearchParams(window.location.search).get("resetToken");
    const passwordInput = document.getElementById("reset-password");
    const confirmInput = document.getElementById("reset-password-confirm");
    const errorMessage = document.getElementById("reset-error");
    const password = passwordInput?.value || "";

    if (!token) {
        if (errorMessage) {
            errorMessage.textContent =
                "Este link não é válido. Solicite uma nova recuperação de senha.";
            errorMessage.classList.remove("hidden");
        }
        return;
    }
    if (password.length < 8 || password.length > 128) {
        if (passwordInput)
            passwordInput.setCustomValidity(
                "Use uma senha de 8 a 128 caracteres."
            );
        passwordInput?.reportValidity();
        return;
    }
    if (password !== confirmInput?.value) {
        if (confirmInput)
            confirmInput.setCustomValidity("As senhas não conferem.");
        confirmInput?.reportValidity();
        return;
    }

    try {
        await apiRequest("/auth/reset", {
            method: "POST",
            body: JSON.stringify({ token, senha: password }),
        });
    } catch (error) {
        if (errorMessage) {
            errorMessage.textContent = error.message;
            errorMessage.classList.remove("hidden");
        }
        return;
    }

    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("resetToken");
    cleanUrl.hash = "screen-login";
    window.history.replaceState({}, "", cleanUrl);
    event.target.reset();
    if (errorMessage) errorMessage.classList.add("hidden");
    showScreen("screen-login", { replace: true });
    showToast("Senha alterada. Entre com a nova senha.");
}

function handleSupport(event) {
    event.preventDefault();
    const subject = document.getElementById("support-subject")?.value;
    const message = document.getElementById("support-message")?.value.trim();
    if (!message) return;

    state.supportMessages.push({
        subject,
        message,
        createdAt: new Date().toISOString(),
    });
    saveState();
    event.target.reset();
    showToast("Mensagem enviada para o suporte!");
}

function goBack() {
    if (screenHistory.length > 1) {
        screenHistory.pop();
        const previousScreen =
            screenHistory[screenHistory.length - 1] || "screen-home";
        showScreen(previousScreen, { fromHistory: true });
        return;
    }

    showScreen("screen-home");
}

async function logout() {
    saveState();
    try {
        await apiRequest("/auth/logout", { method: "POST" });
    } catch {
        showToast("Não foi possível confirmar a saída no servidor.");
    }
    state.currentUser = null;
    activateUserData();
    saveState();
    renderProfile();
    showToast("Você saiu da conta.");
    showScreen("screen-login");
}

function resetPublishForm() {
    const form = document.getElementById("form-publicar");
    const preview = document.getElementById("photo-preview");

    if (!editingProductId) form?.reset();
    if (preview) preview.innerHTML = "";
    if (!editingProductId) state.pendingImages = [];
    if (!editingProductId) {
        const quality = document.getElementById("photo-quality");
        if (quality)
            quality.innerHTML =
                "<strong>Guia de fotos</strong><ul><li>Use um fundo simples e boa iluminação.</li><li>Inclua frente, costas e etiqueta/tamanho.</li><li>Mostre de perto qualquer detalhe ou desgaste.</li></ul>";
    }
}

// TROCA DE TELAS E CONTROLE DOS EVENTOS DA APLICACAO
function showScreen(screenId, options = {}) {
    if (
        screenId === "screen-checkout" &&
        (!state.cart.length || !state.currentUser?.id)
    ) {
        startCheckout();
        return;
    }

    document.getElementById("side-menu")?.classList.add("hidden");
    document.getElementById("notification-panel")?.classList.add("hidden");

    if (screenId === "screen-catalogo" && !options.keepFilters) clearFilters();
    document
        .getElementById("app-header-brand")
        ?.classList.toggle("hidden", screenId === "screen-home");
    if (screenId === "screen-dados") fillPersonalDataForm();
    if (screenId === "screen-publicar") resetPublishForm();
    if (screenId === "screen-tema") fillThemeForm();
    updateSeo(screenId);

    if (
        !options.fromHistory &&
        appScreens.includes(screenId) &&
        !authScreens.includes(screenId)
    ) {
        const lastScreen = screenHistory[screenHistory.length - 1];
        if (lastScreen !== screenId) {
            screenHistory.push(screenId);
        }
    }

    if (options.url) {
        const method = options.replace ? "replaceState" : "pushState";
        window.history[method]({ screenId }, "", options.url);
    } else if (
        !options.fromHistory &&
        window.location.hash !== `#${screenId}`
    ) {
        const method = options.replace ? "replaceState" : "pushState";
        window.history[method]({ screenId }, "", `#${screenId}`);
    }

    const screens = document.querySelectorAll(".screen");
    screens.forEach((screen) => {
        const isActive = screen.id === screenId;
        screen.classList.toggle("active", isActive);
    });

    const app = document.getElementById("app");
    if (app) {
        const shouldShowApp = appScreens.includes(screenId);
        app.classList.toggle("hidden", !shouldShowApp);
    }

    const backButton = document.getElementById("btn-back");
    if (backButton) {
        const shouldShowBack =
            appScreens.includes(screenId) &&
            screenHistory.length > 1 &&
            screenId !== "screen-home";
        backButton.classList.toggle("hidden", !shouldShowBack);
    }

    if (
        screenId === "screen-login" ||
        screenId === "screen-cadastro" ||
        screenId === "screen-recuperar"
    ) {
        document
            .querySelectorAll(".nav-item")
            .forEach((item) => item.classList.remove("active"));
    }

    const navItem = document.querySelector(
        `.nav-item[data-screen="${screenId}"]`
    );
    if (navItem) {
        document
            .querySelectorAll(".nav-item")
            .forEach((item) =>
                item.classList.toggle("active", item === navItem)
            );
    }
}

function handleGlobalActionClick(event) {
    const screenTrigger = event.target.closest("[data-screen]");
    if (screenTrigger) {
        event.preventDefault();
        const targetScreen = screenTrigger.dataset.screen;
        if (targetScreen) {
            showScreen(targetScreen);
            if (targetScreen === "screen-mensagens") renderMessages();
        }
        return;
    }

    const infoTrigger = event.target.closest("[data-info]");
    if (infoTrigger) {
        event.preventDefault();
        showInfoDialog(
            infoTrigger.dataset.info,
            infoTrigger.dataset.infoText || ""
        );
        return;
    }

    const demoLoginTrigger = event.target.closest("[data-demo-login]");
    if (demoLoginTrigger) {
        event.preventDefault();
        loginDemo();
        return;
    }

    const button = event.target.closest("[data-action]");
    if (!button) {
        handlePanelDismissal(event);
        return;
    }

    const action = button.dataset.action;
    const id = button.dataset.id;
    const userId = button.dataset.userId;
    const category = button.dataset.category;
    const filter = button.dataset.filter;
    const coupon = button.dataset.coupon;

    if (action === "add-cart") addToCart(id);
    if (action === "start-checkout") startCheckout();
    if (action === "apply-coupon") applyCoupon();
    if (action === "remove-coupon") removeCoupon();
    if (action === "use-coupon") useCoupon(coupon);
    if (action === "close-info-dialog") closeInfoDialog();
    if (action === "toggle-menu") toggleMenu();
    if (action === "toggle-notifications") toggleNotifications();
    if (action === "mark-all-notifications-read") markAllNotificationsRead();
    if (action === "toggle-filters") toggleFilters();
    if (action === "clear-filters") clearFilters();
    if (action === "logout") void logout();
    if (action === "details") openProductDetails(id);
    if (action === "view-seller") {
        showScreen("screen-vendedor");
        renderSellerProfile(id);
    }
    if (action === "back-to-details") {
        showScreen("screen-detalhes");
        renderDetails(id);
    }
    if (action === "open-chat") {
        showScreen("screen-chat");
        renderChat(id, userId);
    }
    if (action === "back-to-seller") {
        showScreen("screen-vendedor");
        renderSellerProfile(id);
    }
    if (action === "toggle-favorite") toggleFavorite(id);
    if (action === "edit-product") startEditProduct(id);
    if (action === "delete-product") deleteProduct(id);
    if (action === "increase-qty") changeQty(id, "increase");
    if (action === "decrease-qty") changeQty(id, "decrease");
    if (action === "filter-category") filterByCategory(category);
    if (action === "filter-orders") filterOrders(filter);
    if (action === "save-search") saveCurrentSearch();
    if (action === "apply-saved-search") applySavedSearch(id);
    if (action === "delete-saved-search") {
        state.savedSearches = state.savedSearches.filter(
            (search) => search.id !== id
        );
        saveState();
        renderSavedSearches();
    }
    if (action === "share-wishlist") shareWishlist();
    if (action === "open-notification-product") {
        const notification = state.notifications.find(
            (item) => Number(item.productId) === Number(id)
        );
        if (notification) {
            notification.read = true;
            saveState();
            updateNotificationBadge();
        }
        openProductDetails(id);
    }
    if (["track-order", "cancel-demo-order"].includes(action)) {
        handleOrderAction(action, id);
    }

    handlePanelDismissal(event);
}

function handlePanelDismissal(event) {
    if (
        !event.target.closest("#side-menu") &&
        !event.target.closest("#btn-menu") &&
        !event.target.closest(".side-menu-nav button")
    ) {
        document.getElementById("side-menu")?.classList.add("hidden");
    }

    if (
        !event.target.closest("#notification-panel") &&
        !event.target.closest("#btn-notify")
    ) {
        document.getElementById("notification-panel")?.classList.add("hidden");
    }
}

function handleGlobalKeyboardShortcuts(event) {
    const notification = event.target.closest(
        '.notification-item[data-action="open-notification-product"]'
    );
    if (notification && ["Enter", " "].includes(event.key)) {
        event.preventDefault();
        notification.click();
        return;
    }
    const card = event.target.closest(".product-card");
    if (!card || event.target !== card || !["Enter", " "].includes(event.key))
        return;

    event.preventDefault();
    openProductDetails(card.dataset.id);
}

function bindNavigationControls() {
    const btnBack = document.getElementById("btn-back");
    if (btnBack) btnBack.addEventListener("click", goBack);

    const btnMenu = document.getElementById("btn-menu");
    if (btnMenu) btnMenu.addEventListener("click", toggleMenu);

    const btnNotify = document.getElementById("btn-notify");
    if (btnNotify) btnNotify.addEventListener("click", toggleNotifications);
}

function bindFilterInputs() {
    const searchInput = document.getElementById("search-input");
    const catalogFilterInputs = [
        document.getElementById("f-categoria"),
        document.getElementById("f-tamanho"),
        document.getElementById("f-modalidade"),
        document.getElementById("f-estado"),
        document.getElementById("f-preco-min"),
        document.getElementById("f-preco-max"),
        document.getElementById("f-local"),
        document.getElementById("f-ordenar"),
    ].filter(Boolean);

    if (searchInput) searchInput.addEventListener("input", applyFilters);
    catalogFilterInputs.forEach((filterInput) => {
        filterInput.addEventListener(
            filterInput.tagName === "SELECT" ? "change" : "input",
            applyFilters
        );
    });
}

function bindFormListeners() {
    const formLogin = document.getElementById("form-login");
    const formCadastro = document.getElementById("form-cadastro");
    const formRecover = document.getElementById("form-recuperar");
    const formReset = document.getElementById("form-reset");
    const formHomeSearch = document.getElementById("home-search-form");
    const formPublicar = document.getElementById("form-publicar");
    const formPersonalData = document.getElementById("form-dados");
    const formSettings = document.getElementById("form-configuracoes");
    const formTema = document.getElementById("form-tema");
    const formSuporte = document.getElementById("form-suporte");
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
    if (formReset) formReset.addEventListener("submit", handlePasswordReset);
    if (formHomeSearch)
        formHomeSearch.addEventListener("submit", searchFromHome);
    if (formPersonalData)
        formPersonalData.addEventListener("submit", handlePersonalData);
    if (formSettings) {
        fillSettingsForm();
        formSettings.addEventListener("submit", handleSettings);
    }
    if (formTema) {
        fillThemeForm();
        formTema.addEventListener("submit", handleTheme);
    }
    if (formSuporte) formSuporte.addEventListener("submit", handleSupport);

    if (cardToggle && cardFields) {
        cardToggle.addEventListener("change", () =>
            cardFields.classList.toggle("hidden", !cardToggle.checked)
        );
    }

    if (profilePhotoInput) {
        profilePhotoInput.addEventListener("change", () => {
            const file = profilePhotoInput.files?.[0];
            if (!file) return;

            const reader = new FileReader();
            reader.addEventListener("load", () => {
                if (!state.currentUser)
                    state.currentUser = { nome: "Visitante" };
                state.currentUser.photo = reader.result;
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
                savedAt: new Date().toISOString(),
            });
            saveState();
            showToast("Rascunho salvo neste navegador.");
        });
    }

    if (formPublicar) {
        formPublicar.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (!state.currentUser?.id) {
                showToast("Entre em uma conta para publicar anúncios.");
                showScreen("screen-login");
                return;
            }
            const name = document.getElementById("pub-nome")?.value.trim();
            const description = document
                .getElementById("pub-desc")
                ?.value.trim();
            const priceValue =
                document.getElementById("pub-preco")?.value || "";
            const price = Number(priceValue.replace(",", "."));
            const rentalPrice =
                Number(
                    document.getElementById("pub-aluguel-valor")?.value || 0
                ) || null;
            const forSale = document.getElementById("pub-venda")?.checked;
            const forTrade = document.getElementById("pub-troca")?.checked;
            const forRent = document.getElementById("pub-aluguel")?.checked;
            const existingProduct = state.publishedProducts.find(
                (product) => product.id === editingProductId
            );
            if (!name || !description || (!forSale && !forTrade && !forRent)) {
                showToast(
                    "Preencha os dados e escolha pelo menos uma modalidade."
                );
                return;
            }
            if ((forSale && price <= 0) || (forRent && rentalPrice <= 0)) {
                showToast(
                    "Informe preços válidos para as modalidades escolhidas."
                );
                return;
            }
            if (
                !state.pendingImages.length &&
                !existingProduct?.image &&
                !existingProduct?.images?.length
            ) {
                showToast(
                    "Adicione pelo menos uma foto para apresentar o item."
                );
                return;
            }

            const measurements = {
                bust:
                    Number(document.getElementById("pub-busto")?.value) || null,
                waist:
                    Number(document.getElementById("pub-cintura")?.value) ||
                    null,
                hip:
                    Number(document.getElementById("pub-quadril")?.value) ||
                    null,
                length:
                    Number(document.getElementById("pub-comprimento")?.value) ||
                    null,
                fit:
                    document.getElementById("pub-caimento")?.value.trim() || "",
            };
            const images = state.pendingImages.length
                ? [...state.pendingImages]
                : existingProduct?.images ||
                  (existingProduct?.image ? [existingProduct.image] : []);

            const publishedProduct = {
                id: editingProductId || Date.now(),
                nome: name,
                emoji: "👕",
                categoria: normalizeCategory(
                    document.getElementById("pub-categoria")?.value ||
                        "Camisetas"
                ),
                marca:
                    document.getElementById("pub-marca")?.value.trim() ||
                    "Sem marca",
                tamanho: document.getElementById("pub-tamanho")?.value || "G",
                cor:
                    document.getElementById("pub-cor")?.value.trim() ||
                    "Não informada",
                estado:
                    document.getElementById("pub-condicao")?.value ||
                    "Excelente",
                preco: forSale ? price : null,
                aluguel: forRent ? rentalPrice : null,
                troca: forTrade,
                local:
                    document.getElementById("pub-local")?.value.trim() ||
                    "Não informada",
                vendedor: state.currentUser?.nome || "Visitante",
                rating: 5,
                pop: 0,
                desc: description,
                image: images[0] || "",
                images,
                measurements,
                stock: existingProduct?.stock ?? 1,
                ownerEmail: normalizeEmail(state.currentUser?.email),
            };
            const existingIndex = state.publishedProducts.findIndex(
                (product) => product.id === editingProductId
            );
            let savedProduct;
            try {
                savedProduct = await sendProductToApi(
                    publishedProduct,
                    existingIndex >= 0 ? "PUT" : "POST"
                );
            } catch (error) {
                showToast(error.message);
                if (error.status === 401) showScreen("screen-login");
                return;
            }
            Object.assign(publishedProduct, savedProduct);

            if (existingIndex >= 0) {
                const existing = state.publishedProducts[existingIndex];
                if (!publishedProduct.image)
                    publishedProduct.image = existing.image || "";
                if (!state.pendingImages.length)
                    publishedProduct.images =
                        existing.images ||
                        (existing.image ? [existing.image] : []);
                if (!Object.values(measurements).some(Boolean))
                    publishedProduct.measurements = existing.measurements || {};
                Object.assign(existing, publishedProduct, {
                    id: existing.id,
                    stock: existing.stock,
                });
                const productIndex = PRODUCTS.findIndex(
                    (product) => product.id === existing.id
                );
                if (productIndex >= 0) PRODUCTS[productIndex] = existing;
                showToast("Anúncio atualizado com sucesso!");
            } else {
                state.publishedProducts.push(publishedProduct);
                PRODUCTS.push(publishedProduct);
                checkSavedSearchAlerts(publishedProduct);
                showToast("Item publicado com sucesso!");
            }
            editingProductId = null;
            saveState();
            renderHome();
            renderCatalog();
            renderMyProducts();
            showScreen("screen-home");
        });
    }
}

function bindPhotoUploadInput() {
    const photoInput = document.getElementById("pub-fotos");
    if (!photoInput) return;

    photoInput.addEventListener("change", async () => {
        const preview = document.getElementById("photo-preview");
        const quality = document.getElementById("photo-quality");
        if (!preview) return;
        preview.innerHTML = "";
        state.pendingImages = [];
        const selectedFiles = [...photoInput.files];
        const warnings = [];
        if (selectedFiles.length > 8)
            showToast("Você pode adicionar no máximo 8 fotos.");
        const validFiles = selectedFiles.slice(0, 8).filter((file) => {
            if (!file.type.startsWith("image/")) {
                warnings.push(
                    `${file.name}: arquivo não reconhecido como imagem.`
                );
                return false;
            }
            if (file.size > 5 * 1024 * 1024) {
                warnings.push(`${file.name}: excede o limite de 5 MB.`);
                return false;
            }
            return true;
        });

        try {
            const preparedImages = await Promise.all(
                validFiles.map(async (file) => ({
                    file,
                    image: await prepareProductImage(file),
                }))
            );
            state.pendingImages = preparedImages.map(({ image }) => image.src);
            preparedImages.forEach(({ file, image: prepared }, index) => {
                if (
                    Math.min(prepared.originalWidth, prepared.originalHeight) <
                    700
                )
                    warnings.push(
                        `${file.name}: resolução baixa; tente uma foto com mais detalhes.`
                    );
                if (prepared.smallFile)
                    warnings.push(
                        `${file.name}: arquivo pequeno; confira se a foto está nítida.`
                    );
                if (prepared.brightness < 48)
                    warnings.push(
                        `${file.name}: pode estar escura; experimente usar luz natural.`
                    );
                if (prepared.brightness > 232)
                    warnings.push(
                        `${file.name}: pode estar clara demais; confira se as cores aparecem.`
                    );
                if (prepared.contrast < 12)
                    warnings.push(
                        `${file.name}: há pouco contraste; confira se a peça está focada e visível.`
                    );
                const previewImage = document.createElement("img");
                previewImage.alt = `Pré-visualização ${index + 1}: ${file.name}`;
                previewImage.src = prepared.src;
                preview.appendChild(previewImage);
            });
            if (quality) {
                quality.innerHTML = `<strong>${preparedImages.length} de 8 fotos selecionadas</strong><ul>${warnings.length ? warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("") : "<li>Boa seleção. Confira frente, costas, etiqueta e detalhes da peça.</li>"}</ul>`;
            }
        } catch {
            showToast(
                "Não foi possível preparar uma das fotos. Tente outro arquivo."
            );
        }
    });
}

function attachEvents() {
    document.addEventListener("submit", (event) => {
        if (event.target.matches(".seller-message-form"))
            handleSellerMessage(event);
        if (event.target.matches(".order-review-form"))
            submitOrderReview(event);
    });

    document.addEventListener("click", handleGlobalActionClick);
    document.addEventListener("keydown", handleGlobalKeyboardShortcuts);

    bindNavigationControls();
    bindFilterInputs();
    bindFormListeners();
    bindPhotoUploadInput();
}

document.addEventListener("DOMContentLoaded", async () => {
    loadState();
    applyTheme();
    state.currentUser = await restoreServerSession();
    activateUserData();
    await loadOrdersFromApi();
    applyLoggedUser();
    saveState();

    applyTranslations();

    updateCartBadge();
    updateFavoriteBadge();
    renderHome();
    renderCatalog();
    renderFavorites();
    renderMyProducts();
    renderCart();
    renderCheckout();
    renderOrders();
    renderProfile();
    renderNotifications();
    renderMessages();
    attachEvents();
    const urlParams = new URLSearchParams(window.location.search);
    const hasSharedWishlist = urlParams.has("wishlist");
    const hasPasswordReset = urlParams.has("resetToken");
    if (hasSharedWishlist) renderFavorites();
    showScreen(
        hasPasswordReset
            ? "screen-reset"
            : hasSharedWishlist
              ? "screen-favoritos"
              : window.location.hash.slice(1) || "screen-home",
        { replace: true }
    );
    loadProductsFromApi().then(() => {
        const productId = productIdFromPath(window.location.pathname);
        if (hasSharedWishlist) renderFavorites();
        else if (productId) openProductDetails(productId, { replace: true });
    });

    const translationObserver = new MutationObserver(() => applyTranslations());
    translationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
    });
});

window.addEventListener("popstate", () => {
    const productId = productIdFromPath(window.location.pathname);
    if (productId) {
        openProductDetails(productId, { fromHistory: true });
        return;
    }

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
window.markAllNotificationsRead = markAllNotificationsRead;
window.renderMessages = renderMessages;
