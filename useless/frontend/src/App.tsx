import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";
import History from "./pages/History";
import LiveScan from "./pages/LiveScan";

function AppLayout() {
  const isAuthenticated = !!localStorage.getItem("token");
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex h-screen w-full bg-inset">
      <Sidebar />
      <main className="flex-1 overflow-auto p-8 relative">
        <Outlet />
      </main>
    </div>
  );
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Auth />} />
        <Route path="/signup" element={<Auth />} />
        
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/history" element={<History />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/scan/:id" element={<LiveScan />} />
        </Route>

        <Route path="/" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
