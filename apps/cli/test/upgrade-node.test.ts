import { describe, expect, it } from "vitest";

import { parseNodeServiceCoordinates } from "../src/upgrade-node.js";

describe("repository upgrade Node service recovery", () => {
  it("recovers exact launchd coordinates without exposing unrelated service fields", () => {
    expect(
      parseNodeServiceCoordinates(
        "launchd",
        `<?xml version="1.0"?>
<plist><dict>
<key>Label</key><string>com.lervo.node.fixture</string>
<key>ProgramArguments</key><array>
<string>/Users/example/Lervo &amp; tools/node</string>
<string>--config</string>
<string>/Users/example/Lervo &amp; tools/config.json</string>
</array>
</dict></plist>
`,
      ),
    ).toEqual({
      executable: "/Users/example/Lervo & tools/node",
      config: "/Users/example/Lervo & tools/config.json",
    });
  });

  it("recovers escaped systemd coordinates and rejects noncanonical commands", () => {
    expect(
      parseNodeServiceCoordinates(
        "systemd",
        `[Service]
ExecStart="/home/example/Lervo%%20/bin/node" --config "/home/example/Lervo%%20/config.json"
`,
      ),
    ).toEqual({
      executable: "/home/example/Lervo%20/bin/node",
      config: "/home/example/Lervo%20/config.json",
    });
    expect(parseNodeServiceCoordinates("systemd", "ExecStart=/bin/sh -c unsafe\n")).toBeNull();
    expect(
      parseNodeServiceCoordinates(
        "launchd",
        "<key>ProgramArguments</key><array><string>/bin/sh</string></array>",
      ),
    ).toBeNull();
  });
});
