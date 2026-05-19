// .env 의 모든 변수를 Vercel 프로젝트 환경변수(production)에 등록.
// 이미 등록된 키는 건너뜀. 사용법:
//   node --env-file=.env scripts/push-env.js
import fs from 'node:fs';
import path from 'node:path';

const projectJson = JSON.parse(fs.readFileSync('.vercel/project.json', 'utf-8'));
const authJson = JSON.parse(
  fs.readFileSync(
    path.join(
      process.env.HOME,
      'Library/Application Support/com.vercel.cli/auth.json',
    ),
    'utf-8',
  ),
);
const TOKEN = authJson.token;
const PID = projectJson.projectId;
const TID = projectJson.orgId;

const envText = fs.readFileSync('.env', 'utf-8');
const entries = envText
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#') && l.includes('='))
  .map((l) => {
    const idx = l.indexOf('=');
    return [l.slice(0, idx), l.slice(idx + 1)];
  })
  .filter(([, v]) => v.length > 0);

const existing = await fetch(
  `https://api.vercel.com/v10/projects/${PID}/env?teamId=${TID}`,
  { headers: { Authorization: `Bearer ${TOKEN}` } },
).then((r) => r.json());
const existingKeys = new Set((existing.envs || []).map((e) => e.key));

for (const [key, value] of entries) {
  if (existingKeys.has(key)) {
    console.log(`skip: ${key} (이미 존재)`);
    continue;
  }
  const res = await fetch(
    `https://api.vercel.com/v10/projects/${PID}/env?teamId=${TID}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        key,
        value,
        type: 'encrypted',
        target: ['production'],
      }),
    },
  );
  const data = await res.json();
  if (res.ok) console.log(`add : ${key}`);
  else console.log(`FAIL: ${key} → ${data.error?.message || JSON.stringify(data)}`);
}
