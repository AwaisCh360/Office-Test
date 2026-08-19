import React, { useState } from "react";
import { Loader2, AlertCircle, Zap, ScanLine, Target, FileText } from "lucide-react";
import { startScan } from "@/data/serverSource";
import { LuGitPullRequestArrow } from "react-icons/lu";

interface PRReviewsViewProps {
  onScanStarted: (runName: string) => void;
}

type ScanMode = "quick" | "standard" | "deep";

export default function PRReviewsView({ onScanStarted }: PRReviewsViewProps) {
  const [targetRepo, setTargetRepo] = useState("");
  const [diffBase, setDiffBase] = useState("");
  const [instructions, setInstructions] = useState("");
  const [scanMode, setScanMode] = useState<ScanMode>("quick");
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStart = async () => {
    const repo = targetRepo.trim();
    const base = diffBase.trim();
    
    if (!repo) {
      setError("Target repository is required.");
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      const result = await startScan({
        targets: [repo],
        instructions: instructions.trim() || undefined,
        scan_mode: scanMode,
        scope_mode: "diff", // Always use diff mode for PRs
        diff_base: base || undefined, // Passed to backend
      });
      onScanStarted(result.run_name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start PR security review.");
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Page heading */}
      <div className="flex items-center gap-2">
        <LuGitPullRequestArrow className="w-5 h-5 text-[#888]" aria-hidden="true" />
        <h1 className="text-2xl font-semibold text-white">PR Security Review</h1>
      </div>

      <p className="text-sm text-[#888]">
        Configure a targeted penetration test against code changes. Strix will automatically compare the target against the base branch and only review the differences.
      </p>

      {error && (
        <div className="rounded-lg px-4 py-3 flex gap-3 items-start border border-red-500/30 bg-red-500/5">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-400" aria-hidden="true" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {/* Target Repo */}
      <div className="rounded-xl border border-[#222] bg-[rgba(255,255,255,0.02)] p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-[#888]" />
          <h2 className="text-sm font-semibold text-white">Repository Target</h2>
        </div>
        <input
          type="text"
          value={targetRepo}
          onChange={(e) => setTargetRepo(e.target.value)}
          placeholder="e.g. https://github.com/user/repo"
          className="w-full rounded-lg border border-[#333] bg-transparent px-4 py-2.5 text-sm text-white placeholder-[#555] outline-none focus:border-[#555] transition-colors"
        />
      </div>

      {/* Base Branch */}
      <div className="rounded-xl border border-[#222] bg-[rgba(255,255,255,0.02)] p-5 space-y-4">
        <div className="flex items-center gap-2">
          <LuGitPullRequestArrow className="w-4 h-4 text-[#888]" />
          <h2 className="text-sm font-semibold text-white">Base Branch</h2>
        </div>
        <p className="text-xs text-[#666]">
          The branch or commit you want to compare against (e.g., origin/main). Defaults to the repository's default branch.
        </p>
        <input
          type="text"
          value={diffBase}
          onChange={(e) => setDiffBase(e.target.value)}
          placeholder="e.g. main"
          className="w-full rounded-lg border border-[#333] bg-transparent px-4 py-2.5 text-sm text-white placeholder-[#555] outline-none focus:border-[#555] transition-colors"
        />
      </div>

      {/* Scan Mode */}
      <div className="rounded-xl border border-[#222] bg-[rgba(255,255,255,0.02)] p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-[#888]" />
          <h2 className="text-sm font-semibold text-white">Review Intensity</h2>
        </div>
        <div className="flex gap-2">
          {(["quick", "standard", "deep"] as ScanMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setScanMode(mode)}
              className={`flex-1 rounded-lg border px-4 py-2.5 text-sm font-medium capitalize transition-colors ${
                scanMode === mode
                  ? "border-white/20 bg-white/10 text-white"
                  : "border-[#333] text-[#888] hover:border-[#555] hover:text-white"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Custom Instructions */}
      <div className="rounded-xl border border-[#222] bg-[rgba(255,255,255,0.02)] p-5 space-y-4">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-[#888]" />
          <h2 className="text-sm font-semibold text-white">Focus Areas (Optional)</h2>
        </div>
        <p className="text-xs text-[#666]">
          Specific vulnerabilities or logic you want Strix to focus on in these changes.
        </p>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="e.g. Focus on IDOR vulnerabilities in the new user creation endpoints."
          rows={3}
          className="w-full rounded-lg border border-[#333] bg-transparent px-4 py-2.5 text-sm text-white placeholder-[#555] outline-none focus:border-[#555] transition-colors resize-none"
        />
      </div>

      {/* Start Button */}
      <div className="pt-2 flex justify-end">
        <button
          onClick={handleStart}
          disabled={loading || !targetRepo.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <ScanLine className="w-4 h-4" />
          )}
          {loading ? "Starting..." : "Start PR Review"}
        </button>
      </div>
    </div>
  );
}
