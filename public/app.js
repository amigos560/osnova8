'use strict';

// ══════════════════════════════════════════
//  Amigos Shop — клиентская логика + корзина
//  Витрина рисуется из /api/catalog (products.json)
// ══════════════════════════════════════════

const CART_KEY = 'amigos_cart_v1';

// ── Состояние ──
let cart = [];
try {
    const saved = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    if (Array.isArray(saved)) cart = saved.filter(i => i && typeof i.name === 'string' && i.qty > 0);
} catch (_) { cart = []; }

let currentOrder = { items: [], total: 0 };

// ── DOM ──
const overlay      = document.getElementById('modal-overlay');
const cartOverlay  = document.getElementById('cart-overlay');
const bar          = document.getElementById('status-alert');
const cartBadge    = document.getElementById('cart-badge');
const cartItemsEl  = document.getElementById('cart-items');
const cartEmptyEl  = document.getElementById('cart-empty');
const cartFooterEl = document.getElementById('cart-footer');
const cartTotalEl  = document.getElementById('cart-total');

const DEFAULT_BAR = {
    html: '<span class="dot"></span><span>Оплата через CryptoBot (USDT) — товар выдаётся в течение 5 минут после оплаты</span>',
    color: 'var(--cyan)', bg: 'var(--cyan-glow)', border: 'var(--border-hi)'
};

// ══════════════ ОШИБКИ ВНУТРИ МОДАЛКИ ══════════════

function showModalError(msg) {
    let box = document.getElementById('modal-error');
    if (!box) {
        box = document.createElement('div');
        box.id = 'modal-error';
        box.style.cssText = 'margin-top:12px;padding:10px 14px;border-radius:8px;' +
            'background:rgba(255,94,108,.08);border:1px solid rgba(255,94,108,.25);' +
            'color:#ff5e6c;font-size:.82rem;line-height:1.5;word-break:break-word;';
        const btn = document.getElementById('btn-submit');
        btn.parentNode.insertBefore(box, btn.nextSibling);
    }
    box.textContent = msg;
}

function clearModalError() {
    const box = document.getElementById('modal-error');
    if (box) box.remove();
}

// ══════════════ КОРЗИНА ══════════════

function cartCount() { return cart.reduce((s, i) => s + i.qty, 0); }
function cartTotal() { return cart.reduce((s, i) => s + i.price * i.qty, 0); }

function saveCart() {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    updateBadge();
}

function updateBadge() {
    const n = cartCount();
    cartBadge.textContent = n > 99 ? '99+' : n;
    cartBadge.classList.toggle('visible', n > 0);
}

function bumpBadge() {
    updateBadge();
    cartBadge.classList.remove('bump');
    void cartBadge.offsetWidth;
    cartBadge.classList.add('bump');
}

function addToCart(name, price) {
    const found = cart.find(i => i.name === name);
    if (found) {
        found.qty += 1;
    } else {
        cart.push({ name, price, qty: 1 });
    }
    saveCart();
    bumpBadge();
    renderCart();
    openCart();
}

function changeQty(name, delta) {
    const item = cart.find(i => i.name === name);
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) {
        cart = cart.filter(i => i.name !== name);
    }
    if (item.qty > 100) item.qty = 100;
    saveCart();
    renderCart();
}

function removeFromCart(name) {
    cart = cart.filter(i => i.name !== name);
    saveCart();
    renderCart();
}

