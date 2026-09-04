# D5: Call every execution target a computer

## Decision

People see “Your computers” and “Remy computers.” Code may call the execution target a `runner`. “Device” is retired from the UI.

## Consequences

A Mac and a hosted Sprite share one product concept. Phones and browsers are clients, not computers.

## Rejected alternatives

- “Device,” because it conflates clients such as phones with machines that execute threads.
- “Runner” in the UI, because it exposes an implementation term.
- Separate product nouns for Macs and hosted environments, because routing treats them uniformly.
