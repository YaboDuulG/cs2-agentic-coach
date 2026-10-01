"use client";

import { Send } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MatchRow } from "@/components/matches/MatchRow";
import { shortUserId } from "@/components/teams/util";
import { Button, Card, CardHeader, EmptyState, Select, SkeletonRows, Textarea, toast } from "@/components/ui";
import { useTeamChat, useTeamMatches } from "@/lib/api/hooks";
import { mapLabel } from "@/lib/format";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Team coach: chat grounded in the team's own matches and ingested strats. */
export function CoachTab({ teamId }: { teamId: string }) {
  const matches = useTeamMatches(teamId);
  const chat = useTeamChat(teamId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [map, setMap] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => (matches.data ?? []).slice(0, 8), [matches.data]);
  const maps = useMemo(() => Array.from(new Set((matches.data ?? []).map((m) => m.map).filter((m): m is string => Boolean(m)))), [matches.data]);

  // Written from the team's own data, never from pro team names.
  const prompts = useMemo(() => {
    const team = (matches.data ?? []).filter((m) => m.mode === "team");
    const scout = (matches.data ?? []).filter((m) => m.mode === "scouting");
    const out: { label: string; map: string | null }[] = [];
    if (team[0]?.map) out.push({ label: `What went wrong on ${mapLabel(team[0].map)} last match?`, map: team[0].map });
    if (team[1]?.map && team[1].map !== team[0]?.map) out.push({ label: `Which of our ${mapLabel(team[1].map)} defaults get punished?`, map: team[1].map });
    if (scout[0]?.map) out.push({ label: `How does the team we scouted on ${mapLabel(scout[0].map)} play their eco rounds?`, map: scout[0].map });
    if (out.length < 3) out.push({ label: "What should we drill this week based on our matches?", map: null });
    if (out.length < 3) out.push({ label: "Summarise our active strats and where they are weak.", map: null });
    return out.slice(0, 3);
  }, [matches.data]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, chat.isPending]);

  async function send(text: string, mapName?: string | null) {
    const message = text.trim();
    if (!message || chat.isPending) return;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setDraft("");
    try {
      const res = await chat.mutateAsync({ message, history, map_name: mapName ?? (map || null) });
      setMessages((prev) => [...prev, { role: "assistant", content: res.response }]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The coach did not answer. Try again.");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card className="flex min-h-[520px] flex-col">
        <CardHeader
          title="Ask the coach"
          description="Answers cite your team's matches and strats."
          actions={
            maps.length ? (
              <Select value={map} onChange={(e) => setMap(e.target.value)} aria-label="Map context" className="w-40">
                <option value="">Any map</option>
                {maps.map((m) => (
                  <option key={m} value={m}>
                    {mapLabel(m)}
                  </option>
                ))}
              </Select>
            ) : null
          }
        />
        <div className="flex-1 space-y-3 overflow-y-auto" role="log" aria-live="polite">
          {messages.length === 0 ? (
            <div className="surface-2 px-4 py-4">
              <p className="eyebrow mb-2">Try asking</p>
              <div className="flex flex-col items-start gap-2">
                {prompts.map((p) => (
                  <button key={p.label} type="button" onClick={() => send(p.label, p.map)} className="link text-left text-sm">
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div
                className="max-w-[85%] rounded-(--radius-md) px-4 py-2.5 text-sm"
                style={
                  m.role === "user"
                    ? { background: "var(--color-accent-soft)", color: "var(--color-text)" }
                    : { background: "var(--color-surface-2)", border: "1px solid var(--color-line)" }
                }
              >
                {m.role === "assistant" ? (
                  m.content
                    .split(/\n{2,}/)
                    .filter((p) => p.trim())
                    .map((p, j) => (
                      <p key={j} className={j > 0 ? "mt-2 whitespace-pre-line" : "whitespace-pre-line"}>
                        {p}
                      </p>
                    ))
                ) : (
                  <p className="whitespace-pre-line">{m.content}</p>
                )}
              </div>
            </div>
          ))}
          {chat.isPending ? (
            <p className="text-[12px]" style={{ color: "var(--color-text-3)" }}>
              Coach is thinking…
            </p>
          ) : null}
          <div ref={endRef} />
        </div>
        <form
          className="mt-4 flex items-end gap-2 border-t pt-4 hairline"
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
        >
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask about a match, a map or a strat"
            aria-label="Message to the coach"
            className="min-h-11"
            rows={1}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(draft);
              }
            }}
          />
          <Button type="submit" loading={chat.isPending} disabled={!draft.trim()} aria-label="Send">
            <Send size={16} aria-hidden="true" />
            Send
          </Button>
        </form>
      </Card>

      <Card>
        <CardHeader title="What the coach can see" description="Team matches and scouting dossiers, newest first." />
        {matches.isLoading ? (
          <SkeletonRows rows={3} />
        ) : rows.length === 0 ? (
          <EmptyState title="No matches yet" description="Upload a team demo from the Overview tab and ask about it here." />
        ) : (
          <div className="space-y-2">
            {rows.map((m) => (
              <MatchRow key={m.match_id} m={{ ...m, uploader: shortUserId(m.user_id) }} showUploader />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
