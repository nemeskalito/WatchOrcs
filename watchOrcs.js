require('dotenv').config();

const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const sharp = require('sharp');
const fs = require('fs');
const express = require('express');

// ====== CONFIG ======
const BOT_TOKEN = "8528668156:AAFlMyr3XGmPbAYnxnqTlEYT00opdBlVhWY";

const COLLECTION_ADDRESS =
  '0:463685d77d0474ec774386d92622ed688d34f07230741211d838c487dcfeec64';

const LIMIT = 1;
const MAX_SEND = 1;
const IMG_WIDTH = 350;
const CHECK_INTERVAL = 10000; // 10 сек
const STATE_FILE = './state.json';

let OFFSET = 30926;
let isChecking = false;
let blockedUntil = 0;

// ====== LOAD STATE ======
if (fs.existsSync(STATE_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (typeof saved.OFFSET === 'number') OFFSET = saved.OFFSET;
  } catch {}
}

// ====== SAVE STATE ======
function saveState() {
  fs.writeFileSync(STATE_FILE, JSON.stringify({ OFFSET }, null, 2));
}

// ====== BOT ======
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('🤖 Bot started');

// ====== FETCH NFT ======
async function fetchNft() {
  if (Date.now() < blockedUntil) return [];

  const url = `https://tonapi.io/v2/nfts/collections/${COLLECTION_ADDRESS}/items?limit=1&offset=${OFFSET}`;

  try {
    const { data } = await axios.get(url, { timeout: 10000 });
    return data.nft_items || [];
  } catch (err) {
    if (err.response?.status === 429) {
      console.log('⛔ 429 — пауза 2 минуты');
      blockedUntil = Date.now() + 2 * 60 * 1000;
    } else {
      console.error('TON API error:', err.message);
    }
    return [];
  }
}

// ====== FILTER ======
function filterSkinTone(items) {
  return items.filter(item =>
    item.metadata?.attributes?.some(
      a => a.trait_type === 'Skin Tone'
    )
  );
}

// ====== SEND IMAGE ======
async function sendPhotoResized(chatId, url, caption) {
  try {
    if (!url) throw new Error('No image');

    if (url.startsWith('ipfs://')) {
      url = url.replace('ipfs://', 'https://ipfs.io/ipfs/');
    }

    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);

    const resized = await sharp(buffer)
      .resize({ width: IMG_WIDTH })
      .toBuffer();

    await bot.sendPhoto(chatId, resized, {
      caption: caption.slice(0, 1024)
    });
  } catch {
    await bot.sendMessage(chatId, caption + '\n(картинка недоступна)');
  }
}

// ====== WATCHER ======
async function checkNewOrcs(chatId) {
  if (isChecking) return;
  isChecking = true;

  try {
    const items = await fetchNft();
    if (!items.length) return;

    // ⬅️ OFFSET ДВИГАЕМ ВСЕГДА
    OFFSET += items.length;
    saveState();

    const newOrcs = filterSkinTone(items);

    for (const item of newOrcs.slice(0, MAX_SEND)) {
      const nft = item.metadata || {};
      const caption = `🧟‍♂️ NEW NFT\n${nft.name || 'No name'}\n#${OFFSET - 1}`;
      await sendPhotoResized(chatId, nft.image, caption);
    }
  } finally {
    isChecking = false;
  }
}

// ====== COMMAND ======
let watcherStarted = false;

bot.onText(/\/watch_orcs/, async (msg) => {
  const chatId = msg.chat.id;

  if (watcherStarted) {
    return bot.sendMessage(chatId, '⏳ Уже запущен');
  }

  watcherStarted = true;
  await bot.sendMessage(
    chatId,
    `👀 Слежу за NFT\nИнтервал: 10 сек\nOffset: ${OFFSET}`
  );

  await checkNewOrcs(chatId);

  setInterval(() => {
    checkNewOrcs(chatId);
  }, CHECK_INTERVAL);
});

// ====== EXPRESS ======

process.on('uncaughtException', e => console.error('UNCAUGHT:', e));
process.on('unhandledRejection', e => console.error('UNHANDLED REJECTION:', e));

const app = express();

app.get('/', (req, res) => res.send('Bot is alive!'));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));