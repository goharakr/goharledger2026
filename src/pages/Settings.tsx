import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  Users,
  Percent,
  Bell,
  FileText,
  AlertTriangle,
  Save,
  Trash2,
  Download,
  X,
  Wallet,
  ArrowRight,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from '../utils/supabase';
import { useAuth } from '../context/AuthContext';
import { useDataRefresh } from '../context/DataContext';
import { formatKES, todayStr } from '../utils/format';
import { adjustCustomerCredit, adjustSupplierBalance } from '../utils/balances';
import type { Customer, Supplier } from '../types';

export default function Settings() {
  const { user } = useAuth();
  const { triggerRefresh } = useDataRefresh();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('profile');

  const tabs = [
    { id: 'profile', label: 'Business Profile', icon: Building2 },
    { id: 'opening', label: 'Opening Balances', icon: Wallet },
    { id: 'users', label: 'User Management', icon: Users },
    { id: 'shares', label: 'Share Rules', icon: Percent },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'export', label: 'Data & Backup', icon: FileText },
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
        {activeTab === 'opening' && <OpeningBalances navigate={navigate} triggerRefresh={triggerRefresh} />}
        {activeTab === 'users' && <UserManagement />}
        {activeTab === 'shares' && <ShareRulesSettings />}
        {activeTab === 'notifications' && <NotificationsSettings />}
        {activeTab === 'export' && <DataExport />}
        {activeTab === 'danger' && <DangerZone triggerRefresh={triggerRefresh} navigate={navigate} />}
      </div>
    </div>
  );
}

