// Minimal SMTP sink for testing email delivery locally: node tests/smtp-sink.mjs [port] [outfile]
// Accepts every message and appends it to outfile. Not for production use.
import net from "node:net";
import fs from "node:fs";
const port = Number(process.argv[2] ?? 2525), out = process.argv[3] ?? "/tmp/smtp-sink.txt";
net.createServer((s) => {
  let data = false, buf = "", msg = "";
  s.write("220 sink ESMTP\r\n");
  s.on("data", (chunk) => {
    buf += chunk.toString();
    let i;
    while ((i = buf.indexOf("\r\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (data) { if (line === ".") { data = false; fs.appendFileSync(out, msg + "\n=====\n"); msg = ""; s.write("250 queued\r\n"); } else msg += line + "\n"; continue; }
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === "EHLO" || cmd === "HELO") s.write("250-sink\r\n250 OK\r\n");
      else if (cmd === "DATA") { data = true; s.write("354 go\r\n"); }
      else if (cmd === "QUIT") { s.write("221 bye\r\n"); s.end(); }
      else s.write("250 OK\r\n");
    }
  });
}).listen(port, "127.0.0.1", () => console.log(`smtp sink on ${port} -> ${out}`));
