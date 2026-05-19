# Slack 운영 봇 모음

AI 파운더스 운영 슬랙에서 동작하는 봇들을 모아두는 디렉터리.

## 구조

- `ops-manager/` — 운영매니저 봇. Notion 문서를 학습해 수강생 문의에 답변.

향후 추가 예정: 출석/리마인더, 팀 점수 푸시, 공지 자동화 등.

## 공통 스택

- 런타임: Node.js (ESM)
- Slack: [@slack/bolt](https://slack.dev/bolt-js/)
- LLM: Anthropic SDK (Claude)
- 배포: Vercel Serverless Functions (기존 `api/` 패턴과 동일)

환경변수는 각 봇 디렉터리의 `.env.example`를 참고. Vercel 배포 시에는 프로젝트별로 환경변수를 분리해서 등록.
