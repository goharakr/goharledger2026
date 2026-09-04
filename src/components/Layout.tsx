import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  ShoppingCart,
  Receipt,
  Users,
  UserCircle,
  Contact,
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
  Save,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../utils/supabase';
import { formatKES, formatDate, getMonthLabel, todayStr } from '../utils/format';
import { sortCustomersByBalance, sortSuppliersByBalance } from '../utils/sortEntities';
import { useDataRefresh } from '../context/DataContext';
import HelpChat from './HelpChat';
import { buildMonthlyFigures, calculateShareEarned } from '../utils/shareDue';
import { tomorrowStr } from '../utils/walletBalance';
import type { Supplier, Customer, Reminder, Transaction } from '../types';

const navItems = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard },
  { label: 'Sales', path: '/sales', icon: ShoppingCart },
  { label: 'Expenses', path: '/expenses', icon: Receipt },
  { label: 'Cash & Bank', path: '/cash-bank', icon: Banknote },
  { label: 'Partner Accounts', path: '/partners', icon: Users },
  { label: 'Profit & Loss', path: '/profit-loss', icon: TrendingUp },
  { label: 'Customers', path: '/customers', icon: UserCircle },
  { label: 'Suppliers', path: '/suppliers', icon: Landmark },
  { label: 'Employees', path: '/employees', icon: Contact },
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
  // A due reminder that's still "pending" (not yet marked OK) pops up as its
  // own in-app modal here - separate from the OS Notification below, which
  // needs a permission grant and doesn't work on every device. Choosing
  // "Remind me later" only clears it from THIS queue, not the database, so
  // the next check (60s later) puts it right back if it's still due and
  // pending - it keeps coming back until "OK" actually marks it done.
  const [dueReminderQueue, setDueReminderQueue] = useState<Reminder[]>([]);
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
  const [showNavProgress, setShowNavProgress] = useState(false);

  // Month-end profit share popup - the app has no server running in the
  // background, so it can't act "on the last day of the month" by itself.
  // The closest real equivalent: the next time anyone opens it on or after
  // the 1st of a new month, if last month's share hasn't been recorded yet,
  // this pops up with the amount worked out from the Share Rule (editable
  // before confirming). Confirming only records what each partner is now
  // owed (adds a Historical Profit row, same as the Capital page's own
  // table) - it never pays anyone or moves any money.
  const [monthEndPrompt, setMonthEndPrompt] = useState<{
    month: string; taherShare: string; abdulShare: string; taherRuleLabel: string; abdulRuleLabel: string;
    taherBaseShare: number; abdulBaseShare: number; taherOldLeftover: number; abdulOldLeftover: number;
    taherMergeOld: boolean; abdulMergeOld: boolean;
  } | null>(null);
  const [monthEndDismissed, setMonthEndDismissed] = useState(false);
  const [monthEndSaving, setMonthEndSaving] = useState(false);

  // Post-dated cheque confirmation queue - only for a cheque saved with
  // "Ask me to confirm first" (marked via a "[Confirm cheque]" tag in its
  // Notes, since there's no dedicated column for this). Unlike a normal
  // post-dated cheque (which auto-clears once its date passes), one of
  // these stays out of the wallet balance until explicitly confirmed here -
  // clears_on is used as "the next date to ask again", never left in the
  // past, so it can never silently count as paid before that happens.
  const [chequeQueue, setChequeQueue] = useState<Transaction[]>([]);
  const [chequeSaving, setChequeSaving] = useState(false);
  const [chequeAskDate, setChequeAskDate] = useState<{ id: string; date: string } | null>(null);

  // A visible sign that a page switch (from the sidebar or anywhere else) is
  // actually happening - each page fetches its own data after mounting, so
  // without this the screen can look unresponsive for a moment after a click.
  useEffect(() => {
    setShowNavProgress(true);
    const t = setTimeout(() => setShowNavProgress(false), 500);
    return () => clearTimeout(t);
  }, [location.pathname]);

  // Kept loaded on every page (not just while the reminder popup is open) so
  // reminder notifications can fire and show entity names no matter which
  // page the user is currently on.
  useEffect(() => {
    supabase.from('suppliers').select('*').eq('is_active', true).order('name').then(({ data }) => setSuppliers(data || []));
    supabase.from('customers').select('*').eq('is_active', true).order('name').then(({ data }) => setCustomers(data || []));
    supabase.from('reminders').select('*').eq('status', 'pending').then(({ data }) => setReminders(data || []));
  }, [refreshKey]);

  // Check once per app load whether last month's profit share still needs
  // recording - cheap most days (2 tiny queries), only pulls that one
  // month's transactions on the rare day it's actually needed.
  useEffect(() => {
    if (monthEndDismissed) return;
    const now = new Date();
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;

    (async () => {
      const [{ data: allHist }, { data: rules }] = await Promise.all([
        supabase.from('historical_profit').select('*'),
        supabase.from('share_rules').select('*').eq('is_active', true),
      ]);
      const existing = (allHist || []).find((h) => h.month === lastMonth);
      if (existing || !rules || rules.length === 0) return;

      const { data: monthTxns } = await supabase
        .from('transactions')
        .select('*')
        .eq('is_void', false)
        .gte('date', `${lastMonth}-01`)
        .lte('date', `${lastMonth}-31`);
      const monthly = buildMonthlyFigures(monthTxns);
      if (!monthly.has(lastMonth)) return; // no real activity that month - nothing to record

      const taherRule = rules.find((r) => r.partner_id === 'taher');
      const abdulRule = rules.find((r) => r.partner_id === 'abdulqadir');
      const taherEarned = calculateShareEarned(monthly, taherRule);
      const abdulEarned = calculateShareEarned(monthly, abdulRule);

      // Money the partner already took this same month (via Take Money)
      // reduces what still needs adding for this month - otherwise it would
      // look like they're owed the full rule amount again on top of what
      // they've already taken.
      const taherTakenThisMonth = (monthTxns || []).reduce((s, t) => (t.type === 'partner_draw' && t.partner_id === 'taher' && !t.is_void ? s + t.amount : s), 0);
      const abdulTakenThisMonth = (monthTxns || []).reduce((s, t) => (t.type === 'partner_draw' && t.partner_id === 'abdulqadir' && !t.is_void ? s + t.amount : s), 0);
      const taherBaseShare = Math.round(taherEarned - taherTakenThisMonth);
      const abdulBaseShare = Math.round(abdulEarned - abdulTakenThisMonth);

      // Unpaid share sitting in older months (already-recorded rows where
      // taken < share) - shown so the amount doesn't need adding here, but
      // can optionally be folded in if asked for.
      const taherOldLeftover = Math.round((allHist || []).filter((h) => h.month < lastMonth).reduce((s, h) => s + ((h.taher_share || 0) - (h.taher_taken || 0)), 0));
      const abdulOldLeftover = Math.round((allHist || []).filter((h) => h.month < lastMonth).reduce((s, h) => s + ((h.abdulqadir_share || 0) - (h.abdulqadir_taken || 0)), 0));

      setMonthEndPrompt({
        month: lastMonth,
        taherShare: String(taherBaseShare),
        abdulShare: String(abdulBaseShare),
        taherRuleLabel: taherRule ? (taherRule.rule_type === 'fixed' ? 'Fixed amount' : `${taherRule.value}%`) : 'No rule set',
        abdulRuleLabel: abdulRule ? (abdulRule.rule_type === 'fixed' ? 'Fixed amount' : `${abdulRule.value}%`) : 'No rule set',
        taherBaseShare,
        abdulBaseShare,
        taherOldLeftover,
        abdulOldLeftover,
        taherMergeOld: false,
        abdulMergeOld: false,
      });
    })();
  }, [monthEndDismissed]);

  async function handleConfirmMonthEndShare() {
    if (!monthEndPrompt) return;
    setMonthEndSaving(true);
    const taherShare = parseFloat(monthEndPrompt.taherShare || '0') || 0;
    const abdulShare = parseFloat(monthEndPrompt.abdulShare || '0') || 0;
    const { error } = await supabase.from('historical_profit').insert({
      month: monthEndPrompt.month,
      total_profit: taherShare + abdulShare,
      taher_share: taherShare,
      abdulqadir_share: abdulShare,
      taher_taken: 0,
      abdulqadir_taken: 0,
      retained: 0,
      notes: 'Recorded automatically at month-end',
      created_by: user?.username || null,
    });
    if (error) { setMonthEndSaving(false); alert('Failed to record the month-end share: ' + error.message); return; }

    // "Add old leftover to this month too" was ticked - the old unpaid
    // month(s) aren't paid, that unpaid amount has just been folded into
    // this month's number above, so mark those old rows as fully taken now
    // (so the total across all rows stays correct, not double-counted).
    if (monthEndPrompt.taherMergeOld || monthEndPrompt.abdulMergeOld) {
      const { data: oldRows } = await supabase.from('historical_profit').select('*').lt('month', monthEndPrompt.month);
      for (const row of oldRows || []) {
        const updates: Record<string, number> = {};
        if (monthEndPrompt.taherMergeOld) updates.taher_taken = row.taher_share || 0;
        if (monthEndPrompt.abdulMergeOld) updates.abdulqadir_taken = row.abdulqadir_share || 0;
        if (Object.keys(updates).length > 0) {
          await supabase.from('historical_profit').update(updates).eq('id', row.id);
        }
      }
    }

    setMonthEndSaving(false);
    setMonthEndPrompt(null);
    triggerRefresh();
  }

  // Check once per app load whether any "Ask me to confirm first" post-dated
  // cheque is due to be asked about - clears_on <= today means it's due,
  // since clears_on is only ever set to today-or-later for one of these
  // (never left in the past), so it can never silently count as paid.
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('transactions')
        .select('*')
        .eq('is_void', false)
        .not('clears_on', 'is', null)
        .lte('clears_on', todayStr())
        .ilike('notes', '%[Confirm cheque]%');
      setChequeQueue(data || []);
    })();
  }, [refreshKey]);

  async function handleChequeConfirmed(txn: Transaction) {
    setChequeSaving(true);
    const { error } = await supabase.from('transactions').update({
      clears_on: null,
      notes: (txn.notes || '').replace('[Confirm cheque]', '').trim() || null,
      edited_at: new Date().toISOString(),
    }).eq('id', txn.id);
    setChequeSaving(false);
    if (error) { alert('Failed to confirm the cheque: ' + error.message); return; }
    setChequeQueue((prev) => prev.filter((t) => t.id !== txn.id));
    triggerRefresh();
  }

  // "Not yet" - pushes clears_on to the picked date (or tomorrow if none
  // picked, so it naturally asks again every day until a date is set or
  // it's confirmed) - never removes the pending status, only moves it.
  async function handleChequeNotYet(txn: Transaction, nextDate: string) {
    setChequeSaving(true);
    const next = nextDate || tomorrowStr();
    const { error } = await supabase.from('transactions').update({
      clears_on: next,
      edited_at: new Date().toISOString(),
    }).eq('id', txn.id);
    setChequeSaving(false);
    if (error) { alert('Failed to update: ' + error.message); return; }
    setChequeQueue((prev) => prev.filter((t) => t.id !== txn.id));
    setChequeAskDate(null);
    triggerRefresh();
  }

  // Check for due reminders every minute, regardless of which page is open
  useEffect(() => {
    const checkReminders = () => {
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
        // The in-app popup works everywhere, with no permission needed - it's
        // the primary way this shows up. The OS Notification is an extra,
        // only when the browser's granted it.
        setDueReminderQueue((prev) => {
          const prevIds = new Set(prev.map((r) => r.id));
          const newOnes = due.filter((r) => !prevIds.has(r.id));
          return newOnes.length > 0 ? [...prev, ...newOnes] : prev;
        });
        if (notifPermission === 'granted') {
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
      reminder_time: reminderForm.reminderTime || null,
      notes: reminderForm.notes || null,
      status: 'pending',
    });

    setReminderForm({ entityType: 'supplier', entityId: '', amount: '', dueDate: '', reminderDate: '', reminderTime: '09:00', notes: '' });
    setShowReminderPopup(false);
    triggerRefresh();
  }

  // "OK" on the due-reminder popup - marks it done for good, it never
  // fires again.
  async function handleReminderDone(id: string) {
    await supabase.from('reminders').update({ status: 'completed' }).eq('id', id);
    setDueReminderQueue((prev) => prev.filter((r) => r.id !== id));
    setReminders((prev) => prev.filter((r) => r.id !== id));
  }

  // "Remind me later" - only closes this popup, the reminder stays pending
  // in the database, so it comes right back the next time it's checked.
  function handleReminderLater(id: string) {
    setDueReminderQueue((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Page-switch progress bar - visible feedback that a nav click registered */}
      {showNavProgress && (
        <div className="fixed top-0 left-0 right-0 z-[60] h-1 bg-emerald-100">
          <div className="h-full bg-emerald-600 animate-[nav-progress_0.5s_ease-out] [animation-fill-mode:forwards]" />
        </div>
      )}

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

        {/* Due Reminder Alert - pops up on its own, on any page, the moment a
            reminder becomes due. "OK" marks it done for good; "Remind me
            later" only closes this popup - it comes right back the next
            time it's checked (every minute) since it's still pending. */}
        {dueReminderQueue.length > 0 && (() => {
          const r = dueReminderQueue[0];
          const entity = r.entity_type === 'supplier'
            ? suppliers.find((s) => s.id === r.entity_id)
            : customers.find((c) => c.id === r.entity_id);
          return (
            <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md">
                <div className="flex items-center gap-2 mb-3">
                  <Bell size={20} className="text-amber-500" />
                  <h3 className="font-semibold text-slate-800">
                    {r.reminder_type === 'supplier_payment' ? 'Pay' : 'Collect from'} {entity?.name || 'Unknown'}
                  </h3>
                </div>
                <p className="text-sm text-slate-600 mb-1">Amount: KES {formatKES(r.amount || 0)}</p>
                <p className="text-sm text-slate-600 mb-1">Due: {formatDate(r.due_date)}</p>
                {r.notes && <p className="text-sm text-slate-500 mb-3">{r.notes}</p>}
                {dueReminderQueue.length > 1 && (
                  <p className="text-xs text-amber-600 mb-3">+{dueReminderQueue.length - 1} more reminder{dueReminderQueue.length > 2 ? 's' : ''} due</p>
                )}
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => handleReminderDone(r.id)}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-lg text-sm font-medium"
                  >
                    OK - Done
                  </button>
                  <button
                    onClick={() => handleReminderLater(r.id)}
                    className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-2 rounded-lg text-sm font-medium"
                  >
                    Remind me later
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Post-dated cheque confirmation popup - only for cheques saved
            with "Ask me to confirm first". Yes deducts it now; No asks for
            a date to check again (or defaults to tomorrow, so it keeps
            coming daily until a date is set or it's confirmed). */}
        {chequeQueue.length > 0 && (() => {
          const t = chequeQueue[0];
          const asking = chequeAskDate?.id === t.id;
          return (
            <div className="fixed inset-0 bg-black/40 z-[68] flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md">
                <h3 className="font-semibold text-slate-800 mb-1">Cheque check</h3>
                <p className="text-sm text-slate-600 mb-1">{t.description || t.notes?.replace('[Confirm cheque]', '').trim() || t.transaction_id}</p>
                <p className="text-sm text-slate-600 mb-3">KES {formatKES(t.amount || 0)} - was this approved and deducted from the bank?</p>
                {chequeQueue.length > 1 && (
                  <p className="text-xs text-amber-600 mb-3">+{chequeQueue.length - 1} more cheque{chequeQueue.length > 2 ? 's' : ''} to check</p>
                )}
                {!asking ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleChequeConfirmed(t)}
                      disabled={chequeSaving}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white py-2 rounded-lg text-sm font-medium"
                    >
                      Yes - Deducted
                    </button>
                    <button
                      onClick={() => setChequeAskDate({ id: t.id, date: '' })}
                      className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-2 rounded-lg text-sm font-medium"
                    >
                      Not yet
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-500">When should I ask again? Leave blank to ask again tomorrow.</p>
                    <input
                      type="date"
                      value={chequeAskDate.date}
                      onChange={(e) => setChequeAskDate({ id: t.id, date: e.target.value })}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleChequeNotYet(t, chequeAskDate.date)}
                        disabled={chequeSaving}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white py-2 rounded-lg text-sm font-medium"
                      >
                        {chequeSaving ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        onClick={() => setChequeAskDate(null)}
                        className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-2 rounded-lg text-sm font-medium"
                      >
                        Back
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* Month-End Profit Share popup - see the effect above for when this
            fires. Confirming only records what each partner is now owed
            (a Historical Profit row) - it never pays anyone. */}
        {monthEndPrompt && (
          <div className="fixed inset-0 bg-black/40 z-[65] flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md">
              <h3 className="font-semibold text-slate-800 mb-1">{getMonthLabel(monthEndPrompt.month)} ended</h3>
              <p className="text-xs text-slate-500 mb-4">
                Here's each partner's share for that month, worked out from your Share Rule. Check the amounts (edit if needed), then Confirm to add it to what they're owed - this doesn't pay them or move any money.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Taher's share ({monthEndPrompt.taherRuleLabel})</label>
                  <input
                    type="number"
                    value={monthEndPrompt.taherShare}
                    onChange={(e) => setMonthEndPrompt({ ...monthEndPrompt, taherShare: e.target.value })}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                  {monthEndPrompt.taherOldLeftover > 0 && (
                    <label className="flex items-center gap-2 mt-1.5 text-xs text-amber-700">
                      <input
                        type="checkbox"
                        checked={monthEndPrompt.taherMergeOld}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setMonthEndPrompt({
                            ...monthEndPrompt,
                            taherMergeOld: checked,
                            taherShare: String(monthEndPrompt.taherBaseShare + (checked ? monthEndPrompt.taherOldLeftover : 0)),
                          });
                        }}
                      />
                      Also owed KES {formatKES(monthEndPrompt.taherOldLeftover)} from before - add into this month too?
                    </label>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Abdulqadir's share ({monthEndPrompt.abdulRuleLabel})</label>
                  <input
                    type="number"
                    value={monthEndPrompt.abdulShare}
                    onChange={(e) => setMonthEndPrompt({ ...monthEndPrompt, abdulShare: e.target.value })}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                  {monthEndPrompt.abdulOldLeftover > 0 && (
                    <label className="flex items-center gap-2 mt-1.5 text-xs text-amber-700">
                      <input
                        type="checkbox"
                        checked={monthEndPrompt.abdulMergeOld}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setMonthEndPrompt({
                            ...monthEndPrompt,
                            abdulMergeOld: checked,
                            abdulShare: String(monthEndPrompt.abdulBaseShare + (checked ? monthEndPrompt.abdulOldLeftover : 0)),
                          });
                        }}
                      />
                      Also owed KES {formatKES(monthEndPrompt.abdulOldLeftover)} from before - add into this month too?
                    </label>
                  )}
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={handleConfirmMonthEndShare}
                  disabled={monthEndSaving}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white py-2 rounded-lg text-sm font-medium"
                >
                  {monthEndSaving ? 'Saving...' : 'Confirm'}
                </button>
                <button
                  onClick={() => { setMonthEndPrompt(null); setMonthEndDismissed(true); }}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-2 rounded-lg text-sm font-medium"
                >
                  Remind me later
                </button>
              </div>
            </div>
          </div>
        )}

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
                        ? sortSuppliersByBalance(suppliers).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)
                        : sortCustomersByBalance(customers).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
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
      <HelpChat />
    </div>
  );
}