import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Stores from './pages/Stores';
import StoreDetail from './pages/StoreDetail';
import Quotes from './pages/Quotes';
import Comparisons from './pages/Comparisons';
import ComparisonDetail from './pages/ComparisonDetail';
import Users from './pages/Users';
import Audit from './pages/Audit';
import Roles from './pages/Roles';
import Settings from './pages/Settings';
import Operations from './pages/Operations';
import Demands from './pages/Demands';
import Workflows from './pages/Workflows';
import Portfolio from './pages/Portfolio';
import Suppliers from './pages/Suppliers';
import Inbox from './pages/Inbox';
import Reporting from './pages/Reporting';
import Invoices from './pages/Invoices';
import Planning from './pages/Planning';
import Risks from './pages/Risks';
import Site from './pages/Site';
import Governance from './pages/Governance';
import TaxRates from './pages/TaxRates';
import NotificationAdmin from './pages/NotificationAdmin';
import Delegations from './pages/Delegations';
import Notifications from './pages/Notifications';

function Protected({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="min-h-screen grid place-items-center text-muted text-sm">Chargement…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

function Permitted({ perm, children }) {
  const { can } = useAuth();
  if (perm && !can(perm)) return <Navigate to="/stores" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/stores" element={<Stores />} />
        <Route path="/stores/:id" element={<StoreDetail />} />
        <Route path="/quotes" element={<Permitted perm="view_quotes_page"><Quotes /></Permitted>} />
        <Route path="/comparisons" element={<Comparisons />} />
        <Route path="/comparisons/:id" element={<ComparisonDetail />} />
        <Route path="/operations" element={<Permitted perm="manage_operations"><Operations /></Permitted>} />
        <Route path="/demands" element={<Permitted perm="view_demands"><Demands /></Permitted>} />
        <Route path="/workflows" element={<Workflows />} />
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="/inbox" element={<Permitted perm="view_demands"><Inbox /></Permitted>} />
        <Route path="/suppliers" element={<Suppliers />} />
        <Route path="/invoices" element={<Permitted perm="manage_operations"><Invoices /></Permitted>} />
        <Route path="/planning" element={<Permitted perm="manage_operations"><Planning /></Permitted>} />
        <Route path="/risks" element={<Permitted perm="manage_operations"><Risks /></Permitted>} />
        <Route path="/site" element={<Permitted perm="manage_operations"><Site /></Permitted>} />
        <Route path="/reporting" element={<Permitted perm="export_reports"><Reporting /></Permitted>} />
        <Route path="/governance" element={<Governance />} />
        <Route path="/users" element={<Permitted perm="manage_users"><Users /></Permitted>} />
        <Route path="/audit" element={<Permitted perm="view_audit_page"><Audit /></Permitted>} />
        <Route path="/roles" element={<Permitted perm="view_roles_page"><Roles /></Permitted>} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/tax-rates" element={<Permitted perm="manage_users"><TaxRates /></Permitted>} />
        <Route path="/notification-admin" element={<Permitted perm="manage_users"><NotificationAdmin /></Permitted>} />
        <Route path="/delegations" element={<Permitted perm="manage_users"><Delegations /></Permitted>} />
        <Route path="/notifications" element={<Permitted perm="manage_users"><Notifications /></Permitted>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
