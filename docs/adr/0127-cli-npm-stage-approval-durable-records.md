# ADR-0127: CLI npm stage 승인 durable 기록

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

승인은 공개 전환을 일으키므로 npm 호출 전에 시도 사실이 durable해야 합니다. 호출 뒤 응답 유실을 실패 전과 같게 취급하거나 같은 권한을 다시 쓰면 중복·불명확한 공개 결과를 숨길 수 있습니다.

## 결정

Approval attempt는 authorization digest, workflow target, public registry·stage ID digest·dist-tag, tarball 세 digest와 예약 시각을 immutable 문서로 먼저 보존합니다. Retry는 reconciliation 없이는 금지합니다.

Terminal은 별도 파일 하나이며 CLI exit-zero, 호출 뒤 unknown, 호출 전 abort를 구분합니다. Exit-zero도 공개 증명이 아니므로 `publicAvailability=not_claimed`와 authenticated registry verification required를 기록합니다. Unknown은 blind retry를 금지합니다.

공용 immutable attempt filesystem adapter를 추출해 기존 stage publish와 approval store가 공유합니다. Adapter는 owner-only directory·file, exclusive-create, fsync, bounded regular file과 symlink·권한 검사를 소유합니다. Record validator·binding과 오류 code는 도메인 wrapper가 주입하므로 두 실행 의미를 혼용하지 않습니다.

## 결과

기록 계약과 저장 adapter를 npm 실행에서 분리했습니다. 테스트는 성공·unknown·abort 의미, mode, attempt·terminal 분리, 중복·overwrite·binding 변조와 기존 stage publish 회귀를 검증합니다. 실제 npm approve와 2FA는 다음 실행 경계에 남습니다.
