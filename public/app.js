'use strict';

// ══════════════════════════════════════════
//  Amigos Shop — клиентская логика
//  (цена товара показывается из data-атрибутов,
//   но ОПЛАТА всегда создаётся по серверному каталогу)
// ══════════════════════════════════════════

let currentProduct = { name: '', price: 0 };

const overlay   = document.getElementById('modal-overlay');
const bar       = document.getElementById('status-alert');
const DEFAULT_BAR = {
    html: '<span class="dot"></span><span>Оплата через CryptoBot (USDT) — товар выдаётся в течение 5 минут после оплаты</span>',
    color: 'var(--cyan)', bg: 'var(--cyan-glow)', border: 'var(--border-hi)'
};

// ── Делегирование кликов: купить / подробнее / закрыть ──
document.addEventListener('click', (e) => {
    const buyBtn = e.target.closest('.btn-pay');
    if (buyBtn) {
        const card = buyBtn.closest('.product-card');
        if (!card) return;
        const priceText = card.querySelector('.price-main').textContent.replace(/[^\d.]/g, '');
        openOrder(card.dataset.name, parseFloat(priceText) || 0);
        return;
    }

    const infoBtn = e.target.closest('.btn-info');
    if (infoBtn) {
        toggleDetails(infoBtn);
        return;
    }

    if (e.target.closest('.modal-close')) {
        closeModal();
        return;
    }

    if (e.target === overlay) {
        closeModal();
    }
});

// ── Закрытие по Escape ──
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
});

// ── Открыть модалку ──
function openOrder(name, price) {
    currentProduct = { name, price };
    document.getElementById('modal-product-name').textContent = name;
    document.getElementById('modal-price').textContent = price + ' USDT';
    document.getElementById('input-tg').value = '';
    document.getElementById('input-email').value = '';
    clearErrors();
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.getElementById('input-tg').focus(), 100);
}

// ── Закрыть модалку ──
function closeModal() {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
}

// ── Сброс ошибок ──
function clearErrors() {
    ['input-tg', 'input-email'].forEach(id =>
        document.getElementById(id).classList.remove('error'));
    ['err-tg', 'err-email'].forEach(id =>
        document.getElementById(id).classList.remove('visible'));
}

// ── Валидация ──
const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TG_USER_RE  = /^@?[A-Za-z0-9_]{3,64}$/;
const TG_PHONE_RE = /^\+?\d[\d\s\-()]{8,16}$/;

// ── Отправка формы ──
document.getElementById('order-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();

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

    setBar(`⏳ Создаём счёт на ${currentProduct.price} USDT…`, 'var(--cyan)', 'rgba(0,212,255,0.08)', 'rgba(0,212,255,0.2)');

    try {
        const res = await fetch('/api/create-invoice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                productName:   currentProduct.name,   // цену подставит сервер
                buyerTelegram: tgRaw,
                buyerEmail:    email
            })
        });

        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) {
            throw new Error(`Неожиданный ответ сервера (HTTP ${res.status})`);
        }

        const data = await res.json();

        if (res.ok && data.success && data.payUrl) {
            closeModal();
            setBar('🚀 Счёт создан! Перенаправляем в Telegram...', 'var(--green)', 'rgba(0,229,160,0.08)', 'rgba(0,229,160,0.2)');
            setTimeout(() => { window.location.href = data.payUrl; }, 400);
        } else {
            throw new Error(data.error || 'Не удалось создать счёт');
        }

    } catch (err) {
        console.error('[CryptoBot]', err.message);
        setBar('❌ ' + err.message, 'var(--red)', 'rgba(255,94,108,0.08)', 'rgba(255,94,108,0.25)');
        btn.disabled = false;
        btn.textContent = 'Перейти к оплате в CryptoBot →';
        setTimeout(() => setBar(DEFAULT_BAR.html, DEFAULT_BAR.color, DEFAULT_BAR.bg, DEFAULT_BAR.border), 6000);
    }
});

// ── Статус-бар хелпер ──
function setBar(html, color, bg, border) {
    bar.innerHTML = html;
    bar.style.color = color;
    bar.style.background = bg;
    bar.style.borderColor = border;
}

// ── Описание товара ──
function toggleDetails(btn) {
    const box  = btn.closest('.product-card').querySelector('.details-box');
    const open = box.style.display === 'block';
    box.style.display = open ? 'none' : 'block';
    btn.textContent = open ? 'Подробнее' : 'Скрыть';
}

// ── Поиск ──
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
