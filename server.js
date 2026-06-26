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
// ЕСЛИ ТЕСТИРУЕШЬ (виртуальные коины) -> ставь true
// ЕСЛИ ВКЛЮЧАЕШЬ НАСТОЯЩУЮ ОПЛАТУ (реальные деньги) -> ставь false
const IS_TESTNET = false; 

// Твой токен (из @CryptoTestnetBot если IS_TESTNET = true, или из @CryptoBot если false)
const CRYPTO_BOT_TOKEN = "600987:AAOqeM3fM08JDbEbu2yCDU1F7b6g7o9922x"; 
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

        // ИСПРАВЛЕНО НА ВЕКА: Абсолютно точные, официальные API-адреса CryptoBot
        const API_URL = IS_TESTNET 
            ? "https://testnet-pay.cryptobot.pro/api/createInvoice"
            : "https://pay.cryptobot.pro/api/createInvoice";

        let invoicePayload = {
            description: productName || "Товар",
            amount: cleanPrice,
            currency_type: 'crypto',
            asset: 'USDT' // По умолчанию выставляем счет в USDT, так как он доступен всем без верификации мерчанта
        };

        // Если аккаунт верифицирован в CryptoBot на прием фиата (рублей/долларов), этот блок сработает:
        if (currency === 'USD' || currency === 'RUB' || currency === '₽' || currency === '$') {
            invoicePayload.currency_type = 'fiat';
            invoicePayload.fiat = (currency === '₽' ? 'RUB' : (currency === '$' ? 'USD' : currency));
            invoicePayload.accepted_assets = ['USDT', 'TON', 'BTC']; 
        }

        // Отправляем запрос в CryptoBot
        const response = await axios.post(API_URL, invoicePayload, {
            headers: {
                'Crypto-Pay-API-Token': CRYPTO_BOT_TOKEN,
                'Content-Type': 'application/json',
                // Наша маскировка под настоящий браузер Chrome, чтобы Cloudflare не сбрасывал соединение
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            // Наш агент для обхода строгих локальных сертификатов Render
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
app.listen(PORT, () => console.log(`Магазин Amigos успешно запущен на порту ${PORT}`));
