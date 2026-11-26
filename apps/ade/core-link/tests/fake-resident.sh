#!/bin/sh
# A stand-in for `lervo application serve --stdio`: it answers each core-link request by its id
# with a fixed response, and exits when a command's instruction is "crash". Its first argument
# picks a release: "older" advertises no commands and ends on `provider.list`, as a release from
# before the provider list does, "invalid" answers `provider.list` with a malformed result, and
# "rooms" also advertises `decoder.deliveries` and answers output "mention\n" (`bWVudGlvbgo=`)
# with a finished turn that delivers a mention.
# Its second argument, when given, is a file that collects every `session.exited`,
# `decoder.open`, `decoder.send`, and `decoder.interrupt` it receives (an "older" release ends on a
# `decoder.open` that names a session and on any `decoder.interrupt`),
# and its third, a file that gets one line each time the process starts. Output "finish\n"
# (`ZmluaXNoCg==`) finishes the turn.
release="${1:-current}"
reports="${2:-}"
starts="${3:-}"
[ -n "$starts" ] && printf 'started\n' >> "$starts"
launch='{"sessionId":"0b5f7d8e-4a1c-4c2e-9f3a-1d2e3f4a5b6c","workspaceId":"wsp_1","conversationMode":"native","provider":"claude","program":"/opt/claude","arguments":["--print"],"environment":{"LERVO_TEST":"1"},"workingDirectory":"/work/app-wt/fix","initialInput":"Fix it."}'
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
  kind=$(printf '%s' "$line" | sed -n 's/.*"kind":"\([a-z.]*\)".*/\1/p')
  case "$kind" in
    core.command)
      case "$release:$line" in
        *crash*) exit 1 ;;
        *fail*) printf '{"kind":"core.failed","id":%s,"code":"workspace_start_failed","stage":"workstream"}\n' "$id" ;;
        *'"workspace.list"'*)
          case "$release" in
            older) printf '{"kind":"core.result","id":%s,"result":{"workspaces":[]}}\n' "$id" ;;
            rooms) printf '{"kind":"core.result","id":%s,"result":{"workspaces":[],"commands":["workspace.start","workspace.list","repository.list","provider.list","session.exited","decoder.session","decoder.interrupt","decoder.deliveries"]}}\n' "$id" ;;
            *) printf '{"kind":"core.result","id":%s,"result":{"workspaces":[],"commands":["workspace.start","workspace.list","repository.list","provider.list","session.exited","decoder.session","decoder.interrupt"]}}\n' "$id" ;;
          esac ;;
        older:*'"provider.list"'*) exit 1 ;;
        invalid:*'"provider.list"'*) printf '{"kind":"core.result","id":%s,"result":{"providers":[]}}\n' "$id" ;;
        *'"provider.list"'*) printf '{"kind":"core.result","id":%s,"result":{"providers":[{"provider":"claude","displayName":"Claude Code","capabilities":{"nativeConversation":true,"sessionIdBinding":true,"hooks":false,"mcp":false,"systemPromptFile":false,"resume":true},"conversationModes":["native","cli"],"preferredMode":"native","installed":true}],"defaultProvider":"claude"}}\n' "$id" ;;
        *) printf '{"kind":"core.result","id":%s,"result":{"workspaceId":"wsp_1","sessionId":"0b5f7d8e-4a1c-4c2e-9f3a-1d2e3f4a5b6c","provider":"claude"},"launch":%s}\n' "$id" "$launch" ;;
      esac ;;
    core.open) printf '{"kind":"core.failed","id":%s,"code":"workspace_not_found"}\n' "$id" ;;
    decoder.open)
      [ -n "$reports" ] && printf '%s\n' "$line" >> "$reports"
      case "$release:$line" in older:*'"sessionId"'*) exit 1 ;; esac
      printf '{"kind":"decoder.decoded","id":%s,"events":[]}\n' "$id" ;;
    session.exited)
      [ -n "$reports" ] && printf '%s\n' "$line" >> "$reports"
      printf '{"kind":"core.result","id":%s,"result":{"status":"recorded"}}\n' "$id" ;;
    transcript.read)
      case "$line" in
        *'"offset":0'*) printf '{"kind":"transcript.page","id":%s,"items":[{"content":{"kind":"user_message","text":"from the terminal"},"createdAtMs":5}],"complete":false}\n' "$id" ;;
        *) printf '{"kind":"transcript.page","id":%s,"items":[],"complete":true}\n' "$id" ;;
      esac ;;
    decoder.interrupt)
      [ -n "$reports" ] && printf '%s\n' "$line" >> "$reports"
      case "$release" in older) exit 1 ;; esac
      printf '{"kind":"decoder.decoded","id":%s,"events":[],"input":"c3RvcAo="}\n' "$id" ;;
    decoder.send)
      [ -n "$reports" ] && printf '%s\n' "$line" >> "$reports"
      printf '{"kind":"decoder.decoded","id":%s,"events":[{"kind":"item","content":{"kind":"user_message","text":"hi"},"createdAtMs":1},{"kind":"status","event":"turn_started"}],"input":"aGkK"}\n' "$id" ;;
    decoder.output)
      case "$line" in
        *ZmluaXNoCg==*) printf '{"kind":"decoder.decoded","id":%s,"events":[{"kind":"status","event":"turn_finished"}]}\n' "$id"; continue ;;
        *bWVudGlvbgo=*) printf '{"kind":"decoder.decoded","id":%s,"events":[{"kind":"status","event":"turn_finished"}],"deliveries":[{"deliveryId":"7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f","workspaceId":"wsp_1","agentId":"agt_arin","sessionId":null,"text":"[Lervo room] From Elio (Product Owner):\\n@Arin is it in seconds?"}]}\n' "$id"; continue ;;
      esac
      printf '{"kind":"decoder.decoded","id":%s,"events":[{"kind":"start","content":{"kind":"agent_message","text":""},"createdAtMs":2},{"kind":"delta","text":"ok"},{"kind":"finish"}]}\n' "$id" ;;
    *) printf '{"kind":"decoder.decoded","id":%s,"events":[]}\n' "$id" ;;
  esac
done
