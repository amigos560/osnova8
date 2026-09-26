'use strict';

require('dotenv').config();

const express     = require('express');
const path        = require('path');
const fs          = require('fs');
const crypto      = require('crypto');
const axios       = require('axios');
const helmet      = require('helmet');
const rateLimit   = require('express-rate-limit');

// ═══════════════════════════════════════════════════════════
//  КОНФИГУРАЦИЯ — ТОЛЬКО из переменных окружения (.env)
//  ВАЖНО: токены НИКОГДА не храните в коде и не публикуйте
//  в git — они скомпрометированы и должны быть перевыпущены!
//  - CryptoBot: @CryptoBot → Crypto Pay → My Apps → переиздать токен
//  - Telegram:  @BotFather → /revoke
// ═══════════════════════════════════════════════════════════
const CRYPTO_BOT_TOKEN = process.env.CRYPTO_BOT_TOKEN;
const TG_BOT_TOKEN     = process.env.TG_BOT_TOKEN;
const TG_OWNER_ID      = process.env.TG_OWNER_ID;
const MY_DOMAIN        = (process.env.MY_DOMAIN || '').replace(/\/+$/, '');
const IS_TESTNET       = String(process.env.IS_TESTNET).toLowerCase() === 'true';
const PORT             = parseInt(process.env.PORT || '3000', 10);

const CRYPTOBOT_BASE = IS_TESTNET ? 'https://testnet-pay.crypt.bot' : 'https://pay.crypt.bot';

// ── Проверка конфигурации при старте ──
const missing = [];
if (!CRYPTO_BOT_TOKEN) missing.push('CRYPTO_BOT_TOKEN');
if (!TG_BOT_TOKEN)     missing.push('TG_BOT_TOKEN');
if (!TG_OWNER_ID)      missing.push('TG_OWNER_ID');
if (!MY_DOMAIN)        missing.push('MY_DOMAIN');
if (missing.length) {
    console.error('❌ Отсутствуют переменные окружения: ' + missing.join(', '));
    console.error('   Создайте .env по образцу .env.example или задайте их на хостинге.');
    process.exit(1);
}

// ═══════════════════════════════════════════════════════════
//  КАТАЛОГ — цены хранятся ТОЛЬКО на сервере.
//  Клиент присылает названия товаров и количество —
//  сервер сам считает итоговую сумму.
//  ⚠️ Названия должны совпадать с data-name в index.html
// ═══════════════════════════════════════════════════════════
const CATALOG = {
    'Telegram Ads РК | Стартовый Траст':        { price: 500  },
    'Telegram Ads РК VIP | Агентский Безлимит': { price: 1200 },
    'FARM | Аккаунт UA | 14 дней прогрева':     { price: 30   },
    'KING + ПЗРД | БМ 250$ + 2FA':              { price: 144  },
    'Бизнес Менеджер (BM) 50$ лимит':           { price: 54   },
    'Авторег FB | MIX IP | Email в комплекте':  { price: 5    },
    'Google Ads | Саморег UA | cookies':        { price: 15   },
};

// Лимиты корзины
const MAX_QTY_PER_ITEM  = 100;    // максимум штук одного товара
const MAX_DISTINCT_ITEMS = 50;    // максимум разных позиций в заказе
const MAX_ORDER_TOTAL   = 100000; // максимальная сумма заказа, USDT

// ═══════════════════════════════════════════════════════════
//  ЖУРНАЛ ЗАКАЗОВ (JSONL) + защита от повторной обработки
// ═══════════════════════════════════════════════════════════
const DATA_DIR    = path.join(__dirname, 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.jsonl');
const processedInvoiceIds = new Set();
const processedUpdateIds  = new Set();

function loadOrderLog() {
    try {
        if (!fs.existsSync(ORDERS_FILE)) return;
        for (const line of fs.readFileSync(ORDERS_FILE, 'utf8').split('\n')) {
            if (!line.trim()) continue;
            try {
                const rec = JSON.parse(line);
                if (rec.invoiceId) processedInvoiceIds.add(rec.invoiceId);
                if (rec.updateId)  processedUpdateIds.add(rec.updateId);
            } catch (_) {}
        }
        console.log(`📦 В журнале обработанных заказов: ${processedInvoiceIds.size}`);
    } catch (e) {
        console.error('Ошибка чтения журнала заказов:', e.message);
    }
}

function saveOrderRecord(rec) {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.appendFileSync(ORDERS_FILE, JSON.stringify(rec) + '\n');
    } catch (e) {
        console.error('Ошибка записи заказа в журнал:', e.message);
    }
}

// ── Экранирование HTML — защита от инъекций в уведомлениях Telegram ──
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ESCAPES[c]);

