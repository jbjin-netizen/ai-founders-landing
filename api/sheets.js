const { google } = require('googleapis');

const SPREADSHEET_ID = '1HeDIX4CYqlLJyF4NlvYBFwVFLYi-nMJRJVWtlIvJ7ms';
const SHEET_EVENTS = 'events';
const SHEET_APPLICANTS = 'applicants';
const SHEET_PARTIAL = 'partial_applicants';
const SHEET_PURCHASE = 'purchase';
const SHEET_CHEERS = 'cheers';

// AI 파운더스 1기 명단·사전리포트 (별도 운영용 시트, 링크만 있으면 접근 가능)
// 팀배정 탭: name | phone_last4 | team_num | team_channel_id | slack_user_id | joined_at | score_count
// 사전리포트 응답 내용 탭: 제출시간 | 이름 | 전화번호 | 환경세팅 현황 | 서비스 분야 | 만들고 싶은 서비스 | 작업 가능 시간대 | 나에게 한마디 | 주 투자 시간 | ...
const STUDENTS_SPREADSHEET_ID = '1XmhdS0yzH9eZCD3ftEfFJ3vRqjrSe2OAOekZL0jUfgI';
const SHEET_STUDENTS = '팀배정';
const SHEET_PRE_REPORT = '사전리포트 응답 내용';

// 학생이 카드에서 직접 수정한 mission/pledge 저장용 (우리 시트, write 권한 있음)
const SHEET_STUDENT_INPUTS = '1st_student_inputs';
const HEADERS_STUDENT_INPUTS = ['name', 'phone_last4', 'mission', 'pledge', 'updated_at'];

// 테스트 계정 (개발/QA용. 시트 명단에 없어도 로그인 가능)
const TEST_STUDENTS = [
  { name: '백유진', phone_last4: '2222', team: 99, score: 5 },
  { name: '편서윤', phone_last4: '2222', team: 99, score: 5 },
  { name: '진종범', phone_last4: '2222', team: 99, score: 5 },
];

const DEFAULT_OT_SCORE = 5;
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
const HEADERS_CHEERS = ['id','created_at','name','message','crew'];

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

// 간이 CSV 파서. 따옴표("...")로 감싼 필드 + 이스케이프("")만 지원.
// 행 구분: \r\n / \n / \r. 빈 행은 제거.
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const src = String(text || '');
  while (i < src.length) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { inQuotes = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\n' || c === '\r') {
      row.push(field); field = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
      if (c === '\r' && src[i + 1] === '\n') i += 2; else i++;
      continue;
    }
    field += c; i++;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.some(v => v !== '')) rows.push(row);
  }
  return rows;
}

// 사전리포트 응답 내용 시트 로드 → name → {desired_service, pledge, ...}
// 같은 이름의 응답이 여러 개면 가장 최근(아래쪽 행) 응답 우선
async function loadPreReport(sheets) {
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: STUDENTS_SPREADSHEET_ID,
      range: `${SHEET_PRE_REPORT}!A:Z`,
    });
    const rows = resp.data.values || [];
    if (rows.length < 2) return new Map();
    const header = (rows[0] || []).map(h => String(h || '').trim());
    const idx = (key) => header.indexOf(key);
    const i_name = idx('이름');
    const i_phone = idx('전화번호');
    const i_service = idx('만들고 싶은 서비스');
    const i_pledge = idx('나에게 한마디');

    const map = new Map();
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const name = i_name >= 0 ? String(row[i_name] || '').trim() : '';
      if (!name) continue;
      // 같은 이름 중복 시 마지막 응답으로 덮어쓰기 (가장 최근 응답)
      map.set(name, {
        phone: i_phone >= 0 ? normalizePhone(row[i_phone]) : '',
        desired_service: i_service >= 0 ? String(row[i_service] || '').trim() : '',
        pledge: i_pledge >= 0 ? String(row[i_pledge] || '').trim() : '',
      });
    }
    return map;
  } catch (err) {
    console.error('loadPreReport error:', err.message);
    return new Map();
  }
}

