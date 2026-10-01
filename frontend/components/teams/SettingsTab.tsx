"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { TeamMark } from "@/components/teams/TeamMark";
import { shortUserId } from "@/components/teams/util";
import { Badge, Button, Card, CardHeader, FieldError, Input, Label, Modal, toast } from "@/components/ui";
import { useDeleteTeam, useUpdateTeam, useUploadTeamLogo, type TeamDetail } from "@/lib/api/hooks";
import { longDate, mb } from "@/lib/format";

const MAX_LOGO_BYTES = 5 * 1024 * 1024;

/** Settings: name, logo, roster, danger zone. The plan lives on /settings, not here. */
export function SettingsTab({ team, viewerId, isOwner }: { team: TeamDetail; viewerId: string | null; isOwner: boolean }) {
  const router = useRouter();
  const update = useUpdateTeam(team.team_id);
  const uploadLogo = useUploadTeamLogo(team.team_id);
  const del = useDeleteTeam(team.team_id);
  const [name, setName] = useState(team.name);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const dirty = name.trim() !== team.name && name.trim().length > 0;

  async function saveName() {
    try {
      await update.mutateAsync({ name: name.trim() });
      toast.success("Team name saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the name.");
    }
  }

  async function onLogo(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Pick an image file.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error(`That image is ${mb(file.size)}; the limit is 5 MB.`);
      return;
    }
    try {
      await uploadLogo.mutateAsync(file);
      toast.success("Logo updated.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not upload the logo.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onDelete() {
    try {
      await del.mutateAsync();
      toast.success(`${team.name} deleted.`);
      router.push("/teams");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete the team.");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Identity" description={isOwner ? "Name and logo, as your roster sees them." : "Only the captain can change these."} />
        <div className="space-y-4">
          <div>
            <Label htmlFor="team-name">Team name</Label>
            <div className="flex gap-2">
              <Input id="team-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} disabled={!isOwner} />
              <Button onClick={saveName} loading={update.isPending} disabled={!isOwner || !dirty}>
                Save
              </Button>
            </div>
            <FieldError>{update.isError ? (update.error as Error).message : null}</FieldError>
          </div>
          <div>
            <Label htmlFor="team-logo" hint="PNG or JPG, up to 5 MB">
              Logo
            </Label>
            <div className="flex items-center gap-4">
              <TeamMark name={team.name} logoUrl={team.logo_url} size={56} />
              <input
                ref={fileRef}
                id="team-logo"
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={!isOwner || uploadLogo.isPending}
                onChange={(e) => onLogo(e.target.files?.[0])}
              />
              <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} loading={uploadLogo.isPending} disabled={!isOwner}>
                {team.logo_url ? "Replace logo" : "Upload logo"}
              </Button>
            </div>
            <FieldError>{uploadLogo.isError ? (uploadLogo.error as Error).message : null}</FieldError>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Members" description="Share the invite code from Overview to add players." />
        <ul className="space-y-2">
          {team.members.map((m) => {
            const isYou = viewerId !== null && m.user_id === viewerId;
            return (
              <li key={m.user_id} className="surface-2 flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{isYou ? "You" : m.role === "owner" ? "Captain" : <span className="num">{shortUserId(m.user_id)}</span>}</p>
                  {m.joined_at ? (
                    <p className="num text-[12px]" style={{ color: "var(--color-text-3)" }}>
                      joined {longDate(m.joined_at)}
                    </p>
                  ) : null}
                </div>
                {m.role === "owner" ? <Badge tone="rank">Captain</Badge> : <Badge>Player</Badge>}
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-[12px]" style={{ color: "var(--color-text-3)" }}>
          Removing a member is not available yet.
        </p>
      </Card>

      <Card className="lg:col-span-2" style={{ borderColor: "color-mix(in srgb, var(--color-danger) 40%, transparent)" }}>
        <CardHeader title="Danger zone" />
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold">Leave this team</p>
              <p className="text-[12px]" style={{ color: "var(--color-text-2)" }}>
                {isOwner ? "Captains cannot leave; delete the team instead." : "Ask your captain to remove you. Self-service leaving is not available yet."}
              </p>
            </div>
            <Button variant="secondary" size="sm" disabled title="Not available yet">
              Leave
            </Button>
          </div>
          {isOwner ? (
            <div className="flex flex-col gap-2 border-t pt-3 hairline sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold">Delete this team</p>
                <p className="text-[12px]" style={{ color: "var(--color-text-2)" }}>
                  Removes the roster, matches, servers and stratbook. This cannot be undone.
                </p>
              </div>
              <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>
                Delete team
              </Button>
            </div>
          ) : null}
        </div>
      </Card>

      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete team" description={`Type ${team.name} to confirm. Everything under this team is removed.`} size="sm">
        <Label htmlFor="confirm-team-name">Team name</Label>
        <Input id="confirm-team-name" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={team.name} autoComplete="off" />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onDelete} loading={del.isPending} disabled={confirmName.trim() !== team.name}>
            Delete {team.name}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
