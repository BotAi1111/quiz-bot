const express = require('express');
const axios = require('axios');
const { google } = require('googleapis');

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Организатор
const ADMIN_CHAT_ID = '412726697';

// Google Sheets
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const SPREADSHEET_ID = '1ZwHmSpZSGe5oyo1UL3LHE9eRw2j9qyrPsyJ8A1rUmkE';

const auth = new google.auth.GoogleAuth({
  credentials: GOOGLE_CREDENTIALS,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });

// Пока капитанов держим в памяти.
// Следующим шагом можно тоже вынести их в таблицу.
const captains = {};
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

    if (!update.message) {
      return res.sendStatus(200);
    }

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
        const rows = await getQuestions();
        await sendMessage(chatId, `Нашёл ${rows.length} вопросов`);
      }

    } else if (text.toLowerCase().startsWith('/register')) {
      const teamRaw = text.replace(/^\/register\s*/i, '').trim();

      if (!teamRaw) {
        await sendMessage(chatId, 'Пример:\n/register Team 1');
      } else {
        const team = normalizeTeamName(teamRaw);
        captains[chatId] = team;

        await ensureTeamScoreRow(team);

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
          await closeAllQuestions();
          const ok = await setQuestionStatus(q, 'open');

          if (!ok) {
            await sendMessage(chatId, `Вопрос ${q} не найден в таблице Questions.`);
          } else {
            await sendMessage(chatId, `Вопрос ${q} открыт`);
          }
        }
      }

    } else if (text === '/current') {
      if (!isAdmin(chatId)) {
        await sendMessage(chatId, 'Эта команда доступна только организаторам.');
      } else {
        const q = await getOpenQuestion();
        if (!q) {
          await sendMessage(chatId, 'Сейчас нет открытого вопроса.');
        } else {
          await sendMessage(chatId, `Сейчас открыт вопрос ${q.question_id}`);
        }
      }

    } else if (text === '/close') {
      if (!isAdmin(chatId)) {
        await sendMessage(chatId, 'Эта команда доступна только организаторам.');
      } else {
        const q = await getOpenQuestion();

        if (!q) {
          await sendMessage(chatId, 'Сейчас нет открытого вопроса.');
        } else {
          await setQuestionStatus(q.question_id, 'closed');
          await sendMessage(chatId, `Вопрос ${q.question_id} закрыт`);
        }
      }

    } else if (text.toLowerCase().startsWith('/answer')) {
      const team = captains[chatId];

      if (!team) {
        await sendMessage(chatId, 'Сначала зарегистрируйся:\n/register Team 1');
      } else {
        const openQuestion = await getOpenQuestion();

        if (!openQuestion) {
          await sendMessage(chatId, 'Сейчас нет открытого вопроса. Подожди, пока организаторы откроют вопрос.');
        } else {
          const ansRaw = text.replace(/^\/answer\s*/i, '').trim();

          if (!ansRaw) {
            await sendMessage(chatId, 'Пример:\n/answer Париж');
          } else {
            const already = await hasTeamAnswered(openQuestion.question_id, team);

            if (already) {
              await sendMessage(chatId, `Команда ${team} уже отвечала на вопрос ${openQuestion.question_id}.`);
            } else {
              const result = checkAnswer(
                ansRaw,
                openQuestion.accepted_answers,
                openQuestion.question_type,
                Number(openQuestion.points || 0)
              );

              await appendAnswerRow({
                questionId: openQuestion.question_id,
                team,
                answerRaw: ansRaw,
                answerNormalized: result.normalizedAnswer,
                isCorrect: result.isCorrect,
                pointsAwarded: result.pointsAwarded
              });

              if (result.pointsAwarded > 0) {
                await addScore(team, result.pointsAwarded);
              }

              console.log(
                `Q${openQuestion.question_id} | ${team}: ${ansRaw} | correct=${result.isCorrect} | points=${result.pointsAwarded}`
              );

              if (result.isCorrect) {
                await sendMessage(
                  chatId,
                  `Ответ "${ansRaw}" принят от команды ${team} ✅\nПравильно! Начислено ${result.pointsAwarded} балл(ов).`
                );
              } else {
                await sendMessage(
                  chatId,
                  `Ответ "${ansRaw}" принят от команды ${team} ✅\nК сожалению, это неправильный ответ.`
                );
              }
            }
          }
        }
      }

    } else if (text.toLowerCase().startsWith('/results')) {
      if (!isAdmin(chatId)) {
        await sendMessage(chatId, 'Эта команда доступна только организаторам.');
      } else {
        let qid = text.replace(/^\/results\s*/i, '').trim();

        if (!qid) {
          const openQuestion = await getOpenQuestion();
          qid = openQuestion ? openQuestion.question_id : '';
        }

        if (!qid) {
          await sendMessage(chatId, 'Нет активного вопроса');
        } else {
          const rows = await getAnswersByQuestion(qid);

          if (rows.length === 0) {
            await sendMessage(chatId, `Нет ответов на вопрос ${qid}`);
          } else {
            let msg = `Ответы на вопрос ${qid}:\n\n`;

            for (const row of rows) {
              const correctness = row.isCorrect === 'TRUE' ? '✅' : '❌';
              msg += `• ${row.team}: ${row.answerRaw} ${correctness} (${row.pointsAwarded})\n`;
            }

            await sendMessage(chatId, msg.trim());
          }
        }
      }

    } else if (text === '/leaderboard') {
      if (!isAdmin(chatId)) {
        await sendMessage(chatId, 'Эта команда доступна только организаторам.');
      } else {
        const board = await getLeaderboard();
        await sendMessage(chatId, board);
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
          '/leaderboard\n' +
          '/testsheet'
        );
      } else {
        await sendMessage(chatId, 'Я понимаю команды:\n/register Team 1\n/me\n/answer текст');
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
  const cleaned = String(value || '').trim().replace(/\s+/g, ' ');
  const match = cleaned.match(/^team\s*(\d+)$/i);
  if (match) return `Team ${match[1]}`;
  return cleaned;
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/ё/g, 'е')
    .replace(/Ё/g, 'Е')
    .toLowerCase();
}