function renderCart() {
    cartItemsEl.innerHTML = '';
    for (const item of cart) {
        const row = document.createElement('div');
        row.className = 'cart-item';
        row.dataset.name = item.name;

        const info = document.createElement('div');
        info.className = 'ci-info';
        const nm = document.createElement('div');
        nm.className = 'ci-name';
        nm.textContent = item.name;
        const pr = document.createElement('div');
        pr.className = 'ci-price';
        pr.textContent = item.price + ' USDT / шт.';
        info.append(nm, pr);

        const qty = document.createElement('div');
        qty.className = 'ci-qty';
        const dec = document.createElement('button');
        dec.type = 'button'; dec.className = 'qty-btn';
        dec.dataset.action = 'dec'; dec.textContent = '−';
        const num = document.createElement('span');
        num.className = 'qty-num'; num.textContent = item.qty;
        const inc = document.createElement('button');
        inc.type = 'button'; inc.className = 'qty-btn';
        inc.dataset.action = 'inc'; inc.textContent = '+';
        qty.append(dec, num, inc);

        const total = document.createElement('div');
        total.className = 'ci-total';
        total.textContent = (item.price * item.qty).toFixed(2) + ' USDT';

        const rm = document.createElement('button');
        rm.type = 'button'; rm.className = 'ci-remove';
        rm.dataset.action = 'remove'; rm.setAttribute('aria-label', 'Удалить');
        rm.textContent = '✕';

        row.append(info, qty, total, rm);
        cartItemsEl.append(row);
    }

    const empty = cart.length === 0;
    cartEmptyEl.classList.toggle('hidden', !empty);
    cartFooterEl.classList.toggle('hidden', empty);
    cartTotalEl.textContent = cartTotal().toFixed(2) + ' USDT';
}

function openCart() {
    renderCart();
    cartOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeCart() {
    cartOverlay.classList.remove('open');
    document.body.style.overflow = '';
}

// ══════════════ ОФОРМЛЕНИЕ ЗАКАЗА ══════════════

function openOrder() {
    if (cart.length === 0) return;

    currentOrder = {
        items: cart.map(i => ({ name: i.name, qty: i.qty })),
        total: cartTotal()
    };

    const summary = document.getElementById('order-summary');
    summary.innerHTML = '';
    for (const item of cart) {
        const row = document.createElement('div');
        row.className = 'os-row';
        const left = document.createElement('span');
        left.textContent = `${item.name} ×${item.qty}`;
        const right = document.createElement('span');
        right.textContent = (item.price * item.qty).toFixed(2) + ' USDT';
        row.append(left, right);
        summary.append(row);
    }
    const totalRow = document.createElement('div');
    totalRow.className = 'os-row os-total';
    const tl = document.createElement('span');
    tl.textContent = 'Итого';
    const tr = document.createElement('span');
    tr.textContent = currentOrder.total.toFixed(2) + ' USDT';
    totalRow.append(tl, tr);
    summary.append(totalRow);

    document.getElementById('modal-product-name').textContent =
        cart.length === 1 ? cart[0].name : `${cart.length} позиций в заказе`;
    document.getElementById('modal-price').textContent = currentOrder.total.toFixed(2) + ' USDT';

    document.getElementById('input-tg').value = '';
    document.getElementById('input-email').value = '';
    clearErrors();
    clearModalError();

    closeCart();
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.getElementById('input-tg').focus(), 100);
}

function closeModal() {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
}

function clearErrors() {
    ['input-tg', 'input-email'].forEach(id =>
        document.getElementById(id).classList.remove('error'));
    ['err-tg', 'err-email'].forEach(id =>
        document.getElementById(id).classList.remove('visible'));
}

// ══════════════ ОБРАБОТКА КЛИКОВ ══════════════

document.addEventListener('click', (e) => {
    const addBtn = e.target.closest('.btn-add');
    if (addBtn) {
        const card = addBtn.closest('.product-card');
        if (!card) return;
        const priceText = card.querySelector('.price-main').textContent.replace(/[^\d.]/g, '');
        addToCart(card.dataset.name, parseFloat(priceText) || 0);
        return;
    }

    if (e.target.closest('.btn-cart')) {
        openCart();
        return;
    }

    const qtyBtn = e.target.closest('[data-action]');
    if (qtyBtn && qtyBtn.closest('.cart-item')) {
        const name = qtyBtn.closest('.cart-item').dataset.name;
        const action = qtyBtn.dataset.action;
        if (action === 'inc')      changeQty(name, +1);
        else if (action === 'dec') changeQty(name, -1);
        else if (action === 'remove') removeFromCart(name);
        return;
    }

    const infoBtn = e.target.closest('.btn-info');
    if (infoBtn) {
        toggleDetails(infoBtn);
        return;
    }

    if (e.target.closest('#btn-checkout')) {
        openOrder();
        return;
    }

    if (e.target.closest('.modal-close')) {
        if (e.target.closest('#cart-overlay')) closeCart();
        else closeModal();
        return;
    }

    if (e.target === overlay)      closeModal();
    if (e.target === cartOverlay)  closeCart();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeModal(); closeCart(); }
});

