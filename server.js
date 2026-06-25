const express = require('express');
const path = require('path');
const axios = require('axios'); // Axios работает стабильно на любых версиях Node.js

const app = express();
app.use(express.json());

// 1. Раздаем фронтенд (картинки, стили, index.html) из папки public
app.use(express.static(path.join(__dirname, 'public')));

// 2. Обрабатываем создание счета в CryptoBot (Основная сеть)
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

        // Очищаем цену от лишних знаков, оставляя только цифры и точку
        const cleanPrice = price.toString().replace(/[^\d.]/g, '');

        const CRYPTO_BOT_TOKEN = "600089:AAS5wF5Wl9iuPz56Le1D5Dm2ngceGh-HAMRF"; 
        
        // Адрес ОСНОВНОЙ сети CryptoBot
        const API_URL = "https://pay.cryptobot.pro/api/createInvoice";

        let invoicePayload = {
            description: productName || "Товар",
            amount: cleanPrice,
            currency_type: 'crypto',
            asset: 'USDT' 
        };

        // Если цена в USD или RUB, переключаем CryptoBot в режим фиата
        if (currency === 'USD' || currency === 'RUB') {
            invoicePayload.currency_type = 'fiat';
            invoicePayload.fiat = currency;
            // ИСПРАВЛЕНО: API требует строго массив строк, а не строку через запятую
            invoicePayload.accepted_assets = ['USDT', 'TON', 'BTC']; 
        }

        // Отправляем запрос в CryptoBot
        const response = await axios.post(API_URL, invoicePayload, {
            headers: {
                'Crypto-Pay-API-Token': CRYPTO_BOT_TOKEN,
                'Content-Type': 'application/json'
            }
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
        if (error.response) {
            // Выводим в логи Render точную причину, которую вернул CryptoBot
            console.error("CryptoBot вернул ошибку:", error.response.data);
        } else {
            console.error(error.message);
        }
        return res.status(500).json({ success: false, error: "Внутренняя ошибка сервера" });
    }
});

// Если пользователь просто зашел на сайт, отдаем ему index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Магазин Amigos запущен на порту ${PORT}`));
