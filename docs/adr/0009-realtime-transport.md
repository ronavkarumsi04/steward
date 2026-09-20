# ADR-0009: Server-Sent Events for realtime

Status: Accepted

## Decision
SSE over HTTP for server→client events with Last-Event-ID replay; client→server via REST. WebSockets used only for the companion channel (bidirectional command protocol).
