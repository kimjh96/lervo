# ADR-0125: CLI npm staged package 검토 증거

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

ADR-0124는 workflow artifact에 기록된 `npm_cli_exit_zero`를 검증하지만 npm registry가 반환하는 stage metadata와 tarball bytes는 보지 않습니다. 또한 npm stage ID, 계정 정보와 내려받은 파일은 검토에 필요하지만 장기 보고서에 원문으로 남길 필요가 없습니다.

## 결정

`release:bootstrap:stage-review-evidence`를 별도 읽기 전용 명령으로 둡니다. 저장한 stage result report와 명시한 npm user config를 bounded regular-file snapshot으로 읽고, public registry와 npm 11.15.0 이상만 사용합니다.

Observer는 ambient credential을 거부하고 임시 cache·빈 global config·download directory에서 다음 순서만 실행합니다.

1. `npm stage list @lervo/cli --json`
2. exact package·version의 유일한 stage에 `npm stage view <id> --json`
3. `npm stage download <id> --json`
4. 같은 stage를 다시 `view`

List는 최대 100개로 제한하고 ID·package·version·tag·createdAt·shasum만 정규화합니다. 두 view와 list가 같아야 하며 actor·actorType·npm 출력은 폐기합니다. Download directory에는 npm의 exact regular tarball 하나만 허용하고 64 MiB 이하 bytes에서 SHA-256·SHA-512 integrity·SHA-1 shasum을 계산해 stage result artifact와 metadata에 모두 대조합니다. User config와 stage metadata는 관측 뒤 다시 확인하고 임시 root는 반환 전에 제거합니다.

Report v1은 exact staged package와 tarball을 관측했다는 의미만 갖습니다. Stage ID 원문은 SHA-256 digest로 바꾸고 계정·credential·설정 경로·npm 원문과 임시 tarball은 남기지 않습니다. `stage approve`, `stage reject`, 2FA와 공개 전이는 이 명령에 없습니다.

## 실패 의미

명령·source·binding·observation·report 오류는 `first_publication_stage_review_*`로 닫습니다. Adapter는 환경 credential, user config·client 부재나 변경, stage 누락·중복, list/view/download 실패, metadata 변경, tarball 불일치와 cleanup 실패를 제한된 unavailable reason으로 반환합니다. 오류 메시지는 민감한 원문을 복사하지 않습니다.

## 결과

응답 정규화, 격리된 npm observer, bounded source reader, 순수 evidence·standalone report, CLI 조정기와 formatter를 분리했습니다. 테스트는 유일 stage의 전체 read-only 순서와 임시 파일 제거, 중복 stage, metadata·tarball·source race, ambient credential 거부, stage ID·actor 비노출과 approve·reject 미호출을 검증합니다.

현재 실제 npm registry 요청이나 승인·거부·2FA·공개는 수행하지 않았습니다. 다음 단계는 이 fresh evidence와 사람 결정을 결속하는 쓰기 없는 approval authorization 경계입니다.
