import React, { useEffect, useState } from "react";
import { Users, Trash2, Loader2, AlertCircle, ShieldAlert, Activity, Settings, List, Ban, Search, Play, FileText } from "lucide-react";
import { fetchAdminUsers, deleteAdminUser, type AdminUser, suspendUser, updateUserNotes, fetchGlobalRuns, killGlobalRun, fetchAdminSettings, toggleMaintenanceMode, updateNucleiTemplates, fetchAuditLogs } from "@/data/serverSource";

export default function AdminView() {
  const [activeTab, setActiveTab] = useState<"users" | "runs" | "settings" | "audit">("users");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Users Tab State
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [editingNotesId, setEditingNotesId] = useState<number | null>(null);
  const [tempNotes, setTempNotes] = useState("");

  // Runs State
  const [globalRuns, setGlobalRuns] = useState<any[]>([]);

  // Settings State
  const [maintenance, setMaintenance] = useState(false);

  // Audit State
  const [auditLogs, setAuditLogs] = useState<any[]>([]);

  useEffect(() => {
    loadData(activeTab);
  }, [activeTab]);

  const loadData = async (tab: string) => {
    try {
      setLoading(true);
      setError(null);
      if (tab === "users") {
        setUsers(await fetchAdminUsers());
      } else if (tab === "runs") {
        setGlobalRuns(await fetchGlobalRuns());
      } else if (tab === "settings") {
        const s = await fetchAdminSettings();
        setMaintenance(s.maintenance_mode);
      } else if (tab === "audit") {
        setAuditLogs(await fetchAuditLogs());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  const handleToggleSuspend = async (userId: number, currentStatus: boolean) => {
    try {
      setLoading(true);
      await suspendUser(userId, !currentStatus);
      await loadData("users");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to suspend user");
      setLoading(false);
    }
  };

  const handleSaveNotes = async (userId: number) => {
    try {
      await updateUserNotes(userId, tempNotes);
      setEditingNotesId(null);
      await loadData("users");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save notes");
    }
  };

  const handleKillRun = async (runName: string) => {
    if (!confirm(`Are you sure you want to kill ${runName}?`)) return;
    try {
      await killGlobalRun(runName);
      await loadData("runs");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to kill run");
    }
  };

  const handleToggleMaintenance = async () => {
    try {
      await toggleMaintenanceMode(!maintenance);
      setMaintenance(!maintenance);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to toggle maintenance");
    }
  };

  const handleUpdateNuclei = async () => {
    try {
      await updateNucleiTemplates();
      alert("Nuclei update triggered in background!");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update nuclei");
    }
  };

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      <div className="flex items-center justify-between border-b border-[#222] pb-4">
        <h1 className="text-2xl font-semibold text-white flex items-center gap-2">
          <ShieldAlert className="text-emerald-500" /> Super Admin Center
        </h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-[#222]">
        {[
          { id: "users", label: "User Management", icon: Users },
          { id: "runs", label: "Global Runs", icon: Activity },
          { id: "settings", label: "Platform Settings", icon: Settings },
          { id: "audit", label: "Audit Logs", icon: List }
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id as any)}
            className={`pb-3 px-2 flex items-center gap-2 text-sm font-medium transition-colors border-b-2 ${
              activeTab === t.id ? "text-emerald-400 border-emerald-500" : "text-[#888] border-transparent hover:text-white"
            }`}
          >
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg px-4 py-3 flex gap-3 items-start border border-red-500/30 bg-red-500/5">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-400" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
        </div>
      ) : (
        <div className="animate-fade-in">
          {activeTab === "users" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-[#222] bg-[rgba(255,255,255,0.02)] overflow-x-auto">
                <table className="w-full text-left text-sm text-[#ccc]">
                  <thead className="bg-[rgba(255,255,255,0.02)] text-xs uppercase text-[#666] border-b border-[#222]">
                    <tr>
                      <th className="px-6 py-4">User</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4">Internal Notes</th>
                      <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#222]">
                    {users.map((u) => (
                      <tr key={u.id} className="hover:bg-[rgba(255,255,255,0.01)]">
                        <td className="px-6 py-4">
                          <div className="font-medium text-white">{u.first_name} {u.last_name}</div>
                          <div className="text-xs text-[#888]">{u.email}</div>
                          {u.is_admin && <span className="mt-1 inline-flex items-center rounded-full bg-emerald-500/10 px-2 text-[10px] text-emerald-400 border border-emerald-500/20">Admin</span>}
                        </td>
                        <td className="px-6 py-4">
                          {u.is_suspended ? (
                            <span className="inline-flex items-center gap-1 text-red-400 text-xs bg-red-500/10 px-2 py-1 rounded-full"><Ban className="w-3 h-3"/> Suspended</span>
                          ) : (
                            <span className="inline-flex items-center text-emerald-400 text-xs">Active</span>
                          )}
                        </td>
                        <td className="px-6 py-4 w-1/3">
                          {editingNotesId === u.id ? (
                            <div className="flex gap-2">
                              <input 
                                className="bg-black border border-[#333] rounded px-2 py-1 text-xs text-white w-full"
                                value={tempNotes}
                                onChange={e => setTempNotes(e.target.value)}
                              />
                              <button onClick={() => handleSaveNotes(u.id)} className="text-xs text-emerald-400">Save</button>
                            </div>
                          ) : (
                            <div className="flex justify-between group">
                              <span className="text-xs text-[#888] truncate">{u.admin_notes || "No notes"}</span>
                              <button onClick={() => { setEditingNotesId(u.id); setTempNotes(u.admin_notes); }} className="text-xs text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity">Edit</button>
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right space-x-3">
                          <button onClick={() => handleToggleSuspend(u.id, u.is_suspended)} className="text-xs text-orange-400 hover:text-orange-300">
                            {u.is_suspended ? "Unsuspend" : "Suspend"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "runs" && (
            <div className="rounded-xl border border-[#222] bg-[rgba(255,255,255,0.02)] overflow-hidden">
                <table className="w-full text-left text-sm text-[#ccc]">
                  <thead className="bg-[rgba(255,255,255,0.02)] text-xs uppercase text-[#666] border-b border-[#222]">
                    <tr>
                      <th className="px-6 py-4">Run Name</th>
                      <th className="px-6 py-4">Owner</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#222]">
                    {globalRuns.map(r => (
                      <tr key={r.run_name}>
                        <td className="px-6 py-4 font-mono text-xs text-white">{r.run_name}</td>
                        <td className="px-6 py-4 text-[#888]">{r.owner_email}</td>
                        <td className="px-6 py-4 text-xs capitalize">{r.status}</td>
                        <td className="px-6 py-4 text-right">
                          <button onClick={() => handleKillRun(r.run_name)} className="text-xs text-red-400 hover:text-red-300">Kill Scan</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
            </div>
          )}

          {activeTab === "settings" && (
            <div className="grid grid-cols-2 gap-6">
              <div className="rounded-xl border border-[#222] bg-[rgba(255,255,255,0.02)] p-6">
                <h3 className="text-lg font-medium text-white mb-2 flex items-center gap-2"><Ban className="w-5 h-5 text-orange-400"/> Maintenance Mode</h3>
                <p className="text-sm text-[#888] mb-4">When enabled, all non-admin users will receive a 503 error. Use during major upgrades.</p>
                <button 
                  onClick={handleToggleMaintenance}
                  className={`px-4 py-2 rounded font-medium text-sm transition-colors ${maintenance ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' : 'bg-[#222] text-white hover:bg-[#333]'}`}
                >
                  {maintenance ? "Disable Maintenance Mode" : "Enable Maintenance Mode"}
                </button>
              </div>

              <div className="rounded-xl border border-[#222] bg-[rgba(255,255,255,0.02)] p-6">
                <h3 className="text-lg font-medium text-white mb-2 flex items-center gap-2"><Settings className="w-5 h-5 text-blue-400"/> Engine Tools</h3>
                <p className="text-sm text-[#888] mb-4">Force an update of Nuclei templates on the backend worker nodes.</p>
                <button 
                  onClick={handleUpdateNuclei}
                  className="px-4 py-2 rounded font-medium text-sm bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 transition-colors"
                >
                  Update Nuclei Templates
                </button>
              </div>
            </div>
          )}

          {activeTab === "audit" && (
            <div className="rounded-xl border border-[#222] bg-[rgba(255,255,255,0.02)] overflow-hidden">
                <table className="w-full text-left text-sm text-[#ccc]">
                  <thead className="bg-[rgba(255,255,255,0.02)] text-xs uppercase text-[#666] border-b border-[#222]">
                    <tr>
                      <th className="px-6 py-4">Time</th>
                      <th className="px-6 py-4">Actor</th>
                      <th className="px-6 py-4">Action</th>
                      <th className="px-6 py-4">Target / Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#222]">
                    {auditLogs.map(l => (
                      <tr key={l.id}>
                        <td className="px-6 py-4 text-xs text-[#888]">{new Date(l.created_at).toLocaleString()}</td>
                        <td className="px-6 py-4 text-white text-xs">{l.actor_email}</td>
                        <td className="px-6 py-4 font-mono text-xs text-blue-400">{l.action}</td>
                        <td className="px-6 py-4 text-xs text-[#aaa]">{l.target_email || l.details || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
