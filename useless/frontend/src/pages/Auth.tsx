import { useState } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import api from "../lib/api";

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // If user accesses /signup directly, start in signup mode
  useState(() => {
    if (location.pathname === "/signup") {
      setIsLogin(false);
    }
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (isLogin) {
        // FastAPI OAuth2PasswordRequestForm requires form-data
        const formData = new URLSearchParams();
        formData.append("username", email);
        formData.append("password", password);

        const res = await api.post("/login", formData, {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
        localStorage.setItem("token", res.data.access_token);
        navigate("/dashboard");
      } else {
        await api.post("/signup", {
          email,
          username,
          first_name: firstName,
          last_name: lastName,
          password,
        });
        
        // Auto-login after signup
        const formData = new URLSearchParams();
        formData.append("username", email);
        formData.append("password", password);

        const res = await api.post("/login", formData, {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
        localStorage.setItem("token", res.data.access_token);
        navigate("/dashboard");
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-full items-center justify-center bg-inset p-4">
      <div className="w-full max-w-sm rounded-card bg-surface p-8 shadow-raised">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-[12px] text-xl font-bold text-white shadow-md" style={{ background: "linear-gradient(155deg,#5aa2ff,#1f3fb0)" }}>
            S
          </div>
          <h1 className="text-2xl font-bold text-ink">
            {isLogin ? "Welcome back" : "Create an account"}
          </h1>
          <p className="mt-2 text-sm text-ink-3">
            {isLogin ? "Sign in to access your workspace" : "Get started with AI penetration testing"}
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-control bg-red-50 p-3 text-sm text-red-600 border border-red-100">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <>
              <div className="flex gap-3">
                <div className="flex-1 space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-ink-3">First Name</label>
                  <input
                    type="text"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full rounded-control border border-line bg-transparent px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent"
                  />
                </div>
                <div className="flex-1 space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-ink-3">Last Name</label>
                  <input
                    type="text"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full rounded-control border border-line bg-transparent px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-ink-3">Username</label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-control border border-line bg-transparent px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent"
                />
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-ink-3">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-control border border-line bg-transparent px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-ink-3">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-control border border-line bg-transparent px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-control bg-accent py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-ink disabled:opacity-70 mt-6"
          >
            {loading ? "Please wait..." : (isLogin ? "Sign In" : "Sign Up")}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-ink-3">
          {isLogin ? "Don't have an account? " : "Already have an account? "}
          <button
            type="button"
            onClick={() => {
              setIsLogin(!isLogin);
              setError("");
            }}
            className="font-medium text-accent hover:underline"
          >
            {isLogin ? "Sign up" : "Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
