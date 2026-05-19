# 파운더스 안내데스크 (ops-manager)

AI 파운더스 1기 운영 슬랙 `#파운더스_질문해결방`에서 동작하는 챗봇. Notion 운영 문서와 채널 히스토리를 컨텍스트로 활용해 수강생 문의에 1차 응대한다.

> 디렉터리명(`ops-manager`)은 역할 기반, 슬랙 노출 표시명은 **파운더스 안내데스크**.

## 운영 정책

1. `#파운더스_질문해결방`에 올라오는 **모든 새 메시지**를 봇이 먼저 보고 분류한다(멘션 없어도 OK).
2. **운영 vs 기술** 카테고리를 Claude로 판단한다.
3. **운영 질문**이면 봇이 직접 답변한다. 베이스 문서:
   - 파운더스 1기 Notion: https://www.notion.so/teamsparta/AI-1-35e2dc3ef514806287e3dfa5e845b010
   - 채널 히스토리에서 인덱싱된 운영 관련 논의
4. **기술 질문(오류·코드 등)**이면 답변 대신 기술튜터 `@[기술 튜터] 조진호`를 thread에 태그한다.
5. **모호한 질문**은 기술튜터 태그 + 봇이 참고용 초안도 함께 제시한다(사용자 선택).
6. **톤앤매너**: 친절·쉬운 말투(40–50대 비개발자 대상), 응원·치얼업 톤. 추궁/비교/위협조 금지.

## 동작 흐름

```
Slack Events (#파운더스_질문해결방 새 메시지)
   ↓
[api/slack.js]
   ↓
classifier.js → {ops | tech | ambiguous}
   ↓
 ┌───────────────┬──────────────────────┬──────────────────────────┐
 │ ops           │ tech                 │ ambiguous                │
 ├───────────────┼──────────────────────┼──────────────────────────┤
 │ Notion + 채널 │ 튜터 태그 + 짧은 안내 │ 튜터 태그 + 봇 참고 초안 │
 │ 인덱스로 답변 │                       │                          │
 └───────────────┴──────────────────────┴──────────────────────────┘
   ↓
Slack thread reply
```

## 채널 히스토리 인덱싱

- `api/index.js` 가 Vercel cron으로 주기 실행하며 `conversations.history`를 fetch
- MVP는 in-request fetch(매 요청마다 최근 N개) 로 시작 → 메시지 양 증가 시 별도 store(Vercel KV / DB)로 분리

## 디렉터리

- `api/slack.js` — Slack Events API 엔드포인트
- `api/index.js` — 채널 히스토리 인덱싱 cron 엔드포인트
- `lib/classifier.js` — 운영/기술 분류
- `lib/notion.js` — Notion 페이지 재귀 fetch + 마크다운 직렬화
- `lib/claude.js` — Anthropic SDK 호출 (prompt caching)
- `lib/slack.js` — Slack chat.postMessage / 멘션 유틸

## 환경변수

`.env.example` 참고. Vercel Project Settings에도 동일 키 등록.

## 초기 셋업 체크리스트

운영자(사용자)가 해야 할 일:

- [ ] **Slack App 생성** → Bot Token, Signing Secret 발급
  - Bot Token Scopes: `chat:write`, `app_mentions:read`, `channels:history`, `channels:read`, `users:read`
  - Event Subscriptions: `message.channels`, `app_mention`
  - Request URL: `https://<vercel-domain>/api/slack`
- [ ] 봇을 `#파운더스_질문해결방` 채널에 초대
- [ ] **기술튜터 슬랙 user ID** 확보 (`Uxxxxxxxx` 형태)
- [ ] **Notion Internal Integration** 생성 → API 키 발급, 1기 페이지에 Integration "Connect"
- [ ] **Anthropic API 키** 발급
- [ ] Vercel 환경변수 등록 → 배포

## 로컬 실행

```bash
cd slack/ops-manager
npm install
cp .env.example .env   # 값 채우기
npm run dev            # vercel dev
```

## 현재 상태 (2026-05-18)

### 완료 ✅
- 코드 구현 + Notion `column_list` 재귀 처리 패치
- Slack App "파운더스 안내데스크" 생성 + 워크스페이스 설치
- Bot Token / Signing Secret 발급 → `.env` 저장
- 채널 ID 조회 (`C0B3EHMD2DC` = `#파운더스_질문해결방`) 및 봇 가입
- 기술튜터 user ID 조회 (`U0B3VK1B803` = `[기술 튜터] 조진호`)
- Notion API 키 (기존 "AI 파운더스 자동화" integration 재사용) 검증
- 1기 페이지 fetch 검증 (57,072자, OT/항로/오류 해결 순서 모두 포함)
- Anthropic API 키 발급 (단, 크레딧 0)
- Vercel 프로젝트 생성·배포: **https://ops-manager-ten.vercel.app**
- 환경변수 11개 production 등록
- `/api/index` cron 엔드포인트 end-to-end 동작 확인 (Notion 워밍업 성공)
- `/api/slack` 엔드포인트 공개 접근 + 서명 검증 동작 확인
- Vercel cron 등록 (매일 자정 KST, Hobby 플랜 한도 1일 1회)

### 내일 마무리 (운영자 작업)

**1. Anthropic 크레딧 충전 ($5)**
- https://console.anthropic.com/settings/billing
- "Add to credit balance" → $5 → 결제
- 키 그대로 사용 (Vercel 환경변수에 이미 등록됨)

**2. Slack Event Subscriptions URL 등록**
- https://api.slack.com/apps → "파운더스 안내데스크" → 왼쪽 **Event Subscriptions**
- Enable Events 토글 ON
- Request URL에 입력: `https://ops-manager-ten.vercel.app/api/slack`
- "Verified ✓" 뜨면 그 아래 **Subscribe to bot events** 펼치고:
  - Add Bot User Event → `message.channels` 추가
- 화면 하단 **Save Changes**
- 우상단 노란 배너 "Reinstall to Workspace" 뜨면 클릭해서 재설치

**3. 동작 테스트**
- `#파운더스_질문해결방`에서 다른 계정으로 운영성 질문 (예: "줌 링크는 어디서 받나요?")
- 봇이 thread reply 다는지 확인
- 기술 질문 ("requirements.txt 설치 에러나요") 던져서 튜터 멘션되는지 확인

문제 발생 시: https://vercel.com/uzyn0722-gmailcoms-projects/ops-manager 의 Logs 탭 확인

## 디렉터리 메모

- `scripts/smoke-notion.js` — Notion fetch 로컬 검증용 (`node --env-file=.env scripts/smoke-notion.js`)
- `scripts/push-env.js` — `.env`를 Vercel production 환경변수로 일괄 등록 (Vercel REST API 사용)
- `vercel.json` — 일일 0시(UTC) Notion 캐시 워밍업 cron
