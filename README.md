# sns-relay

블로그 글 주소 하나로 Threads · Instagram · Facebook 페이지 · 네이버 블로그용 요약 초안을 만들고, 사람이 승인한 것만 공식 API로 게시하는 도구입니다.

처음이라면 **[처음부터 따라 하는 가이드](https://cube.ai.kr/projects/sns-relay)** 부터 보세요. 설치, Meta 토큰 발급(실제 화면 캡처), 사용법 세 가지를 순서대로 담았습니다.

**왜 만들었나.** 블로그 글 하나를 알리려고 SNS 마다 말투와 길이를 바꿔 다시 쓰는 데 글 한 편에 30분 넘게 들었습니다. 이 반복을 Claude 에게 맡기되, AI 가 쓴 글이 내 확인 없이 나가지 않도록 승인과 미리보기를 반드시 거치게 만들었습니다.

**누구에게 맞나.** 블로그를 쓰면서 Threads · 인스타그램 · 페이스북 페이지 · 네이버도 함께 운영하는 1인 운영자·소상공인에게 맞습니다. 사람 확인 없는 완전 자동 게시, 남의 콘텐츠 재게시, 페이스북 개인 프로필 게시에는 맞지 않습니다.

흐름은 이렇습니다. 글 주소 → 채널별 초안 → 사람의 승인 → 미리보기 → 게시. 네이버는 공식 글쓰기 API가 없어서 붙여 넣기용 원고 파일(naver.md)을 만들어 열어 주고 발행은 직접 합니다(반자동).

## 안전장치

- 승인하지 않은 초안은 게시하지 않습니다. 초안을 고치면 승인이 자동으로 풀립니다.
- 게시 전에 `--dry-run` 미리보기로 최종 문구를 먼저 봅니다. 실제 게시는 채널을 직접 지정해야 합니다.
- 중복 게시를 막습니다. 결과를 모르는 게시는 다시 올리지 않고 사람이 확인해 확정합니다.
- 토큰과 시크릿은 작업 폴더의 `.env` 에만 두며 화면·로그·MCP 응답에 나오지 않습니다.

## 설치

요구 사항은 다음과 같습니다.

- Node.js 22.12 이상
- git

```bash
git clone https://github.com/SomySam/sns-relay.git
cd sns-relay
npm install          # 빌드까지 자동으로 됩니다
npm install -g .     # sns-relay 명령을 등록합니다(이 폴더로 연결됩니다)
sns-relay --version
```

git 주소로 바로 전역 설치하는 방식은 빌드 도구가 설치되지 않아 실패하므로 쓰지 않습니다. 등록한 명령은 이 저장소 폴더를 가리키니 폴더를 지우거나 옮기지 마세요.

업데이트는 저장소 폴더에서 `git pull` 을 한 뒤 `npm install` 을 다시 실행합니다.

## 처음 설정

1. 작업 폴더를 만듭니다. 초안과 상태, 비밀 값이 이 폴더에 쌓이므로 저장소와 따로 둡니다.

   ```bash
   sns-relay init --dir <작업 폴더>
   ```

2. [가이드 5장](https://cube.ai.kr/projects/sns-relay)을 따라 Meta 계정·앱·토큰을 준비하고 `.env` 를 채웁니다.
3. 준비가 잘 됐는지 점검합니다.

   ```bash
   sns-relay doctor --dir <작업 폴더>
   ```

## 쓰는 법

세 가지 중 편한 것을 씁니다. 모두 같은 작업 폴더와 같은 안전장치를 씁니다.

### Claude Code 스킬 / 플러그인

Claude Code 에서 플러그인을 설치하면 스킬(초안 작성부터 승인 요청까지의 절차)과 MCP 서버가 함께 들어옵니다.

```
/plugin marketplace add SomySam/sns-relay
/plugin install sns-relay@sns-relay
```

MCP 서버는 환경 변수 `SNS_RELAY_DIR` 로 작업 폴더를 받습니다. 플러그인을 설치한 뒤 다음처럼 설정합니다.

- Windows: `setx SNS_RELAY_DIR "<작업 폴더>"` 를 실행한 뒤 Claude Code 와 Claude Desktop 을 모든 창까지 완전히 종료했다가 다시 켭니다.
- macOS / Linux: 셸 설정 파일에 `export SNS_RELAY_DIR=<작업 폴더>` 를 추가합니다. 그 터미널에서 시작한 Claude Code 에만 적용되고, GUI 앱은 이 값을 못 볼 수 있습니다.

플러그인의 MCP 서버는 설치된 `sns-relay`(위 설치 절차)를 찾아 실행합니다. 업데이트는 `/plugin marketplace update sns-relay` 로 합니다.

MCP 서버가 뜨지 않으면 플러그인 대신 직접 등록합니다.

```bash
claude mcp add -s user sns-relay -e SNS_RELAY_DIR=<작업 폴더> -- node "<npm root -g 결과>/sns-relay/dist/cli/index.js" mcp
```

플러그인 없이 스킬만 쓰려면 `skill/sns-relay/SKILL.md` 를 `~/.claude/skills/sns-relay/SKILL.md`(모든 프로젝트) 또는 `<작업 폴더>/.claude/skills/sns-relay/SKILL.md`(그 폴더만)에 복사합니다. 승인은 항상 사람이 확인한 뒤에만 합니다.

### Claude Desktop (MCP)

`claude_desktop_config.json` 의 `mcpServers` 에 추가합니다. `<작업 폴더>` 는 자신의 작업 폴더 경로로 바꿉니다.

macOS / Linux:

```json
{"mcpServers":{"sns-relay":{"command":"sns-relay","args":["mcp","--dir","<작업 폴더>"]}}}
```

Windows: npm 전역 명령은 `.cmd` 파일이라 앱이 바로 실행할 수 없습니다. 그래서 node 로 설치된 파일을 실행합니다.

```json
{"mcpServers":{"sns-relay":{"command":"node","args":["<npm root -g 결과>\\sns-relay\\dist\\cli\\index.js","mcp","--dir","<작업 폴더>"]}}}
```

터미널에서 `npm root -g` 를 실행하면 폴더가 나옵니다. JSON 안에서는 경로의 `\` 를 `\\` 로 두 번 씁니다. 예: `"C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\sns-relay\\dist\\cli\\index.js"`. 작업 폴더 경로에 `\` 가 있으면 같은 방식으로 씁니다. `--dir` 이나 `SNS_RELAY_DIR` 중 하나는 꼭 있어야 합니다. 더 간단한 방법으로, `args` 의 첫 항목을 `<저장소 폴더>\\dist\\cli\\index.js` 로 바로 지정해도 됩니다. 연결 설치라면 `npm root -g` 결과의 `sns-relay` 폴더가 이 저장소 폴더를 가리키므로 위 예시도 그대로 동작합니다.

Claude Desktop 을 다시 켠 뒤 프롬프트 `draft_sns_posts` 에 글 주소를 넣고 시작합니다. 실제 게시는 `publish` 를 `dry_run: true` 로 먼저 불러 받은 `confirm_token` 이 있어야 열립니다.

- 이미 만든 초안의 첫 문장만 다시 쓰고 싶으면 프롬프트 `rewrite_hooks` 에 작업 이름을 넣습니다. 채널별 첫 문장 3안을 보여 주고, 고른 안으로 바꾼 뒤 다시 승인받습니다. 계정 말투를 계속 바꾸려면 아래 `config.json` 의 `notes` 를 고칩니다.

### 터미널 (CLI)

작업 폴더에서 실행하거나 명령마다 `--dir <작업 폴더>` 를 붙입니다.

```bash
sns-relay init                       # config.json, .env, work/ 생성
sns-relay fetch <글 주소>             # 본문 추출 + 채널별 빈 초안 파일
sns-relay new --title "<제목>" --text <글감 파일> [--image <파일 또는 주소>]... [--link <주소>]   # 블로그 주소 없이 글감·사진으로 시작 (--image 를 여러 번 주면 사진 여러 장)
sns-relay image <id> --article       # (사진을 하나만 주면 사진이 한 장이 됩니다 — 목록 전체를 바꿈) 대표 이미지를 Cloudinary 에 옮겨 JPEG 주소로 (--file <경로>·--url <주소> 도 가능, 여러 번 주면 사진 전체를 그 순서로 바꿈, 승인이 풀림)
sns-relay rules                      # 초안 작성 규칙
# work/<id>/drafts/*.md 의 본문을 채운다 (직접 또는 Claude 로)
sns-relay drafts <id>                # 검증 결과
sns-relay approve <id> --channels threads,facebook   # 검토한 초안 승인
sns-relay publish <id> --dry-run     # 게시 전 최종 확인
sns-relay publish <id> --channels threads   # 승인된 초안 게시 (Threads·Instagram·Facebook, --channels 필수)
sns-relay status                     # 글 × 채널 상태
sns-relay resolve <id> threads --published <주소>   # 결과 불명 칸 확정
sns-relay naver <id>                 # 네이버 붙여 넣기용 원고(naver.md)를 만들어 연다 — 칸별로 복사해 붙여 넣고, 태그는 「태그 편집」에 하나씩 Enter
sns-relay mark naver <id> --url <발행 주소>   # 직접 발행한 주소 기록
sns-relay doctor                     # 채널별 토큰·권한·만료일 점검
sns-relay token refresh threads      # Threads·Instagram 토큰 갱신(60일 연장)
sns-relay token page                 # 페이스북 페이지 토큰 발급
sns-relay mcp --dir <작업 폴더>       # MCP 서버 (Claude Desktop 등)
```

사진 여러 장: `--image` 를 여러 번 줍니다(최대 10장). 첫 장이 대표이고, 인스타그램은 첫 장 비율로 잘립니다. Claude Code 에서는 입력창에 사진을 여러 장 올리면 됩니다.

- `sns-relay image` 에 사진을 하나만 주면 사진이 한 장이 됩니다(목록 전체를 바꿈).
- 링크가 있는 글은 여러 장이 인스타그램에만 올라가고, Threads·페이스북은 링크 글로 올라갑니다.
- 여러 장 게시는 준비에 몇 분 걸릴 수 있습니다.
- 여러 장 기능은 글감 작업에 쓰는 것을 권합니다(블로그 글을 다시 가져오면 사진 목록이 블로그 대표 이미지로 돌아갑니다).

## 사진 자동 업로드(Cloudinary)

인스타그램·Threads 는 공개 이미지 주소만 받습니다. 로컬 사진이나 WebP 대표 이미지를 쓰려면 Cloudinary 를 켭니다(선택). 자세한 순서는 [가이드 5-10절](https://cube.ai.kr/projects/sns-relay)에 있습니다.

1. https://console.cloudinary.com 에서 무료 가입합니다.
2. 대시보드의 **Product Environment Credentials** 에서 Cloud name, API Key, API Secret 세 값을 찾습니다.
3. `<작업 폴더>/.env` 의 `CLOUDINARY_CLOUD_NAME`·`CLOUDINARY_API_KEY`·`CLOUDINARY_API_SECRET` 에 넣습니다.
4. `config.json` 에 `"imageHost": "cloudinary"` 를 넣습니다.
5. `sns-relay doctor` 로 `✔ cloudinary` 가 나오는지 확인합니다.

무료 요금제는 월 25 크레딧이고 이미지 한 장은 10MB 까지입니다.

## 말투 맞추기

기본 규칙(`sns-relay rules`)은 누구나 쓰는 공통 원칙입니다. 내 계정의 말투는 작업 폴더 `config.json` 의 `notes` 에 적으면 규칙 끝에 붙고, 사실에 관한 규칙을 뺀 나머지는 메모가 우선합니다.

```json
{
  "notes": {
    "common": "짧은 호흡, 핵심만, 위트 있게. 블로그를 쓰다가 혼잣말하는 1인칭 넋두리 말투로.",
    "naver": "소제목마다 예시 하나씩."
  }
}
```

`common` 은 모든 채널에, `threads` · `instagram` · `facebook` · `naver` 는 그 채널에만 적용됩니다.

## 토큰 관리

- Threads·Instagram 장기 토큰은 60일짜리입니다. 발급 24시간 뒤부터 만료 전까지 `token refresh <채널>` 로 60일을 다시 늘릴 수 있습니다. 만료되면 새로 발급해야 합니다.
- 새 토큰과 만료일(`THREADS_TOKEN_EXPIRES_AT`, `IG_TOKEN_EXPIRES_AT`)은 `.env` 에 저장됩니다. 화면에는 토큰 값이 나오지 않습니다.
- 페이스북 페이지 토큰은 만료가 없습니다. 다만 앱의 데이터 접근 기한이 있어 `doctor` 가 그 날짜를 알려 줍니다. 기한 전에 `sns-relay token page` 로 다시 발급합니다. Graph API 탐색기에서 받은 사용자 토큰을 붙여 넣으면 되고, 입력은 화면에 보이지 않습니다(자세한 순서는 [가이드 5-9절](https://cube.ai.kr/projects/sns-relay)).
- `doctor` 는 만료 14일 전부터 경고합니다. 한 달에 한 번쯤 실행하면 됩니다.
- `doctor` 는 경고만 있으면 0, 오류가 있으면 1 로 끝납니다.
- 만료일은 UTC 날짜로 적힙니다(한국 시간보다 최대 하루 이르게 보일 수 있습니다).
- 값 뒤에 붙인 # 주석은 갱신할 때 지워집니다.

## 로드맵

| 상태 | 내용 |
|---|---|
| ✅ v0.2.0 | 블로그 글 주소·글감·사진으로 초안, 승인·미리보기·게시(Threads·Instagram·Facebook 페이지), 네이버 반자동, 사진 여러 장(캐러셀), Cloudinary 업로드, 토큰 점검·갱신, Claude Code 플러그인·MCP |
| 🔧 v0.3.0 (개발 완료, 실사용 확인 중) | **내 유튜브 영상으로 올리기** — 영상 주소와 유튜브 스튜디오에서 받은 자막 파일로 초안 작성. 추가 토큰 없음 |
| 🗓 검토 중 | 구글 로그인으로 유튜브 자막을 자동으로 받기 |
| 🗓 개선 예정 | 블로그 글을 다시 가져올 때 손으로 바꾼 인스타 사진 유지 |
| 🗓 개선 예정 | 인스타 이미지 확인 시 응답 크기 상한, Meta API 버전 정렬 |
| 🗓 개선 예정 | 긴 글에서 MCP 응답이 같은 내용을 두 번 싣는 문제 줄이기 |
| 🗓 검토 중 | 영문 README, npm 배포 |

## 개발

```bash
npm install
npm test        # 빌드 후 전체 테스트
```

버그나 제안은 [Issues](https://github.com/SomySam/sns-relay/issues)에 남겨 주세요.

## 라이선스

MIT
