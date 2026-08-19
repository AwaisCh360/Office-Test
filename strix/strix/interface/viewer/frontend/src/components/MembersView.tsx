import React, { useEffect, useState } from "react";
import { Users, Trash2, Loader2, AlertCircle, ShieldAlert, UserPlus } from "lucide-react";
import { fetchAdminUsers, deleteAdminUser, addAdminUser, editAdminUser, type AdminUser } from "@/data/serverSource";

export default function MembersView({ currentUserEmail, isCurrentUserAdmin }: { currentUserEmail: string, isCurrentUserAdmin: boolean }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({
    email: "", password: "", first_name: "", last_name: "", company: "", is_admin: false
  });
  const [addLoading, setAddLoading] = useState(false);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const data = await fetchAdminUsers();
      setUsers(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (email: string) => {
    if (!confirm(`Are you sure you want to delete user ${email}? This action cannot be undone.`)) return;
    try {
      setLoading(true);
      await deleteAdminUser(email);
      await loadUsers();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete user");
      setLoading(false);
    }
  };

  const handleRoleChange = async (email: string, newIsAdmin: boolean) => {
    try {
      setLoading(true);
      await editAdminUser(email, newIsAdmin);
      await loadUsers();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to change user role");
      setLoading(false);
    }
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setAddLoading(true);
      setError(null);
      await addAdminUser(addForm);
      setAddForm({ email: "", password: "", first_name: "", last_name: "", company: "", is_admin: false });
      setShowAddForm(false);
      await loadUsers();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add user");
    } finally {
      setAddLoading(false);
    }
  };

  if (loading && users.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-[#888]" aria-hidden="true" />
          <h1 className="text-2xl font-semibold text-white">Members</h1>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90"
        >
          <UserPlus className="w-4 h-4" />
          Add Member
        </button>
      </div>

      <p className="text-sm text-[#888]">
        Manage your team members and their access roles.
      </p>

      {error && (
        <div className="rounded-lg px-4 py-3 flex gap-3 items-start border border-red-500/30 bg-red-500/5">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-400" aria-hidden="true" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {showAddForm && (
        <form onSubmit={handleAddSubmit} className="rounded-xl border border-[#222] bg-[rgba(255,255,255,0.02)] p-5 space-y-4">
          <h2 className="text-sm font-semibold text-white">New Member Details</h2>
          <div className="grid grid-cols-2 gap-4">
            <input
              type="text"
              placeholder="First Name"
              required
              value={addForm.first_name}
              onChange={e => setAddForm({...addForm, first_name: e.target.value})}
              className="w-full rounded-lg border border-[#333] bg-transparent px-4 py-2.5 text-sm text-white placeholder-[#555] outline-none focus:border-[#555]"
            />
            <input
              type="text"
              placeholder="Last Name"
              required
              value={addForm.last_name}
              onChange={e => setAddForm({...addForm, last_name: e.target.value})}
              className="w-full rounded-lg border border-[#333] bg-transparent px-4 py-2.5 text-sm text-white placeholder-[#555] outline-none focus:border-[#555]"
            />
            <input
              type="email"
              placeholder="Email Address"
              required
              value={addForm.email}
              onChange={e => setAddForm({...addForm, email: e.target.value})}
              className="w-full rounded-lg border border-[#333] bg-transparent px-4 py-2.5 text-sm text-white placeholder-[#555] outline-none focus:border-[#555]"
            />
            <input
              type="password"
              placeholder="Password"
              required
              value={addForm.password}
              onChange={e => setAddForm({...addForm, password: e.target.value})}
              className="w-full rounded-lg border border-[#333] bg-transparent px-4 py-2.5 text-sm text-white placeholder-[#555] outline-none focus:border-[#555]"
            />
            <input
              type="text"
              placeholder="Company (Optional)"
              value={addForm.company}
              onChange={e => setAddForm({...addForm, company: e.target.value})}
              className="w-full rounded-lg border border-[#333] bg-transparent px-4 py-2.5 text-sm text-white placeholder-[#555] outline-none focus:border-[#555]"
            />
            <div className="flex items-center gap-2 h-full">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={addForm.is_admin}
                  onChange={e => setAddForm({...addForm, is_admin: e.target.checked})}
                  className="rounded border-[#333] bg-transparent"
                />
                <span className="text-sm text-white">Give Admin Access</span>
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="px-4 py-2 text-sm font-medium text-[#888] hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={addLoading}
              className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {addLoading && <Loader2 className="w-4 h-4 animate-spin" />}
              Invite Member
            </button>
          </div>
        </form>
      )}

      <div className="rounded-xl border border-[#222] bg-[rgba(255,255,255,0.02)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-[#ccc]">
            <thead className="bg-[rgba(255,255,255,0.02)] text-xs font-semibold uppercase tracking-wider text-[#666] border-b border-[#222]">
              <tr>
                <th className="px-6 py-4">User</th>
                <th className="px-6 py-4">Company</th>
                <th className="px-6 py-4">Role</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#222]">
              {users.map((user) => {
                const isMe = user.email === currentUserEmail;
                return (
                  <tr key={user.email} className="transition-colors hover:bg-[rgba(255,255,255,0.01)]">
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="font-medium text-white flex items-center gap-2">
                          {user.first_name} {user.last_name}
                          {isMe && <span className="bg-white/10 text-white text-[10px] px-1.5 py-0.5 rounded">You</span>}
                        </span>
                        <span className="text-xs text-[#888] font-mono">{user.email}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-[#aaa]">{user.company || "-"}</span>
                    </td>
                    <td className="px-6 py-4">
                      {!isMe ? (
                        <select
                          value={user.is_admin ? "admin" : "standard"}
                          onChange={(e) => handleRoleChange(user.email, e.target.value === "admin")}
                          className="bg-transparent border border-[#333] rounded px-2 py-1 text-xs text-white outline-none cursor-pointer hover:border-[#555]"
                        >
                          <option value="admin">Admin</option>
                          <option value="standard">Standard</option>
                        </select>
                      ) : (
                        user.is_admin ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-400 border border-emerald-500/20">
                            <ShieldAlert className="w-3 h-3" /> Admin
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-[#222] px-2.5 py-0.5 text-xs font-semibold text-[#888]">
                            Standard
                          </span>
                        )
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {!isMe && (
                        <button
                          onClick={() => handleDelete(user.email)}
                          className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-[#666]">
                    No users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
