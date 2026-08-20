import React, { useState, useRef } from "react";
import { Target, Loader2, AlertCircle, Zap, ScanLine, Layers, FileText, UploadCloud, X, Settings2, SlidersHorizontal, Info, BookOpen, ShieldCheck } from "lucide-react";
import { startScan, fetchRunSummary, FilePayload } from "@/data/serverSource";

interface DashboardViewProps {
  onScanStarted: (runName: string) => void;
}

type ScanMode = "quick" | "standard" | "deep";
type ScopeMode = "auto" | "diff" | "full";
type Tab = "targeting" | "settings" | "advanced";

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // result is "data:mime/type;base64,....."
      const b64 = result.split(",")[1];
      resolve(b64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

export default function DashboardView({ onScanStarted }: DashboardViewProps) {
  const [activeTab, setActiveTab] = useState<Tab>("targeting");

  const [targetText, setTargetText] = useState("");
  const [instructions, setInstructions] = useState("");
  const [scanMode, setScanMode] = useState<ScanMode>("standard");
  const [scopeMode, setScopeMode] = useState<ScopeMode>("auto");
  const [diffBase, setDiffBase] = useState("");
  
  const [instructionFile, setInstructionFile] = useState<File | null>(null);
  const [workspaceFiles, setWorkspaceFiles] = useState<File[]>([]);
  const [maxBudget, setMaxBudget] = useState("");
  const [maxTurns, setMaxTurns] = useState("");
  const [configFile, setConfigFile] = useState<File | null>(null);
  const [targetListFile, setTargetListFile] = useState<File | null>(null);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetListRef = useRef<HTMLInputElement>(null);
  const instructionRef = useRef<HTMLInputElement>(null);
  const workspaceRef = useRef<HTMLInputElement>(null);
  const configRef = useRef<HTMLInputElement>(null);

  const handleStart = async () => {
    const targets = targetText
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean);

    if (targets.length === 0 && !targetListFile) {
      setError("At least one target or a target list file is required.");
      setActiveTab("targeting");
      return;
    }
    try {
      setLoading(true);
      setError(null);
      
      let tlPayload: FilePayload | undefined;
      if (targetListFile) {
        tlPayload = { name: targetListFile.name, content_b64: await fileToBase64(targetListFile) };
      }
      
      let instPayload: FilePayload | undefined;
      if (instructionFile) {
        instPayload = { name: instructionFile.name, content_b64: await fileToBase64(instructionFile) };
      }
      
      const wsPayloads: FilePayload[] = [];
      for (const f of workspaceFiles) {
        wsPayloads.push({ name: f.name, content_b64: await fileToBase64(f) });
      }

      const payload: any = {
        targets,
        instructions: instructions.trim() || undefined,
        scan_mode: scanMode,
        scope_mode: scopeMode,
        target_list_file: tlPayload,
        instruction_file: instPayload,
        workspace_files: wsPayloads.length > 0 ? wsPayloads : undefined,
      };

      if (scopeMode === "diff" && diffBase.trim()) {
        payload.diff_base = diffBase.trim();
      }

      if (maxBudget.trim()) {
        const b = parseFloat(maxBudget);
        if (!isNaN(b) && b > 0) payload.max_budget = b;
      }

      if (maxTurns.trim()) {
        const t = parseInt(maxTurns, 10);
        if (!isNaN(t) && t > 0) payload.max_turns = t;
      }

      if (configFile) {
        payload.config_file = {
          name: configFile.name,
          content_b64: await fileToBase64(configFile),
        };
      }

      const result = await startScan(payload);
      
      // The server already creates a placeholder run.json with status="initializing".
      // We can redirect to the overview page immediately.
      
      onScanStarted(result.run_name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start scan.");
      setLoading(false);
    }
  };

  const removeWorkspaceFile = (index: number) => {
    setWorkspaceFiles((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6 max-w-[1400px] w-full pb-20">
      {/* Page heading */}
      <div className="flex items-center gap-2">
        <ScanLine className="w-5 h-5 text-[#888]" aria-hidden="true" />
        <h1 className="text-2xl font-semibold text-white">New Assessment</h1>
      </div>

      {error && (
        <div className="rounded-lg px-4 py-3 flex gap-3 items-start border border-red-500/30 bg-red-500/5">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-400" aria-hidden="true" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      <div className="max-w-6xl mx-auto space-y-6">

      {/* Navigation Tabs */}
      <div className="flex gap-6 border-b border-[#2a2a2a]">
        <button
          onClick={() => setActiveTab("targeting")}
          className={`cursor-pointer relative pb-3 text-sm font-semibold transition-colors flex items-center gap-2 ${
            activeTab === "targeting" ? "text-white" : "text-[#666] hover:text-white"
          }`}
        >
          <Target className="w-4 h-4" />
          Targeting
          {activeTab === "targeting" && <span className="absolute bottom-0 inset-x-0 h-0.5 bg-white rounded-full" />}
        </button>
        <button
          onClick={() => setActiveTab("settings")}
          className={`cursor-pointer relative pb-3 text-sm font-semibold transition-colors flex items-center gap-2 ${
            activeTab === "settings" ? "text-white" : "text-[#666] hover:text-white"
          }`}
        >
          <Settings2 className="w-4 h-4" />
          Scan Settings
          {activeTab === "settings" && <span className="absolute bottom-0 inset-x-0 h-0.5 bg-white rounded-full" />}
        </button>
        <button
          onClick={() => setActiveTab("advanced")}
          className={`cursor-pointer relative pb-3 text-sm font-semibold transition-colors flex items-center gap-2 ${
            activeTab === "advanced" ? "text-white" : "text-[#666] hover:text-white"
          }`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          Advanced Context
          {activeTab === "advanced" && <span className="absolute bottom-0 inset-x-0 h-0.5 bg-white rounded-full" />}
        </button>
      </div>

      {/* Tab Content Area */}
      <div className="min-h-[400px]">
        {activeTab === "targeting" && (
          <div className="space-y-6">
            <div className="rounded-xl border border-[#222] bg-[rgba(255,255,255,0.02)] p-6 space-y-4">
              <h2 className="text-base font-semibold text-white flex items-center gap-2 relative group">
                Define Scope
                <Info className="w-4 h-4 text-[#666] group-hover:text-white cursor-help transition-colors" />
                
                <div className="absolute left-32 top-1/2 -translate-y-1/2 w-64 p-3 bg-[#0a0a0b] border border-[#333] rounded-lg shadow-2xl text-xs font-normal text-[#aaa] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 pointer-events-none">
                  Provide the target boundaries for the assessment. You can input web URLs (e.g., https://example.com), GitHub repositories, or absolute paths to local code directories. Put each target on a new line.
                </div>
              </h2>
              <textarea
                value={targetText}
                onChange={(e) => setTargetText(e.target.value)}
                placeholder="https://example.com&#10;https://github.com/user/repo&#10;./my-local-project"
                rows={4}
                className="w-full rounded-lg border border-[#333] bg-black px-4 py-3 text-sm text-white placeholder-[#555] outline-none focus:border-[#555] transition-colors resize-none"
              />
              
              <div className="pt-4 mt-2 border-t border-[#333]">
                <h3 className="text-xs font-semibold text-[#888] mb-3 uppercase tracking-wider">Or upload a target list</h3>
                <input
                  type="file"
                  accept=".txt"
                  ref={targetListRef}
                  className="hidden"
                  onChange={(e) => setTargetListFile(e.target.files?.[0] || null)}
                />
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => targetListRef.current?.click()}
                    className="inline-flex items-center gap-2 rounded-md bg-[#222] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#333] transition-colors border border-[#444]"
                  >
                    <UploadCloud className="w-3.5 h-3.5" />
                    Choose File (.txt)
                  </button>
                  {targetListFile && (
                    <div className="flex items-center gap-2 text-sm text-[#ccc] bg-[#111] px-2 py-1 rounded border border-[#222]">
                      <FileText className="w-3.5 h-3.5 text-[#888]" />
                      {targetListFile.name}
                      <button onClick={() => { setTargetListFile(null); if (targetListRef.current) targetListRef.current.value = ""; }} className="text-[#888] hover:text-white">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "settings" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-xl border border-[#222] bg-[rgba(255,255,255,0.02)] p-6 space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-5 h-5 text-[#888]" />
                <h2 className="text-base font-semibold text-white flex items-center gap-2 relative group">
                  Intensity
                  <Info className="w-4 h-4 text-[#666] group-hover:text-white cursor-help transition-colors" />
                  
                  {/* Custom Tooltip */}
                  <div className="absolute left-28 top-1/2 -translate-y-1/2 w-72 p-4 bg-[#0a0a0b] border border-[#333] rounded-lg shadow-2xl text-xs font-normal text-[#aaa] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 pointer-events-none">
                    <p className="mb-2 text-white font-medium">How Intensity Works:</p>
                    <ul className="space-y-2">
                      <li><strong className="text-white">Quick:</strong> Executes rapid network discovery and passive vulnerability checks. Best for preliminary scoping.</li>
                      <li><strong className="text-white">Standard:</strong> Performs active exploitation and payload delivery. Ideal for routine compliance scans.</li>
                      <li><strong className="text-white">Deep:</strong> Enables brute-forcing, exhaustive API fuzzing, and complex logic flaws. Use with caution.</li>
                    </ul>
                  </div>
                </h2>
              </div>
              <div className="flex flex-col gap-2">
                {(["quick", "standard", "deep"] as ScanMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setScanMode(mode)}
                    className={`text-left rounded-lg border px-4 py-3 text-sm font-medium capitalize transition-colors ${
                      scanMode === mode
                        ? "border-white/20 bg-white/10 text-white"
                        : "border-[#333] text-[#888] hover:border-[#555] hover:text-white"
                    }`}
                  >
                    <div className="font-semibold">{mode}</div>
                    <div className="text-xs mt-1 opacity-70 normal-case">
                      {mode === "quick" && "Basic discovery and surface-level checks. Fast but shallow."}
                      {mode === "standard" && "Balanced vulnerability scanning and exploitation attempts."}
                      {mode === "deep" && "Exhaustive fuzzing and deep logic checks. Takes significantly longer."}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-[#222] bg-[rgba(255,255,255,0.02)] p-6 space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <Layers className="w-5 h-5 text-[#888]" />
                <h2 className="text-base font-semibold text-white flex items-center gap-2 relative group">
                  Scope
                  <Info className="w-4 h-4 text-[#666] group-hover:text-white cursor-help transition-colors" />
                  
                  {/* Custom Tooltip */}
                  <div className="absolute left-24 top-1/2 -translate-y-1/2 w-72 p-4 bg-[#0a0a0b] border border-[#333] rounded-lg shadow-2xl text-xs font-normal text-[#aaa] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 pointer-events-none">
                    <p className="mb-2 text-white font-medium">Assessment Boundaries:</p>
                    <ul className="space-y-2">
                      <li><strong className="text-white">Auto:</strong> Strix autonomously maps out boundaries based on subdomains and associated infrastructure.</li>
                      <li><strong className="text-white">Diff:</strong> Constrains scanning only to newly deployed endpoints or updated code paths. Highly efficient for CI/CD.</li>
                      <li><strong className="text-white">Full:</strong> Aggressively crawls everything linked to the root domain, ignoring path restrictions.</li>
                    </ul>
                  </div>
                </h2>
              </div>
              <div className="flex flex-col gap-2">
                {(["auto", "diff", "full"] as ScopeMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setScopeMode(mode)}
                    className={`text-left rounded-lg border px-4 py-3 text-sm font-medium capitalize transition-colors ${
                      scopeMode === mode
                        ? "border-white/20 bg-white/10 text-white"
                        : "border-[#333] text-[#888] hover:border-[#555] hover:text-white"
                    }`}
                  >
                    <div className="font-semibold">{mode}</div>
                    <div className="text-xs mt-1 opacity-70 normal-case">
                      {mode === "auto" && "Automatically determine scope boundaries based on the target type."}
                      {mode === "diff" && "Only scan new or modified code/endpoints (great for PRs)."}
                      {mode === "full" && "Crawl and scan everything within the target domain."}
                    </div>
                  </button>
                ))}
              </div>
              
              {scopeMode === "diff" && (
                <div className="mt-4 pt-4 border-t border-[#333]">
                  <h3 className="text-sm font-medium text-white flex items-center gap-2 mb-2 relative group">
                    Diff Base
                    <Info className="w-4 h-4 text-[#666] group-hover:text-white cursor-help transition-colors" />
                    
                    <div className="absolute left-24 top-1/2 -translate-y-1/2 w-64 p-3 bg-[#0a0a0b] border border-[#333] rounded-lg shadow-2xl text-xs font-normal text-[#aaa] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 pointer-events-none">
                      Specify the target branch or commit hash to compare against (e.g., <code className="text-white bg-[#222] px-1 rounded">origin/main</code>). This isolates the scan exclusively to code that has changed.
                    </div>
                  </h3>
                  <input
                    type="text"
                    value={diffBase}
                    onChange={(e) => setDiffBase(e.target.value)}
                    placeholder="origin/main"
                    className="w-full rounded-lg border border-[#333] bg-black px-4 py-2 text-sm text-white placeholder-[#555] outline-none focus:border-[#555] transition-colors"
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "advanced" && (
          <div className="space-y-6">
            <div className="rounded-xl border border-[#222] bg-[rgba(255,255,255,0.02)] p-6 space-y-4">
              <h2 className="text-base font-semibold text-white flex items-center gap-2 relative group">
                Custom Instructions
                <Info className="w-4 h-4 text-[#666] group-hover:text-white cursor-help transition-colors" />
                
                <div className="absolute left-48 top-1/2 -translate-y-1/2 w-72 p-3 bg-[#0a0a0b] border border-[#333] rounded-lg shadow-2xl text-xs font-normal text-[#aaa] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 pointer-events-none">
                  Steer the AI by providing explicit goals. For example:
                  <br/><br/>
                  <span className="italic">"Focus heavily on GraphQL endpoints. Here are test credentials: admin/password123."</span>
                </div>
              </h2>
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="e.g. Focus on authentication flows. Test credentials: admin/password123."
                rows={3}
                className="w-full rounded-lg border border-[#333] bg-black px-4 py-3 text-sm text-white placeholder-[#555] outline-none focus:border-[#555] transition-colors resize-none"
              />
              
              <div className="pt-4 mt-2 border-t border-[#333]">
                <input
                  type="file"
                  accept=".txt,.md"
                  ref={instructionRef}
                  className="hidden"
                  onChange={(e) => setInstructionFile(e.target.files?.[0] || null)}
                />
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => instructionRef.current?.click()}
                    className="inline-flex items-center gap-2 rounded-md bg-[#222] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#333] transition-colors border border-[#444]"
                  >
                    <UploadCloud className="w-3.5 h-3.5" />
                    Upload Instructions File
                  </button>
                  {instructionFile && (
                    <div className="flex items-center gap-2 text-sm text-[#ccc] bg-[#111] px-2 py-1 rounded border border-[#222]">
                      <FileText className="w-3.5 h-3.5 text-[#888]" />
                      {instructionFile.name}
                      <button onClick={() => { setInstructionFile(null); if (instructionRef.current) instructionRef.current.value = ""; }} className="text-[#888] hover:text-white">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-[#222] bg-[rgba(255,255,255,0.02)] p-6 space-y-4">
              <h2 className="text-base font-semibold text-white flex items-center gap-2 mb-3 relative group">
                Workspace Files
                <Info className="w-4 h-4 text-[#666] group-hover:text-white cursor-help transition-colors" />
                
                <div className="absolute left-40 top-1/2 -translate-y-1/2 w-72 p-3 bg-[#0a0a0b] border border-[#333] rounded-lg shadow-2xl text-xs font-normal text-[#aaa] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 pointer-events-none">
                  Inject extra context into the scanner's isolated environment. Upload things like OpenAPI specifications (Swagger), Postman collections, or custom dictionaries/wordlists for fuzzing.
                </div>
              </h2>
              
              <input
                type="file"
                multiple
                ref={workspaceRef}
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) {
                    setWorkspaceFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
                  }
                }}
              />
              <button
                onClick={() => workspaceRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-md bg-[#222] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#333] transition-colors border border-[#444]"
              >
                <UploadCloud className="w-3.5 h-3.5" />
                Add Files
              </button>

              {workspaceFiles.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {workspaceFiles.map((file, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-sm text-[#ccc] bg-[#111] px-2 py-1 rounded border border-[#222]">
                      <FileText className="w-3.5 h-3.5 text-[#888]" />
                      <span className="max-w-[200px] truncate">{file.name}</span>
                      <button onClick={() => removeWorkspaceFile(idx)} className="text-[#888] hover:text-white">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="rounded-xl border border-[#222] bg-[rgba(255,255,255,0.02)] p-6 space-y-4">
                <h2 className="text-base font-semibold text-white flex items-center gap-2 mb-3 relative group">
                  Resource Limits
                  <Info className="w-4 h-4 text-[#666] group-hover:text-white cursor-help transition-colors" />
                  
                  <div className="absolute left-40 top-1/2 -translate-y-1/2 w-64 p-3 bg-[#0a0a0b] border border-[#333] rounded-lg shadow-2xl text-xs font-normal text-[#aaa] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 pointer-events-none">
                    Protect against run-away AI execution costs. Strix will automatically halt the scan once it hits either the USD budget ceiling or the maximum allowed LLM interaction turns.
                  </div>
                </h2>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#888] mb-1.5 uppercase tracking-wider">Max Budget (USD)</label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={maxBudget}
                      onChange={(e) => setMaxBudget(e.target.value)}
                      placeholder="e.g. 25"
                      className="w-full rounded-lg border border-[#333] bg-black px-4 py-2 text-sm text-white placeholder-[#555] outline-none focus:border-[#555] transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#888] mb-1.5 uppercase tracking-wider">Max Turns</label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={maxTurns}
                      onChange={(e) => setMaxTurns(e.target.value)}
                      placeholder="e.g. 500"
                      className="w-full rounded-lg border border-[#333] bg-black px-4 py-2 text-sm text-white placeholder-[#555] outline-none focus:border-[#555] transition-colors"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-[#222] bg-[rgba(255,255,255,0.02)] p-6 space-y-4">
                <h2 className="text-base font-semibold text-white flex items-center gap-2 mb-3 relative group">
                  Custom Configuration
                  <Info className="w-4 h-4 text-[#666] group-hover:text-white cursor-help transition-colors" />
                  
                  <div className="absolute right-8 top-full mt-2 w-64 p-3 bg-[#0a0a0b] border border-[#333] rounded-lg shadow-2xl text-xs font-normal text-[#aaa] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 pointer-events-none">
                    Upload a raw JSON configuration file to strictly override the default CLI parameter settings (e.g., specifying proxy servers, custom user-agents).
                  </div>
                </h2>
                
                <input
                  type="file"
                  accept=".json"
                  ref={configRef}
                  className="hidden"
                  onChange={(e) => setConfigFile(e.target.files?.[0] || null)}
                />
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => configRef.current?.click()}
                    className="inline-flex items-center gap-2 rounded-md bg-[#222] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#333] transition-colors border border-[#444]"
                  >
                    <Settings2 className="w-3.5 h-3.5" />
                    Upload Config File (.json)
                  </button>
                  {configFile && (
                    <div className="flex items-center gap-2 text-sm text-[#ccc] bg-[#111] px-2 py-1 rounded border border-[#222]">
                      <FileText className="w-3.5 h-3.5 text-[#888]" />
                      <span className="max-w-[200px] truncate">{configFile.name}</span>
                      <button onClick={() => { setConfigFile(null); if (configRef.current) configRef.current.value = ""; }} className="text-[#888] hover:text-white">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      </div>

      {/* Floating Start Button Area */}
      <div className="fixed bottom-0 left-0 right-0 lg:left-64 bg-gradient-to-t from-[#09090b] via-[#09090b] to-transparent pt-12 pb-6 px-6 pointer-events-none">
        <div className="max-w-6xl w-full mx-auto flex justify-end pointer-events-auto">
          <button
            onClick={handleStart}
            disabled={loading || (targetText.trim().length === 0 && !targetListFile)}
            className="inline-flex items-center gap-2 rounded-lg bg-white px-8 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50 shadow-[0_0_20px_rgba(255,255,255,0.1)]"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <ScanLine className="w-5 h-5" />
            )}
            {loading ? "Starting..." : "Start Assessment"}
          </button>
        </div>
      </div>
    </div>
  );
}
