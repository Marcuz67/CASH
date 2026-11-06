const { randomUUID } = require('node:crypto');

function starterProducts() {
  return [
    ['rice', 'White rice - 1 kg', 'Pantry', 50, 58, 45, 10, 5],
    ['milk', 'Fresh milk - 1 L', 'Drinks', 18, 89, 68, 5, 4],
    ['eggs', 'Eggs - per piece', 'Produce', 60, 10, 7, 12, 12],
    ['bread', 'Bread loaf', 'Bakery', 20, 55, 38, 5, 3],
    ['water', 'Bottled water - 500 ml', 'Drinks', 40, 20, 12, 10, 6],
    ['noodles', 'Instant noodles', 'Pantry', 36, 18, 12, 8, 6],
    ['coffee', 'Coffee sachet', 'Pantry', 48, 12, 8, 10, 10],
    ['soap', 'Dishwashing liquid - 250 ml', 'Household', 16, 55, 38, 4, 3],
  ].map(([id, name, category, stock, price, cost, threshold, saleLimit]) => ({
    id: `sample_${id}`, name, category, stock, price, cost, threshold, saleLimit, saleEnabled: true, sold: 0,
  }));
}

function emptyStore() {
  return { products: [], activity: [], profile: { owner: 'Shop owner', store: 'Your store', location: '' },
    weekByDay: Array(7).fill(0), weekProfitByDay: Array(7).fill(0), weekUnits: 0,
    lifetimeGrossProfit: 0, profitGoals: { redBelow: 2000, goodFrom: 3000 }, lastProfitCheck: null };
}

async function initializeCatalog(store) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const data = await store.read();
    if (data.state?.starterCatalogVersion) return;
    const next = structuredClone(data.state || emptyStore());
    // Only seed an empty, unused shop; retain existing products and all recorded sales.
    if (!next.products.length && !next.activity.length) {
      next.products = starterProducts(); next.sampleCatalog = true;
    }
    next.starterCatalogVersion = 1;
    if (await store.save(next, data.revision) !== null) return;
  }
  throw new Error('Could not initialize the catalog after concurrent updates.');
}

const saleLimit = product => product.saleLimit ?? 5;
function publicCatalog(data) {
  const state = data.state || emptyStore();
  return { revision: data.revision, state: {
    profile: { store: state.profile.store, location: state.profile.location, ...(state.profile.photo ? { photo: state.profile.photo } : {}) },
    sampleCatalog: state.sampleCatalog === true,
    products: state.products.filter(product => product.saleEnabled !== false).map(product => ({
      id: product.id, name: product.name, category: product.category, stock: product.stock, price: product.price,
      saleEnabled: true, saleLimit: saleLimit(product), ...(product.photo ? { photo: product.photo } : {}),
    })),
  } };
}

function recordPurchase(data, request) {
  if (!request || !Number.isSafeInteger(request.revision) || typeof request.productId !== 'string'
    || !Number.isSafeInteger(request.quantity) || request.quantity < 1) {
    return { status: 400, error: 'Choose a product and a positive whole-number quantity.' };
  }
  if (request.revision !== data.revision) return { status: 409, error: 'The store changed. Review current stock and prices, then try again.' };
  const next = structuredClone(data.state);
  const product = next?.products.find(item => item.id === request.productId);
  if (!product || product.saleEnabled === false) return { status: 400, error: 'This product is not available for sale.' };
  if (request.quantity > saleLimit(product)) return { status: 400, error: `This item is limited to ${saleLimit(product)} per purchase.` };
  if (request.quantity > product.stock) return { status: 400, error: 'The requested quantity exceeds available stock.' };
  const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
  const sale = { id: `R${randomUUID().replace(/-/g, '')}`, productId: product.id, name: product.name,
    qty: request.quantity, date: Date.now(), unitPrice: product.price, unitCost: product.cost,
    revenue: round(request.quantity * product.price), grossProfit: round(request.quantity * (product.price - product.cost)) };
  product.stock -= request.quantity; product.sold += request.quantity;
  next.activity.unshift(sale);
  const weekday = (new Date(sale.date).getDay() + 6) % 7;
  next.weekByDay[weekday] += sale.revenue; next.weekProfitByDay[weekday] += sale.grossProfit;
  next.weekUnits += request.quantity; next.lifetimeGrossProfit = round(next.lifetimeGrossProfit + sale.grossProfit);
  const { unitCost, grossProfit, ...receipt } = sale;
  return { state: next, receipt };
}

module.exports = { initializeCatalog, publicCatalog, recordPurchase };