// ── Красивый список позиций для уведомления ──
function buildOrderLines(items) {
    return items
        .map(i => `• ${escapeHtml(i.name)} ×${i.qty} — ${(i.price * i.qty).toFixed(2)} USDT`)
        .join('\n');
}

// ── Валидация ввода ──
const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TG_USER_RE  = /^@?[A-Za-z0-9_]{3,64}$/;
const TG_PHONE_RE = /^\+?\d[\d\s\-()]{8,16}$/;

// ── Отправка уведомления владельцу в Telegram ──
async function notifyOwner(text) {
    try {
        await axios.post(
            `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`,
            { chat_id: TG_OWNER_ID, text, parse_mode: 'HTML' },
            { timeout: 8000 }
        );
    } catch (e) {
        console.error('Ошибка уведомления в Telegram:', e.message);
    }
}

// ── Авторегистрация вебхука CryptoBot при старте ──
async function registerWebhook() {
    const webhookUrl = `${MY_DOMAIN}/api/payment-webhook`;
    try {
        const info = await axios.get(`${CRYPTOBOT_BASE}/api/getWebhookInfo`, {
            headers: { 'Crypto-Pay-API-Token': CRYPTO_BOT_TOKEN },
            timeout: 10000
        });

        if ((info.data?.result?.url || '') === webhookUrl) {
            console.log(`✅ Вебхук уже зарегистрирован: ${webhookUrl}`);
            return;
        }

        const res = await axios.post(
            `${CRYPTOBOT_BASE}/api/setWebhook`,
            { url: webhookUrl },
            {
                headers: { 'Crypto-Pay-API-Token': CRYPTO_BOT_TOKEN, 'Content-Type': 'application/json' },
                timeout: 10000
            }
        );

        if (res.data?.ok) console.log(`✅ Вебхук зарегистрирован: ${webhookUrl}`);
        else              console.error('❌ CryptoBot не принял вебхук:', res.data);
    } catch (e) {
        console.error('❌ Ошибка регистрации вебхука:', e.message);
    }
}

// ── Проверка подписи вебхука CryptoBot ──
// key = SHA-256(api_token), далее HMAC-SHA256(key, raw_body) → hex,
// timing-safe сравнение с заголовком crypto-pay-api-signature.
function verifyCryptoBotSignature(rawBody, signature) {
    if (!signature || typeof signature !== 'string') return false;
    try {
        const secret   = crypto.createHash('sha256').update(CRYPTO_BOT_TOKEN).digest();
        const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
        const a = Buffer.from(expected, 'hex');
        const b = Buffer.from(signature, 'hex');
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch (_) {
        return false;
    }
}

// ═══════════════════════════════════════════════════════════
//  ПРИЛОЖЕНИЕ
// ═══════════════════════════════════════════════════════════
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            'default-src':   ["'self'"],
            'script-src':    ["'self'"],
            'style-src':     ["'self'", 'https://fonts.googleapis.com'],
            'font-src':      ["'self'", 'https://fonts.gstatic.com'],
            'img-src':       ["'self'", 'data:'],
            'connect-src':   ["'self'"],
            'object-src':    ["'none'"],
            'frame-ancestors': ["'none'"],
            'form-action':   ["'self'"],
        }
    },
    referrerPolicy: { policy: 'no-referrer' }
}));

// JSON-парсер + сохранение сырого тела для проверки подписи вебхука
app.use(express.json({
    limit: '20kb',
    verify: (req, res, buf) => { req.rawBody = buf; }
}));

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', index: 'index.html' }));

// ── Rate limiting ──
const createInvoiceLimiter = rateLimit({
    windowMs: 60 * 1000, max: 10,
    standardHeaders: true, legacyHeaders: false,
    message: { success: false, error: 'Слишком много запросов. Попробуйте через минуту.' }
});
const webhookLimiter = rateLimit({
    windowMs: 60 * 1000, max: 120,
    standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many requests' }
});
const apiLimiter = rateLimit({
    windowMs: 60 * 1000, max: 60,
    standardHeaders: true, legacyHeaders: false
});

// ── Публичный каталог товаров (для проверки цен) ──
app.get('/api/catalog', apiLimiter, (req, res) => {
    res.json({ products: Object.entries(CATALOG).map(([name, p]) => ({ name, price: p.price })) });
});

