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

// Защита от повторной обработки update
const processedUpdates = new Set();

// Временные состояния UI
const userStates = {}; // chatId -> { mode: ... }

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

    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
      return res.sendStatus(200);
    }

    if (!update.message) {
      return res.sendStatus(200);
    }

    const chatId = String(update.message.chat.id);
    const text = (update.message.text || '').trim();

    console.log(`UPDATE ${updateId} | chat ${chatId} | text: ${text}`);

    await handleIncomingMessage(chatId, text);

    res.sendStatus(200);
  } catch (e) {
    console.error(e);
    res.sendStatus(200);
  }
});

async function handleIncomingMessage(chatId, text) {
  if (text === '/start') {
    await sendWelcome(chatId);
    return;
  }

  if (text === '/menu') {
    await sendMenu(chatId, 'Выбери действие:');
    return;
  }

  if (text === '/id') {
    await sendMessage(chatId, `Твой chat_id: ${chatId}`);
    return;
  }

  const state = userStates[chatId];
  if (state && !text.startsWith('/')) {
    await handleStateInput(chatId, text, state);
    return;
  }

  if (text.toLowerCase().startsWith('/register')) {
    const teamRaw = text.replace(/^\/register\s*/i, '').trim();
    if (!teamRaw) {
      await sendMessage(chatId, 'Пример:\n/register Team 1');
      return;
    }
    await performRegister(chatId, teamRaw);
    return;
  }

  if (text === '/me') {
    await performMe(chatId);
    return;
  }

  if (text.toLowerCase().startsWith('/open')) {
    if (!isAdmin(chatId)) {
      await sendMessage(chatId, 'Эта команда доступна только организаторам.');
      return;
    }

    const q = text.replace(/^\/open\s*/i, '').trim();
    if (!q) {
      await sendMessage(chatId, 'Пример:\n/open 1');
      return;
    }

    await performOpen(chatId, q);
    return;
  }

  if (text === '/current') {
    await performCurrent(chatId);
    return;
  }

  if (text === '/close') {
    await performClose(chatId);
    return;
  }

  if (text === '/resetteams') {
    await performResetTeams(chatId);
    return;
  }

  if (text === '/resetanswers') {
    await performResetAnswers(chatId);
    return;
  }

  if (text === '/teams') {
    await performTeams(chatId);
    return;
  }

  if (text.toLowerCase().startsWith('/answer')) {
    const ansRaw = text.replace(/^\/answer\s*/i, '').trim();
    if (!ansRaw) {
      await sendMessage(chatId, 'Пример:\n/answer Париж');
      return;
    }
    await performAnswer(chatId, ansRaw);
    return;
  }

  if (text.toLowerCase().startsWith('/results')) {
    if (!isAdmin(chatId)) {
      await sendMessage(chatId, 'Эта команда доступна только организаторам.');
      return;
    }

    let qid = text.replace(/^\/results\s*/i, '').trim();
    if (!qid) {
      const openQuestion = await getOpenQuestion();
      qid = openQuestion ? openQuestion.question_id : '';
    }

    await performResults(chatId, qid);
    return;
  }

  if (text === '/leaderboard') {
    await performLeaderboard(chatId);
    return;
  }

  if (text === '/testsheet') {
    if (!isAdmin(chatId)) {
      await sendMessage(chatId, 'Эта команда доступна только организаторам.');
      return;
    }

    const rows = await getQuestions();
    await sendMessage(chatId, `Нашёл ${rows.length} вопросов`);
    return;
  }

  await sendMenu(chatId, 'Не понимаю команду. Выбери действие:');
}

