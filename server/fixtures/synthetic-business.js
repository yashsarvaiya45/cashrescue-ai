// Fictional Pune stationery wholesaler. Amounts are integer paise.
export const business = {
  id: 'demo-business',
  name: 'Copper Kite Stationery',
  currency: 'INR',
  forecastStartDate: '2026-11-13',
  openingBalancePaise: 2_500_000,
};

export const invoices = [
  {
    id: 'invoice-paper',
    businessId: business.id,
    invoiceNumber: 'CK-026',
    customerName: 'Blue Banyan Learning',
    issueDate: '2026-11-02',
    dueDate: '2026-11-21',
    amountPaise: 3_000_000,
    outstandingBalancePaise: 3_000_000,
    status: 'open',
  },
  {
    id: 'invoice-kits',
    businessId: business.id,
    invoiceNumber: 'CK-027',
    customerName: 'Cedar Loom Studio',
    issueDate: '2026-11-06',
    dueDate: '2026-11-26',
    expectedCollectionDate: '2026-11-28',
    amountPaise: 1_850_050,
    outstandingBalancePaise: 1_850_050,
    status: 'open',
  },
];

export const expenses = [
  {
    id: 'expense-payroll',
    businessId: business.id,
    label: 'Workshop wages',
    category: 'payroll',
    dueDate: '2026-11-17',
    amountPaise: 4_500_000,
    status: 'scheduled',
  },
  {
    id: 'expense-freight',
    businessId: business.id,
    label: 'Local deliveries',
    category: 'logistics',
    dueDate: '2026-11-25',
    amountPaise: 425_025,
    status: 'scheduled',
  },
  {
    id: 'expense-rent',
    businessId: business.id,
    label: 'Workshop rent',
    category: 'rent',
    dueDate: '2026-12-01',
    amountPaise: 1_200_000,
    status: 'scheduled',
  },
];

export const forecastInput = {
  forecastStartDate: business.forecastStartDate,
  openingBalancePaise: business.openingBalancePaise,
  receivables: invoices.map(({ businessId, invoiceNumber, customerName, ...record }) => record),
  expenses: expenses.map(({ businessId, label, category, ...record }) => record),
};

export const expectedForecast = {
  firstNegativeBalanceDate: '2026-11-17',
  nextReceiptDateAfterFirstShortfall: '2026-11-21',
  negativeDayCount: 4,
  maximumShortfallPaise: 2_000_000,
  minimumCashBalancePaise: -2_000_000,
  forecastEndDate: '2026-12-12',
  // Change points for the closing curve, reconciled by hand in README.md.
  closingBalanceChanges: [
    ['2026-11-13', 2_500_000],
    ['2026-11-17', -2_000_000],
    ['2026-11-21', 1_000_000],
    ['2026-11-25', 574_975],
    ['2026-11-28', 2_425_025],
    ['2026-12-01', 1_225_025],
  ],
};
