/* ================================================
   WARDROBE VIRTUAL — app.js
   ================================================ */

const PRODUCTS = [
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

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
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

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

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

function buildProductCard(product) {
    const inFavorites = state.favorites.includes(product.id);
    const inCart = state.cart.some((item) => item.id === product.id);

    return `
        <article class="product-card">
            <div class="product-image">${product.emoji}</div>
            <button class="favorite-btn ${inFavorites ? "active" : ""}" data-action="toggle-favorite" data-id="${product.id}" aria-label="Favoritar item">
                <i class="${inFavorites ? "fa-solid fa-heart" : "fa-regular fa-heart"}"></i>
            </button>
            <div class="product-body">
                <div class="product-topline">
                    <span class="tag">${product.categoria}</span>
                    <span class="rating">★ ${product.rating}</span>
                </div>
                <h3>${product.nome}</h3>
                <p>${product.local}</p>
                <div class="price-row">
                    <strong>${formatPrice(product.preco)}</strong>
                    ${product.aluguel ? `<span>${formatPrice(product.aluguel)}/dia</span>` : ""}
                </div>
                <div class="product-meta">
                    <span>${product.estado}</span>
                    <span>${product.tamanho}</span>
                    <span>${product.cor}</span>
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

    const categories = [...new Set(PRODUCTS.map((product) => product.categoria))];
    container.innerHTML = categories.map((categoria) => `
        <button class="category-pill" data-action="filter-category" data-category="${categoria}">
            ${categoria}
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
        const matchesSearch = !search || product.nome.toLowerCase().includes(search.toLowerCase()) || product.desc.toLowerCase().includes(search.toLowerCase());
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

function renderOrders() {
    const orders = document.getElementById("orders-list");
    if (!orders) return;

    orders.innerHTML = `
        <div class="card order-card">
            <h3>Pedido #1042</h3>
            <p>Camisa Social Preta · Status: em transporte</p>
            <strong>${formatPrice(59.99)}</strong>
        </div>
        <div class="card order-card">
            <h3>Pedido #1038</h3>
            <p>Calça Moletom Bench · Status: entregue</p>
            <strong>${formatPrice(89.9)}</strong>
        </div>
    `;
}

function renderProfile() {
    const profileName = document.getElementById("profile-name");
    const profileCity = document.getElementById("profile-city");
    const avatar = document.getElementById("profile-avatar");

    const user = state.currentUser || { nome: "Clayton", cidade: "Londrina, PR" };

    if (profileName) profileName.textContent = user.nome;
    if (profileCity) profileCity.textContent = user.cidade;
    if (avatar) avatar.textContent = user.nome.charAt(0).toUpperCase();

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
                        <h4>${product.nome}</h4>
                        <p>${product.tamanho} · ${product.cor}</p>
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

    const total = state.cart.reduce((sum, entry) => {
        const product = getProductById(entry.id);
        return sum + (product ? product.preco * entry.qty : 0);
    }, 0);

    container.innerHTML = `
        ${items}
        <div class="summary-box card">
            <div class="summary-row"><span>Subtotal</span><strong>${formatPrice(total)}</strong></div>
            <div class="summary-row"><span>Frete</span><strong>Grátis</strong></div>
            <div class="summary-row total"><span>Total</span><strong>${formatPrice(total)}</strong></div>
            <button class="btn btn-primary btn-full" onclick="showScreen('screen-checkout')">Finalizar compra</button>
        </div>
    `;
}

function renderCheckout() {
    const container = document.getElementById("checkout-content");
    if (!container) return;

    const total = state.cart.reduce((sum, entry) => {
        const product = getProductById(entry.id);
        return sum + (product ? product.preco * entry.qty : 0);
    }, 0);

    container.innerHTML = `
        <div class="card checkout-card">
            <h3>Resumo do pedido</h3>
            <div class="summary-row"><span>Itens</span><strong>${state.cart.reduce((sum, item) => sum + item.qty, 0)}</strong></div>
            <div class="summary-row"><span>Entrega</span><strong>Em 2 a 4 dias</strong></div>
            <div class="summary-row total"><span>Total</span><strong>${formatPrice(total)}</strong></div>
            <button class="btn btn-primary btn-full" onclick="finalizePurchase()">Confirmar pagamento</button>
        </div>
    `;
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
            <div class="details-hero">${product.emoji}</div>
            <h1>${product.nome}</h1>
            <p class="details-meta">${product.categoria} · ${product.tamanho} · ${product.cor}</p>
            <div class="price-row big">
                <strong>${formatPrice(product.preco)}</strong>
                ${product.aluguel ? `<span>${formatPrice(product.aluguel)}/dia</span>` : ""}
            </div>
            <p>${product.desc}</p>
            <div class="details-info">
                <span>Estado: ${product.estado}</span>
                <span>Vendedor: ${product.vendedor}</span>
                <span>Local: ${product.local}</span>
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
}

function finalizePurchase() {
    state.cart = [];
    updateCartBadge();
    renderCart();
    renderCheckout();
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

    showToast("Cadastro realizado com sucesso!");
    document.getElementById("form-cadastro")?.reset();
    showScreen("screen-login");
}

function handleRecover(event) {
    event.preventDefault();
    showToast("Link de recuperação enviado!");
    showScreen("screen-login");
}

function logout() {
    state.currentUser = null;
    renderProfile();
    showToast("Você saiu da conta.");
    showScreen("screen-login");
}

function showScreen(screenId) {
    document.getElementById("side-menu")?.classList.add("hidden");
    document.getElementById("notification-panel")?.classList.add("hidden");

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
        "screen-carrinho",
        "screen-checkout",
        "screen-publicar",
        "screen-favoritos",
        "screen-pedidos",
        "screen-perfil",
        "screen-suporte"
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
        }

        if (!event.target.closest("#side-menu") && !event.target.closest("#btn-menu") && !event.target.closest(".side-menu-nav button")) {
            document.getElementById("side-menu")?.classList.add("hidden");
        }

        if (!event.target.closest("#notification-panel") && !event.target.closest("#btn-notify")) {
            document.getElementById("notification-panel")?.classList.add("hidden");
        }
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
    const formPublicar = document.getElementById("form-publicar");

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

    if (formPublicar) {
        formPublicar.addEventListener("submit", (event) => {
            event.preventDefault();
            showToast("Item publicado com sucesso!");
            formPublicar.reset();
            showScreen("screen-home");
        });
    }
}

document.addEventListener("DOMContentLoaded", () => {
    state.users.push({
        nome: "Clayton",
        email: "clayton@teste.com",
        senha: "123456",
        cidade: "Londrina, PR"
    });

    updateCartBadge();
    renderHome();
    renderCatalog();
    renderFavorites();
    renderCart();
    renderCheckout();
    renderOrders();
    renderProfile();
    attachEvents();
    showScreen("screen-login");
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

