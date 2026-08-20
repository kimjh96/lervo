# @lervo/cli

Lervo는 로컬 저장소에서 AI 에이전트의 실행과 근거를 관리하는 CLI입니다. 프로젝트 초기화와 도움말 확인은 Hub 연결 없이 사용할 수 있습니다.

## 준비

- Node.js 22.13 이상

## 설치

```sh
npm install --global @lervo/cli
```

## 첫 실행

프로젝트 폴더에서 다음 명령을 실행합니다.

```sh
lervo init --name my-project
lervo --help
```

`lervo init`은 현재 폴더에 `.lervo/` 설정을 만듭니다. 실행 계획을 먼저 보려면 `lervo init --dry-run --name my-project`를 사용하세요.

에이전트를 실제로 실행할 때는 사용할 공급자와 검증 suite를 별도로 구성해야 합니다. 사용 가능한 명령과 옵션은 `lervo --help`에서 확인할 수 있습니다.
