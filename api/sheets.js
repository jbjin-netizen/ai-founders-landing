const { google } = require('googleapis');

const SPREADSHEET_ID = '1HeDIX4CYqlLJyF4NlvYBFwVFLYi-nMJRJVWtlIvJ7ms';
const SHEET_EVENTS = 'events';
const SHEET_APPLICANTS = 'applicants';

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

    if (body.type === 'applicant') {
      await appendRow(sheets, SHEET_APPLICANTS, HEADERS_APPLICANTS, [
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
      ]);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: 'unknown type' });
  } catch (err) {
    console.error('Sheets API error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
