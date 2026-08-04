// The Help Chat's whole knowledge base - one written, correct answer per
// real thing this app does, instead of a live AI guessing at an app it
// can't see. Answers are plain text; a blank line inside one starts a new
// paragraph, and lines starting with "- " render as a bullet.

export interface HelpEntry {
  id: string;
  category: string;
  question: string;
  keywords: string[];
  answer: string;
}

export const HELP_CONTENT: HelpEntry[] = [
  // ---------------- Getting started ----------------
  {
    id: 'login',
    category: 'Getting Started',
    question: 'How do I log in?',
    keywords: ['login', 'log in', 'sign in', 'password'],
    answer: 'Enter your username and password on the login screen. If it\'s the first time this account has used the new login system, the app will ask you to choose a new password before it lets you in - just follow the on-screen steps once.',
  },
  {
    id: 'forgot-password',
    category: 'Getting Started',
    question: 'I forgot my password - what do I do?',
    keywords: ['forgot password', 'reset password', 'cant login', "can't log in"],
    answer: 'Click "Forgot password?" on the login screen and pick your name (Taher or Abdulqadir). A reset link is emailed to you.\n\nThis only works if recovery email was turned on for your account first. If you see a message saying it isn\'t set up, ask the other partner to log in and turn it on for you from Settings > User Management.',
  },
  {
    id: 'change-password',
    category: 'Getting Started',
    question: 'How do I change my username or password?',
    keywords: ['change password', 'change username', 'my account', 'credentials'],
    answer: 'Go to Settings > User Management. Type your new username and/or password there and save. You can also turn on "Recovery Email" there so you can reset your own password later without needing the other partner.',
  },
  {
    id: 'keyboard-nav',
    category: 'Getting Started',
    question: 'Is there a faster way to fill in forms than clicking each box?',
    keywords: ['keyboard', 'arrow keys', 'enter key', 'shortcut', 'tab between fields'],
    answer: 'Yes - on almost every Add/Edit form, press the Down or Right arrow (or Enter) to jump to the next box, and Up or Left to go back. Pressing Enter on the very last box saves the form (or adds a new row in Bulk Entry) instead of doing nothing.',
  },
  {
    id: 'reminders',
    category: 'Getting Started',
    question: 'How do reminders work?',
    keywords: ['reminder', 'alarm', 'bell icon', 'notification', 'due date'],
    answer: 'Click the bell icon at the top of any page to set a reminder for a supplier payment or a customer collection - pick who it\'s for, the amount, the due date, and when you want to be reminded.\n\nThe app checks every minute and shows a browser notification (plus a sound) when a reminder is due. Your browser will ask permission to show notifications the first time - you need to allow this for reminders to actually alert you. You can turn supplier/customer reminders on or off separately in Settings > Notifications.',
  },
  {
    id: 'unclassified',
    category: 'Getting Started',
    question: 'What does "unclassified" mean on an entry?',
    keywords: ['unclassified', 'needs review', 'flag'],
    answer: 'It\'s a flag you (or Smart Entry) can put on a sale or expense to mean "this needs a second look later" - e.g. you weren\'t sure of the cost price yet, or Smart Entry couldn\'t confidently match a name. It doesn\'t change any numbers - it\'s just a marker so you can find and review it later instead of forgetting.',
  },
  {
    id: 'post-dated-cheque',
    category: 'Getting Started',
    question: 'What is a post-dated cheque / "clears on" date?',
    keywords: ['post dated', 'postdated', 'cheque', 'clears on', 'paybill delay'],
    answer: 'When paying by Paybill, you can tick "Post-dated cheque" and give a date it actually clears the bank. Until that date arrives, the app does not subtract it from your Bank balance yet - it only counts once the "clears on" date is reached, so your balance matches reality instead of showing money as gone before it actually left.',
  },
  {
    id: 'dual-badge',
    category: 'Getting Started',
    question: 'What does the "Dual" badge mean on a supplier/customer?',
    keywords: ['dual badge', 'dual party'],
    answer: 'It\'s just a label you can tick when adding/editing a supplier or customer to mark "this same person/business is both a supplier and a customer to us" - purely informational, for your own reference when scanning the list. It doesn\'t link their two records together on its own - for that, see "Belongs to partner" (ask about linking a supplier/customer to a partner).',
  },

  // ---------------- Sales ----------------
  {
    id: 'sale-cash-mpesa-paybill',
    category: 'Sales',
    question: 'How do I add a Cash, Mpesa or Paybill sale?',
    keywords: ['add sale', 'cash sale', 'mpesa sale', 'paybill sale', 'new sale'],
    answer: 'Sales page > Add Sale. Pick the Mode (Cash/Mpesa/Paybill), enter the Selling Price and Cost Price (Profit fills in automatically from those two). Save.\n\nExample: sold an item for KES 5,000 that cost you KES 3,500, paid in Mpesa - Mode: Mpesa, SP: 5000, CP: 3500. Profit shows KES 1,500 automatically.',
  },
  {
    id: 'sale-credit',
    category: 'Sales',
    question: 'How do I add a Credit sale (customer pays later)?',
    keywords: ['credit sale', 'sale on credit', 'customer owes'],
    answer: 'Sales page > Add Sale. Mode: Credit. Pick the Customer (or click the "+" next to the dropdown to add a new one on the spot). This adds the full Selling Price to that customer\'s balance owed - no cash moves yet.\n\nExample: sold KES 10,000 of goods to a regular customer on credit - Mode: Credit, pick their name, SP: 10000. Their "owes you" balance goes up by 10,000. Later, collect it from the Customers page.',
  },
  {
    id: 'sale-advance',
    category: 'Sales',
    question: 'How do I add an Advance sale (customer already has money on file)?',
    keywords: ['advance sale', 'customer advance', 'prepaid customer'],
    answer: 'This is for a customer who already deposited money ahead of time (see "customer advance"). Sales page > Add Sale, Mode: Advance, pick the customer, pick which wallet the original advance came from (Cash/Mpesa/Paybill). The sale amount is deducted from their advance balance instead of asking for new cash.',
  },
  {
    id: 'sale-split',
    category: 'Sales',
    question: 'How do I add a Split sale (paid partly Cash, partly Mpesa, etc)?',
    keywords: ['split sale', 'split payment', 'part cash part mpesa'],
    answer: 'Sales page > Add Sale, Mode: Split. Three boxes appear (Mpesa/Cash/Paybill) - type how much came through each. The Selling Price fills in automatically as you type, as the total of the three.\n\nExample: sold for 8,000, customer paid 5,000 Mpesa and 3,000 Cash - Mode: Split, Mpesa: 5000, Cash: 3000. SP shows 8,000 automatically.',
  },
  {
    id: 'sale-supplier-mode',
    category: 'Sales',
    question: 'What does Mode: Supplier mean on a sale, and when do I use it?',
    keywords: ['supplier mode sale', 'sale to supplier'],
    answer: 'This is a special, rarely-needed case: the sale itself reduces what the shop owes that supplier, instead of collecting cash or crediting a customer. Most day-to-day sales should NOT use this - use Cash/Mpesa/Paybill/Credit/Advance/Split for a normal sale to a normal customer. Only use Supplier mode if you specifically mean "this sale settles directly against a supplier\'s balance."',
  },
  {
    id: 'sale-pay-cost-to-supplier',
    category: 'Sales',
    question: 'What does "Pay cost price to a supplier now" mean on the Add Sale form?',
    keywords: ['pay cost to supplier', 'cost price supplier'],
    answer: 'This is separate from the top Mode dropdown. Tick it when you want to immediately pay (or record) part of this sale\'s Cost Price to the supplier who provided the stock - pick the supplier and how much of the cost goes to them. Whatever part of the Cost Price you don\'t assign to a supplier is understood as stock the shop already owned.',
  },
  {
    id: 'sale-bulk-entry',
    category: 'Sales',
    question: 'How do I use Bulk Entry on the Sales page?',
    keywords: ['bulk entry sales', 'add many sales'],
    answer: 'Sales page > Bulk Entry opens 10 blank rows so you can enter several sales in one sitting without opening a popup each time. Fill in whichever rows you need (blank rows are ignored) and click Save All at the bottom.',
  },
  {
    id: 'sale-smart-entry',
    category: 'Sales',
    question: 'How do I use Smart Entry to paste a sales sheet?',
    keywords: ['smart entry sales', 'paste sales sheet', 'import sales'],
    answer: 'Sales page > Smart Entry. Paste rows copied from a sheet (date, amount, mode, customer name etc) - it tries to read each row and match names to existing customers. Review the preview list it builds (it flags anything unsure with a note), fix anything wrong, then send them to Bulk Entry to actually save.',
  },
  {
    id: 'sale-refund',
    category: 'Sales',
    question: 'How do I refund a sale?',
    keywords: ['refund sale', 'return sale', 'reverse sale'],
    answer: 'Find the sale in the Sales list and use the Refund action on it. It records a negative-amount entry linked back to the original sale and reverses whatever balance that sale affected (cash/wallet, or the customer\'s/supplier\'s balance) - no cash actually changes hands twice for a credit/advance sale, it just cancels out the original transaction.',
  },
  {
    id: 'sale-edit-void',
    category: 'Sales',
    question: 'How do I edit or void a sale?',
    keywords: ['edit sale', 'void sale', 'delete sale', 'wrong sale'],
    answer: 'Every sale row has Edit (pencil) and Void (bin) buttons. Edit opens the full form again with every field editable - correcting it automatically adjusts whatever balance/wallet it had affected. Void cancels it entirely and reverses those effects, keeping the record (marked void) instead of deleting it, so nothing disappears from history.',
  },

  // ---------------- Expenses ----------------
  {
    id: 'expense-shop',
    category: 'Expenses',
    question: 'How do I add a Shop Expense?',
    keywords: ['shop expense', 'add expense', 'business expense'],
    answer: 'Expenses page > Shop Expenses tab > Add Expense. Pick a Category (Rent, Transport, etc), enter the amount and mode, save.\n\nExample: paid KES 1,500 for fuel in cash - Category: transport (or whatever you\'ve named it), Amount: 1500, Mode: Cash.',
  },
  {
    id: 'expense-categories',
    category: 'Expenses',
    question: 'How do I add or manage expense categories?',
    keywords: ['expense categories', 'add category', 'manage categories'],
    answer: 'Expenses page > Shop Expenses tab > Categories button. Type a new category name and save, or remove one you no longer use. This only affects the Shop Expenses tab\'s own category list.',
  },
  {
    id: 'expense-home',
    category: 'Expenses',
    question: 'How do I add a Home Expense, and what\'s "From Shop" vs "Own Pocket"?',
    keywords: ['home expense', 'from shop', 'own pocket'],
    answer: 'Expenses page > Home Expenses tab > Add Home Expense. Pick which Partner it\'s for, and:\n- "From Shop": the shop\'s own cash is paying this home expense right now (real money leaves a wallet immediately).\n- "Own Pocket": the partner paid it out of their own money, not the shop\'s - it does not touch any wallet, but it adds to what the shop owes that partner back (see "Home Expenses Owed").',
  },
  {
    id: 'expense-partner-draw',
    category: 'Expenses',
    question: 'How do I record a Partner Draw from the Expenses page?',
    keywords: ['partner draw expenses', 'partner take money'],
    answer: 'Expenses page > Partners tab > Add Partner Draw. Pick the partner and amount. This is the same as recording a draw from the Partners page - it reduces what that partner is still owed in profit share.',
  },
  {
    id: 'expense-supplier-payment',
    category: 'Expenses',
    question: 'How do I pay a supplier from the Expenses page?',
    keywords: ['supplier payment expenses', 'pay supplier from expenses'],
    answer: 'Expenses page > Supplier Payments tab > Add Supplier Payment. Pick the supplier and amount - it reduces what the shop owes them, same as paying from the Suppliers page directly. Use Bulk Payments on this tab to pay several suppliers in one sitting.',
  },
  {
    id: 'expense-loan-payment',
    category: 'Expenses',
    question: 'How do I make a loan payment from the Expenses page?',
    keywords: ['loan payment expenses', 'pay off loan'],
    answer: 'Expenses page > Loans tab > Add Loan Payment. Pick which loan (from Capital & History) it\'s paying down and the amount - it reduces that loan\'s remaining balance.',
  },
  {
    id: 'expense-employee-salary',
    category: 'Expenses',
    question: 'How do I pay an employee\'s salary from the Expenses page?',
    keywords: ['pay salary expenses', 'employee salary from expenses'],
    answer: 'Expenses page > Employees tab > Pay Salary. Pick the employee, choose Weekly/Monthly/Custom days to auto-fill the amount from their usual rate (you can still overwrite it), add Commission if any, deduct against a Loan/Advance if they have one outstanding, save. Use Bulk Pay Salaries on the same tab to pay everyone in one sitting - see the Employees questions for the full breakdown.',
  },
  {
    id: 'expense-smart-entry',
    category: 'Expenses',
    question: 'How do I use Smart Entry for expenses?',
    keywords: ['smart entry expenses', 'paste expense sheet'],
    answer: 'Expenses page > Smart Entry (top of Shop/Home/Suppliers tabs). Paste rows from a monthly expense sheet, pick which month it\'s for, and review the parsed rows. Nothing saves until you send each group to its own tab\'s Bulk Entry and press Save All there.',
  },

  // ---------------- Cash & Bank ----------------
  {
    id: 'fund-transfer',
    category: 'Cash & Bank',
    question: 'How do I transfer money between Cash, Mpesa and Paybill?',
    keywords: ['fund transfer', 'move money between wallets', 'transfer cash to mpesa'],
    answer: 'Cash & Bank page > Transfer button. Pick which wallet it\'s coming From and which it\'s going To, and the amount. This doesn\'t change your total money - it only moves it between the two wallet totals.\n\nExample: withdrew KES 20,000 from Mpesa to keep as physical cash - From: Mpesa, To: Cash, Amount: 20000.',
  },
  {
    id: 'wallet-balances',
    category: 'Cash & Bank',
    question: 'What do Cash in Hand, Mpesa and Paybill balance mean?',
    keywords: ['cash in hand', 'mpesa balance', 'paybill balance', 'wallet balance'],
    answer: 'These are your three "wallets" - real running totals built from every sale, expense, payment, salary, loan, and transfer that used that mode, going all the way back. They\'re calculated live from your entries, not typed in by hand, so they should always match reality if every real cash movement has been recorded with the right mode.',
  },
  {
    id: 'physical-cash-count',
    category: 'Cash & Bank',
    question: 'What is a physical cash count / reconciliation?',
    keywords: ['physical cash count', 'reconcile cash', 'cash reconciliation'],
    answer: 'It\'s where you type in what you actually counted (physically, or from your real Mpesa/bank app) for each wallet, and the app shows you the difference against what it calculated from your entries - the Cash Reconciliation report on the Reports page shows this history. A gap usually means either a real entry is missing/duplicated, or a wrong mode was picked on some entry.',
  },

  // ---------------- Partners ----------------
  {
    id: 'partner-draw',
    category: 'Partners',
    question: 'How do I record a Partner Draw (partner takes money from the shop)?',
    keywords: ['partner draw', 'partner takes money', 'withdraw profit'],
    answer: 'Partners page > pick the partner\'s tab > Draw button. Enter amount and mode - this counts against their Share Due (profit not yet taken), reducing how much is still owed to them.',
  },
  {
    id: 'partner-loan',
    category: 'Partners',
    question: 'How do I record a partner returning/repaying money to the shop?',
    keywords: ['partner loan', 'partner returns money', 'partner repay'],
    answer: 'Partners page > pick the partner\'s tab > Return button. This is money going the other way - the partner is putting money back into the shop (e.g. repaying an earlier draw). It increases what the shop has, the opposite of a Draw.',
  },
  {
    id: 'partner-mark-taken',
    category: 'Partners',
    question: 'What does "Mark Taken" do on the Partners page?',
    keywords: ['mark taken', 'mark share taken'],
    answer: 'It\'s a quick way to record that a partner took (or was given) a specific chunk of their Share Due, without filling in a full Draw form each time - useful when reconciling a batch of old profit-share history.',
  },
  {
    id: 'home-expenses-owed',
    category: 'Partners',
    question: 'What is "Home Expenses Owed"?',
    keywords: ['home expenses owed', 'shop owes partner home expense'],
    answer: 'It\'s how much the shop still owes a partner back for home expenses they paid "From Own Pocket" (real money out of their own wallet, not the shop\'s), minus whatever the shop has already repaid them for it. It\'s one of the sources you can use to settle a linked party\'s balance instead of real cash (see "linking a supplier/customer to a partner").',
  },
  {
    id: 'share-due',
    category: 'Partners',
    question: 'What is "Share Due"?',
    keywords: ['share due', 'profit not taken', 'profit share'],
    answer: 'It\'s how much profit a partner has earned so far (based on their Share Rule) but hasn\'t taken out yet - live months\' earnings plus any Historical Profit carried over, minus everything they\'ve already drawn. This is different from "Shop Owes Partner" on the Capital page, which doesn\'t include the current month\'s still-open earnings.',
  },
  {
    id: 'share-rules',
    category: 'Partners',
    question: 'How do I change the profit split rule between Taher and Abdulqadir?',
    keywords: ['share rules', 'change profit split', 'percentage split'],
    answer: 'Edit it from either the Profit & Loss page (Edit Rules button) or the Partners page (Edit Rule link next to Share Due) - both save to the same setting, so it doesn\'t matter which one you use. Choose Fixed Amount (a flat number each month) or Percentage for each partner.',
  },

  // ---------------- Profit & Loss ----------------
  {
    id: 'profit-loss-waterfall',
    category: 'Profit & Loss',
    question: 'How do I read the Profit & Loss waterfall?',
    keywords: ['profit and loss', 'waterfall', 'net profit'],
    answer: 'It starts at Total Sales, then subtracts Cost of Goods, Commissions, Shop Expenses, Salaries, Home Expenses (from Shop), and Loan Repayments step by step down to Net Profit, then splits that into each partner\'s share and Retained Earnings. Each line shows exactly what it took away from the line above it.',
  },
  {
    id: 'profit-loss-month',
    category: 'Profit & Loss',
    question: 'How do I see a different month on Profit & Loss?',
    keywords: ['change month profit loss', 'select month'],
    answer: 'Use the Month dropdown at the top of the Profit & Loss page - it recalculates the whole waterfall for whichever month you pick.',
  },

  // ---------------- Customers ----------------
  {
    id: 'customer-add',
    category: 'Customers',
    question: 'How do I add a Customer?',
    keywords: ['add customer', 'new customer'],
    answer: 'Customers page > Add Customer. Name is required; phone, credit limit, opening balance, and notes are optional. Save.',
  },
  {
    id: 'customer-collect-payment',
    category: 'Customers',
    question: 'How do I collect a payment from a customer?',
    keywords: ['collect payment', 'customer pays', 'record customer payment'],
    answer: 'Customers page > pick the customer > Collect Payment. Enter the amount and mode - it reduces what they owe you (their credit balance).',
  },
  {
    id: 'customer-advance',
    category: 'Customers',
    question: 'How do I add a customer advance (they paid ahead of time)?',
    keywords: ['customer advance', 'add advance', 'prepaid'],
    answer: 'Customers page > pick the customer > Collect Payment, then switch the type to "Add Advance". This adds to their advance balance instead of reducing a credit balance - later, an Advance-mode sale spends it down.',
  },
  {
    id: 'customer-edit-void',
    category: 'Customers',
    question: 'How do I edit or void a customer transaction?',
    keywords: ['edit customer payment', 'void customer payment', 'delete customer entry'],
    answer: 'Every row in a customer\'s Transaction History has Edit and Void buttons - Edit lets you correct date/amount/mode/notes (it keeps their balance in sync automatically), Void cancels it and reverses the balance change, keeping the record marked void rather than deleting it.',
  },
  {
    id: 'linking-partner',
    category: 'Customers',
    question: 'What does linking a customer/supplier to a partner do, and what is netting?',
    keywords: ['linked partner', 'belongs to partner', 'netting', 'settlement'],
    answer: 'If a real-world party (like a partner\'s own separate shop) trades with you as BOTH a supplier and a customer, you can mark their record as "belongs to" that partner. This unlocks paying/collecting their balance using what the shop owes that partner (Home Expenses Owed, Profit Share) instead of only real cash, and lets their supplier balance and customer balance be netted against each other directly - a one-click "Apply Net" banner shows up automatically whenever both sides owe something. You\'ll get a confirm prompt when linking, since it\'s easy to do by accident and has real effects.',
  },

  // ---------------- Suppliers ----------------
  {
    id: 'supplier-add',
    category: 'Suppliers',
    question: 'How do I add a Supplier?',
    keywords: ['add supplier', 'new supplier'],
    answer: 'Suppliers page > Add Supplier. Name is required; phone, opening balance, "Dual" flag, and notes are optional. Save.',
  },
  {
    id: 'supplier-invoice',
    category: 'Suppliers',
    question: 'How do I add an Invoice from a supplier?',
    keywords: ['supplier invoice', 'add invoice', 'stock received'],
    answer: 'Suppliers page > pick the supplier > Add Invoice. Enter the amount owed and due date - it adds to what the shop owes that supplier. You can also set a reminder for the due date right there.',
  },
  {
    id: 'supplier-pay',
    category: 'Suppliers',
    question: 'How do I pay a Supplier?',
    keywords: ['pay supplier', 'supplier payment'],
    answer: 'Suppliers page > pick the supplier > Pay Supplier. Enter the amount and mode - it reduces what the shop owes them. Use Bulk Payments to pay several suppliers in one sitting.',
  },

  // ---------------- Employees ----------------
  {
    id: 'employee-add',
    category: 'Employees',
    question: 'How do I add an Employee?',
    keywords: ['add employee', 'new employee', 'staff'],
    answer: 'Employees page > Add Employee. Fill in Name, Phone (optional), Weekly Salary, Monthly Salary, Notes. Both salary figures are just reference amounts the Pay Salary form auto-fills from - the real amount paid each time is always typed/overwritable.',
  },
  {
    id: 'employee-pay-salary',
    category: 'Employees',
    question: 'How do I pay an employee\'s salary?',
    keywords: ['pay salary', 'employee salary'],
    answer: 'Employees page > pick the employee > Pay Salary. Choose Week/Month/Custom days (amount auto-fills from their rate, still editable). Add Commission if any - it adds to the total. If they have an active Loan or Advance, a deduction box shows their remaining balance and subtracts whatever you type from the total. Days worked and Notes are optional. The running Total to pay updates live as you fill in each box.\n\nExample: weekly pay 5,000, commission 500, loan deduction 200 - Total to pay shows 5,300.',
  },
  {
    id: 'employee-bulk-salary',
    category: 'Employees',
    question: 'How do I use Bulk Pay Salaries?',
    keywords: ['bulk pay salaries', 'pay all employees'],
    answer: 'Employees page (or Expenses > Employees tab) > Bulk Pay Salaries. It lists every active employee as its own row, pre-filled with their weekly rate - fill in whichever ones you\'re paying today (leave the rest blank, they\'re skipped) and click Save All. A combined grand total for everyone shows at the bottom before you save.',
  },
  {
    id: 'employee-loan',
    category: 'Employees',
    question: 'How do I give an employee a loan?',
    keywords: ['employee loan', 'give loan', 'staff loan'],
    answer: 'Employees page > pick the employee > Add Loan. Enter amount, date, mode, and an optional reason. It shows up in their Loan history with a running remaining balance that goes down each time you deduct against it during a salary payment.',
  },
  {
    id: 'employee-advance',
    category: 'Employees',
    question: 'How do I give an employee an advance?',
    keywords: ['employee advance', 'give advance', 'staff advance'],
    answer: 'Employees page > pick the employee > Give Advance. Same idea as a loan, tracked completely separately in its own Advance history - deduct it back later during a salary payment.\n\nEven if there\'s no advance on record yet, you can still type an amount straight into the Advance deduction box on the Salary form - it records a same-day "given and settled" entry automatically, so a small one-off advance doesn\'t need two separate steps.',
  },
  {
    id: 'employee-old-loan-no-wallet',
    category: 'Employees',
    question: 'How do I record a loan/advance that already happened, without it affecting today\'s wallet?',
    keywords: ['old loan', 'historical loan', 'dont deduct wallet', "don't deduct from wallet"],
    answer: 'When adding the Loan or Advance, tick "This already happened before - don\'t deduct from wallet balance." The cash already left back when it really happened, so recording it now (for the history/remaining-balance tracking) won\'t subtract it from Cash/Mpesa/Paybill a second time.',
  },
  {
    id: 'employee-loan-advance-history',
    category: 'Employees',
    question: 'How do I see an employee\'s full loan/advance history?',
    keywords: ['employee loan history', 'employee advance history', 'remaining balance'],
    answer: 'Open the employee on the Employees page - the Loans section and Advances section each list every one given, how much has been deducted so far, and what\'s still remaining, kept completely separate from each other. The Employees tab on the Reports page shows the same detail across ALL employees at once, with date and type filters.',
  },

  // ---------------- Capital & History ----------------
  {
    id: 'capital-entry',
    category: 'Capital & History',
    question: 'How do I add a Capital Entry?',
    keywords: ['capital entry', 'add capital'],
    answer: 'Capital & History page > Add Capital Entry. Pick the partner, entry type, amount, date, and mode. Tick "No real cash" for things like Retained Profit that aren\'t actual new money coming in - that keeps it out of the wallet totals while still recording it as capital.',
  },
  {
    id: 'capital-loan',
    category: 'Capital & History',
    question: 'How do I add a business loan and record payments on it?',
    keywords: ['business loan', 'add loan', 'loan tracker'],
    answer: 'Capital & History page > Add New Loan for the shop\'s own borrowed money (name, total amount, already paid, monthly installment, start date). Then use Loan Payment to record each repayment - it reduces the loan\'s remaining balance and shows progress as a percentage.',
  },
  {
    id: 'historical-profit',
    category: 'Capital & History',
    question: 'What is Historical Profit and when do I use it?',
    keywords: ['historical profit', 'old records', 'past profit'],
    answer: 'It\'s for entering profit figures from BEFORE you started using this app (e.g. 2024/2025 figures from paper records) - one row per month, with total profit, each partner\'s share, and how much of that share they already took. This lets Share Due carry the right starting point forward instead of assuming everything started at zero the day you began using the app.\n\nDon\'t enter a Historical Profit row for a month that also has live entries in the app for that same month - that would count the same profit twice. The Partners page flags any month it finds double-counted like that.',
  },

  // ---------------- Reports ----------------
  {
    id: 'reports-overview',
    category: 'Reports',
    question: 'What reports are available and what do they show?',
    keywords: ['reports', 'what reports', 'list of reports'],
    answer: 'The Reports page has a tab for each: Sales, Expenses, Home Expenses, Partners, Suppliers, Customers, Loans, Employees, Cash Reconciliation, and Monthly Profit Summary. Each one has its own date filter and lets you export to CSV, Excel, or PDF, or print it directly.',
  },

  // ---------------- Settings ----------------
  {
    id: 'settings-business-profile',
    category: 'Settings',
    question: 'What is Business Profile in Settings?',
    keywords: ['business profile', 'business name', 'business details'],
    answer: 'Settings > Business Profile - your business name, address, phone, email, currency, and fiscal year start. This is mostly used to label exports/reports.',
  },
  {
    id: 'settings-opening-balances',
    category: 'Settings',
    question: 'What is Opening Balances in Settings?',
    keywords: ['opening balances', 'starting balance'],
    answer: 'Settings > Opening Balances - where you set the very first balances (Cash/Mpesa/Paybill, or a customer\'s/supplier\'s starting balance) from before you began using the app, so everything after that point builds on the correct starting point.',
  },
  {
    id: 'settings-notifications',
    category: 'Settings',
    question: 'What is Notifications in Settings?',
    keywords: ['notifications settings', 'turn off alerts'],
    answer: 'Settings > Notifications - turn supplier-payment and customer-collection reminder alerts on or off. This controls whether the reminders you set with the bell icon actually notify you.',
  },
  {
    id: 'settings-export',
    category: 'Settings',
    question: 'What is Data & Backup in Settings?',
    keywords: ['data backup', 'export data', 'download backup'],
    answer: 'Settings > Data & Backup - export your data for safekeeping or to move it elsewhere.',
  },
  {
    id: 'settings-danger-zone',
    category: 'Settings',
    question: 'What is the Danger Zone in Settings?',
    keywords: ['danger zone', 'delete everything', 'reset app'],
    answer: 'Settings > Danger Zone holds destructive, hard-to-undo actions. Only go in here if you fully understand what a specific button does - when in doubt, ask before clicking anything in this section.',
  },

  // ---------------- Ledger & general ----------------
  {
    id: 'view-ledger',
    category: 'Ledger',
    question: 'How do I use View Ledger and its filters?',
    keywords: ['view ledger', 'ledger filters', 'transaction history'],
    answer: 'Most pages have a "View Ledger" button that opens every transaction of the relevant type(s) in one table. Filter by date (Today/Yesterday/1 Week/This Month/Last Month/Pick Month/Custom/All Time), by Type, and by Category. Export the filtered list to CSV from there too.',
  },
  {
    id: 'edit-vs-void',
    category: 'Ledger',
    question: 'What\'s the difference between Edit and Void?',
    keywords: ['edit vs void', 'difference edit void'],
    answer: 'Edit changes an existing entry\'s details (date, amount, mode, notes, etc) and automatically keeps any balance/wallet it affects in sync with the new numbers. Void cancels an entry entirely and reverses whatever it affected, but keeps the record (marked void) instead of deleting it, so there\'s always a trail of what happened and when it was cancelled.\n\nA payment that was split across cash and a settlement source (Home Expenses/Profit Share/a linked party\'s balance) can\'t have its amount edited directly in View Ledger - void it and re-enter it instead, since changing that number would need to un-decide which source paid for what.',
  },
];

export const HELP_CATEGORIES: string[] = Array.from(new Set(HELP_CONTENT.map((e) => e.category)));

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Not a real NLP search - just substring/word-overlap scoring against each
// entry's question+category+keywords. Good enough for "how do i add a sale"
// to find the sale entry without needing an exact phrase match, without
// needing a live AI (and its cost/hallucination risk) to answer a fixed set
// of already-known questions.
export interface ScoredHelpEntry {
  entry: HelpEntry;
  score: number;
}

export function searchHelp(query: string, limit = 5): ScoredHelpEntry[] {
  const q = normalize(query);
  if (!q) return [];
  const qWords = q.split(' ').filter((w) => w.length > 1);
  if (qWords.length === 0) return [];

  const scored = HELP_CONTENT.map((entry) => {
    const haystack = normalize([entry.question, entry.category, ...entry.keywords].join(' '));
    let score = 0;
    if (haystack.includes(q)) score += 10;
    qWords.forEach((w) => {
      if (haystack.includes(w)) score += 1;
    });
    return { entry, score };
  }).filter((s) => s.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
