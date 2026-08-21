# ADR-0132: CLI 최초 게시 완료 기록 점검

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

Stage approval transition receipt가 있어도 운영자가 여러 원본을 직접 따라가며 같은 승인 결과에 연결됐는지, 저장된 최초 게시 전환에 남은 수동 조치가 있는지 판단해야 합니다. 이 확인을 위해 외부 상태를 다시 바꾸거나 새 장기 문서를 만들 필요는 없습니다.

## 결정

`release:bootstrap:completion-inspect`를 읽기 전용 명령으로 추가합니다. 입력은 stage evidence bundle과 transition receipt 두 절대 경로뿐입니다. Bundle reader가 manifest와 여섯 참조 원본을 다시 검증하고, receipt reader는 canonical v3 문서의 digest와 고정 완료 의미를 확인합니다.

순수 inspection 정책은 receipt의 stage reconciliation digest·evidence 시각을 bundle report에, 공개 registry·package·version·dist-tag와 artifact integrity·shasum을 approval attempt에 대조합니다. Bootstrap consumed, Trusted Publisher stage-only와 direct publish forbidden 의미도 유지해야 합니다.

성공 report의 `remainingManualActions=[]`는 `recorded_first_publication_transition` 범위에만 적용합니다. Bootstrap·publication authorization 원본은 다시 적재하지 않고, 현재 public registry, workflow, npm trust와 GitHub environment도 다시 관측하지 않으며 receipt signer도 검증하지 않습니다. 사람 출력은 이 범위와 한계를 자연스러운 한국어로 설명하며 digest와 경로를 노출하지 않습니다.

## 결과

저장된 최초 게시 완료 provenance를 짧은 stdout report로 확인할 수 있습니다. 명령은 output 파일, network, npm·GitHub 설정, publication, runtime event·project 상태와 telemetry를 만들거나 바꾸지 않습니다. Source race, 다른 evidence를 가리키도록 redigest한 receipt와 외부 상태를 verified로 올린 report는 fail-closed합니다.
