import express from "express";
import { runMonitoring } from './browser-task.js';
import dotenv from 'dotenv';

dotenv.config();
const site = process.env.SITE_LINK
const rawCoins = process.env.COINS;
const rawUsers = process.env.ACCOUNTS;
const coinCheckUrl = process.env.COIN_CHECK;

const app = express();
app.use(express.json());

app.get("/run-monitoring", async (req, res) => {
    if (!site || !rawCoins || !rawUsers || !coinCheckUrl) res.json({ status: "failed" });
    runMonitoring(site, rawCoins, rawUsers, coinCheckUrl)
        .then(() => console.log("✔ Моніторинг завершено"))
        .catch(err => console.error("❌ Помилка:", err));

    res.json({ status: "started" });
});

app.listen(3000, () => {
    console.log("🚀 Server running at http://localhost:3000");
});
