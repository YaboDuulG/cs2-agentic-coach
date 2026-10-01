"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Label, Modal, Notice, Skeleton, Textarea, toast } from "@/components/ui";
import { useMatchNotes, useSaveNotes } from "@/lib/api/hooks";

/**
 * Match notes feed the coach: saving re-runs coaching, so the dialog says so
 * and asks once before it does.
 */
export function NotesDrawer({ matchId, open, onClose }: { matchId: string; open: boolean; onClose: () => void }) {
  const notes = useMatchNotes(open ? matchId : null);

  return (
    <Modal open={open} onClose={onClose} title="Match notes" description="Context the coach can't see in the demo: who was playing, what you were practising, what went wrong.">
      {notes.isLoading ? (
        <Skeleton className="h-28 w-full" />
      ) : (
        // Mounts with the modal, so the draft starts from the saved notes and
        // the confirm step resets every time the dialog opens.
        <NotesForm matchId={matchId} initial={notes.data?.notes ?? ""} loadFailed={notes.isError} onClose={onClose} />
      )}
    </Modal>
  );
}

function NotesForm({ matchId, initial, loadFailed, onClose }: { matchId: string; initial: string; loadFailed: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const save = useSaveNotes(matchId);
  const [draft, setDraft] = useState(initial);
  const [confirming, setConfirming] = useState(false);
  const dirty = draft !== initial;

  const submit = () => {
    save.mutate(draft, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["job", matchId] });
        toast.success("Notes saved. Coaching is running again with them.");
        onClose();
      },
      onError: (e) => toast.error(e.message || "Could not save the notes."),
    });
  };

  return (
    <>
      <Label htmlFor="debrief-notes" hint={<span className="num">{draft.length} chars</span>}>
        Notes
      </Label>
      <Textarea
        id="debrief-notes"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="We tried a new B default on T side; our AWPer was filling in."
        rows={6}
      />
      {loadFailed ? (
        <Notice tone="danger" className="mt-3">
          Could not load the existing notes. Saving now would overwrite them.
        </Notice>
      ) : null}
      {confirming ? (
        <Notice tone="warning" className="mt-4" title="Saving re-runs coaching">
          The report is rebuilt with these notes; the current findings are replaced in a minute or two.
        </Notice>
      ) : null}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        {confirming ? (
          <Button onClick={submit} loading={save.isPending}>
            Save and re-run
          </Button>
        ) : (
          <Button onClick={() => setConfirming(true)} disabled={!dirty}>
            Save
          </Button>
        )}
      </div>
    </>
  );
}
