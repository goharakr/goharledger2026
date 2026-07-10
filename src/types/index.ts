export type UserRole = 'admin' | 'manager' | 'staff';

export interface AppUser {
  id: string;
  username: string;
  role: UserRole;
  full_name: string | null;
  phone: string | null;
  is_active: boolean;
}

export type PaymentMode = 'mpesa' | 'cash' | 'paybill' | 'credit' | 'advance' | 'supplier' | 'split';

export type TransactionType =
  | 'sale'
  | 'expense'
  | 'fund_transfer'
  | 'partner_draw'
  | 'partner_loan'
  | 'customer_payment'
  | 'supplier_payment'
  | 'supplier_invoice'
  | 'capital_entry'
  | 'loan_payment'
  | 'opening_balance';

export type PartnerId = 'taher' | 'abdulqadir';

export interface Transaction {
  id: string;
  transaction_id: string;
  date: string;
  type: TransactionType;
  primary_mode: PaymentMode | null;
  settlement_mode: PaymentMode | null;
  amount: number;
  description: string | null;
  notes: string | null;
  partner_id: string | null;
  customer_id: string | null;
  supplier_id: string | null;
  loan_id: string | null;
  category: string | null;
  selling_price: number | null;
  cost_price: number | null;
  commission: number | null;
  commission_mode: string | null;
  due_date: string | null;
  clears_on: string | null;
  is_void: boolean;
  void_reason: string | null;
  is_unclassified: boolean;
  created_by: string | null;
  created_at: string;
  edited_at: string | null;
}

export interface TransactionSplit {
  id: string;
  transaction_id: string;
  mode: 'mpesa' | 'cash' | 'paybill';
  amount: number;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  credit_limit: number;
  credit_balance: number;
  advance_balance: number;
  notes: string | null;
  is_active: boolean;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  balance: number;
  notes: string | null;
  is_dual_party: boolean;
  is_active: boolean;
}

export interface LoanTracker {
  id: string;
  loan_name: string;
  loan_type: string;
  total_amount: number;
  remaining_balance: number;
  amount_paid: number;
  monthly_installment: number | null;
  start_date: string | null;
  status: 'active' | 'settled';
  notes: string | null;
}

export interface LoanPayment {
  id: string;
  loan_id: string;
  date: string;
  amount: number;
  mode: 'mpesa' | 'cash' | 'paybill' | null;
  notes: string | null;
}

export interface ShareRule {
  id: string;
  partner_id: PartnerId;
  rule_type: 'fixed' | 'percentage';
  value: number;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
}

export interface CapitalEntry {
  id: string;
  partner_id: PartnerId;
  entry_type: string;
  amount: number;
  date: string;
  description: string | null;
  status: string;
  created_by: string | null;
}

export interface HistoricalProfit {
  id: string;
  month: string;
  total_profit: number;
  taher_share: number | null;
  abdulqadir_share: number | null;
  taher_taken: number;
  abdulqadir_taken: number;
  retained: number | null;
  notes: string | null;
  created_by: string | null;
}

export interface BusinessProfile {
  id: string;
  business_name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  currency: string;
  fiscal_year_start: number;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
}

export interface LoanCategory {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
}

export interface Reminder {
  id: string;
  reminder_type: string;
  entity_id: string;
  entity_type: 'customer' | 'supplier';
  amount: number | null;
  due_date: string;
  reminder_date: string;
  reminder_time: string | null;
  status: 'pending' | 'completed' | 'dismissed';
  notes: string | null;
}

export interface DailySales {
  date: string;
  total_sales: number;
  total_cost: number;
  profit: number;
  count: number;
}

export interface MonthlyProfit {
  month: string;
  total_sales: number;
  total_cost: number;
  gross_profit: number;
  shop_expenses: number;
  home_expenses: number;
  net_profit: number;
  taher_share: number;
  abdulqadir_share: number;
  retained: number;
}
