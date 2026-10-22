# 다음 통합 작업 · 진행 기록

기준 원격: ce064378eeea693a2dffcf1ebb2ba2d62056aa5a

## 사용자 요구사항

- 기존 목업 기준 UI 교정, 애드온 테마색 유입 차단, 한국어 설정, 자간·행간 0.1 단위 입력.
- 감정 태그는 캐릭터 표시에서만 숨기고 사용자 메시지·원문·TTS 합성 입력은 보존.
- 대사별 TTS 재생·정지·확인 후 재생성, 캐시 재사용 및 번역 전 원문 사용.
- 설정 탭을 기능별 실제 진입점을 갖춘 올인원 마이페이지로 구성. 순정 설정 패널만 연결하지 않음.
- 깨진 기존 진입 경로·기능 연결 점검. 영어 전용 기능은 다국어 호환.
- WebP 변환 기본 품질 95.

## 통합 대상

1. leuy5674/marinara-nai-character-prompt · v1.3.0 고정
2. Rmroffj/key_save
3. you2-use/NovelAI-Metadata-Importer
4. ai-frontend-ddini/marinara-global-preset
5. boricha417/marinara-excerpt-studio
6. 번역 프리셋·단어장 마개조 1.6.4.zip
7. illustration-button.personal-extension.zip
8. SharedNAI-marinara-0.1.2.zip
9. marinara-convo-weather-v0.2.1.personal-extension.zip

## 현재 상태와 보존 규칙

이 문서는 작업 인수·요구사항 보존 기록이며 구현 완료 보고가 아니다. 이전 로컬 커밋 5ec0a27/c7208ed는 원격에 보존되지 않았고 자동 작업공간 정리로 제거됐다. 현재 원격 소스를 기준으로 복구해야 한다. 이전 테스트 결과를 복구된 코드의 검증 결과로 재사용하지 않는다.

기능 단위로 코드·출처·라이선스·검증 상태를 기록하고 원격 브랜치 반영을 확인한다. 사용자 데이터·API 키·운영 환경을 커밋하지 않는다. main 병합·배포는 수행하지 않는다.
