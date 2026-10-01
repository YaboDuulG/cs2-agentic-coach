"use client";

import { notFound } from "next/navigation";
import { useState } from "react";
import { MeteringPanel } from "@/components/admin/MeteringPanel";
import { TrialCodesPanel } from "@/components/admin/TrialCodesPanel";
import { Button, Card, CardHeader, Input, Label, PageHeader, Select, Skeleton, Textarea, toast } from "@/components/ui";
import { useAdminConfigs, useSaveAdminConfigs } from "@/lib/api/hooks";

const PROMPTS: [string, string, string][] = [
  ["prompt_great_khan_instructions", "Tactician instructions", "Constraints and formatting for the automated tactician stage."],
  ["prompt_scribe_base", "Scribe base prompt", "Coaching tone, report structure, markdown rules."],
  ["prompt_focus_instruction", "Team focus instruction", "Appended for team uploads. Variables: {user_team}, {uploader_steam_id}."],
  ["prompt_recon_instruction", "Scouting instruction", "Appended for opponent dossiers."],
];

const RATES: [string, string][] = [
  ["llm_price_flash_in", "Flash in"],
  ["llm_price_flash_out", "Flash out"],
  ["llm_price_pro_in", "Pro in"],
  ["llm_price_pro_out", "Pro out"],
  ["server_hourly_cost_usd", "Server $/h"],
];

/** Owner only: the admin route 404s for everyone else, and so does this page. */
export default function AdminPage() {
  const configs = useAdminConfigs();
  const save = useSaveAdminConfigs();
  // Unsaved edits overlay the server values; "Reset" just drops the overlay.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const draft: Record<string, string> = { ...(configs.data ?? {}), ...edits };

  if (configs.isError) notFound();

  const set = (k: string, v: string) => setEdits((d) => ({ ...d, [k]: v }));

  async function onSave() {
    const { last_hltv_ingest_run: _a, last_social_ingest_run: _b, ...rest } = draft;
    void _a;
    void _b;
    try {
      await save.mutateAsync(rest);
      setEdits({});
      toast.success("Settings saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Admin" title="Pipeline" description="Costs per team, trial codes, model and prompts." />

      <MeteringPanel />
      <TrialCodesPanel />

      {configs.isLoading ? (
        <Skeleton className="h-64" />
      ) : (
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            onSave();
          }}
        >
          <Card>
            <CardHeader title="Ingestion" description="Last runs of the pro-meta crawlers." />
            <dl className="grid gap-3 sm:grid-cols-2">
              {[
                ["HLTV pro matches", draft.last_hltv_ingest_run],
                ["Social and YouTube", draft.last_social_ingest_run],
              ].map(([k, v]) => (
                <div key={k} className="surface-2 p-3">
                  <dt className="eyebrow">{k}</dt>
                  <dd className="num mt-1 text-sm">{v && v !== "Never" ? new Date(v).toLocaleString() : "Never"}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Cost rates" description="USD per 1M tokens and per server hour. Each call is priced at the rate in force when it runs." />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {RATES.map(([k, label]) => (
                <div key={k}>
                  <Label htmlFor={k}>{label}</Label>
                  <Input id={k} mono inputMode="decimal" value={draft[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Model" />
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="coaching_model">Coaching model</Label>
                <Select id="coaching_model" value={draft.coaching_model ?? ""} onChange={(e) => set("coaching_model", e.target.value)}>
                  <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                  <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="coaching_temperature" hint="0.0 – 1.0">
                  Temperature
                </Label>
                <Input id="coaching_temperature" mono inputMode="decimal" value={draft.coaching_temperature ?? ""} onChange={(e) => set("coaching_temperature", e.target.value)} />
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Prompts" description="Edits apply to the next coaching run." />
            <div className="space-y-5">
              {PROMPTS.map(([k, label, hint]) => (
                <div key={k}>
                  <Label htmlFor={k} hint={hint}>
                    {label}
                  </Label>
                  <Textarea id={k} mono rows={6} value={draft[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
                </div>
              ))}
            </div>
          </Card>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setEdits({})}>
              Reset
            </Button>
            <Button type="submit" loading={save.isPending}>
              Save settings
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
