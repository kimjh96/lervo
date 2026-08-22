# ADR-0144: 원본 증거를 보존하는 명시적 project identity migration

상태: Accepted  
기준일: 2026-08-22

## 배경

제품 식별자를 Lervo로 통일한 뒤 새 초기화는 이전 실험 버전의 `.roven`을 발견하면 안전하게 멈췄지만, 사용자가 기존 event와 CAS를 보존해 `.lervo`로 전환할 실행 경로는 없었습니다. 디렉터리 이름만 직접 바꾸면 event hash 안의 과거 payload, CAS 주소와 이전 document marker의 의미를 검증할 수 없습니다. 반대로 모든 문자열을 치환하면 append-only event 원본과 사용자가 쓴 문장을 훼손합니다.

## 결정

명칭 전환을 `@lervo/identity-migration`과 `lervo migrate identity`가 소유합니다. 기본 명령은 읽기 전용 plan만 만들며 적용하려면 그 plan ID를 `--apply`로 다시 명시해야 합니다. Plan은 source tree 전체 content hash, project, event chain, CAS object, 문서 metadata 처분과 새 디렉터리를 묶습니다. 적용 직전에 같은 plan을 다시 계산하므로 승인 뒤 한 byte라도 바뀌면 시작하지 않습니다.

Event DB 검사는 원본 파일의 임시 복사본에서 실행합니다. 원본에 WAL·SHM·journal이 있거나 schema migration이 함께 필요하면 중단합니다. 모든 기존 event의 project·sequence·previous hash·event hash와 모든 CAS object의 주소·content hash를 확인합니다. 파일 수 100,000개, 전체 64 GiB, CAS object 100,000개를 넘거나 심볼릭 링크와 특수 파일이 있으면 자동 전환하지 않습니다.

현재 document 계약을 통과하는 metadata는 byte 그대로 활성 상태로 유지합니다. 이전 managed marker나 이전 ownership을 쓰지만 알려진 이전 계약으로 확인되는 metadata는 사용자 Markdown을 고치지 않고 `.lervo/archive/identity/<sourceDigest>/`에 원본 byte로 옮깁니다. 활성 document registry는 빈 디렉터리로 시작하며 재도입은 기존 document migration의 별도 검토와 승인을 사용합니다. 알 수 없는 metadata는 archive로 추정하지 않고 plan을 막습니다.

적용은 root를 원자적으로 rename하고, 빠진 현재 디렉터리를 만든 뒤 `project.identity.migrated`를 기존 event head에 연결합니다. Event commit 전 실패는 새 경로와 SQLite 보조 파일을 제거하고 이전 root를 복구합니다. 복구가 확인되지 않으면 `finalization_failed`입니다. Commit 뒤에는 append-only event를 지우지 않으며 마무리 실패를 정상 receipt로 만들지 않습니다.

## Event와 개인정보

`project.identity.migrated`의 허용 필드는 plan ID, source tree hash, 보존한 event 수와 head hash, 검증한 CAS object 수, 문서 metadata 처분, 적용 시각입니다. Repository path, 파일 목록, 문서·artifact 본문, 승인자나 사용자 ID, provider 원문과 credential은 저장하지 않습니다. 실패는 event로 남기지 않으므로 event 부재만으로 시도 여부를 추정할 수 없습니다.

## 결과

- Local-only 저장소에서도 Hub 없이 전환을 끝낼 수 있습니다.
- 기존 event hash와 CAS object를 다시 쓰지 않고 새 완료 좌표만 append합니다.
- 이전 문서 metadata는 잃지 않되 사용자 문장을 자동 변경하거나 현재 계약인 것처럼 가장하지 않습니다.
- 대규모·활성·손상·알 수 없는 상태는 자동 처리하지 않고 구체적인 blocker로 남습니다.

## 검증

- 같은 원본의 두 dry-run이 같은 plan을 만들고 source DB에 보조 파일을 남기지 않는지 확인합니다.
- 실제 이전 root fixture에서 기존 event head와 CAS bytes가 보존되고 완료 event가 다음 sequence로 연결되는지 확인합니다.
- 계획 뒤 byte 변경, 두 root 공존과 깨진 CAS가 적용 전에 차단되는지 확인합니다.
- 이전 managed marker metadata가 원본 byte로 archive되고 사용자 Markdown과 활성 빈 registry가 분리되는지 확인합니다.
