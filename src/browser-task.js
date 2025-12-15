import {connect} from "puppeteer-real-browser";
import dotenv from 'dotenv';
import EventEmitter from "events";
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

dotenv.config();
const site = process.env.SITE_LINK
const rawCoins = process.env.COINS;
const rawUsers = process.env.ACCOUNTS;
const coinCheckUrl = process.env.COIN_CHECK;
let IS_SECURE_CONNECTION_ENABLED = true;
const coinEmitter = new EventEmitter();

const coins = !rawCoins
    ? []
    : rawCoins.includes(',')
        ? rawCoins.split(',').map(c => c.trim()).filter(Boolean)
        : [rawCoins.trim()];

const users= rawUsers?.length ? rawUsers.split(';')
    .map(user => {
      const [email, password] = user.split(':');
      return email && password ? { email, password } : null;
    })
    .filter(Boolean) : [];

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

async function waitForCoins() {
  console.log("⏳ Очікуємо появу монет...");

  while (true) {
    try {
      const html = await (await fetch(coinCheckUrl)).text();

      const qtyMatch = html.match(/<span class=pd_qty>(\d+)<\/span>/);
      const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 0;

      if (qty > 0) {
        console.log(`🚀 Монети з’явилися: ${qty} шт`);
        coinEmitter.emit("coin");
        return;
      }
    } catch (err) {
      console.log("❌ Помилка моніторингу:", err);
    }
    await new Promise(r => setTimeout(r, 100)); // throttle
  }
}

async function tryBuyCoin(page, coinId) {
  return await page.evaluate(id => {
    const btn = document.querySelector(`span.main-basked-icon.add2cart[data-id="${id}"]`);
    if (!btn) return false;
    btn.click();
    return true;
  }, coinId);
}

async function buyForAccount(session) {
  const { email, page, coinId } = session;

  console.log(`[${email}] 🔍 Шукаю монету ID ${coinId}`);
  await page.reload({ waitUntil: "networkidle2" });

  const clicked = await tryBuyCoin(page, coinId);

  if (!clicked) {
    console.log(`[${email}] ❌ Кнопку не знайдено`);
    return false;
  }

  await sleep(1500);

  console.log(`[${email}] ✅ Монета ${coinId} додана`);
  return true;
}

async function waitForHoldTightIfExists(page, waitMs = 6000) {
  const hasShield = await page.evaluate(() => {
    const h1 = document.querySelector('h1');
    if (h1 && /Hold\s*tight/i.test(h1.textContent)) return true;
    const right = document.querySelector('.container .right');
    return right && right.textContent.includes('secure connection');
  });

  if (hasShield) {
    IS_SECURE_CONNECTION_ENABLED = true;
    console.log(`🛡️ "Hold tight" — чекаємо ${waitMs / 1000}s...`);
    await sleep(waitMs);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  }
}

async function waitForHighActivityIfExists(page, waitMs = 10000) {
  const hasHighActivity = await page.evaluate(() => {
    const leadMsg = document.querySelector('p.lead-message');
    return leadMsg && /Висока\s+активність\s+на\s+сайті/i.test(leadMsg.textContent);
  });

  if (hasHighActivity) {
    console.log(`⚠️ "Висока активність на сайті" — чекаємо ${waitMs / 1000}s...`);
    await sleep(waitMs);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  }
}

async function performLogin(page, email, password) {
  console.log(`[${email}] 🔐 Вхід...`);
  await page.goto(`${site}/login.php`, { waitUntil: "networkidle2" });

  await waitForHoldTightIfExists(page);
  await waitForHighActivityIfExists(page);

  await page.type('input[name="email_address"]', email).catch(() => {});
  await page.type('input[name="password"]', password).catch(() => {});

  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => null),
    page.click("button.btn-default").catch(() => null),
  ]);

  await waitForHoldTightIfExists(page);
  await waitForHighActivityIfExists(page);

  const url = page.url();
  if (url.includes("/login.php")) {
    throw new Error(`[${email}] Логін неуспішний`);
  }

  console.log(`🌐 [${email}] Логін успішний, URL: ${url}`);

  if (!page.url().includes("/catalog.html")) {
    await page.goto(`${site}/catalog.html`, { waitUntil: "networkidle2" });
  }

  await waitForHoldTightIfExists(page);
  await waitForHighActivityIfExists(page);

  console.log(`📍 [${email}] В каталозі`);
}

async function findAndBuyCoin(page, coinId, email) {
  while (true) {
    await page.reload({ waitUntil: "networkidle2" });
    const clicked = await page.evaluate((id) => {
      const btn = document.querySelector(`span.main-basked-icon.add2cart[data-id="${id}"]`);
      if (btn) { btn.click(); return true; }
      return false;
    }, coinId);

    if (clicked) {
      console.log(`✅ [${email}] Монета (${coinId}) додана у кошик`);
      return true;
    }
    await sleep(500);
  }
}

export async function monitorPageForSingleCoin(page, browser, email, coinId) {
  console.log(`🚀 [${email}] Стартуємо моніторинг монети ${coinId}...`);

  await findAndBuyCoin(page, coinId, email);

  console.log(`🏁 [${email}] Завершено`);

  await sleep(15 * 60 * 1000);

  await browser.close();
}


async function runMonitoring(coinId) {

  const sessions = [];

  for (const { email, password } of users) {
    const { browser, page } = await connect({ headless: false, args: ["--start-maximized"] });

    await page.setViewport({ width: 1920, height: 1080 });
    await performLogin(page, email, password);

    sessions.push({
      email,
      password,
      page,
      browser,
      coinId
    });
  }

  if (IS_SECURE_CONNECTION_ENABLED === false) {
    while (sessions.length > 0) {
      await waitForCoins();

      const done = await Promise.all(
          sessions.map(s => buyForAccount(s))
      );

      for (let i = done.length - 1; i >= 0; i--) {
        if (done[i]) sessions.splice(i, 1);
      }

      console.log(`🔄 Залишилось акаунтів: ${sessions.length}`);

      if (sessions.length > 0) {
        await new Promise(r => setTimeout(r, 50));
      }
    }
  } else {
    await Promise.all(
        sessions.map(({ page, browser, email, coinId }) =>
            monitorPageForSingleCoin(page, browser, email, coinId)
        )
    );
  }

  console.log("🎉 Усі акаунти завершили роботу.");
}

runMonitoring(coins);