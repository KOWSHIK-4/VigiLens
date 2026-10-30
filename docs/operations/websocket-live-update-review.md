# Live Update Connection Review Checklist

## Scope
Use this guide when the VigiLens frontend receives live events through WebSocket or another persistent update channel.

## Connection checks
- Confirm the client connects to the intended environment endpoint.
- Verify authentication and authorization are applied to the connection.
- Check behavior when the network is interrupted and restored.
- Confirm reconnect attempts use bounded delays and do not create tight retry loops.
- Verify the client cleans up old connections when a page or session is closed.

## Event handling
- Confirm incoming events are validated before being displayed.
- Check that event identifiers prevent accidental duplicate rendering where supported.
- Verify ordering and timestamp behavior for delayed messages.
- Ensure a failed connection is visible to the user rather than silently appearing live.
- Confirm sensitive payload fields are not exposed to unauthorized clients.

## Test approach
Use synthetic events and test accounts in a safe environment. Record connection state, event identifiers, expected UI behavior, and observed results.

If the application does not use a persistent live-update channel for a workflow, mark that section not applicable rather than assuming it exists.
