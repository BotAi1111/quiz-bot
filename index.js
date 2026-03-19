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

app.post('/', async (req, res) => {
  try {
    const update = req.body;

    if (update.message) {
      const chatId = String(update.message.chat.id);
      const text = (update.message.text || '').trim();

      if (text === '/start') {
        await sendMessage(
          chatId,
          'Привет! Я бот для квиза 🚀\n\nКоманды для капитанов:\n/register Team 1\n/me\n/answer Париж'
        );

      } else if (text === '/id') {
        await sendMessage(chatId, `Твой chat_id: ${chatId}`);

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

      } else if (text.toLowerCase().startsWith('/open')) {
        if (!isAdmin(chatId)) {
          await sendMessage(chatId, 'Эта команда доступна только ведущей.');
        } else {
          const questionRaw = text.replace(/^\/open\s*/i, '').trim();

          if (!questionRaw) {
            await sendMessage(
              chatId,
              'Нужно указать номер вопроса. Пример:\n/open 1'
            );
          } else {
            currentQuestion = questionRaw;
            answers[currentQuestion] = answers[currentQuestion] || {};

            await sendMessage(
              chatId,
              `Открыт вопрос ${currentQuestion}. Теперь команды могут присылать ответы.`
            );
          }
        }

      } else if (text === '/current') {
        if (!isAdmin(chatId)) {
          await sendMessage(chatId, 'Эта команда доступна только ведущей.');
        } else {
          if (currentQuestion) {
            await sendMessage(chatId, `Сейчас открыт вопрос ${currentQuestion}.`);
          } else {
            await sendMessage(chatId, 'Сейчас нет открытого вопроса.');
          }
        }

      } else if (text === '/close') {
        if (!isAdmin(chatId)) {
          await sendMessage(chatId, 'Эта команда доступна только ведущей.');
        } else {
          if (currentQuestion) {
            const closedQuestion = currentQuestion;
            currentQuestion = null;

            await sendMessage(chatId, `Вопрос ${closedQuestion} закрыт. Приём ответов остановлен.`);
          } else {
            await sendMessage(chatId, 'Сейчас нет открытого вопроса.');
          }
        }

      } else if (text.toLowerCase().startsWith('/answer')) {
        const teamName = captains[chatId];

        if (!teamName) {
          await sendMessage(
            chatId,
            'Сначала зарегистрируйся:\n/register Team 1'
          );
        } else if (!currentQuestion) {
          await sendMessage(
            chatId,
            'Сейчас нет открытого вопроса. Подожди, пока ведущая откроет вопрос.'
          );
        } else {
          const answerText = text.replace(/^\/answer\s*/i, '').trim();

          if (!answerText) {
            await sendMessage(
              chatId,
              'Напиши ответ после команды. Пример:\n/answer Париж'
            );
          } else {
            answers[currentQuestion] = answers[currentQuestion] || {};

            if (answers[currentQuestion][teamName]) {
              await sendMessage(
                chatId,
                `Команда ${teamName} уже отвечала на вопрос ${currentQuestion}.`
              );
            } else {
              answers[currentQuestion][teamName] = answerText;

              console.log(`Вопрос ${currentQuestion} | Ответ от ${teamName}: ${answerText}`);

              await sendMessage(
                chatId,
                `Ответ "${answerText}" принят от команды ${teamName} на вопрос ${currentQuestion} ✅`
              );
            }
          }
        }

      } else {
        if (isAdmin(chatId)) {
          await sendMessage(
            chatId,
            'Команды ведущей:\n/open 1\n/current\n/close\n\nКоманды капитанов:\n/register Team 1\n/me\n/answer текст'
          );
        } else {
          await sendMessage(
            chatId,
            'Я понимаю команды:\n/register Team 1\n/me\n/answer текст'
          );
        }
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(200);
  }
});

function isAdmin(chatId) {
  return String(chatId) === String(ADMIN_CHAT_ID);
}

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