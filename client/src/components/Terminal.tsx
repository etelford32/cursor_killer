import { useEffect, useRef } from "react";
import { Terminal as Xterm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

export function TerminalPanel() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Xterm({
      fontSize: 12.5,
      fontFamily: "'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace",
      cursorBlink: true,
      theme: {
        background: "#0c1013",
        foreground: "#d7dde3",
        cursor: "#ff5c57",
        selectionBackground: "#264f78",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    const safeFit = () => {
      // FitAddon throws if the host hasn't been laid out yet.
      try {
        if (host.clientWidth > 0 && host.clientHeight > 0) fit.fit();
      } catch {
        /* ignore fit races during mount/unmount */
      }
    };
    requestAnimationFrame(safeFit);

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/term`);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "output" || msg.type === "info") term.write(msg.data);
        if (msg.type === "exit") term.write(`\r\n[process exited ${msg.code}]\r\n`);
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => term.write("\r\n[disconnected]\r\n");

    const dataSub = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data }));
    });

    const resizeObserver = new ResizeObserver(() => {
      safeFit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    });
    resizeObserver.observe(host);

    return () => {
      resizeObserver.disconnect();
      dataSub.dispose();
      ws.close();
      term.dispose();
    };
  }, []);

  return <div className="terminal-host" ref={hostRef} data-testid="terminal" />;
}