function BusinessProfile() {
  const [profileId, setProfileId] = useState<string | null>(null);
  const [form, setForm] = useState({
    businessName: 'Gohar Records',
    address: '',
    phone: '',
    email: '',
    currency: 'KES',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    supabase.from('business_profile').select('*').limit(1).maybeSingle().then(({ data }) => {
      if (data) {
        setProfileId(data.id);
        setForm({
          businessName: data.business_name || 'Gohar Records',
          address: data.address || '',
          phone: data.phone || '',
          email: data.email || '',
          currency: data.currency || 'KES',
        });
      }
    });
  }, []);

  async function handleSave() {
    setSaving(true);
    const payload = {
      business_name: form.businessName,
      address: form.address || null,
      phone: form.phone || null,
      email: form.email || null,
      currency: form.currency,
    };
    if (profileId) {
      await supabase.from('business_profile').update(payload).eq('id', profileId);
    } else {
      const { data } = await supabase.from('business_profile').insert(payload).select().single();
      if (data) setProfileId(data.id);
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

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
      <div className="flex items-center gap-3">
        <button onClick={handleSave} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50">
          <Save size={16} /> {saving ? 'Saving...' : 'Save Profile'}
        </button>
        {saved && <span className="text-sm text-emerald-600">Saved</span>}
      </div>
    </div>
  );
}

function OpeningBalances({ navigate, triggerRefresh }: { navigate: (path: string) => void; triggerRefresh: () => void }) {
  const { user } = useAuth();
  const [cashAmounts, setCashAmounts] = useState({ cash: '', mpesa: '', paybill: '' });
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [customerAmount, setCustomerAmount] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [supplierAmount, setSupplierAmount] = useState('');
  const [saved, setSaved] = useState('');

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const [{ data: cust }, { data: supp }, { data: opening }] = await Promise.all([
      supabase.from('customers').select('*').eq('is_active', true).order('name'),
      supabase.from('suppliers').select('*').eq('is_active', true).order('name'),
      supabase.from('transactions').select('*').in('transaction_id', ['OPN-CASH', 'OPN-MPESA', 'OPN-PAYBILL']).eq('is_void', false),
    ]);
    setCustomers(cust || []);
    setSuppliers(supp || []);
    setCashAmounts({
      cash: String(opening?.find((t) => t.transaction_id === 'OPN-CASH')?.amount || ''),
      mpesa: String(opening?.find((t) => t.transaction_id === 'OPN-MPESA')?.amount || ''),
      paybill: String(opening?.find((t) => t.transaction_id === 'OPN-PAYBILL')?.amount || ''),
    });
  }

  async function saveCashBalance(mode: 'cash' | 'mpesa' | 'paybill') {
    const amt = parseFloat(cashAmounts[mode] || '0');
    const txnId = `OPN-${mode.toUpperCase()}`;
    const { data: existing } = await supabase.from('transactions').select('*').eq('transaction_id', txnId).maybeSingle();

    if (existing) {
      if (amt > 0) {
        await supabase.from('transactions').update({ amount: amt, is_void: false, edited_at: new Date().toISOString() }).eq('id', existing.id);
      } else if (!existing.is_void) {
        await supabase.from('transactions').update({ is_void: true, void_reason: 'Opening balance removed' }).eq('id', existing.id);
      }
    } else if (amt > 0) {
      await supabase.from('transactions').insert({
        transaction_id: txnId,
        date: todayStr(),
        type: 'opening_balance',
        primary_mode: mode,
        amount: amt,
        description: `Opening balance - ${mode}`,
        created_by: user?.username || null,
      });
    }
    setSaved(`${mode} balance saved`);
    setTimeout(() => setSaved(''), 2000);
    triggerRefresh();
  }

  async function saveCustomerOpeningBalance() {
    if (!customerId || !customerAmount) return;
    const amt = parseFloat(customerAmount);
    const customer = customers.find((c) => c.id === customerId);
    if (!customer) return;

    const txnId = `OPN-CR-${customerId}`;
    const { data: existing } = await supabase.from('transactions').select('*').eq('transaction_id', txnId).maybeSingle();
    const oldAmount = existing && !existing.is_void ? existing.amount || 0 : 0;

    await adjustCustomerCredit(customerId, amt - oldAmount);

    if (existing) {
      await supabase.from('transactions').update({ amount: amt, is_void: false, edited_at: new Date().toISOString() }).eq('id', existing.id);
    } else {
      await supabase.from('transactions').insert({
        transaction_id: txnId,
        date: todayStr(),
        type: 'opening_balance',
        primary_mode: null,
        amount: amt,
        customer_id: customerId,
        description: `Opening balance owed - ${customer.name}`,
        created_by: user?.username || null,
      });
    }
    setCustomerAmount('');
    setSaved(`${customer.name}'s opening balance saved`);
    setTimeout(() => setSaved(''), 2000);
    triggerRefresh();
  }

  async function saveSupplierOpeningBalance() {
    if (!supplierId || !supplierAmount) return;
    const amt = parseFloat(supplierAmount);
    const supplier = suppliers.find((s) => s.id === supplierId);
    if (!supplier) return;

    const txnId = `OPN-BAL-${supplierId}`;
    const { data: existing } = await supabase.from('transactions').select('*').eq('transaction_id', txnId).maybeSingle();
    const oldAmount = existing && !existing.is_void ? existing.amount || 0 : 0;

    await adjustSupplierBalance(supplierId, amt - oldAmount);

    if (existing) {
      await supabase.from('transactions').update({ amount: amt, is_void: false, edited_at: new Date().toISOString() }).eq('id', existing.id);
    } else {
      await supabase.from('transactions').insert({
        transaction_id: txnId,
        date: todayStr(),
        type: 'supplier_invoice',
        primary_mode: null,
        amount: amt,
        supplier_id: supplierId,
        description: `Opening balance - ${supplier.name}`,
        created_by: user?.username || null,
      });
    }
    setSupplierAmount('');
    setSaved(`${supplier.name}'s opening balance saved`);
    setTimeout(() => setSaved(''), 2000);
    triggerRefresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold text-slate-800">Opening Balances</h3>
        <p className="text-sm text-slate-500 mt-1">
          Do this once before you start using the app for real, to carry forward your starting numbers. Everything here can also be edited later from its own page.
        </p>
      </div>
      {saved && <p className="text-sm text-emerald-600">{saved}</p>}

      {/* Cash */}
      <div className="border border-slate-200 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-slate-700 mb-3">Cash in Hand</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {(['cash', 'mpesa', 'paybill'] as const).map((mode) => (
            <div key={mode} className="flex gap-2">
              <input
                type="number"
                value={cashAmounts[mode]}
                onChange={(e) => setCashAmounts({ ...cashAmounts, [mode]: e.target.value })}
                placeholder={mode.charAt(0).toUpperCase() + mode.slice(1)}
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              />
              <button onClick={() => saveCashBalance(mode)} className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-lg text-xs font-medium">Save</button>
            </div>
          ))}
        </div>
      </div>

      {/* Customers */}
      <div className="border border-slate-200 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-slate-700 mb-3">Customer Opening Balances Owed</h4>
        <div className="flex flex-wrap gap-2">
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="flex-1 min-w-[160px] border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none">
            <option value="">Select customer</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input type="number" value={customerAmount} onChange={(e) => setCustomerAmount(e.target.value)} placeholder="Amount owed" className="w-40 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
          <button onClick={saveCustomerOpeningBalance} className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-lg text-xs font-medium">Save</button>
        </div>
        <p className="text-xs text-slate-500 mt-2">Can also be set per-customer from the Customers page.</p>
      </div>

      {/* Suppliers */}
      <div className="border border-slate-200 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-slate-700 mb-3">Supplier Opening Balances</h4>
        <div className="flex flex-wrap gap-2">
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="flex-1 min-w-[160px] border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none">
            <option value="">Select supplier</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input type="number" value={supplierAmount} onChange={(e) => setSupplierAmount(e.target.value)} placeholder="Amount owed" className="w-40 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
          <button onClick={saveSupplierOpeningBalance} className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-lg text-xs font-medium">Save</button>
        </div>
        <p className="text-xs text-slate-500 mt-2">Can also be set per-supplier from the Suppliers page.</p>
      </div>

      {/* Shortcuts */}
      <div className="border border-slate-200 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-slate-700 mb-3">Capital, Loans &amp; Past Profit</h4>
        <button onClick={() => navigate('/capital')} className="flex items-center gap-2 text-sm text-emerald-600 hover:text-emerald-700 font-medium">
          Go to Capital &amp; History <ArrowRight size={14} />
        </button>
        <p className="text-xs text-slate-500 mt-2">Add Capital Entries, past Loans, and Historical Profit records there.</p>
      </div>
    </div>
  );
}