// 학생이 카드에서 직접 수정한 입력값 시트 (우리 시트에 저장) → name → {mission, pledge}
async function loadStudentInputs(sheets) {
  await ensureSheet(sheets, SHEET_STUDENT_INPUTS, HEADERS_STUDENT_INPUTS);
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_STUDENT_INPUTS}!A:E`,
  });
  const rows = resp.data.values || [];
  const map = new Map();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const name = String(row[0] || '').trim();
    if (!name) continue;
    map.set(name, {
      phone_last4: String(row[1] || '').replace(/\D/g, ''),
      mission: String(row[2] || '').trim(),
      pledge: String(row[3] || '').trim(),
    });
  }
  return map;
}

// 행성 컬럼 값을 boolean으로 정규화. TRUE/1/O/✓/획득 등 truthy 처리.
function isPlanetAcquired(val) {
  const v = String(val || '').trim().toUpperCase();
  if (!v) return false;
  return v === 'TRUE' || v === '1' || v === 'O' || v === '✓' || v === '획득' || v === 'YES' || v === 'Y';
}

const PLANET_SLUGS = ['earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];

// 팀배정 시트 + 사전리포트 + 학생 수정 입력 머지해서 반환.
// 우선순위: 학생 수정 입력 > 사전 리포트 > 빈 값
// 매칭 키: 이름. 폰은 last4만 명단에 저장됨.
// 행성 획득: 팀배정 시트의 earth/moon/.../pluto 컬럼 (truthy → 획득)
async function loadStudents(sheets) {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: STUDENTS_SPREADSHEET_ID,
    range: `${SHEET_STUDENTS}!A:Z`,
  });
  const rows = resp.data.values || [];
  if (rows.length < 2) return [];
  const header = (rows[0] || []).map(h => String(h || '').trim().toLowerCase());
  const idx = (key) => header.indexOf(key);
  const i_name = idx('name');
  const i_phone4 = idx('phone_last4');
  const i_team = idx('team_num');
  const i_score = idx('score_count');
  // 행성 8개 컬럼 인덱스 사전 계산
  const planetIdx = PLANET_SLUGS.map(s => idx(s));

  const preReport = await loadPreReport(sheets);
  const inputs = await loadStudentInputs(sheets);
  const students = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const name = i_name >= 0 ? String(row[i_name] || '').trim() : '';
    if (!name) continue;
    const last4 = i_phone4 >= 0 ? String(row[i_phone4] || '').replace(/\D/g, '').padStart(4, '0') : '';
    const teamNum = i_team >= 0 ? parseInt(String(row[i_team] || '').replace(/\D/g, ''), 10) : 0;
    const score = i_score >= 0 ? (parseFloat(row[i_score]) || DEFAULT_OT_SCORE) : DEFAULT_OT_SCORE;
    const pre = preReport.get(name);
    const inp = inputs.get(name);
    const mission = (inp && inp.mission) || (pre && pre.desired_service) || '';
    const pledge = (inp && inp.pledge) || (pre && pre.pledge) || '';
    // 행성별 획득 여부 (시트 컬럼 직접 read)
    const acquired_planets = PLANET_SLUGS.filter((slug, i) => {
      const ci = planetIdx[i];
      return ci >= 0 && isPlanetAcquired(row[ci]);
    });
    students.push({
      name,
      phone_last4: last4,
      phone: last4,
      team: Number.isFinite(teamNum) ? teamNum : 0,
      pledge: pledge,
      desired_service: mission,
      score: score,
      acquired_planets,
      planet_count: acquired_planets.length, // 호환성: 획득한 행성 개수
    });
  }
  // 테스트 계정 append (지구만 기본 획득)
  TEST_STUDENTS.forEach(t => {
    const inp = inputs.get(t.name);
    const pre = preReport.get(t.name);
    students.push({
      name: t.name,
      phone_last4: t.phone_last4,
      phone: t.phone_last4,
      team: t.team,
      pledge: (inp && inp.pledge) || (pre && pre.pledge) || '',
      desired_service: (inp && inp.mission) || (pre && pre.desired_service) || '',
      score: t.score,
      acquired_planets: ['earth'],
      planet_count: 1,
    });
  });
  return students;
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

    if (action === 'cheers') {
      try {
        const auth = getAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        await ensureSheet(sheets, SHEET_CHEERS, HEADERS_CHEERS);
        const resp = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_CHEERS}!A:E`,
        });
        const rows = resp.data.values || [];
        const messages = [];
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i] || [];
          const name = (r[2] || '').trim();
          const message = (r[3] || '').trim();
          if (!name || !message) continue;
          const crew = String(r[4] || '').trim().toLowerCase() === 'true';
          messages.push({ name, message, crew });
        }
        res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=30');
        return res.status(200).json({ ok: true, messages });
      } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
      }
    }

    if (action === 'seatmap') {
      // 좌석배치도 렌더링용 공개 데이터 (전화번호 미노출)
      try {
        const auth = getAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        const students = await loadStudents(sheets);
        const seats = students.map(s => ({
          name: s.name,
          team: s.team,
        }));
        res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
        return res.status(200).json({ ok: true, seats });
      } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
      }
    }

    if (action === 'leaderboard') {
      // 리더보드 (개인 + 팀 집계). 전화번호 미노출
      try {
        const auth = getAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        const students = await loadStudents(sheets);

        const individual = students
          .map(s => ({
            name: s.name,
            team: s.team,
            score: s.score,
            planet_count: s.planet_count,
          }))
          .sort((a, b) => b.score - a.score || b.planet_count - a.planet_count);

        const teamMap = new Map();
        students.forEach(s => {
          if (!s.team) return;
          const cur = teamMap.get(s.team) || { team: s.team, score: 0, planet_count: 0, members: 0 };
          cur.score += s.score;
          cur.planet_count += s.planet_count;
          cur.members += 1;
          teamMap.set(s.team, cur);
        });
        const teams = Array.from(teamMap.values()).sort((a, b) => b.score - a.score || b.planet_count - a.planet_count);

        res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=60');
        return res.status(200).json({ ok: true, individual, teams });
      } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
      }
    }

    if (action === 'student_stats') {
      // 운영진용 명단 입력 완료도 체크. 집계만 반환, 개인정보 미노출.
      try {
        const auth = getAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        const students = await loadStudents(sheets);
        const by_team = {};
        const missing = { phone: 0, pledge: 0, team: 0, desired_service: 0 };
        students.forEach(s => {
          if (s.team) by_team[s.team] = (by_team[s.team] || 0) + 1;
          if (!s.phone) missing.phone++;
          if (!s.pledge) missing.pledge++;
          if (!s.team) missing.team++;
          if (!s.desired_service) missing.desired_service++;
        });
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ ok: true, total: students.length, by_team, missing });
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

    // 학생 본인 인증 + 1st_student_inputs 시트 row upsert helper
    async function authAndUpsertInput(name, phone, field, value) {
      const last4 = phone.slice(-4);
      // 본인 검증: 팀배정 시트에서 name+last4 매칭
      const allStudents = await loadStudents(sheets);
      const verified = allStudents.find(s => s.name === name && s.phone_last4 === last4);
      if (!verified) {
        return { ok: false, status: 404, error: '본인 확인 실패. 이름·연락처 확인해주세요.' };
      }
      // inputs 시트 upsert (우리 SPREADSHEET_ID, write 권한 있음)
      await ensureSheet(sheets, SHEET_STUDENT_INPUTS, HEADERS_STUDENT_INPUTS);
      const resp = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_STUDENT_INPUTS}!A:E`,
      });
      const rows = resp.data.values || [];
      let matchRow = -1;
      for (let r = 1; r < rows.length; r++) {
        if (String((rows[r] || [])[0] || '').trim() === name) { matchRow = r; break; }
      }
      if (matchRow < 0) {
        // 신규 row append
        const newRow = ['', '', '', '', nowKST()];
        newRow[0] = name;
        newRow[1] = last4;
        if (field === 'mission') newRow[2] = value;
        if (field === 'pledge')  newRow[3] = value;
        await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_STUDENT_INPUTS}!A:E`,
          valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
          requestBody: { values: [newRow] },
        });
      } else {
        // 기존 row update
        const existing = rows[matchRow] || [];
        const mission = field === 'mission' ? value : (existing[2] || '');
        const pledge  = field === 'pledge'  ? value : (existing[3] || '');
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_STUDENT_INPUTS}!A${matchRow+1}:E${matchRow+1}`,
          valueInputOption: 'RAW',
          requestBody: { values: [[name, last4, mission, pledge, nowKST()]] },
        });
      }
      return { ok: true };
    }

    if (body.type === 'update_mission') {
      const name = String(body.name || '').trim();
      const phone = normalizePhone(body.phone);
      const mission = String(body.mission || '').trim().slice(0, 200);
      if (!name || !phone) return res.status(400).json({ ok: false, error: '인증 정보 누락' });
      const r = await authAndUpsertInput(name, phone, 'mission', mission);
      if (!r.ok) return res.status(r.status || 500).json({ ok: false, error: r.error });
      return res.status(200).json({ ok: true, mission });
    }

    if (body.type === 'update_pledge') {
      const name = String(body.name || '').trim();
      const phone = normalizePhone(body.phone);
      const pledge = String(body.pledge || '').trim().slice(0, 200);
      if (!name || !phone) return res.status(400).json({ ok: false, error: '인증 정보 누락' });
      const r = await authAndUpsertInput(name, phone, 'pledge', pledge);
      if (!r.ok) return res.status(r.status || 500).json({ ok: false, error: r.error });
      return res.status(200).json({ ok: true, pledge });
    }

    if (body.type === 'bulk_import_students') {
      // 운영진 일괄 등록. ADMIN_KEY 인증 필수. CSV 헤더에 phone 컬럼 필수.
      // 같은 phone 있으면 update, 없으면 append. 시트 헤더는 동적 매칭.
      const adminKey = process.env.ADMIN_KEY;
      if (!adminKey || String(body.admin_key || '') !== adminKey) {
        return res.status(401).json({ ok: false, error: 'unauthorized' });
      }
      const csvRows = parseCSV(body.csv);
      if (csvRows.length < 2) {
        return res.status(400).json({ ok: false, error: 'csv 헤더 + 1행 이상 필요' });
      }
      const csvHeader = csvRows[0].map(h => String(h || '').trim().toLowerCase());
      const csvData = csvRows.slice(1);
      const csv_i_phone = csvHeader.indexOf('phone');
      if (csv_i_phone < 0) {
        return res.status(400).json({ ok: false, error: 'csv에 phone 컬럼 필수' });
      }

      // 시트 현재 상태 로드
      const resp = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_STUDENTS}!A:Z`,
      });
      const allRows = resp.data.values || [];
      let sheetHeader = (allRows[0] || []).map(h => String(h || '').trim().toLowerCase());

      // 시트 헤더가 비어있으면 csv 헤더로 초기화
      if (sheetHeader.length === 0) {
        sheetHeader = csvHeader.slice();
        const lastCol = String.fromCharCode(65 + sheetHeader.length - 1);
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_STUDENTS}!A1:${lastCol}1`,
          valueInputOption: 'RAW',
          requestBody: { values: [sheetHeader] },
        });
        allRows[0] = sheetHeader;
      } else {
        // csv에는 있는데 시트에 없는 컬럼은 시트 헤더 끝에 추가
        for (const csvCol of csvHeader) {
          if (!sheetHeader.includes(csvCol)) {
            sheetHeader.push(csvCol);
            const colLetter = String.fromCharCode(65 + sheetHeader.length - 1);
            await sheets.spreadsheets.values.update({
              spreadsheetId: SPREADSHEET_ID,
              range: `${SHEET_STUDENTS}!${colLetter}1`,
              valueInputOption: 'RAW',
              requestBody: { values: [[csvCol]] },
            });
          }
        }
      }

      const sheet_i_phone = sheetHeader.indexOf('phone');
      const lastCol = String.fromCharCode(65 + sheetHeader.length - 1);

      let added = 0, updated = 0;
      const errors = [];
      for (let idx = 0; idx < csvData.length; idx++) {
        const csvRow = csvData[idx];
        const phone = normalizePhone(csvRow[csv_i_phone]);
        if (!phone) { errors.push({ row: idx + 2, error: 'phone 비어있음' }); continue; }

        // 시트에서 phone 매칭 row 찾기
        let matchRow = -1;
        for (let r = 1; r < allRows.length; r++) {
          if (normalizePhone((allRows[r] || [])[sheet_i_phone]) === phone) {
            matchRow = r; break;
          }
        }

        // 최종 행 빌드. csv에 없는 컬럼은 기존 값 유지(update) 또는 빈값(append).
        const finalRow = sheetHeader.map((col, ci) => {
          const csvIdx = csvHeader.indexOf(col);
          if (csvIdx >= 0) return String(csvRow[csvIdx] || '').trim();
          if (matchRow >= 0) return String((allRows[matchRow] || [])[ci] || '');
          return '';
        });

        if (matchRow >= 0) {
          const sheetRowNum = matchRow + 1;
          await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_STUDENTS}!A${sheetRowNum}:${lastCol}${sheetRowNum}`,
            valueInputOption: 'RAW',
            requestBody: { values: [finalRow] },
          });
          allRows[matchRow] = finalRow;
          updated++;
        } else {
          await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_STUDENTS}!A:A`,
            valueInputOption: 'RAW',
            insertDataOption: 'INSERT_ROWS',
            requestBody: { values: [finalRow] },
          });
          allRows.push(finalRow);
          added++;
        }
      }
      return res.status(200).json({ ok: true, added, updated, total: added + updated, errors });
    }

    if (body.type === 'student_login') {
      // 1기 수강생 로그인 검증. 이름+폰 마지막 4자리 매칭 (팀배정 시트는 last4만 저장).
      const name = String(body.name || '').trim();
      const phone = normalizePhone(body.phone);
      if (!name || !phone) {
        return res.status(400).json({ ok: false, error: '이름과 연락처를 모두 입력해주세요.' });
      }
      const last4 = phone.slice(-4);
      const students = await loadStudents(sheets);
      const match = students.find(s => s.name === name && s.phone_last4 && s.phone_last4 === last4);
      if (!match) {
        return res.status(404).json({ ok: false, error: '이름 또는 연락처를 찾을 수 없어요. 다시 확인해주세요.' });
      }
      // 전화번호는 응답에 포함하지 않음 (다른 사용자가 본인 카드를 캡처해 공유할 가능성 차단)
      return res.status(200).json({
        ok: true,
        student: {
          name: match.name,
          team: match.team,
          pledge: match.pledge,
          desired_service: match.desired_service,
          score: match.score,
          planet_count: match.planet_count,
          acquired_planets: match.acquired_planets || [],
        },
      });
    }

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

    if (body.type === 'cheer_message') {
      const name = String(body.name || '').trim().slice(0, 40);
      const message = String(body.message || '').trim().slice(0, 1000);
      if (!name || !message) {
        return res.status(400).json({ ok: false, error: 'name과 message는 필수예요' });
      }
      const crew = String(body.crew || '').toLowerCase() === 'true' ? 'true' : '';
      await appendRow(sheets, SHEET_CHEERS, HEADERS_CHEERS, [
        uuid(),
        nowKST(),
        name,
        message,
        crew,
      ]);
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
