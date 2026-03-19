const express = require('express');
const axios = require('axios');
const { google } = require('googleapis');

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Твой Telegram chat_id
const ADMIN_CHAT_ID = '412726697';

// Google Sheets
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const SPREADSHEET_ID = '1ZwHmSpZSGe5oyo1UL3LHE9eRw2j9qyrPsyJ8A1rUmkE';

const auth = new google.auth.GoogleAuth({
  credentials: GOOGLE_CREDENTIALS,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });

// Хранилище в памяти
const captains = {};          // chatId -> Team N
const answers = {};           // question -> { Team N: "answer" }
const scores = {};            // Team N -> points
let currentQuestion = null;

// Защита от повторной обработки update
const processedUpdates = new Set();

app.post('/', async (req, res) => {
  try {
    const update = req.body;
    const updateId = update.update_id;

    if (processedUpdates.has(updateId)) {
      return res.sendStatus(200);
    }
    processedUpdates.add(updateId);

    if (processedUpdates.size > 1000) {
      const oldest = processedUpdates.values().next().value;
      processedUpdates.delete(oldest);
    }

    if (update.message) {
      const chatId = String(update.message.chat.id);
      const text = (update.message.text || '').trim();

      console.log(`UPDATE ${updateId} | chat ${chatId} | text: ${text}`);

      if (text === '/start') {
        if (isAdmin(chatId)) {
          await sendMessage(
            chatId,
            'Привет! Я бот для квиза 🚀\n\nКоманды организатора:\n' +
            '/open 1\n' +
            '/current\n' +
            '/close\n' +
            '/results\n' +
            '/results 1\n' +
            '/score Team 1 1\n' +
            '/setscore Team 1 5\n' +
            '/teamscore Team 1\n' +
            '/leaderboard\n' +
            '/testsheet\n' +
            '/id'
          );
        } else {
          await sendMessage(
            chatId,
            'Привет! Я бот для квиза 🚀\n\nКоманды капитана:\n' +
            '/register Team 1\n' +
            '/me\n' +
            '/answer Париж'
          );
        }

      } else if (text === '/id') {
        await sendMessage(chatId, `Твой chat_id: ${chatId}`);

      } else if (text === '/testsheet') {
        if (!isAdmin(chatId)) {
          await sendMessage(chatId, 'Эта команда доступна только организаторам.');
        } else {
          const data = await getQuestions();
          console.log('SHEETS DATA:', data);
          await sendMessage(chatId, `Нашёл ${data.length} вопросов`);
        }

      } else if (text.toLowerCase().startsWith('/register')) {
        const teamRaw = text.replace(/^\/register\s*/i, '').trim();

        if (!teamRaw) {
          await sendMessage(chatId, 'Пример:\n/register Team 1');
        } else {
          const team = normalizeTeamName(teamRaw);
          captains[chatId] = team;

          if (!(team in scores)) {
            scores[team] = 0;
          }

          await sendMessage(chatId, `Ты капитан ${team} ✅`);
        }

      } else if (text === '/me') {
        const team = captains[chatId];

        if (!team) {
          await sendMessage(chatId, 'Ты не зарегистрирован');
        } else {
          await sendMessage(chatId, `Ты капитан ${team} ✅`);
        }

      } else if (text.toLowerCase().startsWith('/open')) {
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

      } else if (text.toLowerCase().startsWith('/results')) {
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
              for (const team of sortTeams(Object.keys(data))) {
                msg += `• ${team}: ${data[team]}\n`;
              }
              await sendMessage(chatId, msg.trim());
            }
          }
        }

      } else if (text.toLowerCase().startsWith('/score')) {
        if (!isAdmin(chatId)) {
          await sendMessage(chatId, 'Эта команда доступна только организаторам.');
        } else {
          const parsed = parseScoreCommand(text, '/score');

          if (!parsed.ok) {
            await sendMessage(chatId, 'Пример:\n/score Team 1 1');
          } else {
            const { team, points } = parsed;

            if (!(team in scores)) {
              scores[team] = 0;
            }

            scores[team] += points;

            await sendMessage(
              chatId,
              `Команде ${team} ${points >= 0 ? 'добавлено' : 'снято'} ${Math.abs(points)} балл(ов).\nТекущий счёт: ${scores[team]}`
            );
          }
        }

      } else if (text.toLowerCase().startsWith('/setscore')) {
        if (!isAdmin(chatId)) {
          await sendMessage(chatId, 'Эта команда доступна только организаторам.');
        } else {
          const parsed = parseScoreCommand(text, '/setscore');

          if (!parsed.ok) {
            await sendMessage(chatId, 'Пример:\n/setscore Team 1 5');
          } else {
            const { team, points } = parsed;
            scores[team] = points;
            await sendMessage(chatId, `Счёт команды ${team} установлен на ${points}`);
          }
        }

      } else if (text.toLowerCase().startsWith('/teamscore')) {
        if (!isAdmin(chatId)) {
          await sendMessage(chatId, 'Эта команда доступна только организаторам.');
        } else {
          const teamRaw = text.replace(/^\/teamscore\s*/i, '').trim();

          if (!teamRaw) {
            await sendMessage(chatId, 'Пример:\n/teamscore Team 1');
          } else {
            const team = normalizeTeamName(teamRaw);
            const value = scores[team] || 0;
            await sendMessage(chatId, `${team}: ${value} балл(ов)`);
          }
        }

      } else if (text === '/leaderboard') {
        if (!isAdmin(chatId)) {
          await sendMessage(chatId, 'Эта команда доступна только организаторам.');
        } else {
          await sendMessage(chatId, buildLeaderboard(scores));
        }

      } else {
        if (isAdmin(chatId)) {
          await sendMessage(
            chatId,
            'Команды организатора:\n' +
            '/open 1\n' +
            '/current\n' +
            '/close\n' +
            '/results\n' +
            '/results 1\n' +
            '/score Team 1 1\n' +
            '/setscore Team 1 5\n' +
            '/teamscore Team 1\n' +
            '/leaderboard\n' +
            '/testsheet'
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

function parseScoreCommand(text, commandName) {
  const raw = text.replace(new RegExp(`^\\${commandName}\\s*`, 'i'), '').trim();
  const match = raw.match(/^(team\s+\d+)\s+(-?\d+)$/i);

  if (!match) {
    return { ok: false };
  }

  return {
    ok: true,
    team: normalizeTeamName(match[1]),
    points: Number(match[2])
  };
}

function sortTeams(teamNames) {
  return [...teamNames].sort((a, b) => {
    const aMatch = a.match(/^Team\s+(\d+)$/i);
    const bMatch = b.match(/^Team\s+(\d+)$/i);

    if (aMatch && bMatch) {
      return Number(aMatch[1]) - Number(bMatch[1]);
    }

    return a.localeCompare(b, 'ru');
  });
}

function buildLeaderboard(scoreMap) {
  const teams = Object.keys(scoreMap);

  if (teams.length === 0) {
    return 'Пока нет ни одной команды с баллами.';
  }

  const sorted = teams.sort((a, b) => {
    const diff = (scoreMap[b] || 0) - (scoreMap[a] || 0);
    if (diff !== 0) return diff;
    return a.localeCompare(b, 'ru');
  });

  let msg = '🏆 Таблица результатов:\n\n';
  sorted.forEach((team, index) => {
    msg += `${index + 1}. ${team} — ${scoreMap[team] || 0}\n`;
  });

  return msg.trim();
}

async function getQuestions() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Questions!A2:F'
  });

  return res.data.values || [];
}

async function sendMessage(chatId, text) {
  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running'));