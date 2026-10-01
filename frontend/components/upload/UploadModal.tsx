"use client";

import { useEffect, useRef, useState } from "react";
import { UpgradeModal } from "@/components/paywall/UpgradeModal";
import { Badge, Button, Modal } from "@/components/ui";
import { DropZone } from "@/components/upload/DropZone";
import { ModePicker, type ModeChoice, type UploadMode } from "@/components/upload/ModePicker";
import { useDemoUpload } from "@/lib/upload/useDemoUpload";

export interface UploadModalProps {
  open: boolean;
  onClose: () => void;
  /** Callers only pre-select: Team Hub → team; Opponents tab → scouting. */
  preset?: { mode: UploadMode; teamId?: string | null };
  /** A file dropped before the mode was known (Home's drop zone); uploaded as soon as step 2 opens. */
  initialFile?: File | null;
}

const modeTitle: Record<UploadMode, string> = { personal: "Personal", team: "Team", scouting: "Scouting" };

/**
 * Two steps, one decision: who the analysis is for, then the drop zone. The
 * request carries team_id and is_recon; the server derives the mode and
 * stores it on the match. There is no global mode anywhere else.
 */
export function UploadModal({ open, onClose, preset, initialFile }: UploadModalProps) {
  // The flow mounts with the dialog, so every open starts from the preset with
  // a fresh upload state; nothing needs syncing in an effect.
  return open ? <UploadFlow onClose={onClose} preset={preset} initialFile={initialFile} /> : null;
}

function UploadFlow({ onClose, preset, initialFile }: Omit<UploadModalProps, "open">) {
  const [choice, setChoice] = useState<ModeChoice>({ mode: preset?.mode ?? "personal", teamId: preset?.teamId ?? null });
  const [step, setStep] = useState<1 | 2>(preset ? 2 : 1);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const { state, upload, cancel } = useDemoUpload(onClose);

  // A carried file starts uploading the moment the drop step is reached.
  const pendingFile = useRef<File | null | undefined>(initialFile);
  useEffect(() => {
    const file = pendingFile.current;
    if (step === 2 && file && state.phase === "idle") {
      pendingFile.current = null;
      upload(file, { teamId: choice.teamId, isRecon: choice.mode === "scouting" });
    }
  }, [step, state.phase, upload, choice]);

  const needsTeam = choice.mode !== "personal";
  const canContinue = !needsTeam || Boolean(choice.teamId);

  return (
    <>
      <Modal
        open
        onClose={() => {
          if (state.phase === "uploading" || state.phase === "finalizing") return;
          onClose();
        }}
        title={step === 1 ? "Upload a demo" : `Upload a demo · ${modeTitle[choice.mode]}`}
        description={step === 1 ? "One decision, then drop the file. The mode is stored on the match." : undefined}
        size="lg"
      >
        {step === 1 ? (
          <div className="space-y-4">
            <ModePicker value={choice} onChange={setChoice} onUpgrade={() => setUpgradeOpen(true)} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={() => setStep(2)} disabled={!canContinue}>
                Continue
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <Badge tone="accent">{modeTitle[choice.mode]}</Badge>
              {state.phase === "idle" || state.phase === "error" ? (
                <button type="button" className="link text-[13px]" onClick={() => setStep(1)}>
                  Change
                </button>
              ) : null}
            </div>
            <DropZone
              state={state}
              onFile={(file) => upload(file, { teamId: choice.teamId, isRecon: choice.mode === "scouting" })}
              onCancel={cancel}
            />
          </div>
        )}
      </Modal>
      <UpgradeModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} tierNeeded="TEAM" />
    </>
  );
}
