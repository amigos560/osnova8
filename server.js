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

const TG_BOT_TOKEN = "8904225827:AAFI2SJDpdA-z4-MeIdZpQloyEIPhHNX-Gc";   // токен из @BotFather
const TG_OWNER_ID  = "8656762078";       // твой chat_id из @userinfobot

const IS_TESTNET = false;
const API_URL = IS_TESTNET
    ? "https://testnet-pay.crypt.bot/api/createInvoice"
    : "https://pay.crypt.bot/api/createInvoice";
// ══════════════════════════════════════════

// Отправка уведомления владельцу в Telegram
async function notifyOwner(text) {
    try {
        await axios.post(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
            chat_id: TG_OWNER_ID,
            text: text,
            parse_mode: 'HTML'
        });
    } catch (e) {
        console.error("Ошибка отправки уведомления в Telegram:", e.message);
    }
}

// Создание инвойса
app.post('/api/create-invoice', async (req, res) => {
    try {
        const { productName, price, currency, buyerTelegram, buyerEmail } = req.body;

        // Валидация полей
        if (!price)         return res.status(400).json({ success: false, error: "Цена не указана" });
        if (!buyerTelegram) return res.status(400).json({ success: false, error: "Укажите Telegram" });
        if (!buyerEmail)    return res.status(400).json({ success: false, error: "Укажите Email" });

        // Простая проверка email
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
            return res.status(400).json({ success: false, error: "Email указан неверно" });
        }

        // Нормализуем Telegram (убираем @ если написал с ним)
        const tg = buyerTelegram.startsWith('@') ? buyerTelegram : '@' + buyerTelegram;

        const cleanPrice = parseFloat(price.toString().replace(/[^\d.]/g, '')).toFixed(2);
        if (isNaN(cleanPrice) || parseFloat(cleanPrice) <= 0) {
            return res.status(400).json({ success: false, error: "Некорректная цена" });
        }

        // Вкладываем данные покупателя в payload (CryptoBot вернёт их в вебхуке)
        const payload = JSON.stringify({ tg, email: buyerEmail, product: productName });

        const invoicePayload = {
            description: (productName || "Товар").substring(0, 1024),
            amount:      cleanPrice,
            currency_type: 'crypto',
            asset:       'USDT',
            payload:     payload   // ← эти данные вернутся в вебхуке при оплате
        };

        const response = await axios.post(API_URL, invoicePayload, {
            headers: {
                'Crypto-Pay-API-Token': CRYPTO_BOT_TOKEN,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });

        const data = response.data;

        if (data.ok) {
            // Сразу уведомляем о новом заказе (ожидает оплаты)
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

        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            return res.status(500).json({ success: false, error: "Нет соединения с CryptoBot" });
        }
        if (error.code === 'ECONNABORTED') {
            return res.status(500).json({ success: false, error: "Таймаут — CryptoBot не ответил" });
        }
        if (error.response) {
            return res.status(500).json({ success: false, error: `Ошибка API: ${JSON.stringify(error.response.data)}` });
        }

        return res.status(500).json({ success: false, error: error.message });
    }
});

// Вебхук от CryptoBot — вызывается когда оплата ПРОШЛА
app.post('/api/payment-webhook', async (req, res) => {
    try {
        const update = req.body;

        // Проверяем что это именно событие оплаты
        if (update.update_type !== 'invoice_paid') {
            return res.sendStatus(200);
        }

        const invoice = update.payload; // объект инвойса от CryptoBot
        const amount  = invoice.amount;
        const asset   = invoice.asset;
        const invoiceId = invoice.invoice_id;

        // Достаём данные покупателя из payload который мы сохранили при создании
        let buyer = { tg: 'неизвестно', email: 'неизвестно', product: 'неизвестно' };
        try {
            buyer = JSON.parse(invoice.payload);
        } catch (e) {
            console.error("Не удалось разобрать payload:", invoice.payload);
        }

        // Уведомление: оплата прошла — нужно выдать товар
        await notifyOwner(
`✅ <b>ОПЛАТА ПОЛУЧЕНА — выдай товар!</b>

📦 <b>Товар:</b> ${buyer.product}
💰 <b>Оплачено:</b> ${amount} ${asset}
👤 <b>Telegram:</b> ${buyer.tg}
📧 <b>Email:</b> ${buyer.email}
🆔 <b>Invoice ID:</b> <code>${invoiceId}</code>

⏰ <b>Выдай товар в течение 5 минут!</b>`
        );

        res.sendStatus(200);
    } catch (e) {
        console.error("Ошибка обработки вебхука:", e.message);
        res.sendStatus(500);
    }
});

// SPA fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Магазин запущен на порту ${PORT}`));
