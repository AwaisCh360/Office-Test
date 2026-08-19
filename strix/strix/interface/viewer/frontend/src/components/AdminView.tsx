import React, { useEffect, useState } from "react";
import { Users, Trash2, Loader2, AlertCircle, ShieldAlert } from "lucide-react";
import { fetchAdminUsers, deleteAdminUser, type AdminUser } from "@/data/serverSource";

export default function AdminView() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  if (loading && users.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Users className="w-5 h-5 text-[#888]" aria-hidden="true" />
        <h1 className="text-2xl font-semibold text-white">Admin Panel</h1>
      </div>

      {error && (
        <div className="rounded-lg px-4 py-3 flex gap-3 items-start border border-red-500/30 bg-red-500/5">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-400" aria-hidden="true" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      <div className="rounded-xl border border-[#222] bg-[rgba(255,255,255,0.02)] overflow-hidden animate-card-in">
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
              {users.map((user) => (
                <tr key={user.email} className="transition-colors hover:bg-[rgba(255,255,255,0.01)]">
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span className="font-medium text-white">{user.first_name} {user.last_name}</span>
                      <span className="text-xs text-[#888] font-mono">{user.email}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-[#aaa]">{user.company || "-"}</span>
                  </td>
                  <td className="px-6 py-4">
                    {user.is_admin ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-400 border border-emerald-500/20">
                        <ShieldAlert className="w-3 h-3" /> Admin
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-[#222] px-2.5 py-0.5 text-xs font-semibold text-[#888]">
                        Standard
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {!user.is_admin && (
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
              ))}
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
