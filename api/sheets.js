const { google } = require('googleapis');

const SPREADSHEET_ID = '1HeDIX4CYqlLJyF4NlvYBFwVFLYi-nMJRJVWtlIvJ7ms';
const SHEET_EVENTS = 'events';
const SHEET_APPLICANTS = 'applicants';
const SHEET_PARTIAL = 'partial_applicants';

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function nowKST() {
  const offset = 9 * 60 * 60 * 1000;
  return new Date(Date.now() + offset).toISOString().replace('Z', '+09:00');
}

const HEADERS_EVENTS = [
  'id','timestamp','event_type','session_id','applicant_id','location','option',
  'utm_source','utm_medium','utm_campaign','utm_content','device','referrer','date'
];
const HEADERS_APPLICANTS = [
  'id','created_at','name','phone','motivation','ai_experience','desired_service',
  'selected_option','payment_link','apply_status',
  'utm_source','utm_medium','utm_campaign','utm_content'
];
const HEADERS_PARTIAL = [
  'id','created_at','name','phone','motivation','selected_option','session_id',
  'utm_source','utm_medium','utm_campaign','utm_content'
];

async function ensureSheet(sheets, sheetName, headers) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const exists = meta.data.sheets.some(s => s.properties.title === sheetName);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    });
  }
}

