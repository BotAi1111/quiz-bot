const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Простое временное хранилище в памяти.
// После перезапуска сервиса данные очистятся.
const captains = {};

app.post('/', async (req, res) => {
  try {
    const update = req.body;

    if (update.message) {
      const chatId = String(update.message.chat.id);
      const text = (update.message.text || '').trim();

      if (text === '/start') {
        await sendMessage(
          chatId,
          'Привет! Я бот для квиза 🚀\n\nЧтобы зарегистрироваться как капитан команды, отправь команду в формате:\n/register Team 1'
        );
      } else if (text.toLowerCase().startsWith('/register')) {
        const teamNameRaw = text.replace(/^\/register\s*/i, '').trim();

        if (!teamNameRaw) {
          await sendMessage(
            chatId,
            'Нужно указать название команды. Пример:\n/register Team 1'
          );
        } else {
          const teamName = normalizeTeamName(teamNameRaw);
          captains[chatId] = teamName;

          await sendMessage(
            chatId,
            `Готово! Ты зарегистрирован как капитан команды ${teamName}.`
          );
        }
      } else if (text === '/me') {
        const teamName = captains[chatId];

        if (teamName) {
          await sendMessage(chatId, `Ты зарегистрирован как капитан команды ${teamName}.`);
        } else {
          await sendMessage(
            chatId,
            'Ты пока не зарегистрирован. Используй команду:\n/register Team 1'
          );
        }
      } else {
        await sendMessage(
          chatId,
          'Я пока понимаю команды:\n/start\n/register Team 1\n/me'
        );
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(200);
  }
});

function normalizeTeamName(value) {
  const cleaned = value.trim().replace(/\s+/g, ' ');

  const match = cleaned.match(/^team\s+(\d+)$/i);
  if (match) {
    return `Team ${match[1]}`;
  }

  return cleaned;
}

async function sendMessage(chatId, text) {
  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text: text
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server running on port', PORT);
});