async function handleCallbackQuery(callbackQuery) {
  const callbackId = callbackQuery.id;
  const chatId = String(callbackQuery.message.chat.id);
  const data = String(callbackQuery.data || '');

  console.log(`CALLBACK | chat ${chatId} | data: ${data}`);

  await answerCallbackQuery(callbackId);

  if (data === 'menu_main') {
    await clearState(chatId);
    await sendMenu(chatId, 'Выбери действие:');
    return;
  }

  if (data === 'user_register') {
    await setState(chatId, 'register_team_number');
    await sendMessage(chatId, 'Введи номер команды, например:\n1');
    return;
  }

  if (data === 'user_me') {
    await clearState(chatId);
    await performMe(chatId);
    return;
  }

  if (data === 'user_answer') {
    await setState(chatId, 'answer_text');
    await sendMessage(chatId, 'Введи свой ответ:');
    return;
  }

  if (data === 'admin_open') {
    if (!isAdmin(chatId)) {
      await sendMessage(chatId, 'Эта команда доступна только организаторам.');
      return;
    }
    await setState(chatId, 'open_question_number');
    await sendMessage(chatId, 'Введи номер вопроса, например:\n1');
    return;
  }

  if (data === 'admin_current') {
    await clearState(chatId);
    await performCurrent(chatId);
    return;
  }

  if (data === 'admin_close') {
    await clearState(chatId);
    await performClose(chatId);
    return;
  }

  if (data === 'admin_results_current') {
    await clearState(chatId);
    const openQuestion = await getOpenQuestion();
    const qid = openQuestion ? openQuestion.question_id : '';
    await performResults(chatId, qid);
    return;
  }

  if (data === 'admin_results_number') {
    await setState(chatId, 'results_question_number');
    await sendMessage(chatId, 'Введи номер вопроса для просмотра результатов:');
    return;
  }

  if (data === 'admin_leaderboard') {
    await clearState(chatId);
    await performLeaderboard(chatId);
    return;
  }

  if (data === 'admin_resetteams') {
    await clearState(chatId);
    await performResetTeams(chatId);
    return;
  }

  if (data === 'admin_resetanswers') {
    await clearState(chatId);
    await performResetAnswers(chatId);
    return;
  }

  if (data === 'admin_teams') {
    await clearState(chatId);
    await performTeams(chatId);
    return;
  }

  await sendMenu(chatId, 'Выбери действие:');
}

async function handleStateInput(chatId, text, state) {
  if (state.mode === 'register_team_number') {
    await clearState(chatId);
    await performRegister(chatId, `Team ${text}`);
    return;
  }

  if (state.mode === 'answer_text') {
    await clearState(chatId);
    await performAnswer(chatId, text);
    return;
  }

  if (state.mode === 'open_question_number') {
    await clearState(chatId);
    await performOpen(chatId, text);
    return;
  }

  if (state.mode === 'results_question_number') {
    await clearState(chatId);
    await performResults(chatId, text);
    return;
  }

  await clearState(chatId);
  await sendMenu(chatId, 'Выбери действие:');
}

async function performRegister(chatId, teamRaw) {
  const team = normalizeTeamName(teamRaw);

  const existingTeam = await getTeamByChatId(chatId);
  if (existingTeam) {
    if (existingTeam === team) {
      await sendMessage(chatId, `Ты уже капитан ${team} ✅`, getMenuMarkup(chatId));
    } else {
      await sendMessage(
        chatId,
        `Ты уже зарегистрирован как капитан ${existingTeam}.\nНельзя быть капитаном сразу в двух командах.`,
        getMenuMarkup(chatId)
      );
    }
    return;
  }

  const captainsForTeam = await getCaptainsByTeam(team);
  if (captainsForTeam.length >= 2) {
    await sendMessage(chatId, `У команды ${team} уже есть 2 капитана. Добавить ещё одного нельзя.`, getMenuMarkup(chatId));
    return;
  }

  await appendTeamCaptain(chatId, team);
  await ensureTeamScoreRow(team);

  await sendMessage(chatId, `Ты капитан ${team} ✅`, getMenuMarkup(chatId));
}

