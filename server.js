const express = require('express');
const path = require('path');
const axios = require('axios');

const app = express();
app.use(express.json());

// Раздаём фронтенд из папки public
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// НАСТРОЙКА КРИПТОБОТА
// ==========================================
const IS_TESTNET = false;

// Токен из @CryptoBot → Crypto Pay → My Apps
const CRYPTO_BOT_TOKEN = "600987:AAOqeM3fM08JDbEbu2yCDU1F7b6g7o9922x";

// ПРАВИЛЬНЫЕ домены CryptoBot API (pay.crypt.bot, НЕ .pro)
const API_URL = IS_TESTNET
    ? "https://testnet-pay.crypt.bot/api/createInvoice"
    : "https://pay.crypt.bot/api/createInvoice";
// ==========================================

// Создание счёта в CryptoBot
app.post('/api/create-invoice', async (req, res) => {
    try {
        const { productName, price } = req.body;

        if (!price) {
            return res.status(400).json({ success: false, error: "Цена не получена от фронтенда" });
        }

        // Очищаем цену: оставляем только цифры и точку
        const cleanPrice = parseFloat(price.toString().replace(/[^\d.]/g, '')).toFixed(2);

        if (isNaN(cleanPrice) || parseFloat(cleanPrice) <= 0) {
            return res.status(400).json({ success: false, error: "Некорректная цена" });
        }

        const invoicePayload = {
            description: (productName || "Товар").substring(0, 1024), // API ограничение
            amount: cleanPrice,
            currency_type: 'crypto',
            asset: 'USDT'
        };

        const response = await axios.post(API_URL, invoicePayload, {
            headers: {
                'Crypto-Pay-API-Token': CRYPTO_BOT_TOKEN,
                'Content-Type': 'application/json'
            },
            timeout: 10000 // 10 секунд таймаут
        });

        const data = response.data;

        if (data.ok) {
            return res.status(200).json({
                success: true,
                payUrl: data.result.pay_url
            });
        } else {
            const apiError = data.error
                ? `${data.error.name} (код ${data.error.code})`
                : 'Неизвестная ошибка CryptoBot';
            console.error("Ошибка от CryptoBot API:", data.error);
            return res.status(400).json({ success: false, error: apiError });
        }

    } catch (error) {
        console.error("=== ОШИБКА НА СЕРВЕРЕ ===");

        // Ошибка DNS / сети (ENOTFOUND, ECONNREFUSED и т.д.)
        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            console.error("Сетевая ошибка:", error.code, error.message);
            return res.status(500).json({
                success: false,
                error: "Нет соединения с сервером CryptoBot. Проверьте интернет-соединение."
            });
        }

        // Ошибка с ответом от API (4xx, 5xx)
        if (error.response) {
            console.error("Ответ API с ошибкой:", error.response.status, error.response.data);
            return res.status(500).json({
                success: false,
                error: `Ошибка CryptoBot API: ${JSON.stringify(error.response.data)}`
            });
        }

        // Таймаут
        if (error.code === 'ECONNABORTED') {
            return res.status(500).json({
                success: false,
                error: "Превышено время ожидания ответа от CryptoBot"
            });
        }

        return res.status(500).json({
            success: false,
            error: `Внутренняя ошибка сервера: ${error.message}`
        });
    }
});

// SPA fallback — все остальные маршруты отдают index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Магазин Amigos запущен на порту ${PORT}`));
