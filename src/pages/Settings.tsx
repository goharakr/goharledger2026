import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  Users,
  Percent,
  Bell,
  FileText,
  Palette,
  AlertTriangle,
  Save,
  Trash2,
  Download,
  X,
} from 'lucide-react';
import { supabase } from '../utils/supabase';
import { useAuth } from '../context/AuthContext';
import { useDataRefresh } from '../context/DataContext';

export default function Settings() {
  const { user } = useAuth();
  const { triggerRefresh } = useDataRefresh();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('profile');

  const tabs = [
    { id: 'profile', label: 'Business Profile', icon: Building2 },
    { id: 'users', label: 'User Management', icon: Users },
    { id: 'shares', label: 'Share Rules', icon: Percent },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'export', label: 'Data & Backup', icon: FileText },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'danger', label: 'Danger Zone', icon: AlertTriangle },
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit flex-wrap">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
              activeTab === tab.id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        {activeTab === 'profile' && <BusinessProfile />}
        {activeTab === 'users' && <UserManagement />}
        {activeTab === 'shares' && <ShareRulesSettings />}
        {activeTab === 'notifications' && <NotificationsSettings />}
        {activeTab === 'export' && <DataExport />}
        {activeTab === 'appearance' && <AppearanceSettings />}
        {activeTab === 'danger' && <DangerZone triggerRefresh={triggerRefresh} navigate={navigate} />}
      </div>
    </div>
  );
}

function BusinessProfile() {
  const [form, setForm] = useState({
    businessName: 'Gohar Records',
    address: '',
    phone: '',
    email: '',
    currency: 'KES',
  });

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-slate-800">Business Profile</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div><label className="block text-sm font-medium text-slate-700 mb-1">Business Name</label><input type="text" value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" /></div>
        <div><label className="block text-sm font-medium text-slate-700 mb-1">Phone</label><input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" /></div>
        <div><label className="block text-sm font-medium text-slate-700 mb-1">Email</label><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" /></div>
        <div><label className="block text-sm font-medium text-slate-700 mb-1">Currency</label><select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"><option value="KES">KES (Kenyan Shilling)</option></select></div>
      </div>
      <div><label className="block text-sm font-medium text-slate-700 mb-1">Address</label><textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} rows={2} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" /></div>
      <button className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-lg text-sm font-medium flex items-center gap-2"><Save size={16} /> Save Profile</button>
    </div>
  );
}

function UserManagement() {
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-slate-800">User Management</h3>
      <div className="bg-slate-50 rounded-lg p-4">
        <p className="text-sm text-slate-600">Current users:</p>
        <div className="mt-2 space-y-2">
          <div className="flex items-center justify-between bg-white rounded-lg p-3 border border-slate-200">
            <div>
              <p className="font-medium text-slate-800">taher</p>
              <p className="text-xs text-slate-500">Admin</p>
            </div>
            <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">Active</span>
          </div>
          <div className="flex items-center justify-between bg-white rounded-lg p-3 border border-slate-200">
            <div>
              <p className="font-medium text-slate-800">abdulqadir</p>
              <p className="text-xs text-slate-500">Admin</p>
            </div>
            <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">Active</span>
          </div>
        </div>
      </div>
      <p className="text-xs text-slate-500">Only admins can access this page. Password is shared: &quot;gohar&quot;</p>
    </div>
  );
}

function ShareRulesSettings() {
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-slate-800">Share Rules</h3>
      <p className="text-sm text-slate-600">Share rules are managed from the Profit & Loss page. Go to Profit & Loss to edit current rules.</p>
    </div>
  );
}

