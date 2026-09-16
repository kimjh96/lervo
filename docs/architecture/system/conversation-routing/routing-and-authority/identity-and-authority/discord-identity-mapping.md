# Discord identity mapping

The Discord adapter resolves native mention metadata through configured participant identities. When notification suppression omits that metadata, an exact leading participant address uses the same identity mapping. Quoted, embedded, and unknown addresses cannot create ownership.

A reply reference implicitly addresses its referenced agent only when the author is human. Bot and webhook replies retain correlation without starting an unaddressed acknowledgement loop. Explicit participant mentions remain addressable. These rules neither widen authority nor add event fields.
