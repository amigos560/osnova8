const express = require('express');
const path = require('path');
const axios = require('axios'); 
const https = require('https'); 

const app = express();
app.use(express.json());

// 1. Раздаем фронтенд из папки public
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// НАСТРОЙКА КРИПТОБОТА
// ==========================================
// Ставим false, так как тестируем именно реальную (основную) сеть
const IS_TESTNET = false; 

// Вставь сюда свой реальный токен из официального @CryptoBot (Crypto Pay -> My Apps)
const CRYPTO_BOT_TOKEN = "СЮДА_ВСТАВЬ_СВОЙ_РЕАЛЬНЫЙ_ТОКЕН"; 
// ==========================================

// 2. Обрабатываем создание счета в CryptoBot
app.post('/api/create-invoice', async (req, res) => {
    try {
        let body = req.body;
        if (typeof body === 'string') {
            body = JSON.parse(body);
        }

        const { productName, price, currency } = body;

        if (!price) {
            return res.status(400).json({ success: false, error: "Цена не получена от фронтенда" });
        }

        // Очищаем цену от лишних знаков
        const cleanPrice = price.toString().replace(/[^\d.]/g, '');

        // Автоматический выбор адреса основной сети (https://pay.crypto.bot)
        const API_URL = IS_TESTNET 
            ? "https://testnet-pay.crypto.bot/api/createInvoice"
            : "https://pay.crypto.bot/api/createInvoice";

        // ИСПРАВЛЕНО ПО ПУНКТУ 1:
        // Мы убрали условие проверки фиата (RUB/USD). Теперь счет ВСЕГДА создается в USDT.
        // Обрати внимание: цифра цены с сайта пойдет как количество USDT (например, если товар стоил 150 рублей, счет создастся на 150 USDT).
        // Для теста авторизации токена это абсолютно нормально.
        let invoicePayload = {
            description: productName || "Товар",
            amount: cleanPrice, 
            currency_type: 'crypto',
            asset: 'USDT' 
        };

        // Отправляем запрос в CryptoBot
        const response = await axios.post(API_URL, invoicePayload, {
            headers: {
                'Crypto-Pay-API-Token': CRYPTO_BOT_TOKEN,
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            httpsAgent: new https.Agent({ rejectUnauthorized: false })
        });

        const data = response.data;

        if (data.ok) {
            return res.status(200).json({ 
                success: true, 
                payUrl: data.result.pay_url 
            });
        } else {
            return res.status(400).json({ 
                success: false, 
                error: data.error ? data.error.name : 'CryptoBot API Error' 
            });
        }

    } catch (error) {
        console.error("=== ОШИБКА НА СЕРВЕРЕ ===");
        let details = error.message;
        if (error.response && error.response.data) {
            details = JSON.stringify(error.response.data);
        }
        
        return res.status(500).json({ 
            success: false, 
            error: `Ошибка CryptoBot: ${details}` 
        });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Магазин Amigos запущен. Тестовая сеть: ${IS_TESTNET}`));
