const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Твой Telegram chat_id
const ADMIN_CHAT_ID = '412726697';

// Временное хранилище в памяти
const captains = {};
const answers = {};
let currentQuestion = null;

// Защита от повторной обработки одного и того же update
const processedUpdates = new Set();

app.post('/', async (req, res) => {
  try {
    const update = req.body;

    // Telegram update_id
    const updateId = update.update_id;
    if (processedUpdates.has(updateId)) {
      return res.sendStatus(200);
    }
    processedUpdates.add(updateId);

    // Чтобы set не рос бесконечно
    if (processedUpdates.size > 1000) {
      const firstKey = processedUpdates.values().next().value;
      processedUpdates.delete(firstKey);
    }

    if (update.message) {
      const chatId = String(update.message.chat.id);
      const text = (update.message.text || '').trim();

      console.log(`UPDATE ${updateId} | chat ${chatId} | text: ${text}`);

      if (text === '/start') {
        await sendMessage(
          chatId,
          'Привет! Я бот для квиза 🚀\n\nКоманды для капитанов:\n/register Team 1\n/me\n/answer Париж'
        );

      } else if (text === '/id') {
        await sendMessage(chatId, `Твой chat_id: ${chatId}`);

      } else if (text.toLowerCase().startsWith('/register')) {
        const teamRaw = text.replace(/^\/register\s*/i, '').trim();

        if (!teamRaw) {
          await sendMessage(chatId, 'Пример:\n/register Team 1');
        } else {
          const team = normalizeTeamName(teamRaw);
          captains[chatId] = team;
          await sendMessage(chatId, `Ты капитан ${team} ✅`);
        }

      } else if (text === '/me') {
        const team = captains[chatId];

        if (!team) {
          await sendMessage(chatId, 'Ты не зарегистрирован');
        } else {
          await sendMessage(chatId, `Ты капитан ${team} ✅`);
        }

      } else if (text.startsWith('/open')) {
        if (!isAdmin(chatId)) {
          await sendMessage(chatId, 'Эта команда доступна только организаторам.');
        } else {
          const q = text.replace(/^\/open\s*/i, '').trim();

          if (!q) {
            await sendMessage(chatId, 'Пример:\n/open 1');
          } else {
            currentQuestion = q;
            answers[q] = answers[q] || {};
            await sendMessage(chatId, `Вопрос ${q} открыт`);
          }
        }

      } else if (text === '/current') {
        if (!isAdmin(chatId)) {
          await sendMessage(chatId, 'Эта команда доступна только организаторам.');
        } else {
          await sendMessage(
            chatId,
            currentQuestion ? `Сейчас вопрос ${currentQuestion}` : 'Сейчас нет открытого вопроса.'
          );
        }

      } else if (text === '/close') {
        if (!isAdmin(chatId)) {
          await sendMessage(chatId, 'Эта команда доступна только организаторам.');
        } else {
          if (!currentQuestion) {
            await sendMessage(chatId, 'Сейчас нет открытого вопроса.');
          } else {
            const q = currentQuestion;
            currentQuestion = null;
            await sendMessage(chatId, `Вопрос ${q} закрыт`);
          }
        }

      } else if (text.toLowerCase().startsWith('/answer')) {
        const team = captains[chatId];

        if (!team) {
          await sendMessage(chatId, 'Сначала зарегистрируйся:\n/register Team 1');
        } else if (!currentQuestion) {
          await sendMessage(chatId, 'Сейчас нет открытого вопроса. Подожди, пока организаторы откроют вопрос.');
        } else {
          const ans = text.replace(/^\/answer\s*/i, '').trim();

          if (!ans) {
            await sendMessage(chatId, 'Пример:\n/answer Париж');
          } else {
            answers[currentQuestion] = answers[currentQuestion] || {};

            if (answers[currentQuestion][team]) {
              await sendMessage(chatId, `Команда ${team} уже отвечала на вопрос ${currentQuestion}.`);
            } else {
              answers[currentQuestion][team] = ans;
              console.log(`Q${currentQuestion} | ${team}: ${ans}`);
              await sendMessage(chatId, `Ответ "${ans}" принят от команды ${team} на вопрос ${currentQuestion} ✅`);
            }
          }
        }

      } else if (text.startsWith('/results')) {
        if (!isAdmin(chatId)) {
          await sendMessage(chatId, 'Эта команда доступна только организаторам.');
        } else {
          let q = text.replace(/^\/results\s*/i, '').trim();
          if (!q) q = currentQuestion;

          if (!q) {
            await sendMessage(chatId, 'Нет активного вопроса');
          } else {
            const data = answers[q];

            if (!data || Object.keys(data).length === 0) {
              await sendMessage(chatId, `Нет ответов на вопрос ${q}`);
            } else {
              let msg = `Ответы на вопрос ${q}:\n\n`;
              for (const team in data) {
                msg += `• ${team}: ${data[team]}\n`;
              }
              await sendMessage(chatId, msg);
            }
          }
        }

      } else {
        if (isAdmin(chatId)) {
          await sendMessage(
            chatId,
            'Команды организатора:\n/open 1\n/current\n/close\n/results\n/results 1\n\nКоманды капитанов:\n/register Team 1\n/me\n/answer текст'
          );
        } else {
          await sendMessage(chatId, 'Я понимаю команды:\n/register Team 1\n/me\n/answer текст');
        }
      }
    }

    res.sendStatus(200);
  } catch (e) {
    console.error(e);
    res.sendStatus(200);
  }
});

function isAdmin(chatId) {
  return String(chatId) === String(ADMIN_CHAT_ID);
}

function normalizeTeamName(value) {
  const cleaned = value.trim().replace(/\s+/g, ' ');
  const match = cleaned.match(/^team\s*(\d+)$/i);
  if (match) return `Team ${match[1]}`;
  return cleaned;
}

async function sendMessage(chatId, text) {
  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running'));