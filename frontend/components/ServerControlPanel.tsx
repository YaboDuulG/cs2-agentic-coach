import { useState } from "react";
import { Terminal, Send, CheckCircle, XCircle } from "lucide-react";
import { Button, Spinner } from "@/components/ui";

interface Props {
  teamId: string;
  matchId: string; // The active practice match/session ID
}

export function ServerControlPanel({ teamId, matchId }: Props) {
  const [command, setCommand] = useState("");
  const [logs, setLogs] = useState<{ id: number; text: string; type: "user" | "system" | "error" }[]>([
    { id: 0, text: "Warlord RCON Console connected. You can use natural language (e.g. 'kick all bots') or raw commands.", type: "system" }
  ]);
  const [isSending, setIsSending] = useState(false);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!command.trim() || isSending) return;

    const userCmd = command.trim();
    setCommand("");
    setLogs(prev => [...prev, { id: Date.now(), text: `> ${userCmd}`, type: "user" }]);
    setIsSending(true);

    try {
      const res = await fetch(`/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          match_id: matchId,
          query: userCmd,
          team_id: teamId, // Assuming chat API passes this if needed
        }),
      });

      if (!res.ok) throw new Error("API Error");

      const data = await res.json();
      // The Khan returns a report, extract the summary
      const responseText = data.summary || data.final_report?.summary || "Command executed.";

      setLogs(prev => [...prev, { id: Date.now(), text: responseText, type: "system" }]);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Error executing command";
      setLogs(prev => [...prev, { id: Date.now(), text: `Error executing command: ${errorMsg}`, type: "error" }]);
    } finally {
      setIsSending(false);
    }
  };

  const logColor = (type: "user" | "system" | "error") =>
    type === "user"
      ? "var(--color-text-primary)"
      : type === "error"
        ? "var(--color-danger)"
        : "var(--color-success)";

  return (
    <div className="card flex flex-col h-[400px] overflow-hidden">
      <div
        className="flex items-center gap-2 p-3 border-b"
        style={{ borderColor: "var(--color-border-primary)", background: "var(--color-bg-secondary)" }}
      >
        <Terminal size={16} style={{ color: "var(--color-text-secondary)" }} />
        <h3
          className="text-xs font-bold uppercase tracking-wider"
          style={{ color: "var(--color-text-primary)", fontFamily: "var(--font-body)" }}
        >
          Warlord RCON Console
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-xs">
        {logs.map((log) => (
          <div key={log.id} className="flex items-start gap-2" style={{ color: logColor(log.type) }}>
            <span className="opacity-50 mt-0.5">
              {log.type === "user" ? "" : log.type === "error" ? <XCircle size={12} /> : <CheckCircle size={12} />}
            </span>
            <span className="leading-relaxed whitespace-pre-wrap">{log.text}</span>
          </div>
        ))}
        {isSending && (
          <div className="flex items-center gap-2" style={{ color: "var(--color-text-secondary)" }}>
            <Spinner size={10} />
            <span>Running…</span>
          </div>
        )}
      </div>

      <form
        onSubmit={handleSend}
        className="p-3 border-t flex gap-2"
        style={{ borderColor: "var(--color-border-primary)", background: "var(--color-bg-secondary)" }}
      >
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="e.g. 'Turn on infinite ammo' or 'sv_cheats 1'"
          aria-label="Server command"
          className="flex-1 bg-transparent border rounded px-3 py-2 text-xs"
          style={{
            borderColor: "var(--color-border-primary)",
            color: "var(--color-text-primary)",
            transition: "border-color var(--dur-press) ease",
          }}
          disabled={isSending}
        />
        <Button type="submit" variant="secondary" size="icon" disabled={!command.trim() || isSending} aria-label="Run command">
          <Send size={16} />
        </Button>
      </form>
    </div>
  );
}
