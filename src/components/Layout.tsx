import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  ShoppingCart,
  Receipt,
  Wallet,
  Users,
  UserCircle,
  Landmark,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronRight,
  Banknote,
  TrendingUp,
  BookOpen,
  FileText,
  Bell,
  Plus,
  Save,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../utils/supabase';
import { formatKES, formatDate } from '../utils/format';
import { useDataRefresh } from '../context/DataContext';
import type { Supplier, Customer, Reminder } from '../types';

const navItems = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard },
  { label: 'Sales', path: '/sales', icon: ShoppingCart },
  { label: 'Expenses', path: '/expenses', icon: Receipt },
  { label: 'Cash & Bank', path: '/cash-bank', icon: Banknote },
  { label: 'Partner Accounts', path: '/partners', icon: Users },
  { label: 'Profit & Loss', path: '/profit-loss', icon: TrendingUp },
  { label: 'Customers', path: '/customers', icon: UserCircle },
  { label: 'Suppliers', path: '/suppliers', icon: Landmark },
  { label: 'Capital & History', path: '/capital', icon: BookOpen },
  { label: 'Reports', path: '/reports', icon: FileText },
  { label: 'Settings', path: '/settings', icon: Settings },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showReminderPopup, setShowReminderPopup] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
  );
  const [reminderForm, setReminderForm] = useState({
    entityType: 'supplier' as 'supplier' | 'customer',
    entityId: '',
    amount: '',
    dueDate: '',
    reminderDate: '',
    reminderTime: '09:00',
    notes: '',
  });
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { refreshKey, triggerRefresh } = useDataRefresh();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Kept loaded on every page (not just while the reminder popup is open) so
  // reminder notifications can fire and show entity names no matter which
  // page the user is currently on.
  useEffect(() => {
    supabase.from('suppliers').select('*').eq('is_active', true).then(({ data }) => setSuppliers(data || []));
    supabase.from('customers').select('*').eq('is_active', true).then(({ data }) => setCustomers(data || []));
    supabase.from('reminders').select('*').eq('status', 'pending').then(({ data }) => setReminders(data || []));
  }, [refreshKey]);

  // Check for due reminders every minute, regardless of which page is open
  useEffect(() => {
    const checkReminders = () => {
      if (notifPermission !== 'granted') return;
      const supplierAlerts = localStorage.getItem('gohar_alert_supplier') !== 'false';
      const collectionAlerts = localStorage.getItem('gohar_alert_collection') !== 'false';
      const now = new Date();
      const due = reminders.filter((r) => {
        if (r.reminder_type === 'supplier_payment' && !supplierAlerts) return false;
        if (r.reminder_type === 'customer_collection' && !collectionAlerts) return false;
        const reminderDate = new Date(r.reminder_date);
        const reminderTime = r.reminder_time || '09:00';
        const [hours, minutes] = reminderTime.split(':').map(Number);
        reminderDate.setHours(hours, minutes, 0, 0);
        return reminderDate <= now && r.status === 'pending';
      });
      if (due.length > 0) {
        due.forEach((r) => {
          const entity = r.entity_type === 'supplier'
            ? suppliers.find((s) => s.id === r.entity_id)
            : customers.find((c) => c.id === r.entity_id);
          new Notification(`Payment Reminder: ${r.reminder_type === 'supplier_payment' ? 'Pay' : 'Collect from'} ${entity?.name || 'Unknown'}`, {
            body: `Amount: KES ${formatKES(r.amount || 0)}\nDue: ${formatDate(r.due_date)}`,
            icon: '/favicon.ico',
            tag: r.id, // Prevents duplicate notifications
          });
        });
        if (audioRef.current) {
          audioRef.current.play().catch(() => {});
        }
      }
    };

    checkReminders();
    const interval = setInterval(checkReminders, 60000);
    return () => clearInterval(interval);
  }, [reminders, suppliers, customers, notifPermission]);

  function enableNotifications() {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    Notification.requestPermission().then((permission) => setNotifPermission(permission));
  }

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  async function handleSaveReminder() {
    if (!reminderForm.entityId || !reminderForm.dueDate || !reminderForm.reminderDate) return;

    await supabase.from('reminders').insert({
      // Matches the convention used everywhere else a reminder is created
      // (Dashboard.tsx, Suppliers.tsx) and what the notification/list display
      // here already checks for - this used to say 'payment_due'/'collection',
      // which never matched, so these reminders always displayed as "Collect from"
      reminder_type: reminderForm.entityType === 'supplier' ? 'supplier_payment' : 'customer_collection',
      entity_id: reminderForm.entityId,
      entity_type: reminderForm.entityType,
      amount: parseFloat(reminderForm.amount || '0') || null,
      due_date: reminderForm.dueDate,
      reminder_date: reminderForm.reminderDate,
      notes: reminderForm.notes || null,
      status: 'pending',
    });

    setReminderForm({ entityType: 'supplier', entityId: '', amount: '', dueDate: '', reminderDate: '', reminderTime: '09:00', notes: '' });
    setShowReminderPopup(false);
    triggerRefresh();
  }

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:sticky top-0 left-0 z-50 h-screen w-64 bg-slate-900 text-white
          flex flex-col transition-transform duration-300 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        <div className="p-4 border-b border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center">
              <span className="font-bold text-sm">GR</span>
            </div>
            <span className="font-semibold text-lg">Gohar Records</span>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden p-1 hover:bg-slate-700 rounded">
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                className={`
                  flex items-center gap-3 px-4 py-2.5 mx-2 rounded-lg text-sm transition-colors
                  ${isActive
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }
                `}
              >
                <item.icon size={18} />
                <span>{item.label}</span>
                {isActive && <ChevronRight size={14} className="ml-auto" />}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-700">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 bg-slate-700 rounded-full flex items-center justify-center text-xs font-medium uppercase">
              {user?.full_name?.[0] || user?.username?.[0]}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.full_name || user?.username}</p>
              <p className="text-xs text-slate-400 capitalize">{user?.role}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-sm text-slate-300 hover:text-white w-full px-2 py-1.5 rounded hover:bg-slate-800 transition-colors"
          >
            <LogOut size={16} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-30">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 hover:bg-slate-100 rounded-lg"
          >
            <Menu size={20} />
          </button>
          <h1 className="text-lg font-semibold text-slate-800 flex-1">
            {navItems.find((n) => n.path === location.pathname)?.label || 'Gohar Records'}
          </h1>
          <button
            onClick={() => setShowReminderPopup(true)}
            className="p-2 hover:bg-amber-50 rounded-lg text-amber-600 hover:text-amber-700 transition-colors"
            title="Add Reminder/Alarm"
          >
            <Bell size={18} />
          </button>
        </header>

        {/* Enable notifications prompt - browsers block silent/automatic permission requests, so this must be a real click */}
        {notifPermission === 'default' && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center gap-3 text-sm">
            <Bell size={16} className="text-amber-600 flex-shrink-0" />
            <span className="text-amber-800 flex-1">Turn on notifications to get popup + sound alerts when a reminder is due.</span>
            <button
              onClick={enableNotifications}
              className="bg-amber-600 hover:bg-amber-700 text-white px-3 py-1 rounded-lg text-xs font-medium flex-shrink-0"
            >
              Enable Notifications
            </button>
          </div>
        )}

        {/* Hidden audio for reminder notification sound */}
        <audio ref={audioRef} src="data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdH2LkZeYl5aSjIR8eXp5e3uBh4yRk5aXl5aTkI2HgH17e3t7fISLkpWYl5eWko6IhIJ8e3t8fYOKkJWYmJiWko6JhYOBfHt8fYGHjZGXmJiWk46JhoSDgX18fX6Ch4yRlpiYlpKOiYWEg4F9fX5/gYaMkZaYmJaSjomFhIOBf39/gIGGjJGXmJeWko6JhYSDgYB/f4CCRoyRlpiXlpKOioWEg4GAf3+AgYaOkZSYl5aSjYqFhIOBf4CAgYSMkZSYl5aTjomFhIOCf4CBgYaNkZSXl5aTjomGhIOCf4CBgoiQlJeXlpOOioWEg4J/gIGChoyRlJeWlZOQi4WEg4J/gICCgoeOkpSWlpSSkIuGhIOCf4GCg4ePkpSVlZSQjouGhIOCgIGCg4ePkpOTkpKQjouGhIOCgIGChA==" />

        {/* Quick Add Reminder Popup */}
        {showReminderPopup && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                  <Bell size={18} className="text-amber-500" /> Add Reminder
                </h3>
                <button onClick={() => setShowReminderPopup(false)} className="p-1 hover:bg-slate-100 rounded">
                  <X size={18} />
                </button>
              </div>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
                    <select
                      value={reminderForm.entityType}
                      onChange={(e) => setReminderForm({ ...reminderForm, entityType: e.target.value as 'supplier' | 'customer', entityId: '' })}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="supplier">Supplier</option>
                      <option value="customer">Customer</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">{reminderForm.entityType === 'supplier' ? 'Supplier' : 'Customer'}</label>
                    <select
                      value={reminderForm.entityId}
                      onChange={(e) => setReminderForm({ ...reminderForm, entityId: e.target.value })}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="">Select</option>
                      {reminderForm.entityType === 'supplier'
                        ? suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)
                        : customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Amount</label>
                    <input
                      type="number"
                      value={reminderForm.amount}
                      onChange={(e) => setReminderForm({ ...reminderForm, amount: e.target.value })}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Due Date</label>
                    <input
                      type="date"
                      value={reminderForm.dueDate}
                      onChange={(e) => setReminderForm({ ...reminderForm, dueDate: e.target.value })}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Reminder Date</label>
                    <input
                      type="date"
                      value={reminderForm.reminderDate}
                      onChange={(e) => setReminderForm({ ...reminderForm, reminderDate: e.target.value })}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Time</label>
                    <input
                      type="time"
                      value={reminderForm.reminderTime}
                      onChange={(e) => setReminderForm({ ...reminderForm, reminderTime: e.target.value })}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                  <textarea
                    value={reminderForm.notes}
                    onChange={(e) => setReminderForm({ ...reminderForm, notes: e.target.value })}
                    rows={2}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={handleSaveReminder}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
                  >
                    <Save size={16} /> Save
                  </button>
                  <button
                    onClick={() => setShowReminderPopup(false)}
                    className="px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <main className="flex-1 p-4 lg:p-6 overflow-x-auto">
          {children}
        </main>
      </div>
    </div>
  );
}