# 확장 통합 소스와 다음 수정 위치

현재 PR: #12, fix/reader-mockup-theme. 이 문서는 미완료 통합의 재개 지점이며 완료 보고가 아니다.

## 통합한 항목

- NAI Character Prompt: v1.3.0 / e0dee0ffa13ec25b1534abf781b85219c3dc4306 / MIT. packages/client/src/lib/nai-character-prompt의 원본 생성·근거 검증·정규화 모듈, hooks/use-nai-character-prompt.ts, components/chat/NaiCharacterPromptTool.tsx. 두 번의 원문 기반 raw 생성, 요청별 취소, 긍정·부정 분리·복사. 카드·프리셋은 변경하지 않는다. 모의 제공자 브라우저 검증 통과, 실제 유료 생성 미검증.
- 첨부 illustration-button.personal-extension: 기존 ChatArea.handleIllustrate에 메시지 ID 범위를 직접 전달. ChatRoleplaySurface에서 동기 pending 잠금, ChatMessage에서 실제 액션. 초안 유지·ID 전달·생성 중 잠금의 모의 제공자 검사 통과. 첨부의 React 내부 트리 탐색과 DOM 감시는 가져오지 않는다.
- SharedNAI 첨부 0.1.2: 이미 main의 server/src/assets/sharednai-bridge.mjs 및 services/image/image-generation.ts에 직접 어댑터가 있다. 중복 로더·전역 fetch 패치를 추가하지 않는다. NAI/WebP 회귀 검사에서 자격 증명 및 요청 변환·429·중복 생성 방지 경로를 확인했다. 실제 계정 호출은 미검증. 첨부 배포 제한 문구가 있어 원본 설치 스크립트는 공개 복사하지 않는다.

## 아직 구현하지 않은 통합

| 대상 | 확인한 기능과 구현 경계 | 다음 연결 위치 |
| --- | --- | --- |
| Rmroffj/key_save v1.1.4 | 마스터 암호·PBKDF2 200,000회·암호화 키 보관 및 그룹 관리. 원본은 연결 화면의 React 내부 트리와 입력창을 탐색한다. 저장 키·비밀번호는 저장소에 커밋하지 않는다. | 연결 편집기와 마이페이지에 네이티브 키 보관함 연결. 원본 라이선스 메타데이터 없음. |
| you2-use/NovelAI-Metadata-Importer v1.0.0 | PNG tEXt/zTXt/iTXt·stealth alpha, WebP EXIF UserComment. 선택한 항목만 비교·적용. 생성 설정 적용 시 seed=-1, UC preset=0. 썸네일은 별도 즉시 저장. | 기존 png-parser 및 연결 편집기의 실제 초안 상태에 연결. 원본 전체 body MutationObserver 대신 네이티브 이벤트 사용. 원본 라이선스 메타데이터 없음. |
| ai-frontend-ddini/marinara-global-preset v2.9.4 | 전역 따르기·개별 고정·명시적 없음·일괄 변경·삭제 프리셋 계열 매칭·최근 300건 이력·옵션 선택 알림. 기본 대상 RP, 연결 프리셋이 우선. 새 방은 마법사 완료 뒤 적용 선택. schema2 및 v1 pins 이관. | use-chats/use-presets 및 채팅 설정의 상태·변이 경로에 연결. 300ms 폴링과 React 내부 트리 탐색은 가져오지 않는다. MIT. |
| boricha417/marinara-excerpt-studio v1.0.0 | 선택 문장 발췌 PNG. 강조·밑줄·가림·교체·인용 색·질감/줄/격자/이미지 배경·제목/작성자·너비·높이·모서리. 폰트는 /api/fonts 및 엔진 선택을 따를 것. | 메시지 선택/발췌 작업 및 마이페이지 스튜디오. 원본 라이선스 메타데이터 없음. |
| 번역 프리셋·단어장 1.6.4 첨부 | 번역 프리셋, 대화별 단어장·말투, 문단별 번역·원문 대조·편집, 자동 추출, 백업. 약 303KB 단일 확장. 원본은 fetch 패치·body 감시·250ms 채팅 폴링 사용. | use-translate, 번역 설정 및 메시지 렌더러에 네이티브 연결. 원문/기존 번역 저장과 제공자 설정 보존. |
| marinara-convo-weather v0.2.1 첨부 | 사용자 공통 지역 + 대상 대화방, 캐릭터별 선택 지역. 날씨 주입은 agentInjectionOverrides. 모델에 지역명은 보내지 않고 날씨·온도만 제공, 양쪽이면 user/char 구분. 명시적 저장과 0.1 이관. | 대화 생성 입력과 별도 네이티브 편집 화면. 전역 fetch 패치 금지. MIT 및 Open-Meteo 데이터 출처 표기 보존. |

## 재개 규칙

원격 ref를 읽고 최신 main/작업 브랜치 차이부터 확인한다. 소스 폴더 extension-sources와 첨부 upload는 작업공간 외부 임시 경로이므로 없으면 저장소 URL과 원본 첨부에서 다시 가져온다. 구현된 항목을 다시 작성하지 않는다. 기능마다 실제 API 연결·한국어·전자책 토큰·모바일·오류/취소/원문 보존을 검증하고 원격에 Commit+Push한 뒤 ref를 확인한다.
