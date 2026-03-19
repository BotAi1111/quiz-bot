const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// 👇 ТВОЙ ID
const ADMIN_CHAT_ID = '412726697';

// Хранилище
const captains = {};
const answers = {};
let currentQuestion = null;

app.post('/', async (req, res) => {
  try {
    const update = req.body;

    if (update.message) {
      const chatId = String(update.message.chat.id);
      const text = (update.message.text || '').trim();

      // ===== START =====
      if (text === '/start') {
        await sendMessage(chatId,
`Привет! Я бот для квиза 🚀

Капитаны:
 /register Team 1
 /me
 /answer Париж`
        );

      // ===== REGISTER =====
      } else if (text.toLowerCase().startsWith('/register')) {
        const teamRaw = text.replace(/^\/register\s*/i, '').trim();

        if (!teamRaw) {
          return sendMessage(chatId, 'Пример:\n/register Team 1');
        }

        const team = normalizeTeamName(teamRaw);
        captains[chatId] = team;

        return sendMessage(chatId, `Ты капитан ${team} ✅`);

      // ===== ME =====
      } else if (text === '/me') {
        const team = captains[chatId];

        if (!team) {
          return sendMessage(chatId, 'Ты не зарегистрирован');
        }

        return sendMessage(chatId, `Ты капитан ${team}`);

      // ===== OPEN =====
      } else if (text.startsWith('/open')) {
        if (!isAdmin(chatId)) {
          return sendMessage(chatId, 'Только для организаторов');
        }

        const q = text.replace('/open', '').trim();

        if (!q) return sendMessage(chatId, 'Пример: /open 1');

        currentQuestion = q;
        answers[q] = answers[q] || {};

        return sendMessage(chatId, `Вопрос ${q} открыт`);

      // ===== CURRENT =====
      } else if (text === '/current') {
        if (!isAdmin(chatId)) {
          return sendMessage(chatId, 'Только для организаторов');
        }

        return sendMessage(chatId,
          currentQuestion
            ? `Сейчас вопрос ${currentQuestion}`
            : 'Нет активного вопроса'
        );

      // ===== CLOSE =====
      } else if (text === '/close') {
        if (!isAdmin(chatId)) {
          return sendMessage(chatId, 'Только для организаторов');
        }

        if (!currentQuestion) {
          return sendMessage(chatId, 'Нет открытого вопроса');
        }

        const q = currentQuestion;
        currentQuestion = null;

        return sendMessage(chatId, `Вопрос ${q} закрыт`);

      // ===== ANSWER =====
      } else if (text.toLowerCase().startsWith('/answer')) {
        const team = captains[chatId];

        if (!team) {
          return sendMessage(chatId, 'Сначала /register Team 1');
        }

        if (!currentQuestion) {
          return sendMessage(chatId, 'Нет активного вопроса');
        }

        const ans = text.replace(/^\/answer\s*/i, '').trim();

        if (!ans) {
          return sendMessage(chatId, 'Пример:\n/answer Париж');
        }

        answers[currentQuestion] = answers[currentQuestion] || {};

        if (answers[currentQuestion][team]) {
          return sendMessage(chatId, 'Вы уже отвечали');
        }

        answers[currentQuestion][team] = ans;

        console.log(`Q${currentQuestion} | ${team}: ${ans}`);

        return sendMessage(chatId, 'Ответ принят ✅');

      // ===== RESULTS =====
      } else if (text.startsWith('/results')) {
        if (!isAdmin(chatId)) {
          return sendMessage(chatId, 'Только для организаторов');
        }

        let q = text.replace('/results', '').trim();
        if (!q) q = currentQuestion;

        if (!q) {
          return sendMessage(chatId, 'Нет активного вопроса');
        }

        const data = answers[q];

        if (!data || Object.keys(data).length === 0) {
          return sendMessage(chatId, `Нет ответов на вопрос ${q}`);
        }

        let msg = `Ответы на вопрос ${q}:\n\n`;

        for (const team in data) {
          msg += `• ${team}: ${data[team]}\n`;
        }

        return sendMessage(chatId, msg);

      // ===== DEFAULT =====
      } else {
        return sendMessage(chatId, 'Не понимаю команду');
      }
    }

    res.sendStatus(200);

  } catch (e) {
    console.error(e);
    res.sendStatus(200);
  }
});

// ===== HELPERS =====

function isAdmin(chatId) {
  return chatId === ADMIN_CHAT_ID;
}

function normalizeTeamName(value) {
  const match = value.match(/^team\s*(\d+)$/i);
  if (match) return `Team ${match[1]}`;
  return value;
}

async function sendMessage(chatId, text) {
  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running'));