function normalizeNumber(value) {
  const raw = String(value || '').trim().replace(',', '.');
  const num = Number(raw);
  return Number.isNaN(num) ? null : String(num);
}

function checkAnswer(answerRaw, acceptedAnswersRaw, questionType, points) {
  const type = String(questionType || 'text').trim().toLowerCase();
  const acceptedList = String(acceptedAnswersRaw || '')
    .split('|')
    .map(v => v.trim())
    .filter(Boolean);

  if (type === 'number') {
    const normalizedAnswer = normalizeNumber(answerRaw);
    const normalizedAccepted = acceptedList
      .map(v => normalizeNumber(v))
      .filter(v => v !== null);

    const isCorrect =
      normalizedAnswer !== null && normalizedAccepted.includes(normalizedAnswer);

    return {
      normalizedAnswer: normalizedAnswer ?? '',
      isCorrect,
      pointsAwarded: isCorrect ? points : 0
    };
  }

  const normalizedAnswer = normalizeText(answerRaw);
  const normalizedAccepted = acceptedList.map(v => normalizeText(v));
  const isCorrect = normalizedAccepted.includes(normalizedAnswer);

  return {
    normalizedAnswer,
    isCorrect,
    pointsAwarded: isCorrect ? points : 0
  };
}

async function getQuestions() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Questions!A2:F'
  });

  const rows = res.data.values || [];

  return rows.map(row => ({
    question_id: String(row[0] || '').trim(),
    question_type: String(row[1] || '').trim(),
    question_text: String(row[2] || '').trim(),
    accepted_answers: String(row[3] || '').trim(),
    points: String(row[4] || '').trim(),
    status: String(row[5] || '').trim()
  }));
}

async function getOpenQuestion() {
  const rows = await getQuestions();
  return rows.find(row => row.status.toLowerCase() === 'open') || null;
}

async function setQuestionStatus(questionId, newStatus) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Questions!A2:F'
  });

  const rows = res.data.values || [];

  for (let i = 0; i < rows.length; i++) {
    const rowQuestionId = String(rows[i][0] || '').trim();

    if (rowQuestionId === String(questionId).trim()) {
      const targetRow = i + 2;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `Questions!F${targetRow}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[newStatus]]
        }
      });
      return true;
    }
  }

  return false;
}

async function closeAllQuestions() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Questions!A2:F'
  });

  const rows = res.data.values || [];

  for (let i = 0; i < rows.length; i++) {
    const status = String(rows[i][5] || '').trim().toLowerCase();

    if (status === 'open') {
      const targetRow = i + 2;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `Questions!F${targetRow}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [['closed']]
        }
      });
    }
  }
}

async function appendAnswerRow({ questionId, team, answerRaw, answerNormalized, isCorrect, pointsAwarded }) {
  const timestamp = new Date().toISOString();

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Answers!A:G',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[
        timestamp,
        questionId,
        team,
        answerRaw,
        answerNormalized,
        isCorrect ? 'TRUE' : 'FALSE',
        pointsAwarded
      ]]
    }
  });
}

async function getAnswersByQuestion(questionId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Answers!A2:G'
  });

  const rows = res.data.values || [];

  return rows
    .map(row => ({
      timestamp: row[0] || '',
      questionId: row[1] || '',
      team: row[2] || '',
      answerRaw: row[3] || '',
      answerNormalized: row[4] || '',
      isCorrect: row[5] || '',
      pointsAwarded: row[6] || '0'
    }))
    .filter(row => String(row.questionId).trim() === String(questionId).trim())
    .sort((a, b) => a.team.localeCompare(b.team, 'en', { numeric: true }));
}

async function hasTeamAnswered(questionId, team) {
  const rows = await getAnswersByQuestion(questionId);
  return rows.some(row => String(row.team).trim() === String(team).trim());
}

async function ensureTeamScoreRow(team) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Scores!A2:B'
  });

  const rows = res.data.values || [];
  const exists = rows.some(row => String(row[0] || '').trim() === String(team).trim());

  if (!exists) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Scores!A:B',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[team, 0]]
      }
    });
  }
}

async function addScore(team, delta) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Scores!A2:B'
  });

  const rows = res.data.values || [];

  for (let i = 0; i < rows.length; i++) {
    const rowTeam = String(rows[i][0] || '').trim();

    if (rowTeam === String(team).trim()) {
      const current = Number(rows[i][1] || 0);
      const updated = current + delta;
      const targetRow = i + 2;

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `Scores!B${targetRow}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[updated]]
        }
      });
      return;
    }
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Scores!A:B',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[team, delta]]
    }
  });
}

async function getLeaderboard() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Scores!A2:B'
  });

  const rows = res.data.values || [];

  if (rows.length === 0) {
    return 'Пока нет ни одной команды с баллами.';
  }

  const data = rows.map(row => ({
    team: String(row[0] || '').trim(),
    points: Number(row[1] || 0)
  }));

  data.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    return a.team.localeCompare(b.team, 'en', { numeric: true });
  });

  let msg = '🏆 Таблица результатов:\n\n';
  data.forEach((item, index) => {
    msg += `${index + 1}. ${item.team} — ${item.points}\n`;
  });

  return msg.trim();
}

async function sendMessage(chatId, text) {
  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running'));