// ══════════════ ВАЛИДАЦИЯ ══════════════

const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TG_USER_RE  = /^@?[A-Za-z0-9_]{3,64}$/;
const TG_PHONE_RE = /^\+?\d[\d\s\-()]{8,16}$/;

// ══════════════ ОТПРАВКА ЗАКАЗА ══════════════

document.getElementById('order-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();
    clearModalError();

    if (currentOrder.items.length === 0) {
        showModalError('❌ Корзина пуста');
        return;
    }

    const tgRaw = document.getElementById('input-tg').value.trim();
    const email = document.getElementById('input-email').value.trim();
    let valid = true;

    if (!TG_USER_RE.test(tgRaw) && !TG_PHONE_RE.test(tgRaw)) {
        document.getElementById('input-tg').classList.add('error');
        document.getElementById('err-tg').classList.add('visible');
        valid = false;
    }
    if (!EMAIL_RE.test(email)) {
        document.getElementById('input-email').classList.add('error');
        document.getElementById('err-email').classList.add('visible');
        valid = false;
    }
    if (!valid) return;

    const btn = document.getElementById('btn-submit');
    btn.disabled = true;
    btn.textContent = '⏱ Создаём счёт...';

    setBar(`⏳ Создаём счёт на ${currentOrder.total.toFixed(2)} USDT…`,
           'var(--cyan)', 'rgba(0,212,255,0.08)', 'rgba(0,212,255,0.2)');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    try {
        const res = await fetch('/api/create-invoice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                items:         currentOrder.items,
                buyerTelegram: tgRaw,
                buyerEmail:    email
            }),
            signal: controller.signal
        });

        const data = await res.json().catch(() => null);
        if (!data) throw new Error(`Сервер вернул неожиданный ответ (HTTP ${res.status})`);

        if (res.ok && data.success && data.payUrl) {
            cart = [];
            saveCart();
            clearModalError();
            closeModal();
            setBar('🚀 Счёт создан! Перенаправляем в Telegram...',
                   'var(--green)', 'rgba(0,229,160,0.08)', 'rgba(0,229,160,0.2)');
            window.location.href = data.payUrl;
            return;
        }

        throw new Error(data.error || `Ошибка сервера (HTTP ${res.status})`);

    } catch (err) {
        const msg = (err.name === 'AbortError')
            ? 'Сервер не ответил за 25 секунд. Проверьте связь и попробуйте ещё раз.'
            : err.message;
        console.error('[create-invoice]', msg);
        showModalError('❌ ' + msg);
        setBar('❌ ' + msg, 'var(--red)', 'rgba(255,94,108,0.08)', 'rgba(255,94,108,0.25)');
    } finally {
        clearTimeout(timeoutId);
        btn.disabled = false;
        btn.textContent = 'Перейти к оплате в CryptoBot →';
    }
});

// ══════════════ СТАТУС-БАР / ПОДРОБНЕЕ / ПОИСК ══════════════

function setBar(html, color, bg, border) {
    bar.innerHTML = html;
    bar.style.color = color;
    bar.style.background = bg;
    bar.style.borderColor = border;
}

function toggleDetails(btn) {
    const box  = btn.closest('.product-card').querySelector('.details-box');
    const open = box.style.display === 'block';
    box.style.display = open ? 'none' : 'block';
    btn.textContent = open ? 'Подробнее' : 'Скрыть';
}

