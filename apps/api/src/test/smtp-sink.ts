/**
 * A real SMTP server that accepts mail and keeps it.
 *
 * The eval cases about outbound actions are only worth something if the approved action genuinely leaves the
 * building. This speaks enough SMTP for nodemailer to hand over a message — greeting, EHLO, MAIL FROM, RCPT TO,
 * DATA, the message, QUIT — with no TLS and no auth, so a case can connect the product to it like any other
 * SMTP host and then check that the message arrived.
 */
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";

export interface SmtpMessage {
  from: string;
  to: string[];
  data: string;
}

export interface SmtpSink {
  host: string;
  port: number;
  messages: SmtpMessage[];
  close(): Promise<void>;
}

export async function startSmtpSink(): Promise<SmtpSink> {
  const messages: SmtpMessage[] = [];
  const server = createServer((socket) => {
    let inData = false;
    let buffer = "";
    let from = "";
    let to: string[] = [];
    let body: string[] = [];
    const write = (line: string) => socket.write(`${line}\r\n`);

    write("220 steward-eval-sink ESMTP");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (let index = buffer.indexOf("\r\n"); index >= 0; index = buffer.indexOf("\r\n")) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            messages.push({ from, to, data: body.join("\n") });
            body = [];
            write("250 2.0.0 Ok: queued as steward-eval");
          } else {
            body.push(line.startsWith("..") ? line.slice(1) : line);
          }
          continue;
        }
        const upper = line.toUpperCase();
        if (upper.startsWith("EHLO") || upper.startsWith("HELO")) write("250 steward-eval-sink");
        else if (upper.startsWith("MAIL FROM")) {
          from = /<([^>]*)>/.exec(line)?.[1] ?? "";
          to = [];
          write("250 2.1.0 Ok");
        } else if (upper.startsWith("RCPT TO")) {
          to.push(/<([^>]*)>/.exec(line)?.[1] ?? "");
          write("250 2.1.5 Ok");
        } else if (upper.startsWith("DATA")) {
          inData = true;
          write("354 End data with <CR><LF>.<CR><LF>");
        } else if (upper.startsWith("QUIT")) {
          write("221 2.0.0 Bye");
          socket.end();
        } else write("250 2.0.0 Ok");
      }
    });
    socket.on("error", () => undefined);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    host: "127.0.0.1",
    port,
    messages,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
