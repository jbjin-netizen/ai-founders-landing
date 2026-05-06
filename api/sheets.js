const { google } = require('googleapis');

const SPREADSHEET_ID = '1HeDIX4CYqlLJyF4NlvYBFwVFLYi-nMJRJVWtlIvJ7ms';
const SHEET_EVENTS = 'events';
const SHEET_APPLICANTS = 'applicants';
const SHEET_PARTIAL = 'partial_applicants';
const SHEET_PURCHASE = 'purchase';

const COHORT_CAPACITY = 50;
const SEATS_MIN_DISPLAY = 3;

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

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    const action = (req.query && req.query.action) || '';

    if (action === 'events_summary') {
      // 임시 분석용 — 토큰 매치 시에만 events 시트 집계 반환. 분석 끝나면 이 분기 제거 예정.
      const token = (req.query && req.query.token) || '';
      const EXPECTED_TOKEN = 'tmp-7f3a9c1e4b2d8a5f6e0d3b2c9a8f7e1d';
      if (token !== EXPECTED_TOKEN) {
        return res.status(401).json({ ok: false, error: 'unauthorized' });
      }
      try {
        const auth = getAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        const resp = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_EVENTS}!A:N`,
        });
        const rows = resp.data.values || [];
        if (rows.length < 2) {
          return res.status(200).json({ ok: true, total: 0 });
        }
        const hd = rows[0];
        const iEv = hd.indexOf('event_type');
        const iSid = hd.indexOf('session_id');
        const iDev = hd.indexOf('device');
        const iSrc = hd.indexOf('utm_source');
        const iMed = hd.indexOf('utm_medium');
        const iCmp = hd.indexOf('utm_campaign');
        const iLoc = hd.indexOf('location');
        const iOpt = hd.indexOf('option');
        const iDate = hd.indexOf('date');
        const data = rows.slice(1);

        const byEventType = {};
        const byDevice = {};
        const bySource = {};
        const byDate = {};
        const byCtaLocation = {};
        const byApplyOption = {};
        const sessionsBy = {};       // session unique by event_type
        const sessionsByDev = { mobile: {}, desktop: {} };
        const sessionsBySrc = {};    // {source: {event_type: Set}}
        const allSessions = new Set();
        const sessionFirstSeen = {};

        for (const r of data) {
          const ev = r[iEv] || '';
          const sid = r[iSid] || '';
          const dev = r[iDev] || '';
          const src = r[iSrc] || '(none)';
          const date = r[iDate] || '';
          const loc = r[iLoc] || '';
          const opt = r[iOpt] || '';

          byEventType[ev] = (byEventType[ev] || 0) + 1;
          byDevice[dev] = (byDevice[dev] || 0) + 1;
          bySource[src] = (bySource[src] || 0) + 1;
          if (date) byDate[date] = (byDate[date] || 0) + 1;
          if (ev === 'cta_click' && loc) byCtaLocation[loc] = (byCtaLocation[loc] || 0) + 1;
          if (ev === 'apply_start' && opt) byApplyOption[opt] = (byApplyOption[opt] || 0) + 1;

          if (sid) {
            allSessions.add(sid);
            if (!sessionsBy[ev]) sessionsBy[ev] = new Set();
            sessionsBy[ev].add(sid);
            if (dev === 'mobile' || dev === 'desktop') {
              if (!sessionsByDev[dev][ev]) sessionsByDev[dev][ev] = new Set();
              sessionsByDev[dev][ev].add(sid);
            }
            if (!sessionsBySrc[src]) sessionsBySrc[src] = {};
            if (!sessionsBySrc[src][ev]) sessionsBySrc[src][ev] = new Set();
            sessionsBySrc[src][ev].add(sid);
          }
        }

        const sessionsByEvent = {};
        Object.keys(sessionsBy).forEach(k => { sessionsByEvent[k] = sessionsBy[k].size; });

        const funnelEvents = ['landing_view','cta_click','apply_start','apply_input_start','apply_phase1_done','apply_done'];
        const funnelByDevice = {};
        ['mobile','desktop'].forEach(d => {
          funnelByDevice[d] = {};
          funnelEvents.forEach(ev => {
            funnelByDevice[d][ev] = (sessionsByDev[d][ev] || new Set()).size;
          });
        });
        const funnelBySource = {};
        Object.keys(sessionsBySrc).forEach(src => {
          funnelBySource[src] = {};
          funnelEvents.forEach(ev => {
            funnelBySource[src][ev] = (sessionsBySrc[src][ev] || new Set()).size;
          });
        });

        return res.status(200).json({
          ok: true,
          total_rows: data.length,
          unique_sessions: allSessions.size,
          by_event_type: byEventType,
          sessions_by_event_type: sessionsByEvent,
          by_device: byDevice,
          by_utm_source: bySource,
          by_date: byDate,
          cta_click_by_location: byCtaLocation,
          apply_start_by_option: byApplyOption,
          funnel_by_device: funnelByDevice,
          funnel_by_utm_source: funnelBySource,
        });
      } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
      }
    }

    if (action === 'count') {
      try {
        const auth = getAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        const resp = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_PURCHASE}!A:A`,
        });
        const rows = resp.data.values || [];
        const count = Math.max(0, rows.length - 1); // 헤더 제외
        const remainingRaw = Math.max(0, COHORT_CAPACITY - count);
        const remaining = Math.max(remainingRaw, SEATS_MIN_DISPLAY);
        const filled = COHORT_CAPACITY - remaining;
        const percent = Math.round(filled / COHORT_CAPACITY * 100);

        // 엣지 캐시 30s + SWR 60s → Sheets API 호출량을 분당 2회 수준으로 고정
        res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
        return res.status(200).json({
          ok: true,
          count,
          capacity: COHORT_CAPACITY,
          remaining,
          percent,
        });
      } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
      }
    }

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

    return res.status(400).json({ ok: false, error: 'unknown type' });
  } catch (err) {
    console.error('Sheets API error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