document.getElementById('search-input').addEventListener('input', function () {
    const q = this.value.toLowerCase().trim();
    let total = 0;
    document.querySelectorAll('.cat-block').forEach(block => {
        let vis = 0;
        block.querySelectorAll('.product-card').forEach(card => {
            const match = !q || card.querySelector('.p-name').textContent.toLowerCase().includes(q);
            card.classList.toggle('hidden', !match);
            if (match) vis++;
        });
        block.classList.toggle('hidden', vis === 0);
        total += vis;
    });
    document.getElementById('no-results').classList.toggle('visible', total === 0 && q.length > 0);
});

updateBadge();

// ══════════════ КАТАЛОГ ИЗ products.json ══════════════
// Витрина рисуется автоматически: сервер отдаёт /api/catalog,
// товары лежат в одном файле products.json (корень репозитория).

function pluralPositions(n) {
    const m = Math.abs(n) % 100;
    const d = m % 10;
    if (m > 10 && m < 20) return 'позиций';
    if (d > 1 && d < 5) return 'позиции';
    if (d === 1) return 'позиция';
    return 'позиций';
}

function escHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderCatalog(data) {
    const root  = document.getElementById('catalog-root');
    const side  = document.getElementById('sidebar-links');
    const chips = document.getElementById('mobile-chips');
    const warrantyDefault = data.warranty || '';

    let html = '', sideHtml = '', chipsHtml = '';
    for (const cat of (data.categories || [])) {
        sideHtml  += `<a class="cat-link" href="#${escHtml(cat.id)}"><span>${escHtml(cat.icon)}</span> ${escHtml(cat.title)}</a>`;
        chipsHtml += `<a class="chip" href="#${escHtml(cat.id)}">${escHtml(cat.icon)} ${escHtml(cat.title)}</a>`;

        const prods = cat.products || [];
        let cards = '';
        for (const p of prods) {
            const warranty = p.warranty || warrantyDefault;
            const out = Number(p.stock) === 0;
            cards += `
        <article class="product-card${out ? ' hidden' : ''}" data-name="${escHtml(p.name)}">
          <div class="p-info">
            <div class="p-name">${escHtml(p.name)}${p.badge ? ` <span class="badge-pop">${escHtml(p.badge)}</span>` : ''}</div>
            <div class="p-desc">${escHtml(p.desc || '')}</div>
            ${warranty ? `<div class="p-warranty">${escHtml(warranty)}</div>` : ''}
            ${p.details ? `<div class="details-box">${p.details}</div>` : ''}
          </div>
          <div class="p-stock-col"><div class="stock-label">${out ? 'Нет в наличии' : 'В наличии'}</div><div class="stock-count">${Number(p.stock) || 0} шт.</div></div>
          <div class="p-action-col">
            ${p.rub ? `<div class="price-rub">${escHtml(p.rub)}</div>` : ''}
            <div class="price-main">${escHtml(String(p.price))} USDT</div>
            <div class="btn-row">
              ${p.details ? '<button class="btn btn-info" type="button">Подробнее</button>' : ''}
              ${out ? '' : '<button class="btn btn-add" type="button">В корзину</button>'}
            </div>
          </div>
        </article>`;
        }
        html += `
    <div class="cat-block" id="${escHtml(cat.id)}">
      <h2 class="cat-title"><span>${escHtml(cat.icon)}</span> ${escHtml(cat.title)} <span class="cat-count">${prods.length} ${pluralPositions(prods.length)}</span></h2>
      <div class="product-list">${cards}
      </div>
    </div>`;
    }
    root.innerHTML = html;
    if (side)  side.innerHTML  = sideHtml;
    if (chips) chips.innerHTML = chipsHtml;
}

async function initCatalog() {
    const root = document.getElementById('catalog-root');
    if (!root) return;
    try {
        const res = await fetch('/api/catalog');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        renderCatalog(await res.json());
    } catch (e) {
        root.innerHTML = '<div class="status-bar" style="color:var(--red);border-color:rgba(255,94,108,.25);background:rgba(255,94,108,.08);">❌ Не удалось загрузить каталог. Обновите страницу или напишите @amigospeso</div>';
    }
}

initCatalog();

// Дата обновления стока в статус-баре — всегда сегодня
const stockDateEl = document.getElementById('stock-date');
if (stockDateEl) {
    stockDateEl.textContent = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}
