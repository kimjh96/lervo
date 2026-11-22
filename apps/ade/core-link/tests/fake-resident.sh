#!/bin/sh
# A stand-in for `lervo application serve --stdio`: it answers each core-link request by its id
# with a fixed response, and exits when a command's instruction is "crash".
launch='{"sessionId":"0b5f7d8e-4a1c-4c2e-9f3a-1d2e3f4a5b6c","workspaceId":"wsp_1","conversationMode":"native","provider":"claude","program":"/opt/claude","arguments":["--print"],"environment":{"LERVO_TEST":"1"},"workingDirectory":"/work/app-wt/fix","initialInput":"Fix it."}'
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
  kind=$(printf '%s' "$line" | sed -n 's/.*"kind":"\([a-z.]*\)".*/\1/p')
  case "$kind" in
    core.command)
      case "$line" in
        *crash*) exit 1 ;;
        *fail*) printf '{"kind":"core.failed","id":%s,"code":"workspace_start_failed","stage":"workstream"}\n' "$id" ;;
        *) printf '{"kind":"core.result","id":%s,"result":{"workspaceId":"wsp_1"},"launch":%s}\n' "$id" "$launch" ;;
      esac ;;
    core.open) printf '{"kind":"core.failed","id":%s,"code":"workspace_not_found"}\n' "$id" ;;
    decoder.send) printf '{"kind":"decoder.decoded","id":%s,"events":[{"kind":"item","content":{"kind":"user_message","text":"hi"},"createdAtMs":1},{"kind":"status","event":"turn_started"}],"input":"aGkK"}\n' "$id" ;;
    decoder.output) printf '{"kind":"decoder.decoded","id":%s,"events":[{"kind":"start","content":{"kind":"agent_message","text":""},"createdAtMs":2},{"kind":"delta","text":"ok"},{"kind":"finish"}]}\n' "$id" ;;
    *) printf '{"kind":"decoder.decoded","id":%s,"events":[]}\n' "$id" ;;
  esac
done
