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
// ЕСЛИ ТЕСТИРУЕШЬ (fake-деньги) -> ставь true
// ЕСЛИ ВКЛЮЧАЕШЬ НАСТОЯЩУЮ ОПЛАТУ (реальные деньги) -> ставь false
const IS_TESTNET = true; 

// Твой текущий токен (если он из @CryptoTestnetBot, оставь IS_TESTNET = true)
const CRYPTO_BOT_TOKEN = "600089:AAS5wF5Wl9iuPz56Le1D5Dm2ngceGh-HAMRF"; 
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

        // Автоматический выбор адреса в зависимости от переключателя
        const API_URL = IS_TESTNET 
            ? "https://testnet-pay.crypto.bot/api/createInvoice"
            : "https://pay.crypto.bot/api/createInvoice";

        let invoicePayload = {
            description: productName || "Товар",
            amount: cleanPrice,
            currency_type: 'crypto',
            asset: 'USDT' 
        };

        // Если валюта фиатная, настраиваем параметры под неё
        if (currency === 'USD' || currency === 'RUB' || currency === '₽' || currency === '$') {
            invoicePayload.currency_type = 'fiat';
            // Приводим значки к понятным для API кодам
            invoicePayload.fiat = (currency === '₽' ? 'RUB' : (currency === '$' ? 'USD' : currency));
            invoicePayload.accepted_assets = ['USDT', 'TON', 'BTC']; 
        }

        // Отправляем запрос
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
