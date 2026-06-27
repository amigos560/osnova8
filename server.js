const express = require('express');
const path    = require('path');
const axios   = require('axios');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ══════════════════════════════════════════
//  НАСТРОЙКИ — заполни перед запуском
// ══════════════════════════════════════════
const CRYPTO_BOT_TOKEN = "600987:AAOqeM3fM08JDbEbu2yCDU1F7b6g7o9922x";

const TG_BOT_TOKEN = "8904225827:AAFI2SJDpdA-z4-MeIdZpQloyEIPhHNX-Gc";  // из @BotFather → /newbot
const TG_OWNER_ID  = "8656762078";     // из @userinfobot

// Твой домен БЕЗ слэша в конце. Пример: "https://amigos-shop.up.railway.app"
const MY_DOMAIN = "https://amigosaccs.store";

const IS_TESTNET = false;
const CRYPTOBOT_BASE = IS_TESTNET ? "https://testnet-pay.crypt.bot" : "https://pay.crypt.bot";
// ══════════════════════════════════════════


// ── Отправка уведомления тебе в Telegram ──
async function notifyOwner(text) {
    try {
        await axios.post(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
            chat_id:    TG_OWNER_ID,
            text:       text,
            parse_mode: 'HTML'
        });
    } catch (e) {
        console.error("Ошибка уведомления в Telegram:", e.message);
    }
}


// ── Автоматическая регистрация вебхука в CryptoBot ──
// Вызывается один раз при старте сервера.
// CryptoBot запоминает адрес навсегда — при следующих запусках тоже работает.
async function registerWebhook() {
    const webhookUrl = `${MY_DOMAIN}/api/payment-webhook`;
    try {
        // Сначала смотрим, какой вебхук уже стоит
        const info = await axios.get(`${CRYPTOBOT_BASE}/api/getWebhookInfo`, {
            headers: { 'Crypto-Pay-API-Token': CRYPTO_BOT_TOKEN }
        });

        const current = info.data?.result?.url || '';

        if (current === webhookUrl) {
            console.log(`✅ Вебхук уже зарегистрирован: ${webhookUrl}`);
            return;
        }

        // Если адрес другой (или не стоит) — регистрируем
        const res = await axios.post(`${CRYPTOBOT_BASE}/api/setWebhook`,
            { url: webhookUrl },
            { headers: { 'Crypto-Pay-API-Token': CRYPTO_BOT_TOKEN, 'Content-Type': 'application/json' } }
        );

        if (res.data?.ok) {
            console.log(`✅ Вебхук зарегистрирован: ${webhookUrl}`);
        } else {
            console.error("❌ CryptoBot не принял вебхук:", res.data);
        }
    } catch (e) {
        console.error("❌ Ошибка регистрации вебхука:", e.message);
    }
}


// ── Создание инвойса (покупатель нажал «Перейти к оплате») ──
app.post('/api/create-invoice', async (req, res) => {
    try {
        const { productName, price, currency, buyerTelegram, buyerEmail } = req.body;

        if (!price)         return res.status(400).json({ success: false, error: "Цена не указана" });
        if (!buyerTelegram) return res.status(400).json({ success: false, error: "Укажите Telegram" });
        if (!buyerEmail)    return res.status(400).json({ success: false, error: "Укажите Email" });

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
            return res.status(400).json({ success: false, error: "Email указан неверно" });
        }

        const tg         = buyerTelegram.startsWith('@') ? buyerTelegram : '@' + buyerTelegram;
        const cleanPrice = parseFloat(price.toString().replace(/[^\d.]/g, '')).toFixed(2);

        if (isNaN(cleanPrice) || parseFloat(cleanPrice) <= 0) {
            return res.status(400).json({ success: false, error: "Некорректная цена" });
        }

        // Сохраняем данные покупателя внутри инвойса — CryptoBot вернёт их в вебхуке
        const buyerPayload = JSON.stringify({ tg, email: buyerEmail, product: productName });

        const response = await axios.post(`${CRYPTOBOT_BASE}/api/createInvoice`, {
            description:   (productName || "Товар").substring(0, 1024),
            amount:        cleanPrice,
            currency_type: 'crypto',
            asset:         'USDT',
            payload:       buyerPayload
        }, {
            headers: { 'Crypto-Pay-API-Token': CRYPTO_BOT_TOKEN, 'Content-Type': 'application/json' },
            timeout: 10000
        });

        const data = response.data;

        if (data.ok) {
            // Уведомление: новый заказ ожидает оплаты
            await notifyOwner(
`🛒 <b>Новый заказ — ожидает оплаты</b>

📦 <b>Товар:</b> ${productName}
💰 <b>Сумма:</b> ${cleanPrice} USDT
👤 <b>Telegram:</b> ${tg}
📧 <b>Email:</b> ${buyerEmail}
🔗 <b>Ссылка на оплату:</b> <a href="${data.result.pay_url}">открыть</a>
🆔 <b>Invoice ID:</b> <code>${data.result.invoice_id}</code>`
            );

            return res.status(200).json({ success: true, payUrl: data.result.pay_url });
        } else {
            const err = data.error ? `${data.error.name} (код ${data.error.code})` : 'Ошибка CryptoBot';
            return res.status(400).json({ success: false, error: err });
        }

    } catch (error) {
        console.error("=== ОШИБКА СЕРВЕРА ===", error.message);
        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED')
            return res.status(500).json({ success: false, error: "Нет соединения с CryptoBot" });
        if (error.code === 'ECONNABORTED')
            return res.status(500).json({ success: false, error: "Таймаут — CryptoBot не ответил" });
        if (error.response)
            return res.status(500).json({ success: false, error: `Ошибка API: ${JSON.stringify(error.response.data)}` });
        return res.status(500).json({ success: false, error: error.message });
    }
});


// ── Вебхук от CryptoBot — срабатывает когда покупатель ОПЛАТИЛ ──
app.post('/api/payment-webhook', async (req, res) => {
    try {
        const update = req.body;

        // Нас интересует только событие «счёт оплачен»
        if (update.update_type !== 'invoice_paid') {
            return res.sendStatus(200);
        }

        const invoice   = update.payload;
        const amount    = invoice.amount;
        const asset     = invoice.asset;
        const invoiceId = invoice.invoice_id;

        // Достаём данные покупателя из payload
        let buyer = { tg: 'неизвестно', email: 'неизвестно', product: 'неизвестно' };
        try { buyer = JSON.parse(invoice.payload); } catch (_) {}

        // Уведомление: оплата прошла, надо выдать товар
        await notifyOwner(
`✅ <b>ОПЛАТА ПОЛУЧЕНА — выдай товар!</b>

📦 <b>Товар:</b> ${buyer.product}
💰 <b>Оплачено:</b> ${amount} ${asset}
👤 <b>Telegram покупателя:</b> ${buyer.tg}
📧 <b>Email покупателя:</b> ${buyer.email}
🆔 <b>Invoice ID:</b> <code>${invoiceId}</code>

⏰ <b>Выдай товар в течение 5 минут!</b>`
        );

        res.sendStatus(200);
    } catch (e) {
        console.error("Ошибка вебхука:", e.message);
        res.sendStatus(500);
    }
});


// SPA fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// ── Запуск ──
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`✅ Магазин запущен на порту ${PORT}`);
    // Регистрируем вебхук сразу при старте
    await registerWebhook();
});
