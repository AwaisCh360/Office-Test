import { useState } from "react";
import { History, ChevronRight, Terminal, Trash2 } from "lucide-react";
import { type RunListEntry, type RunsPayload, type RunSeverityCounts, deleteRun } from "@/data/serverSource";
import { runTitle } from "@/lib/target-utils";
import { trackCta } from "@/lib/cta";
import EmailVerifyInline from "@/components/EmailVerifyInline";

/**
 * "Past runs" panel. Unverified users see a tease with the run count and a
 * verify affordance (the launched run stays fully visible; the CLI
 * `strix view <name>` still works). Verified users get the full history and can
 * switch the active run, which threads ?run=<name> through the data fetches.
 */

const SEV = [
  { key: "critical", dot: "bg-red-500", text: "text-red-500" },
  { key: "high", dot: "bg-orange-500", text: "text-orange-500" },
  { key: "medium", dot: "bg-yellow-500", text: "text-yellow-500" },
  { key: "low", dot: "bg-blue-500", text: "text-blue-500" },
] as const;

function SeverityChips({ counts }: { counts: RunSeverityCounts }) {
  const shown = SEV.filter((s) => counts[s.key] > 0);
  if (shown.length === 0) {
    return <span className="text-xs text-[#555]">No findings</span>;
  }
  return (
    <div className="flex items-center gap-3">
      {shown.map((s) => (
        <div key={s.key} className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${s.dot}`} aria-hidden="true" />
          <span className={`text-xs tabular-nums ${s.text}`}>{counts[s.key]}</span>
        </div>
      ))}
    </div>
  );
}

function formatDate(iso: string | number | null): string | null {
  if (!iso) return null;
  let normalized: string | number = iso;
  if (typeof iso === "string") {
    normalized = iso.trim().replace(" UTC", "Z").replace(" ", "T");
  } else if (typeof iso === "number") {
    normalized = iso * 1000; // Convert Python seconds to JS milliseconds
  }
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Relative time ("just now" / "5m ago" / "3h ago" / "2d ago"), falling back to
 * the absolute date for anything older than a week (mirrors the pro app).
 */
function formatTimeAgo(iso: string | number | null): string | null {
  if (!iso) return null;
  let normalized: string | number = iso;
  if (typeof iso === "string") {
    normalized = iso.trim().replace(" UTC", "Z").replace(" ", "T");
  } else if (typeof iso === "number") {
    normalized = iso * 1000; // Convert Python seconds to JS milliseconds
  }
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return null;
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
}

interface PastRunsViewProps {
  runs: RunsPayload | null;
  activeRun: string | null;
  onSelectRun: (name: string) => void;
  onVerified: () => void;
  onRunDeleted?: () => void;
}

export default function PastRunsView({
  runs,
  activeRun,
  onSelectRun,
  onVerified,
  onRunDeleted,
}: PastRunsViewProps) {
  const count = runs?.count ?? 0;
  const [showVerify, setShowVerify] = useState(false);
  const [runToDelete, setRunToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  if (!runs || runs.locked) {
    return (
      <div className="rounded-xl border border-[#222] bg-[rgba(255,255,255,0.02)] p-8 text-center">
        <div
          className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl"
          style={{ border: "1px solid #2a2a2a", background: "rgba(255,255,255,0.04)" }}
        >
          <History className="h-5 w-5 text-[#888]" aria-hidden="true" />
        </div>
        <h2 className="text-base font-semibold text-white">Browse every run on this machine</h2>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-[#888]">
          You have {count} past {count === 1 ? "run" : "runs"} on this machine.
        </p>
        {showVerify ? (
          <>
            <p className="mx-auto mt-3 max-w-sm text-xs text-[#666]">
              Verify your email with a one-time code to unlock the full history.
            </p>
            <EmailVerifyInline onVerified={onVerified} />
          </>
        ) : (
          <button
            onClick={() => {
              trackCta("history_unlock", "past_runs");
              setShowVerify(true);
            }}
            className="mt-4 cursor-pointer rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90"
          >
            View runs
          </button>
        )}
        <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-[#555]">
          <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
          Or open one from the CLI with{" "}
          <code className="font-mono text-[#888]">strix view &lt;name&gt;</code>
        </p>
      </div>
    );
  }

  if (runs.runs.length === 0) {
    return (
      <div className="rounded-xl border border-[#222] bg-[rgba(255,255,255,0.02)] p-8 text-center text-sm text-[#888]">
        No past runs found on this machine yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {runs.runs.map((run: RunListEntry) => {
        const active = run.name === activeRun;
        const date = formatTimeAgo(run.start_time) ?? formatTimeAgo(run.end_time);
        const title = runTitle(run.target, run.name);
        return (
          <div key={run.name} className="relative group/item flex items-center">
            <button
              onClick={() => onSelectRun(run.name)}
              className={`animate-card-in flex w-full cursor-pointer items-center gap-4 rounded-lg border px-4 py-3 text-left transition-colors pr-14 ${
                active
                  ? "border-[#444] bg-[rgba(255,255,255,0.04)]"
                  : "border-[#222] bg-[rgba(255,255,255,0.02)] hover:border-[#444]"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-white">{title}</span>
                  {active && (
                    <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400" style={{ border: "1px solid rgba(16,185,129,0.3)" }}>
                      Active
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#666]">
                  {run.scan_mode && <span className="capitalize">{run.scan_mode}</span>}
                  {run.scan_mode && (date || run.status) && <span className="text-[#333]">·</span>}
                  {date && <span>{date}</span>}
                  {date && run.status && <span className="text-[#333]">·</span>}
                  {run.status && <span className="capitalize">{run.status}</span>}
                </div>
              </div>
              <SeverityChips counts={run.severity_counts} />
              <ChevronRight className="h-4 w-4 flex-shrink-0 text-[#555] transition-colors group-hover/item:text-[#aaa]" aria-hidden="true" />
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                setRunToDelete(run.name);
              }}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-[#555] hover:text-red-500 opacity-0 group-hover/item:opacity-100 transition-all cursor-pointer"
              title="Delete run"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        );
      })}

      {runToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-[#111] border border-[#333] rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-scale-in">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-white mb-2">Delete Run</h3>
              <p className="text-sm text-[#888]">
                Are you sure you want to delete <strong className="text-white font-medium">{runToDelete}</strong>? This action cannot be undone.
              </p>
            </div>
            <div className="px-6 py-4 bg-[#0a0a0a] border-t border-[#222] flex items-center justify-end gap-3">
              <button
                onClick={() => setRunToDelete(null)}
                disabled={isDeleting}
                className="px-4 py-2 text-sm font-medium text-white hover:bg-[#222] rounded-lg transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setIsDeleting(true);
                  try {
                    await deleteRun(runToDelete);
                    onRunDeleted?.();
                    setRunToDelete(null);
                  } catch (err) {
                    alert(String(err));
                  } finally {
                    setIsDeleting(false);
                  }
                }}
                disabled={isDeleting}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    Deleting...
                  </>
                ) : (
                  "Delete"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
