const express = require('express');
const path = require('path');
const axios = require('axios'); 
const https = require('https'); 

const app = express();
app.use(express.json());

// 1. Раздаем фронтенд из папки public
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// НАСТРОЙКА XROCKET (ROCKET PAY)
// ==========================================
// Вставь сюда свой API-токен (ключ) от xRocket
const X_ROCKET_TOKEN = "0090c64be8a83ecbfcbae9a53"; 

// Какую монету принимать? По умолчанию ставим USDT. 
const PAYMENT_ASSET = 'USDT'; 
// ==========================================

// 2. Обрабатываем создание счета в xRocket
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

        // Очищаем цену от лишних знаков и переводим в число
        const cleanPriceString = price.toString().replace(/[^\d.]/g, '');
        const finalAmount = parseFloat(cleanPriceString);

        if (isNaN(finalAmount) || finalAmount <= 0) {
            return res.status(400).json({ success: false, error: "Некорректная сумма товара" });
        }

        // ИСПРАВЛЕНО: Изменено с .com на .org
        const API_URL = "https://pay.ton-rocket.org/tg-invoices";

        // Формируем payload по документации xRocket
        const invoicePayload = {
            amount: finalAmount,      
            token: PAYMENT_ASSET,     
            description: productName || "Оплата товара" 
        };

        // Отправляем запрос в xRocket
        const response = await axios.post(API_URL, invoicePayload, {
            headers: {
                'Rocket-Pay-Key': X_ROCKET_TOKEN, 
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            httpsAgent: new https.Agent({ rejectUnauthorized: false })
        });

        const data = response.data;

        if (data.success && data.data && data.data.link) {
            return res.status(200).json({ 
                success: true, 
                payUrl: data.data.link 
            });
        } else {
            return res.status(400).json({ 
                success: false, 
                error: data.message || 'Ошибка API xRocket' 
            });
        }

    } catch (error) {
        console.error("=== ОШИБКА НА СЕРВЕРЕ XROCKET ===");
        let details = error.message;
        if (error.response && error.response.data) {
            details = JSON.stringify(error.response.data);
        }
        
        return res.status(500).json({ 
            success: false, 
            error: `Ошибка xRocket: ${details}` 
        });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Магазин Amigos запущен на порту ${PORT}`));
