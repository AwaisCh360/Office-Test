import { useState, useEffect } from "react";
import api from "../lib/api";

export default function Settings() {
  const [strixLlm, setStrixLlm] = useState("openai/gpt-5.4");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [maskedApiKey, setMaskedApiKey] = useState("");
  const [llmApiBase, setLlmApiBase] = useState("");
  const [perplexityApiKey, setPerplexityApiKey] = useState("");
  const [maskedPerplexityKey, setMaskedPerplexityKey] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState("high");
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });

  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await api.get("/strix/settings");
        setStrixLlm(res.data.strix_llm || "openai/gpt-5.4");
        setMaskedApiKey(res.data.masked_api_key || "");
        setLlmApiBase(res.data.llm_api_base || "");
        setMaskedPerplexityKey(res.data.masked_perplexity_key || "");
        setReasoningEffort(res.data.reasoning_effort || "high");
      } catch (err) {
        console.error("Failed to load settings", err);
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage({ type: "", text: "" });

    try {
      await api.post("/strix/settings", {
        strix_llm: strixLlm,
        llm_api_key: llmApiKey || "", // Empty means unchanged
        llm_api_base: llmApiBase || null,
        perplexity_api_key: perplexityApiKey || "", // Empty means unchanged
        reasoning_effort: reasoningEffort || null,
      });
      setMessage({ type: "success", text: "Settings saved successfully!" });
      // Clear inputs since they are saved
      setLlmApiKey("");
      setPerplexityApiKey("");
    } catch (err: any) {
      setMessage({ 
        type: "error", 
        text: err.response?.data?.detail || "Failed to save settings" 
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-ink-2">Loading settings...</div>;
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-ink mb-2">Configuration</h1>
        <p className="text-ink-3">Configure AI providers and custom endpoints for Strix Agents.</p>
      </div>

      {message.text && (
        <div className={`mb-6 rounded-control p-4 text-sm border ${
          message.type === 'error' 
            ? 'bg-red-50 text-red-600 border-red-100' 
            : 'bg-green-50 text-green-700 border-green-100'
        }`}>
          {message.text}
        </div>
      )}

      <div className="bg-surface rounded-card p-6 shadow-raised border border-line">
        <form onSubmit={handleSave} className="space-y-6">
          
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2 col-span-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-ink-3">Main LLM Provider & Model</label>
              <input
                type="text"
                required
                placeholder="e.g. openai/gpt-5.4 or anthropic/claude-sonnet-4-6"
                value={strixLlm}
                onChange={(e) => setStrixLlm(e.target.value)}
                className="w-full rounded-control border border-line bg-inset px-4 py-3 text-sm text-ink outline-none transition-colors focus:border-accent focus:bg-surface"
              />
              <p className="text-[11px] text-ink-3 mt-1">Format: provider/model-name</p>
            </div>

            <div className="space-y-2 col-span-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-ink-3">LLM API Key</label>
              <input
                type="password"
                placeholder={maskedApiKey ? `Saved: ${maskedApiKey} (Enter new to update)` : "Enter your API key"}
                value={llmApiKey}
                onChange={(e) => setLlmApiKey(e.target.value)}
                className="w-full rounded-control border border-line bg-inset px-4 py-3 text-sm text-ink outline-none transition-colors focus:border-accent focus:bg-surface placeholder:text-ink-3/70"
              />
            </div>
            
            <div className="space-y-2 col-span-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-ink-3 flex justify-between">
                <span>Custom API Base URL</span>
                <span className="text-ink-3/50 font-normal normal-case">Optional</span>
              </label>
              <input
                type="url"
                placeholder="e.g. http://localhost:11434/v1 for Ollama"
                value={llmApiBase}
                onChange={(e) => setLlmApiBase(e.target.value)}
                className="w-full rounded-control border border-line bg-inset px-4 py-3 text-sm text-ink outline-none transition-colors focus:border-accent focus:bg-surface"
              />
            </div>

            <div className="space-y-2 col-span-1">
              <label className="text-xs font-semibold uppercase tracking-wider text-ink-3 flex justify-between">
                <span>Perplexity API Key</span>
                <span className="text-ink-3/50 font-normal normal-case">Optional</span>
              </label>
              <input
                type="password"
                placeholder={maskedPerplexityKey ? `Saved: ${maskedPerplexityKey}` : "For agent search capabilities"}
                value={perplexityApiKey}
                onChange={(e) => setPerplexityApiKey(e.target.value)}
                className="w-full rounded-control border border-line bg-inset px-4 py-3 text-sm text-ink outline-none transition-colors focus:border-accent focus:bg-surface placeholder:text-ink-3/70"
              />
            </div>

            <div className="space-y-2 col-span-1">
              <label className="text-xs font-semibold uppercase tracking-wider text-ink-3 flex justify-between">
                <span>Reasoning Effort</span>
                <span className="text-ink-3/50 font-normal normal-case">Optional</span>
              </label>
              <select
                value={reasoningEffort}
                onChange={(e) => setReasoningEffort(e.target.value)}
                className="w-full rounded-control border border-line bg-inset px-4 py-3 text-sm text-ink outline-none transition-colors focus:border-accent focus:bg-surface appearance-none"
              >
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>

          <div className="pt-2 flex items-center justify-end border-t border-line mt-6">
            <button
              type="submit"
              disabled={saving}
              className="px-6 rounded-control bg-accent py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-ink disabled:opacity-70"
            >
              {saving ? "Saving..." : "Save Settings"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