function UserManagement() {
  const { user, changeCredentials } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newUsername, setNewUsername] = useState(user?.username || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setError('');
    setSuccess('');
    if (!currentPassword) { setError('Enter your current password to confirm the change'); return; }
    if (newPassword && newPassword !== confirmPassword) { setError('New passwords do not match'); return; }

    setSaving(true);
    const result = await changeCredentials(currentPassword, newUsername, newPassword);
    setSaving(false);

    if (!result.ok) {
      setError(result.error || 'Could not save changes');
      return;
    }
    setSuccess('Saved - use your new username/password next time you log in.');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  }

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-slate-800">User Management</h3>
      <div className="bg-slate-50 rounded-lg p-4 space-y-3 max-w-md">
        <p className="text-sm text-slate-600">
          Signed in as <span className="font-medium text-slate-800">{user?.username}</span>. Change your own username and/or password below.
        </p>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Current Password</label>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Required to confirm any change"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">New Username</label>
          <input
            type="text"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Leave blank to keep current"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Confirm New Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-emerald-600">{success}</p>}
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
      <p className="text-xs text-slate-500">Only your own account can be changed here - the other partner changes theirs the same way, from their own login.</p>
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
  const [supplierAlerts, setSupplierAlerts] = useState(() => localStorage.getItem('gohar_alert_supplier') !== 'false');
  const [collectionAlerts, setCollectionAlerts] = useState(() => localStorage.getItem('gohar_alert_collection') !== 'false');
  const [browserNotifications, setBrowserNotifications] = useState<NotificationPermission | 'unsupported'>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
  );

  function toggleSupplierAlerts(checked: boolean) {
    setSupplierAlerts(checked);
    localStorage.setItem('gohar_alert_supplier', String(checked));
  }

  function toggleCollectionAlerts(checked: boolean) {
    setCollectionAlerts(checked);
    localStorage.setItem('gohar_alert_collection', String(checked));
  }

  const requestNotificationPermission = () => {
    if ('Notification' in window) {
      Notification.requestPermission().then((permission) => setBrowserNotifications(permission));
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-slate-800">Notifications</h3>
      <p className="text-sm text-slate-500">Controls which due reminders trigger the popup alert and browser notification (set from the bell icon in the sidebar).</p>
      <div className="space-y-3">
        <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
          <span className="text-sm text-slate-700">Supplier payment due alerts</span>
          <input type="checkbox" checked={supplierAlerts} onChange={(e) => toggleSupplierAlerts(e.target.checked)} className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
        </div>
        <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
          <span className="text-sm text-slate-700">Customer collection due alerts</span>
          <input type="checkbox" checked={collectionAlerts} onChange={(e) => toggleCollectionAlerts(e.target.checked)} className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
        </div>
        <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
          <div>
            <span className="text-sm text-slate-700">Browser Notifications</span>
            <p className="text-xs text-slate-500">Get popup alerts when reminders are due</p>
          </div>
          <button
            onClick={requestNotificationPermission}
            disabled={browserNotifications === 'unsupported'}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50 ${
              browserNotifications === 'granted'
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
            }`}
          >
            {browserNotifications === 'granted' ? 'Enabled' : browserNotifications === 'unsupported' ? 'Not supported' : 'Enable'}
          </button>
        </div>
      </div>
    </div>
  );
}

async function fetchReportData() {
  const [{ data: txns }, { data: customers }, { data: suppliers }, { data: profile }] = await Promise.all([
    supabase.from('transactions').select('*').eq('is_void', false).order('date', { ascending: false }),
    supabase.from('customers').select('*'),
    supabase.from('suppliers').select('*'),
    supabase.from('business_profile').select('*').limit(1).maybeSingle(),
  ]);
  const businessName = profile?.business_name || 'Gohar Records';

  const entityName = (t: any) => {
    if (t.customer_id) return customers?.find((c) => c.id === t.customer_id)?.name || 'Customer';
    if (t.supplier_id) return suppliers?.find((s) => s.id === t.supplier_id)?.name || 'Supplier';
    if (t.partner_id) return t.partner_id.charAt(0).toUpperCase() + t.partner_id.slice(1);
    return '-';
  };

  let salesTotal = 0, costTotal = 0, commissionTotal = 0, shopExpenseTotal = 0, homeExpenseTotal = 0;
  let partnerDrawTotal = 0, loanPaymentTotal = 0, supplierPaymentTotal = 0, customerCollectionTotal = 0;

  (txns || []).forEach((t) => {
    if (t.type === 'sale') {
      salesTotal += t.selling_price || t.amount;
      costTotal += t.cost_price || 0;
      commissionTotal += t.commission || 0;
    } else if (t.type === 'customer_payment') {
      customerCollectionTotal += t.amount;
    } else if (t.type === 'expense') {
      const isSupplierPayment = t.category === 'supplier_payment' || t.category === 'stock';
      if (t.category === 'home_expense') homeExpenseTotal += t.amount;
      else if (!isSupplierPayment) shopExpenseTotal += t.amount;
    } else if (t.type === 'supplier_payment') {
      supplierPaymentTotal += t.amount;
    } else if (t.type === 'partner_draw') {
      partnerDrawTotal += t.amount;
    } else if (t.type === 'loan_payment') {
      loanPaymentTotal += t.amount;
    }
  });

  const grossProfit = salesTotal - costTotal - commissionTotal;
  const netProfit = grossProfit - shopExpenseTotal - homeExpenseTotal - partnerDrawTotal - loanPaymentTotal;

  const summaryRows: [string, string][] = [
    ['Sales', formatKES(salesTotal)],
    ['Gross Profit', formatKES(grossProfit)],
    ['Net Profit', formatKES(netProfit)],
    ['Shop Expenses', formatKES(shopExpenseTotal)],
    ['Home Expenses', formatKES(homeExpenseTotal)],
    ['Partner Withdrawals', formatKES(partnerDrawTotal)],
    ['Loan Repayments', formatKES(loanPaymentTotal)],
    ['Supplier Payments', formatKES(supplierPaymentTotal)],
    ['Customer Collections', formatKES(customerCollectionTotal)],
  ];

  const txnRows = (txns || []).map((t) => [
    t.date,
    t.transaction_id,
    t.type.replace(/_/g, ' '),
    t.description || '',
    entityName(t),
    t.primary_mode || '-',
    t.amount,
  ]);

  return { summaryRows, txnRows, businessName };
}

function DataExport() {
  const [exporting, setExporting] = useState<string | null>(null);

  async function exportJSON() {
    setExporting('json');
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
      a.download = `gohar-records-backup-${todayStr()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    }
    setExporting(null);
  }

  async function exportExcel() {
    setExporting('excel');
    try {
      const { summaryRows, txnRows, businessName } = await fetchReportData();

      const wb = XLSX.utils.book_new();
      const summarySheet = XLSX.utils.aoa_to_sheet([[businessName, ''], ['Summary', ''], ...summaryRows]);
      XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

      const txnSheet = XLSX.utils.aoa_to_sheet([
        ['Date', 'ID', 'Type', 'Description', 'Entity', 'Mode', 'Amount'],
        ...txnRows,
      ]);
      XLSX.utils.book_append_sheet(wb, txnSheet, 'Transactions');

      XLSX.writeFile(wb, `gohar-records-report-${todayStr()}.xlsx`);
    } catch (err) {
      console.error('Export failed:', err);
    }
    setExporting(null);
  }

  async function exportPDF() {
    setExporting('pdf');
    try {
      const { summaryRows, txnRows, businessName } = await fetchReportData();

      const doc = new jsPDF();
      doc.setFontSize(16);
      doc.text(`${businessName} - Business Report`, 14, 16);
      doc.setFontSize(10);
      doc.text(`Generated ${todayStr()}`, 14, 22);

      autoTable(doc, {
        startY: 28,
        head: [['Summary', 'Amount (KES)']],
        body: summaryRows,
        theme: 'striped',
        headStyles: { fillColor: [5, 150, 105] },
      });

      const afterSummaryY = (doc as any).lastAutoTable.finalY + 8;
      autoTable(doc, {
        startY: afterSummaryY,
        head: [['Date', 'ID', 'Type', 'Description', 'Entity', 'Mode', 'Amount']],
        body: txnRows,
        theme: 'striped',
        headStyles: { fillColor: [5, 150, 105] },
        styles: { fontSize: 8 },
      });

      doc.save(`gohar-records-report-${todayStr()}.pdf`);
    } catch (err) {
      console.error('Export failed:', err);
    }
    setExporting(null);
  }

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-slate-800">Data & Backup</h3>
      <p className="text-sm text-slate-500">Excel and PDF give you a formatted business report (sales, profit, expenses, and the full transaction list). JSON gives you a raw copy of your data.</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button
          onClick={exportExcel}
          disabled={!!exporting}
          className="bg-white border border-slate-300 hover:bg-slate-50 rounded-lg p-4 flex flex-col items-center gap-2 transition-colors disabled:opacity-50"
        >
          <Download size={24} className="text-blue-600" />
          <span className="text-sm font-medium text-slate-700">{exporting === 'excel' ? 'Exporting...' : 'Export as Excel'}</span>
        </button>
        <button
          onClick={exportPDF}
          disabled={!!exporting}
          className="bg-white border border-slate-300 hover:bg-slate-50 rounded-lg p-4 flex flex-col items-center gap-2 transition-colors disabled:opacity-50"
        >
          <Download size={24} className="text-red-600" />
          <span className="text-sm font-medium text-slate-700">{exporting === 'pdf' ? 'Exporting...' : 'Export as PDF'}</span>
        </button>
        <button
          onClick={exportJSON}
          disabled={!!exporting}
          className="bg-white border border-slate-300 hover:bg-slate-50 rounded-lg p-4 flex flex-col items-center gap-2 transition-colors disabled:opacity-50"
        >
          <Download size={24} className="text-emerald-600" />
          <span className="text-sm font-medium text-slate-700">{exporting === 'json' ? 'Exporting...' : 'Export as JSON'}</span>
        </button>
      </div>
    </div>
  );
}