async function performMe(chatId) {
  const team = await getTeamByChatId(chatId);

  if (!team) {
    await sendMessage(chatId, 'Ты не зарегистрирован', getMenuMarkup(chatId));
  } else {
    await sendMessage(chatId, `Ты капитан ${team} ✅`, getMenuMarkup(chatId));
  }
}

async function performOpen(chatId, q) {
  if (!isAdmin(chatId)) {
    await sendMessage(chatId, 'Эта команда доступна только организаторам.', getMenuMarkup(chatId));
    return;
  }

  const questionId = String(q || '').trim();
  if (!questionId) {
    await sendMessage(chatId, 'Пример:\n/open 1', getMenuMarkup(chatId));
    return;
  }

  await closeAllQuestions();
  const ok = await setQuestionStatus(questionId, 'open');

  if (!ok) {
    await sendMessage(chatId, `Вопрос ${questionId} не найден в таблице Questions.`, getMenuMarkup(chatId));
  } else {
    await sendMessage(chatId, `Вопрос ${questionId} открыт`, getMenuMarkup(chatId));
  }
}

async function performCurrent(chatId) {
  if (!isAdmin(chatId)) {
    await sendMessage(chatId, 'Эта команда доступна только организаторам.', getMenuMarkup(chatId));
    return;
  }

  const q = await getOpenQuestion();
  if (!q) {
    await sendMessage(chatId, 'Сейчас нет открытого вопроса.', getMenuMarkup(chatId));
  } else {
    await sendMessage(chatId, `Сейчас открыт вопрос ${q.question_id}`, getMenuMarkup(chatId));
  }
}

async function performClose(chatId) {
  if (!isAdmin(chatId)) {
    await sendMessage(chatId, 'Эта команда доступна только организаторам.', getMenuMarkup(chatId));
    return;
  }

  const q = await getOpenQuestion();

  if (!q) {
    await sendMessage(chatId, 'Сейчас нет открытого вопроса.', getMenuMarkup(chatId));
    return;
  }

  await setQuestionStatus(q.question_id, 'closed');

  const firstCorrectAnswer = getFirstAcceptedAnswer(q.accepted_answers);
  const results = await getAnswersByQuestion(q.question_id);

  // Уведомляем капитанов команд, которые отвечали
  for (const row of results) {
    const captains = await getCaptainsByTeam(row.team);

    for (const captain of captains) {
      const msg =
        `Вопрос закрыт.\n` +
        `Ваш ответ: ${row.answerRaw}\n` +
        `Результат: ${row.isCorrect === 'TRUE' ? 'правильно' : 'неправильно'}\n` +
        `Начислено: ${row.pointsAwarded} балл(ов)`;

      try {
        await sendMessage(captain.chat_id, msg, getMenuMarkup(captain.chat_id));
      } catch (err) {
        console.error(`Не удалось отправить уведомление chat_id=${captain.chat_id}`, err?.message || err);
      }
    }
  }

  const closeMessage =
    `Вопрос ${q.question_id} закрыт\n\n` +
    `Вопрос:\n${q.question_text}\n\n` +
    `Правильный ответ:\n${firstCorrectAnswer}`;

  await sendMessage(chatId, closeMessage, getMenuMarkup(chatId));
}

async function performResetTeams(chatId) {
  if (!isAdmin(chatId)) {
    await sendMessage(chatId, 'Эта команда доступна только организаторам.', getMenuMarkup(chatId));
    return;
  }

  await clearTeamsSheet();
  await sendMessage(chatId, 'Все привязки капитанов ко всем командам сброшены.', getMenuMarkup(chatId));
}

async function performResetAnswers(chatId) {
  if (!isAdmin(chatId)) {
    await sendMessage(chatId, 'Эта команда доступна только организаторам.', getMenuMarkup(chatId));
    return;
  }

  await clearAnswersSheet();
  await clearScoresSheet();
  await sendMessage(chatId, 'Все ответы и баллы сброшены.', getMenuMarkup(chatId));
}

