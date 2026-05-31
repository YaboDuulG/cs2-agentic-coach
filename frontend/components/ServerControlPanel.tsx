import { useState } from "react";
import { Terminal, Send, CheckCircle, XCircle } from "lucide-react";

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
    } catch (err: any) {
      setLogs(prev => [...prev, { id: Date.now(), text: `Error executing command: ${err.message}`, type: "error" }]);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="card border border-white/10 bg-[#0F172A] flex flex-col h-[400px] overflow-hidden rounded-xl">
      <div className="flex items-center gap-2 p-3 border-b border-white/10 bg-black/20">
        <Terminal size={16} className="text-[#8BA7CC]" />
        <h3 className="text-xs font-bold text-white uppercase tracking-wider">Warlord RCON Console</h3>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-xs">
        {logs.map((log) => (
          <div key={log.id} className={`flex items-start gap-2 ${log.type === 'user' ? 'text-white' : log.type === 'error' ? 'text-rose-500' : 'text-[#22D3A0]'}`}>
            <span className="opacity-50 mt-0.5">
              {log.type === "user" ? "" : log.type === "error" ? <XCircle size={12} /> : <CheckCircle size={12} />}
            </span>
            <span className="leading-relaxed whitespace-pre-wrap">{log.text}</span>
          </div>
        ))}
        {isSending && (
          <div className="flex items-center gap-2 text-[#8BA7CC]">
            <div className="w-2 h-2 rounded-full border border-t-transparent animate-spin" style={{ borderColor: "#8BA7CC", borderTopColor: "transparent" }} />
            <span>Executing...</span>
          </div>
        )}
      </div>

      <form onSubmit={handleSend} className="p-3 border-t border-white/10 bg-black/20 flex gap-2">
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="e.g. 'Turn on infinite ammo' or 'sv_cheats 1'"
          className="flex-1 bg-transparent border border-white/10 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-[#2D7DD2]"
          disabled={isSending}
        />
        <button
          type="submit"
          disabled={!command.trim() || isSending}
          className="p-2 bg-[#2D7DD2]/20 text-[#2D7DD2] hover:bg-[#2D7DD2]/30 rounded transition-colors disabled:opacity-50"
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