function DangerZone({ triggerRefresh, navigate }: { triggerRefresh: () => void; navigate: (path: string) => void }) {
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetStep, setResetStep] = useState(1);
  const [resetConfirmation, setResetConfirmation] = useState('');
  const [resetting, setResetting] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);

  async function handleDeleteAllCustomersSuppliers() {
    setDeletingAll(true);
    try {
      // Transactions/reminders reference customers and suppliers by id, so they
      // have to go first or the delete below would be blocked/orphan them.
      await supabase.from('transaction_splits').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('transactions').delete().or('customer_id.not.is.null,supplier_id.not.is.null');
      await supabase.from('reminders').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('customers').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('suppliers').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      triggerRefresh();
      navigate('/');
    } catch (err) {
      console.error('Delete all failed:', err);
    }
    setDeletingAll(false);
  }

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

      // Reset customer balances (all of them, including soft-deleted ones, so
      // nothing carries a stale balance if it's ever reactivated)
      await supabase.from('customers').update({ credit_balance: 0, advance_balance: 0 }).neq('id', '00000000-0000-0000-0000-000000000000');

      // Reset supplier balances (same reasoning)
      await supabase.from('suppliers').update({ balance: 0 }).neq('id', '00000000-0000-0000-0000-000000000000');

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
            onClick={() => { if (confirm('This will delete everything including customer/supplier records. Are you sure?')) handleDeleteAllCustomersSuppliers(); }}
            disabled={deletingAll}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {deletingAll ? 'Deleting...' : 'Delete All'}
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