async function performAnswer(chatId, ansRaw) {
  const team = await getTeamByChatId(chatId);

  if (!team) {
    await sendMessage(chatId, 'Сначала зарегистрируйся:\n/register Team 1', getMenuMarkup(chatId));
    return;
  }

  const openQuestion = await getOpenQuestion();

  if (!openQuestion) {
    await sendMessage(chatId, 'Ответы больше не принимаются', getMenuMarkup(chatId));
    return;
  }

  const answerText = String(ansRaw || '').trim();
  if (!answerText) {
    await sendMessage(chatId, 'Введи ответ ещё раз.', getMenuMarkup(chatId));
    return;
  }

  const already = await hasTeamAnswered(openQuestion.question_id, team);

  if (already) {
    await sendMessage(chatId, `Команда ${team} уже отвечала на вопрос ${openQuestion.question_id}.`, getMenuMarkup(chatId));
    return;
  }

  const result = checkAnswer(
    answerText,
    openQuestion.accepted_answers,
    openQuestion.question_type,
    Number(openQuestion.points || 0)
  );

  await appendAnswerRow({
    questionId: openQuestion.question_id,
    team,
    answerRaw: answerText,
    answerNormalized: result.normalizedAnswer,
    isCorrect: result.isCorrect,
    pointsAwarded: result.pointsAwarded
  });

  if (result.pointsAwarded > 0) {
    await addScore(team, result.pointsAwarded);
  }

  console.log(
    `Q${openQuestion.question_id} | ${team}: ${answerText} | correct=${result.isCorrect} | points=${result.pointsAwarded}`
  );

  await sendMessage(chatId, 'Ответ принят', getMenuMarkup(chatId));
}

async function performResults(chatId, qid) {
  if (!isAdmin(chatId)) {
    await sendMessage(chatId, 'Эта команда доступна только организаторам.', getMenuMarkup(chatId));
    return;
  }

  const questionId = String(qid || '').trim();

  if (!questionId) {
    await sendMessage(chatId, 'Нет активного вопроса', getMenuMarkup(chatId));
    return;
  }

  const rows = await getAnswersByQuestion(questionId);

  if (rows.length === 0) {
    await sendMessage(chatId, `Нет ответов на вопрос ${questionId}`, getMenuMarkup(chatId));
  } else {
    let msg = `Ответы на вопрос ${questionId}:\n\n`;

    for (const row of rows) {
      const correctness = row.isCorrect === 'TRUE' ? '✅' : '❌';
      msg += `• ${row.team}: ${row.answerRaw} ${correctness} (${row.pointsAwarded})\n`;
    }

    await sendMessage(chatId, msg.trim(), getMenuMarkup(chatId));
  }
}

async function performLeaderboard(chatId) {
  if (!isAdmin(chatId)) {
    await sendMessage(chatId, 'Эта команда доступна только организаторам.', getMenuMarkup(chatId));
    return;
  }

  const board = await getLeaderboard();
  await sendMessage(chatId, board, getMenuMarkup(chatId));
}

async function performTeams(chatId) {
  if (!isAdmin(chatId)) {
    await sendMessage(chatId, 'Эта команда доступна только организаторам.', getMenuMarkup(chatId));
    return;
  }

  const teamsRows = await getTeamsRows();

  if (teamsRows.length === 0) {
    await sendMessage(chatId, 'Пока нет зарегистрированных капитанов.', getMenuMarkup(chatId));
    return;
  }

  const grouped = {};
  for (const row of teamsRows) {
    if (!grouped[row.team]) grouped[row.team] = 0;
    grouped[row.team] += 1;
  }

  const sortedTeams = Object.keys(grouped).sort((a, b) =>
    a.localeCompare(b, 'en', { numeric: true })
  );

  let msg = 'Команды:\n\n';
  for (const team of sortedTeams) {
    msg += `• ${team} — ${grouped[team]} капитан(а)\n`;
  }

  await sendMessage(chatId, msg.trim(), getMenuMarkup(chatId));
}