async function appendRow(sheets, sheetName, headers, values) {
  await ensureSheet(sheets, sheetName, headers);
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:A`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [values] },
  });
}

function normalizePhone(v) {
  return String(v || '').replace(/\D/g, '');
}

// 키 컬럼 기준으로 동일 행이 있으면 update, 없으면 append.
// preserveColumns 에 적힌 컬럼은 기존 행 값을 유지(예: id, created_at).
async function upsertRow(sheets, sheetName, headers, newValues, keyColumn, preserveColumns) {
  await ensureSheet(sheets, sheetName, headers);

  const keyIdx = headers.indexOf(keyColumn);
  const keyVal = keyIdx >= 0 ? normalizePhone(newValues[keyIdx]) : '';
  if (!keyVal) {
    return appendRow(sheets, sheetName, headers, newValues);
  }

  const lastColLetter = String.fromCharCode(65 + headers.length - 1);
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:${lastColLetter}`,
  });
  const rows = resp.data.values || [];

  let matchIdx = -1;
  for (let i = 1; i < rows.length; i++) {
    if (normalizePhone((rows[i] || [])[keyIdx]) === keyVal) {
      matchIdx = i;
      break;
    }
  }

  if (matchIdx < 0) {
    return appendRow(sheets, sheetName, headers, newValues);
  }

  const existing = rows[matchIdx] || [];
  const finalValues = newValues.slice();
  (preserveColumns || []).forEach(function(col) {
    const idx = headers.indexOf(col);
    if (idx >= 0 && existing[idx]) finalValues[idx] = existing[idx];
  });

  const sheetRowNum = matchIdx + 1; // 1-indexed
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A${sheetRowNum}:${lastColLetter}${sheetRowNum}`,
    valueInputOption: 'RAW',
    requestBody: { values: [finalValues] },
  });
}

// 같은 phone 그룹을 1개로 정리. 가장 최근 데이터를 남기되 id/created_at은 첫 행 값을 보존.
async function dedupeSheet(sheets, sheetName, headers, keyColumn) {
  await ensureSheet(sheets, sheetName, headers);

  const lastColLetter = String.fromCharCode(65 + headers.length - 1);
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:${lastColLetter}`,
  });
  const rows = resp.data.values || [];
  if (rows.length <= 1) return { sheetName, removed: 0, mergedGroups: 0 };

  const keyIdx = headers.indexOf(keyColumn);
  const idIdx = headers.indexOf('id');
  const createdIdx = headers.indexOf('created_at');

  const groups = {};
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const key = normalizePhone(row[keyIdx]);
    if (!key) continue;
    if (!groups[key]) groups[key] = [];
    groups[key].push({ idx: i, row });
  }

  const updates = [];
  const deleteIndices = [];

  Object.keys(groups).forEach(function(key) {
    const group = groups[key];
    if (group.length < 2) return;
    group.sort(function(a, b) {
      return String(a.row[createdIdx] || '').localeCompare(String(b.row[createdIdx] || ''));
    });
    const oldest = group[0];
    const newest = group[group.length - 1];
    const finalRow = newest.row.slice();
    while (finalRow.length < headers.length) finalRow.push('');
    if (idIdx >= 0) finalRow[idIdx] = oldest.row[idIdx] || finalRow[idIdx];
    if (createdIdx >= 0) finalRow[createdIdx] = oldest.row[createdIdx] || finalRow[createdIdx];

    const keepRowNum = newest.idx + 1;
    updates.push({
      range: `${sheetName}!A${keepRowNum}:${lastColLetter}${keepRowNum}`,
      values: [finalRow],
    });
    for (let i = 0; i < group.length - 1; i++) {
      deleteIndices.push(group[i].idx);
    }
  });

  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: 'RAW', data: updates },
    });
  }

  if (deleteIndices.length > 0) {
    deleteIndices.sort(function(a, b) { return b - a; });
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const sheetMeta = meta.data.sheets.find(function(s) { return s.properties.title === sheetName; });
    if (!sheetMeta) return { sheetName, removed: 0, error: 'sheet not found' };
    const sheetId = sheetMeta.properties.sheetId;
    const requests = deleteIndices.map(function(idx) {
      return {
        deleteDimension: {
          range: { sheetId, dimension: 'ROWS', startIndex: idx, endIndex: idx + 1 },
        },
      };
    });
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests },
    });
  }

  return {
    sheetName,
    removed: deleteIndices.length,
    mergedGroups: updates.length,
  };
}

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    const hasKey = !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    let parseOk = false;
    let email = '';
    try {
      const cred = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
      parseOk = true;
      email = cred.client_email || '';
    } catch(e) {}
    return res.status(200).json({ ok: true, hasKey, parseOk, email });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const auth = getAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    if (body.type === 'event') {
      const now = body.timestamp || nowKST();
      const date = now.slice(0, 10);
      await appendRow(sheets, SHEET_EVENTS, HEADERS_EVENTS, [
        uuid(),
        now,
        body.event_type || '',
        body.session_id || '',
        body.applicant_id || '',
        body.location || '',
        body.option || '',
        body.utm_source || '',
        body.utm_medium || '',
        body.utm_campaign || '',
        body.utm_content || '',
        body.device || '',
        body.referrer || '',
        date,
      ]);
      return res.status(200).json({ ok: true });
    }

    if (body.type === 'partial_applicant') {
      await upsertRow(sheets, SHEET_PARTIAL, HEADERS_PARTIAL, [
        uuid(),
        body.created_at || nowKST(),
        body.name || '',
        body.phone || '',
        body.motivation || '',
        body.selected_option || '',
        body.session_id || '',
        body.utm_source || '',
        body.utm_medium || '',
        body.utm_campaign || '',
        body.utm_content || '',
      ], 'phone', ['id', 'created_at']);
      return res.status(200).json({ ok: true });
    }

    if (body.type === 'applicant') {
      await upsertRow(sheets, SHEET_APPLICANTS, HEADERS_APPLICANTS, [
        uuid(),
        body.created_at || '',
        body.name || '',
        body.phone || '',
        body.motivation || '',
        body.ai_experience || '',
        body.desired_service || '',
        body.selected_option || '',
        body.payment_link || '',
        body.apply_status || '',
        body.utm_source || '',
        body.utm_medium || '',
        body.utm_campaign || '',
        body.utm_content || '',
      ], 'phone', ['id', 'created_at']);
      return res.status(200).json({ ok: true });
    }

    if (body.type === 'dedupe') {
      const applicants = await dedupeSheet(sheets, SHEET_APPLICANTS, HEADERS_APPLICANTS, 'phone');
      const partial = await dedupeSheet(sheets, SHEET_PARTIAL, HEADERS_PARTIAL, 'phone');
      return res.status(200).json({ ok: true, applicants, partial });
    }

    return res.status(400).json({ ok: false, error: 'unknown type' });
  } catch (err) {
    console.error('Sheets API error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
