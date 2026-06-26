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
const IS_TESTNET = false; 

// Твой реальный токен из официального @CryptoBot
const CRYPTO_BOT_TOKEN = "600987:AAOqeM3fM08JDbEbu2yCDU1F7b6g7o9922x"; 
// ==========================================

// 2. Обрабатываем создание счета в CryptoBot
app.post('/api/create-invoice', async (req, res) => {
    try {
        let body = req.body;
        if (typeof body === 'string') {
            body = JSON.parse(body);
        }

        const { productName, price } = body;

        if (!price) {
            return res.status(400).json({ success: false, error: "Цена не получена от фронтенда" });
        }

        // Очищаем цену от лишних знаков
        const cleanPrice = price.toString().replace(/[^\d.]/g, '');

        // Официальные и рабочие домены .pro
        const API_URL = IS_TESTNET 
            ? "https://testnet-pay.cryptobot.pro/api/createInvoice"
            : "https://pay.cryptobot.pro/api/createInvoice";

        // СТРОГО КРИПТОВАЛЮТА (USDT): Работает у всех без верификации
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
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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
            // Расширенная диагностика ошибки от API
            const apiError = data.error ? `${data.error.name} (код ${data.error.code})` : 'Неизвестная ошибка CryptoBot';
            return res.status(400).json({ 
                success: false, 
                error: apiError 
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
app.listen(PORT, () => console.log(`Магазин Amigos успешно запущен`));
