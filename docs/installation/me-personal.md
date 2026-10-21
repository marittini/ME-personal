# ME-personal 설치 및 업데이트

Marinara Engine 2.5.1 (`8042ef6ec638801de45b8d82f82cd2dea85f51a4`) 기반의 독립 포크입니다.
순정 기준점은 `baseline/marinara-v2.5.1` 브랜치에 보존합니다.
엔진 소스의 설치·업데이트 대상은 `marittini/ME-personal`입니다.
공식 에이전트 카탈로그는 계속 이용하며, 에이전트 설치와 엔진 업데이트는 별개입니다.

## Docker로 새로 설치

Git과 Docker Compose가 있는 서버에서 실행합니다.

```bash
git clone --depth 1 --single-branch --branch main https://github.com/marittini/ME-personal.git
cd ME-personal
docker compose -p me-personal up -d --build
```

기본 접속 주소는 서버의 `127.0.0.1:7860`입니다. 기존 서버와 함께 시험할 때는
`PORT=7861 docker compose -p me-personal-test up -d --build`로 다른 포트와 별도 볼륨을 사용하세요.
기존 데이터 볼륨을 두 서버에 동시에 연결하지 마세요.
이 구성은 소스를 직접 빌드하므로 초기 빌드에 메모리와 시간이 필요합니다.
포크의 사전 빌드 이미지·설치기·APK는 아직 발행하지 않았습니다.

## Docker 업데이트

처음 설치한 것과 같은 Compose 프로젝트 이름을 계속 사용합니다.

```bash
cd ME-personal
git fetch https://github.com/marittini/ME-personal.git main
git merge --ff-only FETCH_HEAD
docker compose -p me-personal build --pull
docker compose -p me-personal up -d --no-build
```

각 명령이 성공한 뒤 다음 명령을 실행하세요. 소스가 갈라져 병합이 실패하면 중단하고
직접 수정한 내용을 확인합니다. 순정 저장소로 자동 복귀하지 않습니다.

## 소스로 실행

Node.js 24 이상과 Git을 사용합니다. 프로젝트에 고정된 pnpm 버전은 Corepack으로 실행합니다.

```bash
git clone --depth 1 --single-branch --branch main https://github.com/marittini/ME-personal.git
cd ME-personal
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm start
```

Linux/macOS는 `./start.sh`, Termux는 `./start-termux.sh`, Windows는 `start.bat`을
사용할 수도 있습니다. 시작 스크립트와 앱 내부 Git 업데이터는 `origin`이 이 포크인지
확인하고, 다른 저장소이면 엔진 업데이트를 중단합니다.

## 기존 서버 이전

이 작업은 저장소의 독립화이며 기존 VPS나 실행 중인 Docker 서버를 변경하지 않습니다.
이전 전 데이터 전체와 환경 설정, API 키 암호화에 사용한 비밀값을 백업해야 합니다.
복사한 데이터로 검증한 뒤 기존 서버를 중지하고 전환하세요.
기존 라이선스·저작자 표시는 유지합니다.

## 이 포크에서 제거한 기능

대화와 롤플레이만 제공합니다. Game 모드, Noodle, Slurp, Gacha Forge,
2D/3D Avatars, Storyboard, Haptic Feedback, Echo Chamber, 대화 미니게임,
Combat, CYOA Choices는 제공하지 않습니다. Music DJ, 일반 프로필 사진,
표정 스프라이트, TTS, 통화, 번역, 기억 기능은 유지합니다.

기존 패키지의 실행 코드 복사본은 시작 시 정리합니다. 패키지 데이터와
채팅·미디어는 자동 삭제하지 않습니다. Game 기록은 백업·내보내기를 위한
기존 형식을 유지하지만 Game 실행과 새 Game 채팅 생성은 지원하지 않습니다.
최초 설치에는 위 shallow clone 명령을 사용하면 과거 Git 이력을 받지 않습니다.
로컬 기억 임베딩과 음성 인식에 쓰는 AI 런타임은 별도로 남습니다.