async function sendWelcome(chatId) {
  if (isAdmin(chatId)) {
    await sendMessage(
      chatId,
      'Привет! Я бот для квиза 🚀\nНажми кнопку ниже, чтобы открыть меню организатора.',
      getMenuMarkup(chatId)
    );
  } else {
    await sendMessage(
      chatId,
      'Привет! Я бот для квиза 🚀\nНажми кнопку ниже, чтобы открыть меню участника.',
      getMenuMarkup(chatId)
    );
  }
}

async function sendMenu(chatId, text) {
  await sendMessage(chatId, text, getMenuMarkup(chatId));
}

function getMenuMarkup(chatId) {
  if (isAdmin(chatId)) {
    return {
      inline_keyboard: [
        [
          { text: 'Открыть вопрос', callback_data: 'admin_open' },
          { text: 'Текущий вопрос', callback_data: 'admin_current' }
        ],
        [
          { text: 'Закрыть вопрос', callback_data: 'admin_close' },
          { text: 'Результаты (текущий)', callback_data: 'admin_results_current' }
        ],
        [
          { text: 'Результаты по номеру', callback_data: 'admin_results_number' },
          { text: 'Таблица лидеров', callback_data: 'admin_leaderboard' }
        ],
        [
          { text: 'Команды', callback_data: 'admin_teams' },
          { text: 'Сбросить капитанов', callback_data: 'admin_resetteams' }
        ],
        [
          { text: 'Сбросить ответы и баллы', callback_data: 'admin_resetanswers' }
        ]
      ]
    };
  }

  return {
    inline_keyboard: [
      [
        { text: 'Зарегистрироваться', callback_data: 'user_register' },
        { text: 'Моя команда', callback_data: 'user_me' }
      ],
      [
        { text: 'Ответить', callback_data: 'user_answer' }
      ]
    ]
  };
}

async function setState(chatId, mode) {
  userStates[String(chatId)] = { mode };
}

async function clearState(chatId) {
  delete userStates[String(chatId)];
}

async function answerCallbackQuery(callbackQueryId, text = '') {
  await axios.post(`${TELEGRAM_API}/answerCallbackQuery`, {
    callback_query_id: callbackQueryId,
    text
  });
}

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

function getFirstAcceptedAnswer(acceptedAnswersRaw) {
  return String(acceptedAnswersRaw || '')
    .split('|')
    .map(v => v.trim())
    .filter(Boolean)[0] || '—';
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

async function getTeamsRows() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Teams!A2:C'
  });

  const rows = res.data.values || [];

  return rows.map((row, index) => ({
    rowIndex: index + 2,
    chat_id: String(row[0] || '').trim(),
    team: String(row[1] || '').trim(),
    added_at: String(row[2] || '').trim()
  }));
}

async function getTeamByChatId(chatId) {
  const rows = await getTeamsRows();
  const found = rows.find(row => String(row.chat_id) === String(chatId));
  return found ? found.team : null;
}

async function getCaptainsByTeam(team) {
  const rows = await getTeamsRows();
  return rows.filter(row => String(row.team).trim() === String(team).trim());
}

async function appendTeamCaptain(chatId, team) {
  const timestamp = new Date().toISOString();

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Teams!A:C',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[chatId, team, timestamp]]
    }
  });
}

async function clearTeamsSheet() {
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Teams!A2:C'
  });
}

async function clearAnswersSheet() {
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Answers!A2:G'
  });
}

async function clearScoresSheet() {
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Scores!A2:B'
  });
}

async function sendMessage(chatId, text, replyMarkup = null) {
  const payload = {
    chat_id: chatId,
    text
  };

  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  await axios.post(`${TELEGRAM_API}/sendMessage`, payload);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running'));