// ── Создание инвойса (оформление заказа из корзины) ──
// Принимает: { items: [{name, qty}], buyerTelegram, buyerEmail }
// Сумма считается ТОЛЬКО на сервере по каталогу.
app.post('/api/create-invoice', createInvoiceLimiter, async (req, res) => {
    try {
        const { items, buyerTelegram, buyerEmail } = req.body || {};

        // ── Собираем позиции: массив (новый формат) или один товар (старый) ──
        let rawItems;
        if (Array.isArray(items) && items.length > 0) {
            rawItems = items;
        } else if (req.body && typeof req.body.productName === 'string') {
            rawItems = [{ name: req.body.productName, qty: 1 }]; // обратная совместимость
        } else {
            return res.status(400).json({ success: false, error: 'Корзина пуста' });
        }

        if (rawItems.length > MAX_DISTINCT_ITEMS) {
            return res.status(400).json({ success: false, error: `Слишком много позиций (максимум ${MAX_DISTINCT_ITEMS})` });
        }

        // ── Проверяем каждую позицию и считаем сумму по серверному каталогу ──
        let total = 0;
        const cleanItems = [];
        for (const raw of rawItems) {
            const name = String(raw?.name || '').slice(0, 200);
            const product = CATALOG[name];
            if (!product) {
                return res.status(400).json({ success: false, error: 'Товар не найден: ' + name });
            }
            let qty = parseInt(raw?.qty, 10);
            if (!Number.isFinite(qty) || qty < 1) qty = 1;
            if (qty > MAX_QTY_PER_ITEM) {
                return res.status(400).json({ success: false, error: `Максимум ${MAX_QTY_PER_ITEM} шт. одного товара` });
            }
            total += product.price * qty;
            cleanItems.push({ name, qty, price: product.price });
        }

        if (!(total > 0) || total > MAX_ORDER_TOTAL) {
            return res.status(400).json({ success: false, error: 'Некорректная сумма заказа' });
        }

        // ── Контакты покупателя ──
        if (typeof buyerTelegram !== 'string' || typeof buyerEmail !== 'string') {
            return res.status(400).json({ success: false, error: 'Некорректные данные' });
        }

        const tg    = buyerTelegram.trim();
        const email = buyerEmail.trim();

        if (email.length > 120 || !EMAIL_RE.test(email)) {
            return res.status(400).json({ success: false, error: 'Email указан неверно' });
        }
        if (!TG_USER_RE.test(tg) && !TG_PHONE_RE.test(tg)) {
            return res.status(400).json({ success: false, error: 'Укажите корректный Telegram (@username или телефон)' });
        }

        const tgNorm = tg.startsWith('@') ? tg : '@' + tg;
        const totalStr = total.toFixed(2);

        // В payload помещаем весь состав заказа — вернётся в вебхуке
        const buyerPayload = JSON.stringify({ tg: tgNorm, email, items: cleanItems, total: totalStr });

        // Описание счёта — краткий состав (лимит CryptoBot 1024 символа)
        const description = cleanItems
            .map(i => `${i.name} ×${i.qty}`)
            .join('\n')
            .substring(0, 1024);

        const response = await axios.post(
            `${CRYPTOBOT_BASE}/api/createInvoice`,
            {
                description,
                amount:        totalStr,
                currency_type: 'crypto',
                asset:         'USDT',
                payload:       buyerPayload,
                expires_in:    1800, // 30 минут на оплату
                paid_btn_name: 'viewItem',
                paid_btn_url:  `${MY_DOMAIN}/payment-success.html`
            },
            {
                headers: { 'Crypto-Pay-API-Token': CRYPTO_BOT_TOKEN, 'Content-Type': 'application/json' },
                timeout: 10000,
                validateStatus: s => s < 500
            }
        );

        const data = response.data || {};

        if (response.status === 200 && data.ok) {
            saveOrderRecord({
                ts: new Date().toISOString(), type: 'created',
                items: cleanItems, total: totalStr, tg: tgNorm, email,
                invoiceId: data.result.invoice_id
            });

            await notifyOwner(
`🛒 <b>Новый заказ (${cleanItems.length} поз.) — ожидает оплаты</b>

📦 <b>Состав:</b>
${buildOrderLines(cleanItems)}

💰 <b>Итого:</b> ${escapeHtml(totalStr)} USDT
👤 <b>Telegram:</b> ${escapeHtml(tgNorm)}
📧 <b>Email:</b> ${escapeHtml(email)}
🔗 <b>Ссылка на оплату:</b> <a href="${data.result.pay_url}">открыть</a>
🆔 <b>Invoice ID:</b> <code>${data.result.invoice_id}</code>`
            );

            return res.status(200).json({ success: true, payUrl: data.result.pay_url });
        }

        console.error('CryptoBot createInvoice ошибка:', response.status, JSON.stringify(data));
        return res.status(400).json({ success: false, error: 'Ошибка создания счёта. Напишите @amigospeso — оплатим вручную.' });

    } catch (error) {
        console.error('=== ОШИБКА /api/create-invoice ===', error.message);
        if (error.code === 'ECONNABORTED') {
            return res.status(500).json({ success: false, error: 'CryptoBot не ответил вовремя, попробуйте ещё раз' });
        }
        return res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
});

// ── Вебхук от CryptoBot — только после проверки подписи ──
app.post('/api/payment-webhook', webhookLimiter, (req, res) => {
    try {
        // 1. Проверяем подпись ПЕРЕД любой обработкой
        const signature = req.headers['crypto-pay-api-signature'];
        if (!verifyCryptoBotSignature(req.rawBody || Buffer.alloc(0), signature)) {
            console.warn('⚠️ Вебхук с НЕВАЛИДНОЙ подписью от IP:', req.ip);
            return res.sendStatus(401);
        }

        // 2. Парсим сырой JSON
        let update;
        try { update = JSON.parse(req.rawBody.toString('utf8')); }
        catch { return res.sendStatus(400); }

        // 3. Нас интересует только «счёт оплачен»
        if (update.update_type !== 'invoice_paid') return res.sendStatus(200);

        // 4. Дедупликация повторных доставок
        if (update.update_id && processedUpdateIds.has(update.update_id)) return res.sendStatus(200);

        const invoice = update.payload || {};
        if (invoice.invoice_id && processedInvoiceIds.has(invoice.invoice_id)) return res.sendStatus(200);

        // 5. Санитарная проверка суммы
        const amount = parseFloat(invoice.amount);
        if (!(amount > 0) || typeof invoice.asset !== 'string') return res.sendStatus(400);

        // 6. Достаём состав заказа из payload
        let buyer = {};
        try { buyer = JSON.parse(invoice.payload || '{}'); } catch (_) {}

        // Список позиций + мягкая проверка суммы
        let orderLines;
        let itemsSum = 0;
        if (Array.isArray(buyer.items) && buyer.items.length > 0) {
            orderLines = buildOrderLines(buyer.items);
            itemsSum = buyer.items.reduce((s, i) =>
                s + (parseFloat(i.price) || 0) * (parseInt(i.qty) || 0), 0);
        } else {
            orderLines = `• ${escapeHtml(buyer.product || 'неизвестно')}`;
        }
        const mismatch = (itemsSum > 0 && Math.abs(itemsSum - amount) > 0.01)
            ? '\n⚠️ <b>ВНИМАНИЕ: сумма заказа не совпадает с оплатой!</b>'
            : '';

        // 7. Фиксируем обработку
        if (update.update_id) processedUpdateIds.add(update.update_id);
        if (invoice.invoice_id) processedInvoiceIds.add(invoice.invoice_id);
        saveOrderRecord({
            ts: new Date().toISOString(), type: 'paid',
            updateId: update.update_id, invoiceId: invoice.invoice_id,
            amount, asset: invoice.asset,
            tg: buyer.tg || 'неизвестно', email: buyer.email || 'неизвестно',
            items: buyer.items || null, product: buyer.product || null
        });

        // 8. Уведомление владельцу
        notifyOwner(
`✅ <b>ОПЛАТА ПОЛУЧЕНА — выдай товар!</b>

📦 <b>Состав заказа:</b>
${orderLines}

💰 <b>Оплачено:</b> ${escapeHtml(amount)} ${escapeHtml(invoice.asset)}
👤 <b>Telegram покупателя:</b> ${escapeHtml(buyer.tg || 'неизвестно')}
📧 <b>Email покупателя:</b> ${escapeHtml(buyer.email || 'неизвестно')}
🆔 <b>Invoice ID:</b> <code>${escapeHtml(invoice.invoice_id)}</code>${mismatch}

⏰ <b>Выдайте товар в течение 5 минут!</b>`
        ).catch(() => {});

        return res.sendStatus(200);
    } catch (e) {
        console.error('Ошибка вебхука:', e.message);
        return res.sendStatus(500);
    }
});

// ── Служебные endpoints ──
app.get('/api/health', apiLimiter, (req, res) => res.json({ ok: true }));

app.use('/api', apiLimiter, (req, res) => res.status(404).json({ success: false, error: 'Not found' }));

// SPA fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Централизованная обработка ошибок
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    console.error('Необработанная ошибка:', err.message);
    if (res.headersSent) return;
    res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
});

process.on('unhandledRejection', (reason) => {
    console.error('unhandledRejection:', reason);
});

// ── Запуск ──
app.listen(PORT, async () => {
    console.log(`✅ Магазин запущен на порту ${PORT}`);
    loadOrderLog();
    await registerWebhook();
});
