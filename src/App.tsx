import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { DataProvider } from './context/DataContext';
import { PageStateProvider } from './context/PageStateContext';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Sales = lazy(() => import('./pages/Sales'));
const Expenses = lazy(() => import('./pages/Expenses'));
const CashBank = lazy(() => import('./pages/CashBank'));
const Partners = lazy(() => import('./pages/Partners'));
const ProfitLoss = lazy(() => import('./pages/ProfitLoss'));
const Customers = lazy(() => import('./pages/Customers'));
const Suppliers = lazy(() => import('./pages/Suppliers'));
const Capital = lazy(() => import('./pages/Capital'));
const Settings = lazy(() => import('./pages/Settings'));
const Reports = lazy(() => import('./pages/Reports'));

function PageLoading() {
  return (
    <div className="flex items-center justify-center min-h-[50vh] text-slate-400 text-sm">
      Loading...
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <DataProvider>
        <PageStateProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <Suspense fallback={<PageLoading />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
              <Route path="/sales" element={<ProtectedRoute><Sales /></ProtectedRoute>} />
              <Route path="/expenses" element={<ProtectedRoute><Expenses /></ProtectedRoute>} />
              <Route path="/cash-bank" element={<ProtectedRoute><CashBank /></ProtectedRoute>} />
              <Route path="/partners" element={<ProtectedRoute><Partners /></ProtectedRoute>} />
              <Route path="/profit-loss" element={<ProtectedRoute><ProfitLoss /></ProtectedRoute>} />
              <Route path="/customers" element={<ProtectedRoute><Customers /></ProtectedRoute>} />
              <Route path="/suppliers" element={<ProtectedRoute><Suppliers /></ProtectedRoute>} />
              <Route path="/capital" element={<ProtectedRoute><Capital /></ProtectedRoute>} />
              <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
              <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
        </PageStateProvider>
      </DataProvider>
    </AuthProvider>
  );
}

export default App;