function NotificationsSettings() {
  const [supplierAlerts, setSupplierAlerts] = useState(true);
  const [partnerAlerts, setPartnerAlerts] = useState(true);
  const [lowCashAlerts, setLowCashAlerts] = useState(false);
  const [browserNotifications, setBrowserNotifications] = useState(false);

  const requestNotificationPermission = () => {
    if ('Notification' in window) {
      Notification.requestPermission().then((permission) => {
        setBrowserNotifications(permission === 'granted');
      });
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-slate-800">Notifications</h3>
      <div className="space-y-3">
        <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
          <span className="text-sm text-slate-700">Supplier payment due alerts</span>
          <input type="checkbox" checked={supplierAlerts} onChange={(e) => setSupplierAlerts(e.target.checked)} className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
        </div>
        <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
          <span className="text-sm text-slate-700">Partner pending balance alerts</span>
          <input type="checkbox" checked={partnerAlerts} onChange={(e) => setPartnerAlerts(e.target.checked)} className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
        </div>
        <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
          <span className="text-sm text-slate-700">Low cash threshold alerts</span>
          <input type="checkbox" checked={lowCashAlerts} onChange={(e) => setLowCashAlerts(e.target.checked)} className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
        </div>
        <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
          <div>
            <span className="text-sm text-slate-700">Browser Notifications</span>
            <p className="text-xs text-slate-500">Get popup alerts when reminders are due</p>
          </div>
          <button
            onClick={requestNotificationPermission}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              browserNotifications
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
            }`}
          >
            {browserNotifications ? 'Enabled' : 'Enable'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DataExport() {
  const [exporting, setExporting] = useState(false);

  async function exportCSV() {
    setExporting(true);
    try {
      const { data: txns } = await supabase.from('transactions').select('*').eq('is_void', false);
      const { data: customers } = await supabase.from('customers').select('*').eq('is_active', true);
      const { data: suppliers } = await supabase.from('suppliers').select('*').eq('is_active', true);
      const { data: capital } = await supabase.from('capital_entries').select('*');
      const { data: loans } = await supabase.from('loan_trackers').select('*');

      const allData = {
        transactions: txns,
        customers,
        suppliers,
        capital_entries: capital,
        loans,
      };

      const blob = new Blob([JSON.stringify(allData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gohar-records-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    }
    setExporting(false);
  }

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-slate-800">Data & Backup</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button
          onClick={exportCSV}
          disabled={exporting}
          className="bg-white border border-slate-300 hover:bg-slate-50 rounded-lg p-4 flex flex-col items-center gap-2 transition-colors disabled:opacity-50"
        >
          <Download size={24} className="text-emerald-600" />
          <span className="text-sm font-medium text-slate-700">{exporting ? 'Exporting...' : 'Export as JSON'}</span>
        </button>
        <button className="bg-white border border-slate-300 hover:bg-slate-50 rounded-lg p-4 flex flex-col items-center gap-2 transition-colors opacity-50 cursor-not-allowed">
          <Download size={24} className="text-blue-600" />
          <span className="text-sm font-medium text-slate-700">Excel (Coming Soon)</span>
        </button>
        <button className="bg-white border border-slate-300 hover:bg-slate-50 rounded-lg p-4 flex flex-col items-center gap-2 transition-colors opacity-50 cursor-not-allowed">
          <Download size={24} className="text-red-600" />
          <span className="text-sm font-medium text-slate-700">PDF (Coming Soon)</span>
        </button>
      </div>
    </div>
  );
}

function AppearanceSettings() {
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-slate-800">Appearance</h3>
      <div className="space-y-3">
        <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
          <span className="text-sm text-slate-700">Dark Mode</span>
          <input type="checkbox" className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
        </div>
        <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
          <span className="text-sm text-slate-700">Compact View</span>
          <input type="checkbox" className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
        </div>
      </div>
    </div>
  );
}

function DangerZone({ triggerRefresh, navigate }: { triggerRefresh: () => void; navigate: (path: string) => void }) {
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetStep, setResetStep] = useState(1);
  const [resetConfirmation, setResetConfirmation] = useState('');
  const [resetting, setResetting] = useState(false);

  async function handleReset() {
    if (resetStep === 1) {
      setResetStep(2);
      return;
    }

    if (resetStep === 2 && resetConfirmation !== 'RESET') {
      return;
    }

    setResetting(true);
    try {
      // Clear all transactions and splits
      await supabase.from('transaction_splits').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('transactions').delete().neq('id', '00000000-0000-0000-0000-000000000000');

      // Clear reminders
      await supabase.from('reminders').delete().neq('id', '00000000-0000-0000-0000-000000000000');

      // Clear loan payments
      await supabase.from('loan_payments').delete().neq('id', '00000000-0000-0000-0000-000000000000');

      // Clear historical profit
      await supabase.from('historical_profit').delete().neq('id', '00000000-0000-0000-0000-000000000000');

      // Clear capital entries
      await supabase.from('capital_entries').delete().neq('id', '00000000-0000-0000-0000-000000000000');

      // Clear loan trackers
      await supabase.from('loan_trackers').delete().neq('id', '00000000-0000-0000-0000-000000000000');

      // Reset customer balances
      await supabase.from('customers').update({ credit_balance: 0, advance_balance: 0 }).eq('is_active', true);

      // Reset supplier balances
      await supabase.from('suppliers').update({ balance: 0 }).eq('is_active', true);

      // Reset share rules
      await supabase.from('share_rules').delete().neq('id', '00000000-0000-0000-0000-000000000000');

      setShowResetModal(false);
      setResetStep(1);
      setResetConfirmation('');
      triggerRefresh();
      navigate('/');
    } catch (err) {
      console.error('Reset failed:', err);
    }
    setResetting(false);
  }

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-slate-800 text-red-600">Danger Zone</h3>
      <div className="border border-red-200 rounded-lg p-4 bg-red-50 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-slate-800">Reset All Data</p>
            <p className="text-xs text-slate-500">This will clear all transactions, balances, loans, and capital entries. Customers and suppliers will be kept but balances reset. Cannot be undone.</p>
          </div>
          <button
            onClick={() => setShowResetModal(true)}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            Reset
          </button>
        </div>
        <div className="border-t border-red-200 pt-4 flex items-center justify-between">
          <div>
            <p className="font-medium text-slate-800">Delete All Customers & Suppliers</p>
            <p className="text-xs text-slate-500">Permanently delete all customer and supplier records along with transactions.</p>
          </div>
          <button
            onClick={() => { if (confirm('This will delete everything including customer/supplier records. Are you sure?')) { /* handle full delete */ } }}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            Delete All
          </button>
        </div>
      </div>

      {/* Reset Modal */}
      {showResetModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-800 text-red-600">Reset All Data</h3>
              <button onClick={() => { setShowResetModal(false); setResetStep(1); setResetConfirmation(''); }} className="p-1 hover:bg-slate-100 rounded">
                <X size={18} />
              </button>
            </div>

            {resetStep === 1 && (
              <div className="space-y-4">
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-sm text-red-700 font-medium">Warning: This action cannot be undone!</p>
                  <p className="text-sm text-slate-600 mt-2">All of the following will be permanently deleted:</p>
                  <ul className="text-sm text-slate-600 mt-2 list-disc list-inside">
                    <li>All transactions (sales, expenses, payments)</li>
                    <li>All loan records and payments</li>
                    <li>All capital entries</li>
                    <li>All reminders</li>
                    <li>All historical profit data</li>
                  </ul>
                  <p className="text-sm text-slate-600 mt-2">Customer and supplier records will be kept but their balances will be reset to 0.</p>
                </div>
                <button
                  onClick={handleReset}
                  className="w-full bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-lg text-sm font-medium"
                >
                  Yes, continue to next step
                </button>
              </div>
            )}

            {resetStep === 2 && (
              <div className="space-y-4">
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-sm text-red-700 font-medium">Final Confirmation</p>
                  <p className="text-sm text-slate-600 mt-2">Type <strong>RESET</strong> to confirm and delete all data:</p>
                </div>
                <input
                  type="text"
                  value={resetConfirmation}
                  onChange={(e) => setResetConfirmation(e.target.value)}
                  placeholder="Type RESET"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 outline-none"
                />
                <button
                  onClick={handleReset}
                  disabled={resetConfirmation !== 'RESET' || resetting}
                  className="w-full bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {resetting ? 'Resetting...' : 'DELETE ALL DATA'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
