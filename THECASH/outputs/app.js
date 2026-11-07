/* C.A.S.H. interface. The existing /api/shop API remains the source of truth. */
'use strict';
const $ = (id) => document.getElementById(id);
function setPasswordVisibility(input, button, visible) {
  input.type = visible ? 'text' : 'password';
  const label = `${visible ? 'Hide' : 'Show'} ${input.name === 'setupToken' ? 'setup key' : input.name === 'confirmPassword' ? 'confirm password' : 'password'}`;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', String(visible));
  button.title = label;
  button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>${visible ? '<path d="m3 3 18 18"/>' : ''}</svg>`;
}
function resetPasswordVisibility(form) {
  form?.querySelectorAll('.password-toggle').forEach(button => setPasswordVisibility($(button.getAttribute('aria-controls')), button, false));
}
document.querySelectorAll('input[type="password"]').forEach(input => {
  const wrapper = document.createElement('span');
  wrapper.className = 'password-field';
  input.before(wrapper);
  wrapper.append(input);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'password-toggle';
  button.setAttribute('aria-controls', input.id);
  setPasswordVisibility(input, button, false);
  button.addEventListener('click', () => setPasswordVisibility(input, button, input.type === 'password'));
  wrapper.append(button);
});
document.querySelectorAll('form').forEach(form => form.addEventListener('reset', () => resetPasswordVisibility(form)));
// Re-enable Google only after the Google client ID and seller list are configured.
const GOOGLE_SIGN_IN_AVAILABLE = false;
const DEMO_KEY = 'cash-demo-store-v1';
let demoMode = false;
let buyerAccountMode = false;
let buyerRegistrationMode = false;
let buyerAuthPending = false;
let demoMemory = null;
let demoTabOnly = false;
const route = location.pathname.replace(/\/$/, '').slice(1).replace(/\.html$/, '');
const mode = route === 'seller' ? 'admin' : route;
let state = null;
let revision = 0;
let view = mode === 'buyer' ? 'sales' : 'overview';
let saving = false;
let uncertainSave = false;
let settingsDirty = false;
let productPhoto = null;
let storePhoto = null;
let photoPending = 0;
let lastPurchase = null;
let viewedReceipt = null;
let toastTimer;
let pollTimer;
let signedInUser = null;
let myPurchases = [];
let loginPending = false;
let googleClientLoading;
let adminSetupMode = false;
let adminAccountState = null;
let adminAuthPending = false;
let adminSalesWelcomeShown = false;
const money = (value) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value) || 0);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const dateLabel = (value) => new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
const localDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const round = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const byId = (id) => state.products.find((product) => product.id === id);
const empty = (message) => `<div class="empty">${esc(message)}</div>`;
const titles = {
  history: ['Purchase history', 'View your previous purchases and download receipts.'],
  overview: ['Overview', 'A summary of stock and recorded sales.'],
  inventory: ['Inventory', 'Manage products, prices, and available stock.'],
  sales: ['Sales', 'Record customer purchases and update stock.'],
  accounting: ['Accounting', 'Review recorded revenue, product costs, and gross profit.'],
  rankings: ['Product rankings', 'See which products sell most and least.'],
  settings: ['Store settings', 'Store details and daily gross profit goals.'],
};

function newStore() {
  return { products: [], activity: [], profile: { owner: 'Shop owner', store: 'Your store', location: '' },
    weekByDay: Array(7).fill(0), weekProfitByDay: Array(7).fill(0), weekUnits: 0,
    lifetimeGrossProfit: 0, profitGoals: { redBelow: 2000, goodFrom: 3000 }, lastProfitCheck: null };
}
function normalize(saved) {
  const defaults = newStore();
  return { ...defaults, ...saved, profile: { ...defaults.profile, ...saved?.profile },
    profitGoals: { ...defaults.profitGoals, ...saved?.profitGoals },
    products: (saved?.products || []).map((product) => ({ sold: 0, threshold: 5, cost: 0, saleEnabled: true, saleLimit: 5, ...product })),
    activity: saved?.activity || [] };
}
function toast(message) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6000);
}
function syncStatus(message) { $('connectionStatus').textContent = demoMode ? (demoTabOnly ? 'Demo - this tab only' : 'Demo - browser data') : message; }
function setBusy(value) {
  saving = value;
  document.querySelectorAll('form button[type="submit"], button[data-action], #addProduct').forEach((button) => { button.disabled = value || uncertainSave || (button.dataset.action === 'sell' && (!byId(button.dataset.id)?.saleEnabled || byId(button.dataset.id)?.stock < 1)); });
  if ($('saleDialog').open) {
    const product = byId($('saleProductId').value);
    $('confirmSale').disabled = value || uncertainSave || !product || !product.saleEnabled || product.stock < 1;
  }
  syncStatus(value ? 'Saving...' : 'Connected to shared store');
}
function shopperHeaders() { return buyerAccountMode ? {'X-Cash-Buyer':'1'} : {}; }
async function readStore() {
  if (demoMode) return readDemoStore();
  const response = await fetch(mode === 'buyer' ? '/api/catalog' : '/api/shop', { cache: 'no-store', headers: shopperHeaders() });
  if (!response.ok) {
    const error = new Error([401,403].includes(response.status) ? 'Please sign in with the correct Google account.' : 'Could not connect to the store database.');
    error.status = response.status; throw error;
  }
  return response.json();
}
function accept(data) { state = normalize(data.state); revision = data.revision; }
async function commit(change) {
  if (mode !== 'admin' || saving || uncertainSave) return false;
  const next = structuredClone(state);
  try { change(next); } catch (error) { toast(error.message); return false; }
  setBusy(true);
  let response;
  try {
    if (demoMode) {
      const current = readDemoStore();
      if (current.revision !== revision) { accept(current); render(); updateSale(); toast('Demo data changed in another tab. Review it and try again.'); return false; }
      const saved = writeDemoStore({ state: next, revision: revision + 1 });
      accept(saved); render(); return true;
    }
    response = await fetch('/api/shop', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: next, revision }) });
    if (response.status === 401 || response.status === 403) { await startWithAuth(); return false; }
    if (response.status === 409) {
      accept(await readStore()); render();
      updateSale();
      toast('The store changed on another page. Review the latest stock and try again.');
      return false;
    }
    if (!response.ok) {
      let message = 'The change was not saved. Please try again.';
      try { message = (await response.json()).error || message; } catch {}
      toast(message); return false;
    }
    const result = await response.json();
    state = next; revision = result.revision;
    render(); return true;
  } catch {
    // A dropped connection can hide a successful write. Never automatically repeat a sale.
    uncertainSave = true;
    $('syncNoticeText').textContent = 'Could not confirm whether the change was saved. Reload the store before trying again.';
    $('syncNotice').hidden = false;
    toast('Connection lost. Reload the store to check the saved records.');
    return false;
  } finally { setBusy(false); }
}
async function refresh() {
  if (!state || saving || uncertainSave || document.hidden || document.querySelector('dialog[open]') || settingsDirty || view === 'settings') return;
  const before = revision;
  try {
    const data = await readStore();
    if (saving || revision !== before || document.querySelector('dialog[open]') || settingsDirty) return;
    if (data.revision > revision) { accept(data); render(); if (mode === 'buyer') await loadMyPurchases(); }
    syncStatus('Connected to shared store');
  } catch (error) {
    if ([401,403].includes(error.status)) await startWithAuth();
    else syncStatus('Connection interrupted');
  }
}
async function start() {
  if (!['admin', 'buyer'].includes(mode) || !signedInUser) return;
  document.body.dataset.mode = mode;
  $('welcome').hidden = true; $('signInScreen').hidden = true; $('workspace').hidden = false;
  $('signedInAccount').textContent = signedInUser.email || signedInUser.username || signedInUser.name;
  $('signOut').textContent = demoMode ? 'Exit demo' : 'Sign out';
  $('demoModeNotice').hidden = !demoMode;
  document.querySelector('.sidebar-footer span').textContent = demoMode ? 'Demo store in this browser' : 'Shared store database';
  $('sidebar').hidden = mode === 'buyer'; $('buyerBrand').hidden = mode !== 'buyer';
  $('viewLabel').textContent = mode === 'buyer' ? 'BUYER WORKSPACE' : 'ADMIN WORKSPACE';
  $('loading').hidden = false; $('loadError').hidden = true;
  try {
    let data = await readStore();
    accept(data); $('loading').hidden = true; $('views').hidden = false;
    render(); showView(view); syncStatus('Connected to shared store');
    if (mode === 'buyer') await loadMyPurchases();
    clearInterval(pollTimer); pollTimer = setInterval(refresh, 5000);
    if (mode === 'admin') showAdminSalesWelcome();
  } catch (error) {
    if ([401,403].includes(error.status)) { await startWithAuth(); return; }
    $('loading').hidden = true; $('loadError').hidden = false;
    $('loadErrorText').textContent = error.message; syncStatus('Not connected');
  }
}
function showAdminSalesWelcome() {
  const dialog = $('adminSalesWelcome');
  if (mode !== 'admin' || !state || adminSalesWelcomeShown || !dialog) return;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const sales = state.activity.filter(sale => sale.date <= now.getTime()).map(financials).sort((a,b) => b.date - a.date);
  const todaySales = sales.filter(sale => sale.date >= todayStart);
  const sum = totals(todaySales);
  const latest = sales[0];
  $('adminSalesWelcomeTitle').textContent = demoMode ? 'Demo sales update' : 'Welcome back!';
  $('adminLatestSale').textContent = latest
    ? `${latest.buyerId?.startsWith('local-buyer:') && latest.buyerName ? latest.buyerName + ' bought' : 'Latest purchase:'} ${latest.qty} x ${latest.name}.`
    : 'Your next sale starts here.';
  $('adminLatestSaleDate').textContent = latest ? `Recorded ${dateLabel(latest.date)} | ${money(latest.revenue)}` : 'No purchases have been recorded yet.';
  $('adminTodaySales').textContent = String(todaySales.length);
  $('adminTodayUnits').textContent = String(sum.units);
  $('adminTodayRevenue').textContent = money(sum.revenue);
  $('adminSalesEncouragement').textContent = todaySales.length
    ? 'Every sale counts. Keep your shelves ready for the next customer!'
    : 'A fresh day, a new chance to sell. Check your stock and get ready for your next customer!';
  adminSalesWelcomeShown = true;
  dialog.showModal();
}
function showView(name) {
  if (!state || !titles[name] || (mode === 'buyer' && !['sales','history'].includes(name)) || (mode === 'admin' && name === 'history')) return;
  if (settingsDirty && name !== 'settings' && !window.confirm('Leave without saving your store settings?')) return;
  if (name !== 'settings') settingsDirty = false;
  view = name;
  document.querySelectorAll('.view').forEach((element) => { element.hidden = element.id !== `${name}View`; });
  document.querySelectorAll('#adminNav [data-view]').forEach((button) => {
    if (button.dataset.view === name) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  document.querySelectorAll('#buyerNav [data-view]').forEach(button => {
    if (button.dataset.view === name) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
  });
  $('pageTitle').textContent = mode === 'buyer' && name === 'sales' ? 'Browse products' : titles[name][0];
  $('pageDescription').textContent = mode === 'buyer' && name === 'sales' ? 'Choose a product and quantity to record a purchase. No online payment is collected.' : titles[name][1];
  if (name === 'history') loadMyPurchases();
  if (name === 'settings') fillSettings();
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function financials(sale) {
  const product = state.products.find((item) => sale.productId ? item.id === sale.productId : item.name === sale.name);
  const qty = Number(sale.qty) || 0;
  const unitPrice = Number(sale.unitPrice ?? product?.price ?? 0);
  const unitCost = Number(sale.unitCost ?? product?.cost ?? 0);
  return { ...sale, qty, unitPrice, unitCost, revenue: Number(sale.revenue ?? qty * unitPrice),
    grossProfit: Number(sale.grossProfit ?? qty * (unitPrice - unitCost)), estimated: sale.unitPrice == null || (mode === 'admin' && sale.unitCost == null) };
}
function totals(sales) {
  return sales.reduce((sum, sale) => { sum.revenue += sale.revenue; sum.profit += sale.grossProfit; sum.units += sale.qty; return sum; }, { revenue: 0, profit: 0, units: 0 });
}
function stats(items) {
  return items.map(([label, value, note]) => `<article class="stat"><div class="stat-label">${esc(label)}</div><div class="stat-value">${esc(value)}</div><div class="stat-note">${esc(note)}</div></article>`).join('');
}
function table(headers, rows, message = 'No records to display.') {
  if (!rows.length) return empty(message);
  return `<table><thead><tr>${headers.map((text) => `<th scope="col">${esc(text)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}
function photo(product) {
  return product.photo ? `<img class="product-thumb" src="${esc(product.photo)}" alt="" loading="lazy">` : '';
}
function productCell(product) { return `<div class="product-cell">${photo(product)}<span>${esc(product.name)}<small>${esc(product.category)}</small></span></div>`; }
function stockBadge(product) {
  const type = product.stock === 0 ? 'out' : product.stock <= product.threshold ? 'low' : 'ok';
  return `<span class="badge ${type}">${type === 'out' ? 'Out of stock' : type === 'low' ? 'Low stock' : 'In stock'}</span>`;
}
function salesTable(sales, admin = true) {
  return table(admin ? ['Date', 'Product', 'Quantity', 'Unit price', 'Revenue', 'Gross profit'] : ['Date', 'Product', 'Quantity', 'Total'],
    sales.map((sale) => `<tr><td>${esc(dateLabel(sale.date))}<small>${esc(sale.id || '')}</small></td><td>${esc(sale.name)}${sale.estimated ? '<small>Estimated older amounts</small>' : ''}</td><td>${sale.qty}</td>${admin ? `<td>${money(sale.unitPrice)}</td>` : ''}<td>${money(sale.revenue)}</td>${admin ? `<td>${money(sale.grossProfit)}</td>` : ''}</tr>`), 'No sales recorded for this period.');
}
function setCategories(id, categories) {
  const element = $(id); const selected = element.value;
  element.innerHTML = '<option value="">All categories</option>' + categories.map((category) => `<option value="${esc(category)}">${esc(category)}</option>`).join('');
  if (categories.includes(selected)) element.value = selected;
}
function render() {
  if (!state) return;
  $('shopName').textContent = state.profile.store || 'Your store';
  $('sampleCatalogNotice').hidden = !state.sampleCatalog;
  $('markCatalogReviewed').hidden = mode !== 'admin';
  const categories = [...new Set(state.products.map((product) => product.category))].sort();
  setCategories('salesCategory', categories); setCategories('inventoryCategory', categories);
  $('categoryOptions').innerHTML = categories.map((category) => `<option value="${esc(category)}"></option>`).join('');
  renderCatalog();
  if (mode === 'admin') { renderInventory(); renderOverview(); renderAccounting(); renderRankings(); }
}
function filteredProducts(search, category) {
  const query = $(search).value.trim().toLowerCase(); const selected = $(category).value;
  return state.products.filter((product) => product.name.toLowerCase().includes(query) && (!selected || product.category === selected)).sort((a, b) => a.name.localeCompare(b.name));
}
function renderCatalog() {
  const products = filteredProducts('salesSearch', 'salesCategory').filter((product) => product.saleEnabled);
  $('catalogCount').textContent = `${products.length} product${products.length === 1 ? '' : 's'}`;
  $('productCatalog').innerHTML = products.length ? products.map((product) => `<article class="product-card">${product.photo ? `<img class="catalog-photo" src="${esc(product.photo)}" alt="${esc(product.name)}" loading="lazy">` : `<div class="catalog-placeholder" aria-hidden="true">${esc(product.category)}</div>`}<div class="product-card-content"><span class="category">${esc(product.category)}</span><h2>${esc(product.name)}</h2><div class="product-price">${money(product.price)}</div><div class="availability">${product.stock === 0 ? 'Out of stock' : `${product.stock} available`}</div><div class="purchase-limit">Maximum ${product.saleLimit} per purchase</div><button type="button" class="primary" data-action="sell" data-id="${esc(product.id)}" ${product.stock < 1 || saving || uncertainSave ? 'disabled' : ''}>${product.stock < 1 ? 'Out of stock' : mode === 'buyer' ? 'Buy item' : 'Record sale'}</button></div></article>`).join('') : empty(mode === 'buyer' ? 'No products are currently offered for sale. Please check again later.' : 'No matching products are enabled for sale. Set Buyer availability in Inventory.');
}

function renderInventory() {
  const products = filteredProducts('inventorySearch', 'inventoryCategory');
  const low = state.products.filter((product) => product.stock <= product.threshold);
  $('lowStockBadge').textContent = low.length; $('lowStockBadge').hidden = low.length === 0;
  $('inventorySummary').textContent = `${state.products.length} products | ${state.products.reduce((sum, product) => sum + product.stock, 0)} units in stock | ${low.length} stock alerts`;
  $('inventoryTable').innerHTML = table(['Product', 'Stock', 'Unit cost', 'Selling price', 'Buyer sale', 'Limit / purchase', 'Status', 'Actions'], products.map((product) => `<tr><td>${productCell(product)}</td><td>${product.stock}</td><td>${money(product.cost)}</td><td>${money(product.price)}</td><td><span class="badge ${product.saleEnabled ? 'ok' : 'paused'}">${product.saleEnabled ? 'For sale' : 'Paused'}</span></td><td>${product.saleLimit}</td><td>${stockBadge(product)}</td><td><div class="row-actions"><button type="button" data-action="toggleSale" data-id="${esc(product.id)}">${product.saleEnabled ? 'Pause sale' : 'Offer for sale'}</button><button type="button" data-action="receive" data-id="${esc(product.id)}">Receive</button><button type="button" data-action="edit" data-id="${esc(product.id)}">Edit</button><button type="button" class="danger" data-action="remove" data-id="${esc(product.id)}">Remove</button></div></td></tr>`), 'No products found. Use Add product to create an item.');
}
function renderOverview() {
  const now = new Date(); const month = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const sales = state.activity.map(financials).sort((a, b) => b.date - a.date);
  const sum = totals(sales.filter((sale) => sale.date >= month && sale.date <= now.getTime()));
  const inventoryValue = state.products.reduce((value, product) => value + product.stock * product.cost, 0);
  const low = state.products.filter((product) => product.stock <= product.threshold).sort((a, b) => a.stock - b.stock);
  $('overviewStats').innerHTML = stats([['Revenue this month', money(sum.revenue), 'From recorded sales'], ['Gross profit this month', money(sum.profit), 'Before operating expenses'], ['Inventory at cost', money(inventoryValue), 'Available units x current unit cost'], ['Needs restocking', String(low.length), 'At or below the restock level']]);
  $('stockAlerts').innerHTML = low.length ? low.map((product) => `<div class="alert-item"><div><strong>${esc(product.name)}</strong><small>${product.stock} left | Restock level ${product.threshold}</small></div>${stockBadge(product)}</div>`).join('') : empty('All products are above their restock levels.');
  $('overviewSales').innerHTML = salesTable(sales.slice(0, 5));
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (now.getDay() + 6) % 7);
  const values = Array(7).fill(0);
  sales.forEach((sale) => { const day = new Date(sale.date); const index = Math.round((new Date(day.getFullYear(), day.getMonth(), day.getDate()) - monday) / 86400000); if (index >= 0 && index < 7) values[index] += sale.grossProfit; });
  const maximum = Math.max(1, ...values.map(Math.abs));
  $('weekChart').innerHTML = values.map((value, index) => `<div class="chart-column" role="listitem" aria-label="${['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][index]}: ${esc(money(value))}"><span class="chart-amount">${money(value)}</span><div class="chart-track"><div class="chart-bar ${value < state.profitGoals.redBelow ? 'low' : value >= state.profitGoals.goodFrom ? 'good' : ''}" style="height:${Math.max(2, Math.abs(value) / maximum * 100)}%"></div></div><span>${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][index]}</span></div>`).join('');
  $('weekSummary').textContent = `Week total: ${money(values.reduce((sum, value) => sum + value, 0))}. Red: below ${money(state.profitGoals.redBelow)}. Green: ${money(state.profitGoals.goodFrom)} or above. Negative values are losses.`;
}
let reportRange = null;
function rangeSales() {
  if (!reportRange) return [];
  const from = new Date(`${reportRange.from}T00:00:00`).getTime();
  const to = new Date(`${reportRange.to}T00:00:00`); to.setDate(to.getDate() + 1);
  return state.activity.map(financials).filter((sale) => sale.date >= from && sale.date < to.getTime()).sort((a, b) => b.date - a.date);
}
function renderAccounting() {
  const sales = rangeSales(); const sum = totals(sales);
  $('accountingStats').innerHTML = stats([['Revenue', money(sum.revenue), 'Selling amounts at time of sale'], ['Product costs', money(sum.revenue - sum.profit), 'Recorded cost of goods sold'], ['Gross profit', money(sum.profit), 'Revenue less product costs'], ['Gross margin', `${sum.revenue ? (sum.profit / sum.revenue * 100).toFixed(1) : '0.0'}%`, `${sum.units} units in ${sales.length} transactions`]]);
  $('reportSummary').textContent = `${reportRange.from} through ${reportRange.to} | ${sales.length} transactions${sales.some((sale) => sale.estimated) ? ' | Older amounts include estimates' : ''}`;
  $('reportTable').innerHTML = salesTable(sales);
  $('downloadReport').disabled = !sales.length;
  $('latestReceipt').disabled = !latestMonthSale();
}
function latestMonthSale() {
  const now = new Date(); const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return state.activity.filter((sale) => sale.date >= start && sale.date <= now.getTime()).sort((a, b) => b.date - a.date)[0];
}
function renderRankings() {
  const direction = $('rankingOrder').value === 'low' ? 1 : -1;
  const products = [...state.products].sort((a, b) => direction * (a.sold - b.sold) || a.name.localeCompare(b.name));
  $('rankingsTable').innerHTML = table(['Rank', 'Product', 'Units sold', 'Available stock'], products.map((product, index) => `<tr><td>${index + 1}</td><td>${productCell(product)}</td><td>${product.sold}</td><td>${product.stock}</td></tr>`), 'Add products to start tracking sales rankings.');
}

function preview(id, value) { $(id).hidden = !value; if (value) $(id).src = value; else $(id).removeAttribute('src'); }
function fillSettings() {
  if (settingsDirty) return;
  $('storeName').value = state.profile.store; $('ownerName').value = state.profile.owner;
  $('storeLocation').value = state.profile.location; $('goalLow').value = state.profitGoals.redBelow;
  $('goalHigh').value = state.profitGoals.goodFrom; storePhoto = state.profile.photo || null;
  $('storePhoto').value = ''; preview('storePhotoPreview', storePhoto);
}
function openProduct(id = '') {
  if (mode !== 'admin' || saving || uncertainSave) return;
  const product = id ? byId(id) : null;
  if (id && !product) return;
  $('productForm').reset(); $('productId').value = id;
  $('productDialogTitle').textContent = product ? 'Edit product' : 'Add product';
  $('productName').value = product?.name || ''; $('productCategory').value = product?.category || '';
  $('productStock').value = product?.stock ?? 0; $('productThreshold').value = product?.threshold ?? 5;
  $('productSaleEnabled').value = String(product?.saleEnabled ?? true); $('productSaleLimit').value = product?.saleLimit ?? 5;
  $('productPrice').value = product?.price ?? ''; $('productCost').value = product?.cost ?? '';
  productPhoto = product?.photo || null; preview('productPhotoPreview', productPhoto);
  $('productDialog').showModal(); $('productName').focus();
}
function openSale(id) {
  const product = byId(id);
  if (!product || !product.saleEnabled || product.stock < 1 || saving || uncertainSave) return;
  $('saleProductId').value = id; $('saleQuantity').value = 1;
  $('saleDialogTitle').textContent = mode === 'buyer' ? 'Confirm purchase' : 'Record sale';
  $('confirmSale').textContent = mode === 'buyer' ? 'Confirm purchase' : 'Save sale';
  updateSale(); $('saleDialog').showModal(); $('saleQuantity').focus();
}
function updateSale() {
  if (!state) return;
  const product = byId($('saleProductId').value);
  if (!product || !product.saleEnabled) {
    $('saleAvailability').textContent = 'This product is no longer offered for sale.';
    $('saleLimitNote').textContent = 'Close this form and choose another product.';
    $('saleQuantity').max = 0; $('saleTotal').textContent = money(0); $('confirmSale').disabled = true;
    return;
  }
  $('saleProductName').textContent = product.name;
  preview('saleProductPhoto', product.photo || null);
  $('saleProductPhoto').alt = product.name;
  $('saleAvailability').textContent = `${product.stock} available | ${money(product.price)} each`;
  $('saleQuantity').max = Math.min(product.stock, product.saleLimit);
  $('saleLimitNote').textContent = `Admin limit: ${product.saleLimit} per purchase. You can buy up to ${Math.min(product.stock, product.saleLimit)} right now.`;
  $('saleTotal').textContent = money(product.price * Number($('saleQuantity').value || 0));
}
function openReceive(id) {
  if (mode !== 'admin' || saving || uncertainSave) return;
  const product = byId(id); if (!product) return;
  $('receiveProductId').value = id; $('receiveProductName').textContent = `${product.name} | ${product.stock} units in stock`;
  $('receiveQuantity').value = ''; $('receiveDialog').showModal(); $('receiveQuantity').focus();
}
function openRemove(id) {
  if (mode !== 'admin' || saving || uncertainSave) return;
  const product = byId(id); if (!product) return;
  $('removeProductId').value = id; $('removeProductName').textContent = `Remove ${product.name} from the inventory?`;
  $('removeDialog').showModal();
}
function requireInteger(value, minimum, label) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${label} must be a whole number of ${minimum} or more.`);
}
function requireAmount(value, label) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be zero or greater.`);
}
async function saveProduct(event) {
  event.preventDefault();
  if (mode !== 'admin') return;
  if (photoPending) return toast('Wait for the photo to finish processing.');
  const id = $('productId').value;
  const values = { name: $('productName').value.trim(), category: $('productCategory').value.trim(),
    stock: Number($('productStock').value), threshold: Number($('productThreshold').value),
    price: Number($('productPrice').value), cost: Number($('productCost').value), saleEnabled: $('productSaleEnabled').value === 'true', saleLimit: Number($('productSaleLimit').value) };
  const image = productPhoto;
  const saved = await commit((next) => {
    if (!values.name || !values.category) throw new Error('Enter a product name and category.');
    requireInteger(values.stock, 0, 'Stock'); requireInteger(values.threshold, 0, 'Restock level');
    requireInteger(values.saleLimit, 1, 'Purchase limit');
    if (values.saleLimit > 1000000) throw new Error('The purchase limit cannot exceed 1,000,000.');
    requireAmount(values.price, 'Selling price'); requireAmount(values.cost, 'Unit cost');
    const existing = id ? next.products.find((product) => product.id === id) : null;
    if (id && !existing) throw new Error('This product was removed on another page.');
    const product = existing || { id: `p${crypto.randomUUID().replace(/-/g, '')}`, sold: 0 };
    Object.assign(product, values);
    if (image) product.photo = image; else delete product.photo;
    if (!existing) next.products.push(product);
  });
  if (saved) { $('productDialog').close(); toast(id ? 'Product updated.' : 'Product added.'); }
}
async function saveSale(event) {
  event.preventDefault();
  if (saving || uncertainSave) return;
  const product = byId($('saleProductId').value); const quantity = Number($('saleQuantity').value);
  try {
    requireInteger(quantity, 1, 'Quantity');
    if (!product || !product.saleEnabled) throw new Error('This item is not currently for sale.');
    if (quantity > product.saleLimit) throw new Error(`This item is limited to ${product.saleLimit} per purchase.`);
    if (quantity > product.stock) throw new Error('That quantity is not available in stock.');
  } catch (error) { toast(error.message); return; }
  setBusy(true);
  try {
    const response = await purchaseRequest({ productId: product.id, quantity, revision });
    if (response.status === 401 || response.status === 403) { await startWithAuth(); return; }
    if (response.status === 409) {
      accept(await readStore()); render(); updateSale();
      toast('The store changed. Review the latest stock and price, then try again.'); return;
    }
    if (!response.ok) { const error = await response.json(); toast(error.error || 'Purchase could not be recorded.'); return; }
    const result = await response.json();
    // Remember the confirmed receipt before refreshing so a failed refresh never repeats a purchase.
    lastPurchase = result.receipt; revision = result.revision;
    $('saleDialog').close();
    if (mode === 'buyer') {
      $('purchaseReceipt').hidden = false;
      $('purchaseReceiptText').textContent = `${lastPurchase.qty} x ${lastPurchase.name} | ${money(lastPurchase.revenue)} | ${dateLabel(lastPurchase.date)}`;
    }
    try { accept(await readStore()); render(); if (mode === 'buyer') await loadMyPurchases(); }
    catch { syncStatus('Purchase saved. Refresh to update stock.'); }
    toast(mode === 'buyer' ? 'Purchase recorded.' : 'Sale recorded.');
  } catch {
    uncertainSave = true; $('syncNotice').hidden = false;
    $('syncNoticeText').textContent = 'Could not confirm the purchase. Reload the store before trying again to avoid a duplicate.';
    toast('Connection lost. Reload the store to check the saved record.');
  } finally { setBusy(false); }
}

async function receiveStock(event) {
  event.preventDefault(); if (mode !== 'admin') return;
  const id = $('receiveProductId').value; const quantity = Number($('receiveQuantity').value);
  if (await commit((next) => {
    requireInteger(quantity, 1, 'Units received');
    const product = next.products.find((item) => item.id === id);
    if (!product) throw new Error('This product is no longer in inventory.');
    requireInteger(product.stock + quantity, 0, 'Resulting stock'); product.stock += quantity;
  })) { $('receiveDialog').close(); toast('Stock received.'); }
}
async function removeProduct(event) {
  event.preventDefault(); if (mode !== 'admin') return;
  const id = $('removeProductId').value;
  if (await commit((next) => { next.products = next.products.filter((product) => product.id !== id); })) {
    $('removeDialog').close(); toast('Product removed. Previous sales are preserved.');
  }
}
async function saveSettings(event) {
  event.preventDefault(); if (mode !== 'admin') return;
  if (photoPending) return toast('Wait for the photo to finish processing.');
  const profile = { ...state.profile, owner: $('ownerName').value.trim(), store: $('storeName').value.trim(), location: $('storeLocation').value.trim() };
  const goals = { redBelow: Number($('goalLow').value), goodFrom: Number($('goalHigh').value) };
  if (storePhoto) profile.photo = storePhoto; else delete profile.photo;
  if (await commit((next) => {
    if (!profile.owner || !profile.store) throw new Error('Enter the store name and owner name.');
    requireAmount(goals.redBelow, 'Lower goal'); requireAmount(goals.goodFrom, 'Upper goal');
    if (goals.goodFrom <= goals.redBelow) throw new Error('The upper goal must be higher than the lower goal.');
    next.profile = profile; next.profitGoals = goals;
  })) { settingsDirty = false; fillSettings(); toast('Store settings saved.'); }
}
async function preparePhoto(file) {
  if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPG, or WebP image.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Choose an image smaller than 10 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('The image could not be opened.')); image.src = url; });
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser could not prepare this image.');
    const size = Math.min(image.naturalWidth, image.naturalHeight);
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, 256, 256);
    context.drawImage(image, (image.naturalWidth - size) / 2, (image.naturalHeight - size) / 2, size, size, 0, 0, 256, 256);
    return canvas.toDataURL('image/jpeg', .85);
  } finally { URL.revokeObjectURL(url); }
}
async function choosePhoto(event, type) {
  const file = event.target.files[0]; if (!file) return;
  photoPending++;
  try {
    const image = await preparePhoto(file);
    if (type === 'product') { productPhoto = image; preview('productPhotoPreview', image); }
    else { storePhoto = image; settingsDirty = true; preview('storePhotoPreview', image); }
  } catch (error) { toast(error.message); event.target.value = ''; }
  finally { photoPending--; }
}

// Small text PDF writer: plain ASCII streams keep byte offsets deterministic.
function pdfText(value) {
  return String(value).replace(/[^\x20-\x7e]/g, '?').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}
function createPdf(lines) {
  const wrapped = lines.flatMap((line) => {
    const text = String(line); const parts = [];
    for (let index = 0; index < text.length; index += 88) parts.push(text.slice(index, index + 88));
    return parts.length ? parts : [''];
  });
  const pages = [];
  for (let index = 0; index < wrapped.length; index += 48) pages.push(wrapped.slice(index, index + 48));
  if (!pages.length) pages.push(['No records.']);
  const objects = [];
  const pageIds = pages.map((_, index) => 4 + index * 2);
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pages.forEach((page, index) => {
    const id = pageIds[index];
    const stream = `BT\n/F1 10 Tf\n45 795 Td\n14 TL\n${page.map((line) => `(${pdfText(line)}) Tj\nT*`).join('\n')}\nET`;
    objects[id - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`;
    objects[id] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let result = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(result.length); result += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = result.length;
  result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) result += `${String(offset).padStart(10, '0')} 00000 n \n`;
  result += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([result], { type: 'application/pdf' });
}
function openBuyerReceipt(receipt) {
  if (mode !== 'buyer' || !receipt || !$('buyerReceiptDialog')) return;
  viewedReceipt = receipt;
  $('buyerReceiptDetails').innerHTML = `<p class="receipt-store"><strong>${esc(state.profile.store)}</strong><br>${esc(state.profile.location || '')}</p><dl><dt>Receipt number</dt><dd>${esc(receipt.id)}</dd><dt>Date</dt><dd>${esc(dateLabel(receipt.date))}</dd><dt>Buyer</dt><dd>${esc(receipt.buyerName || signedInUser.name)}</dd><dt>Product</dt><dd>${esc(receipt.name)}</dd><dt>Quantity</dt><dd>${esc(receipt.qty)}</dd><dt>Unit price</dt><dd>${money(receipt.unitPrice)}</dd><dt>Total</dt><dd><strong>${money(receipt.revenue)}</strong></dd></dl><p class="small-note">Purchase record only. No online payment was collected.</p>`;
  $('buyerReceiptDialog').showModal();
}
function downloadPdf(records, title, filename, admin = true) {
  if (!records.length) return toast('There are no sales to download.');
  const sales = records.map(financials); const sum = totals(sales);
  const cash = (amount) => `PHP ${Number(amount).toFixed(2)}`;
  const lines = ['C.A.S.H. - Central Accountant and Storage Helper', title,
    `Store: ${state.profile.store}`, `Location: ${state.profile.location || '-'}`,
    `Generated: ${dateLabel(Date.now())}`, ''];
  if (demoMode) lines.splice(1, 0, 'DEMO DOCUMENT - SAMPLE DATA ONLY');
  sales.forEach((sale) => {
    lines.push(`Receipt: ${sale.id || sale.date}`, `Date: ${dateLabel(sale.date)}`, `Product: ${sale.name}`,
      `Quantity: ${sale.qty} x ${cash(sale.unitPrice)}`, `Total: ${cash(sale.revenue)}`);
    if (admin) lines.push(`Product cost: ${cash(sale.qty * sale.unitCost)}`, `Gross profit: ${cash(sale.grossProfit)}`);
    if (sale.estimated) lines.push('Older amounts are estimated from current product prices.');
    lines.push('------------------------------------------------------------');
  });
  lines.push(`Transactions: ${sales.length}`, `Total: ${cash(sum.revenue)}`);
  if (admin) lines.push(`Gross profit: ${cash(sum.profit)}`, 'Gross profit excludes operating expenses and taxes.');
  else lines.push('Purchase record only. No online payment was collected.');
  const url = URL.createObjectURL(createPdf(lines)); const link = document.createElement('a');
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Event wiring. Navigation and state mutations are kept separate from rendering.
document.addEventListener('click', (event) => {
  const close = event.target.closest('[data-close]');
  if (close) { if (!saving) $(close.dataset.close).close(); return; }
  const navigation = event.target.closest('[data-view]');
  if (navigation) { showView(navigation.dataset.view); return; }
  const action = event.target.closest('[data-action]');
  if (!action || saving || uncertainSave) return;
  const id = action.dataset.id;
  if (action.dataset.action === 'viewReceipt') {
    openBuyerReceipt(myPurchases.find(item => item.id === id));
  } else if (action.dataset.action === 'receipt') {
    const receipt = myPurchases.find(item => item.id === id);
    if (receipt) downloadPdf([receipt], 'Purchase record', `cash-purchase-${receipt.id}.pdf`, false);
  } else if (action.dataset.action === 'sell') openSale(id);
  else if (mode === 'admin') {
    if (action.dataset.action === 'toggleSale') {
      commit(next => { const product = next.products.find(item => item.id === id); if (product) product.saleEnabled = !product.saleEnabled; });
    }
    if (action.dataset.action === 'edit') openProduct(id);
    if (action.dataset.action === 'receive') openReceive(id);
    if (action.dataset.action === 'remove') openRemove(id);
  }
});
document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('cancel', (event) => { if (saving) event.preventDefault(); }));
$('addProduct').addEventListener('click', () => openProduct());
$('markCatalogReviewed').addEventListener('click', () => commit(next => { next.sampleCatalog = false; }));
$('productForm').addEventListener('submit', saveProduct); $('saleForm').addEventListener('submit', saveSale);
$('receiveForm').addEventListener('submit', receiveStock); $('removeForm').addEventListener('submit', removeProduct);
$('settingsForm').addEventListener('submit', saveSettings); $('settingsForm').addEventListener('input', () => { settingsDirty = true; });
$('inventorySearch').addEventListener('input', () => { if (state) renderInventory(); });
$('inventoryCategory').addEventListener('change', () => { if (state) renderInventory(); });
$('salesSearch').addEventListener('input', () => { if (state) renderCatalog(); });
$('salesCategory').addEventListener('change', () => { if (state) renderCatalog(); });
$('rankingOrder').addEventListener('change', () => { if (state) renderRankings(); });
$('saleQuantity').addEventListener('input', updateSale);
$('productPhoto').addEventListener('change', (event) => choosePhoto(event, 'product'));
$('storePhoto').addEventListener('change', (event) => choosePhoto(event, 'store'));
$('removeProductPhoto').addEventListener('click', () => { productPhoto = null; $('productPhoto').value = ''; preview('productPhotoPreview', null); });
$('removeStorePhoto').addEventListener('click', () => { storePhoto = null; settingsDirty = true; $('storePhoto').value = ''; preview('storePhotoPreview', null); });
$('reportFilters').addEventListener('submit', (event) => {
  event.preventDefault(); const from = $('reportFrom').value; const to = $('reportTo').value;
  if (!from || !to || from > to) return toast('Choose a start date on or before the end date.');
  reportRange = { from, to }; renderAccounting();
});
$('downloadReport').addEventListener('click', () => downloadPdf(rangeSales(), `Sales report: ${reportRange.from} through ${reportRange.to}`, `cash-sales-${reportRange.from}-${reportRange.to}.pdf`));
$('latestReceipt').addEventListener('click', () => { const sale = latestMonthSale(); if (sale) downloadPdf([sale], 'Latest sale this month', `cash-receipt-${sale.id || sale.date}.pdf`); });
$('downloadPurchaseReceipt').addEventListener('click', () => { if (lastPurchase) downloadPdf([lastPurchase], 'Purchase record', `cash-purchase-${lastPurchase.id}.pdf`, false); });
$('viewLatestPurchaseReceipt')?.addEventListener('click', () => openBuyerReceipt(lastPurchase));
$('downloadViewedReceipt')?.addEventListener('click', () => { if (viewedReceipt) downloadPdf([viewedReceipt], 'Purchase record', `cash-purchase-${viewedReceipt.id}.pdf`, false); });
$('refreshPurchaseHistory')?.addEventListener('click', loadMyPurchases);
$('retryLoad').addEventListener('click', start); $('reloadStore').addEventListener('click', () => location.reload());
document.addEventListener('visibilitychange', refresh);
window.addEventListener('beforeunload', (event) => { if (saving || settingsDirty) { event.preventDefault(); event.returnValue = ''; } });
function setTheme(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('themeToggle').textContent = dark ? 'Light mode' : 'Dark mode';
  $('themeToggle').setAttribute('aria-pressed', String(dark));
}
let darkTheme = false;
try { darkTheme = localStorage.getItem('cash-theme') === 'dark'; } catch {}
setTheme(darkTheme);
$('themeToggle').addEventListener('click', () => {
  darkTheme = !darkTheme; setTheme(darkTheme);
  try { localStorage.setItem('cash-theme', darkTheme ? 'dark' : 'light'); } catch {}
});
const today = new Date();
reportRange = { from: localDate(new Date(today.getFullYear(), today.getMonth(), 1)), to: localDate(today) };
$('reportFrom').value = reportRange.from; $('reportTo').value = reportRange.to;
startWithAuth();

async function loadMyPurchases() {
  if (mode !== 'buyer' || !signedInUser) return;
  const buyerId = signedInUser.sub;
  const refreshButton = $('refreshPurchaseHistory');
  if (refreshButton) refreshButton.disabled = true;
  $('purchaseHistoryPanel').hidden = false;
  if ($('purchaseHistoryDescription')) $('purchaseHistoryDescription').textContent = buyerAccountMode ? 'Your account receipts, available on any device after login.' : demoMode ? 'Sample receipts saved in this browser' : 'Receipts from your Google account, across devices';
  try {
    const response = demoMode ? { ok: true, json: async () => ({ purchases: readDemoStore().state.activity.filter(sale => sale.buyerId === 'demo-buyer') }) } : await fetch('/api/my-purchases', { cache: 'no-store', headers:shopperHeaders() });
    if (!response.ok) throw new Error('Could not load your purchase history.');
    const result = await response.json();
    if (signedInUser?.sub !== buyerId) return;
    myPurchases = result.purchases.sort((a,b) => b.date - a.date);
    $('myPurchasesTable').innerHTML = table(['Date','Product','Quantity','Total','Receipt'], myPurchases.map(receipt =>
      `<tr><td>${esc(dateLabel(receipt.date))}</td><td>${esc(receipt.name)}</td><td>${receipt.qty}</td><td>${money(receipt.revenue)}</td><td><div class="row-actions"><button type="button" data-action="viewReceipt" data-id="${esc(receipt.id)}">View receipt</button><button type="button" data-action="receipt" data-id="${esc(receipt.id)}">Download PDF</button></div></td></tr>`), 'No purchases yet. Choose an item in Shop to make your first purchase.');
  } catch (error) { if (signedInUser?.sub === buyerId) $('myPurchasesTable').innerHTML = empty(`${error.message} Use Refresh history to try again.`); }
  finally { if (refreshButton) refreshButton.disabled = false; }
}
function clearPrivateView() {
  adminSalesWelcomeShown = false;
  clearInterval(pollTimer);
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  $('workspace').hidden = true; $('views').hidden = true; $('purchaseReceipt').hidden = true;
  $('welcome').hidden = true; $('signInScreen').hidden = false;
  state = null; signedInUser = null; myPurchases = []; lastPurchase = null; viewedReceipt = null;
  $('buyerReceiptDetails')?.replaceChildren();
  for (const id of ['adminLatestSale','adminLatestSaleDate','adminTodaySales','adminTodayUnits','adminTodayRevenue','adminSalesEncouragement']) $(id)?.replaceChildren();
  productPhoto = null; storePhoto = null; settingsDirty = false; uncertainSave = false;
  $('syncNotice').hidden = true;
  for (const id of ['productCatalog','inventoryTable','overviewSales','stockAlerts','reportTable','rankingsTable','myPurchasesTable','overviewStats','accountingStats','weekChart']) $(id).replaceChildren();
  for (const id of ['purchaseReceiptText','weekSummary','inventorySummary','reportSummary','signedInAccount','saleProductName','saleAvailability','saleLimitNote','saleTotal']) $(id).textContent = '';
  $('settingsForm').reset(); $('productForm').reset();
  $('adminPasswordForm')?.reset(); $('buyerPasswordForm')?.reset();
  preview('storePhotoPreview', null); preview('productPhotoPreview', null); preview('saleProductPhoto', null);
}
async function loadGoogleClient() {
  if (window.google?.accounts?.id) return;
  if (!googleClientLoading) googleClientLoading = new Promise((resolve,reject) => {
    const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
    const timeout = setTimeout(() => reject(new Error('Google sign-in could not load. Check your connection and reload.')), 15000);
    script.onload = () => { clearTimeout(timeout); resolve(); };
    script.onerror = () => { clearTimeout(timeout); reject(new Error('Google sign-in could not load. Check your connection and reload.')); };
    document.head.append(script);
  });
  return googleClientLoading;
}
async function startWithAuth() {
  if (!['admin','buyer'].includes(mode)) return;
  buyerAccountMode = false;
  clearPrivateView();
  $('signInTitle').textContent = mode === 'admin' ? 'Admin login' : 'Buyer login';
  $('signInDescription').textContent = mode === 'admin' ? 'Use an approved Google account to manage inventory and reports.' : 'Use your Google account to buy products and keep your receipts.';
  $('signInStatus').textContent = 'Checking your sign-in...';
  $('googleSignInButton').replaceChildren(); $('retrySignIn').hidden = true;
  if ($('enterDemo')) $('enterDemo').hidden = mode !== 'admin';
  $('googleSignInButton').hidden = !GOOGLE_SIGN_IN_AVAILABLE;
  if (mode === 'buyer') {
    demoMode = false;
    const opened = await loadBuyerAccess();
    if (opened) return;
  }
  if (mode === 'admin') {
    $('enterDemo').disabled = true;
    const opened = await loadAdminAccess();
    $('enterDemo').disabled = false;
    if (opened) return;
  }
  if (!GOOGLE_SIGN_IN_AVAILABLE) {
    if (mode === 'admin' && !adminSetupMode) {
      $('signInTitle').textContent = 'Admin login';
      $('signInDescription').textContent = 'Sign in to manage your store.';
    }
    $('signInStatus').textContent = 'Google Play not available yet';
    return;
  }
  try {
    const response = await fetch('/api/auth/session', { cache: 'no-store' });
    if (!response.ok) throw new Error('Sign-in is temporarily unavailable. Reload to try again.');
    const session = await response.json();
    if (session.user && (mode === 'buyer' || session.user.role === 'admin')) {
      signedInUser = session.user; await start(); return;
    }
    if (!session.configured) throw new Error('Google sign-in is still being set up. Please contact the store owner.');
    if (mode === 'admin' && !session.sellerConfigured) throw new Error('Seller/Admin access has not been set up yet. Please contact the store owner.');
    $('signInStatus').textContent = session.user ? 'This account is a Buyer. Choose an approved Seller/Admin Google account, or open Buyer sign-in.' : 'Choose your Google account below.';
    await loadGoogleClient();
    window.google.accounts.id.initialize({ client_id: session.clientId, nonce: session.nonce, auto_select: false, callback: googleCredential });
    window.google.accounts.id.renderButton($('googleSignInButton'), { theme: document.documentElement.dataset.theme === 'dark' ? 'filled_black' : 'outline', size: 'large', type: 'standard', text: 'signin_with', shape: 'rectangular', width: Math.min(300, Math.max(200, $('googleSignInButton').clientWidth || 300)) });
  } catch (error) {
    $('signInStatus').textContent = error.message; $('retrySignIn').hidden = false;
  }
}
async function googleCredential(result) {
  if (loginPending || adminAuthPending || buyerAuthPending) return;
  loginPending = true; $('googleSignInButton').classList.add('busy'); $('signInStatus').textContent = 'Verifying your Google account...';
  try {
    const response = await fetch('/api/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: result.credential, mode }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Google sign-in could not be completed.');
    signedInUser = data.user; uncertainSave = false; await start();
  } catch (error) { $('signInStatus').textContent = error.message; $('retrySignIn').hidden = false; }
  finally { loginPending = false; $('googleSignInButton').classList.remove('busy'); }
}
$('retrySignIn').addEventListener('click', () => location.reload());
$('signOut').addEventListener('click', async () => {
  if (saving) return toast('Please wait for the current save to finish.');
  if (settingsDirty && !confirm('Sign out without saving your store settings?')) return;
  if (buyerAccountMode) {
    try {
      const response=await fetch('/api/auth/buyer/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      if(!response.ok)throw new Error();
      buyerAccountMode=false; await startWithAuth();
    } catch { toast('Could not log out. Please check your connection and try again.'); }
    return;
  }
  if (demoMode) { demoMode = false; await startWithAuth(); return; }
  try {
    const response = await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!response.ok) throw new Error();
    window.google?.accounts?.id.disableAutoSelect();
    await startWithAuth();
  } catch { toast('Could not sign out. Check your connection and try again.'); }
});


// Demo mode is a separate browser-only store. It never calls the live shop APIs.
function demoStoreDefaults() {
  const data = newStore();
  data.profile = { owner: 'Demo owner', store: 'C.A.S.H. Demo Store', location: 'Sample store' };
  data.products = [
    ['rice','White rice - 1 kg','Pantry',50,58,45,10,5],
    ['milk','Fresh milk - 1 L','Drinks',18,89,68,5,4],
    ['eggs','Eggs - per piece','Produce',60,10,7,12,12],
    ['bread','Bread loaf','Bakery',20,55,38,5,3],
    ['water','Bottled water - 500 ml','Drinks',40,20,12,10,6],
    ['noodles','Instant noodles','Pantry',36,18,12,8,6],
    ['coffee','Coffee sachet','Pantry',48,12,8,10,10],
    ['soap','Dishwashing liquid - 250 ml','Household',16,55,38,4,3],
  ].map(([id,name,category,stock,price,cost,threshold,saleLimit]) => ({id:`demo_${id}`,name,category,stock,price,cost,threshold,saleLimit,saleEnabled:true,sold:0,photo:`/assets/products/${id}.png`}));
  data.productPhotosVersion = 1;
  return { version:1, revision:0, state:data };
}
function readDemoStore() {
  try {
    const saved = JSON.parse(localStorage.getItem(DEMO_KEY) || 'null');
    if (saved?.version === 1 && Number.isSafeInteger(saved.revision) && Array.isArray(saved.state?.products) && Array.isArray(saved.state?.activity)) {
      if (saved.state.productPhotosVersion !== 1) {
        const images = new Map(demoStoreDefaults().state.products.map(product => [product.id, product.photo]));
        for (const product of saved.state.products) {
          if (!product.photo && images.has(product.id)) product.photo = images.get(product.id);
        }
        saved.state.productPhotosVersion = 1; saved.revision++;
        return writeDemoStore(saved);
      }
      demoMemory = saved; return structuredClone(saved);
    }
  } catch {}
  if (!demoMemory) return writeDemoStore(demoStoreDefaults());
  return structuredClone(demoMemory);
}
function writeDemoStore(data) {
  const snapshot = { ...structuredClone(data), version:1 };
  demoMemory = snapshot;
  try { localStorage.setItem(DEMO_KEY, JSON.stringify(snapshot)); demoTabOnly = false; }
  catch { demoTabOnly = true; }
  return structuredClone(snapshot);
}
async function purchaseRequest(payload) {
  if (!demoMode) return fetch('/api/sales', {method:'POST',headers:{'Content-Type':'application/json',...shopperHeaders()},body:JSON.stringify(payload)});
  const current = readDemoStore();
  let error;
  if (current.revision !== payload.revision) return {ok:false,status:409,json:async()=>({error:'Demo stock changed in another tab.'})};
  const next = structuredClone(current.state); const product = next.products.find(item => item.id === payload.productId);
  if (!product || !product.saleEnabled) error = 'This item is not offered for sale.';
  else if (!Number.isSafeInteger(payload.quantity) || payload.quantity < 1 || payload.quantity > product.stock || payload.quantity > product.saleLimit) error = 'Choose a quantity within the stock and purchase limit.';
  if (error) return {ok:false,status:400,json:async()=>({error})};
  const quantity = payload.quantity;
  const receipt = {id:`DEMO-${crypto.randomUUID().replace(/-/g,'')}`,productId:product.id,name:product.name,qty:quantity,date:Date.now(),unitPrice:product.price,unitCost:product.cost,revenue:round(quantity*product.price),grossProfit:round(quantity*(product.price-product.cost)),buyerId:signedInUser.sub,buyerName:signedInUser.name};
  product.stock -= quantity; product.sold += quantity; next.activity.unshift(receipt);
  const weekday = (new Date(receipt.date).getDay()+6)%7;
  next.weekByDay[weekday] += receipt.revenue; next.weekProfitByDay[weekday] += receipt.grossProfit;
  next.weekUnits += quantity; next.lifetimeGrossProfit = round(next.lifetimeGrossProfit+receipt.grossProfit);
  const saved = writeDemoStore({state:next,revision:current.revision+1});
  return {ok:true,status:200,json:async()=>({receipt,revision:saved.revision})};
}
$('enterDemo')?.addEventListener('click', async () => {
  if (adminAuthPending || loginPending || buyerAuthPending) return;
  if (mode !== 'admin') return;
  demoMode = true;
  signedInUser = {sub:mode === 'admin' ? 'demo-admin' : 'demo-buyer',email:mode === 'admin' ? 'Seller demo' : 'Buyer demo',name:mode === 'admin' ? 'Demo seller' : 'Demo buyer',role:mode};
  uncertainSave = false; await start();
});
$('resetDemo').addEventListener('click', () => {
  if (!demoMode || saving || !confirm('Reset the demo products and transactions in this browser? The live store will not be changed.')) return;
  const reset = demoStoreDefaults(); reset.revision = readDemoStore().revision + 1;
  accept(writeDemoStore(reset)); settingsDirty = false; lastPurchase = null; $('purchaseReceipt').hidden = true;
  render(); if (view === 'settings') fillSettings(); if (mode === 'buyer') loadMyPurchases();
  toast('Demo reset to sample products.');
});


function setAdminSetupMode(value) {
  resetPasswordVisibility($('adminPasswordForm'));
  if (!$('adminPasswordForm')) return;
  adminSetupMode = value;
  $('adminNameField').hidden = !value; $('adminDisplayName').required = value;
  $('adminConfirmField').hidden = !value; $('adminConfirmPassword').required = value;
  $('adminSetupKeyField').hidden = !(value && adminAccountState?.tokenRequired);
  $('adminSetupKey').required = value && Boolean(adminAccountState?.tokenRequired);
  $('adminSetupHint').hidden = !value;
  $('adminPassword').minLength = value ? 12 : 1;
  $('adminPassword').autocomplete = value ? 'new-password' : 'current-password';
  $('adminAuthSubmit').textContent = value ? 'Create Admin account' : 'Sign in';
  $('signInTitle').textContent = value ? 'Create Admin account' : 'Admin login';
  $('signInDescription').textContent = value ? 'Choose the credentials you will use to manage this store.' : 'Sign in to manage your store.';
  $('toggleAdminSetup').textContent = value ? 'Back to Admin login' : 'Create first Admin account';
}
async function loadAdminAccess() {
  if (!$('adminPasswordForm')) return false;
  $('adminPasswordForm').hidden = false; $('adminAuthStatus').hidden = true;
  try {
    const response = await fetch('/api/auth/admin/status',{cache:'no-store'});
    if (!response.ok) throw new Error('Could not check Admin access. Reload this page to try again.');
    adminAccountState = await response.json();
    if (adminAccountState.user) {
      signedInUser = adminAccountState.user; demoMode = false; await start(); return true;
    }
    $('toggleAdminSetup').hidden = adminAccountState.exists || !adminAccountState.setupAvailable;
    setAdminSetupMode(!adminAccountState.exists && adminAccountState.setupAvailable);
    if (!adminAccountState.exists && !adminAccountState.setupAvailable) {
      $('adminAuthStatus').textContent = 'First-time setup has not been enabled yet. Please contact the store owner.';
      $('adminAuthStatus').hidden = false;
    }
  } catch (error) {
    setAdminSetupMode(false);
    $('toggleAdminSetup').hidden = true; $('adminAuthStatus').textContent = error.message; $('adminAuthStatus').hidden = false;
  }
  return false;
}
$('toggleAdminSetup')?.addEventListener('click',()=>setAdminSetupMode(!adminSetupMode));
$('adminPasswordForm')?.addEventListener('submit',async(event)=>{
  event.preventDefault(); if (adminAuthPending) return;
  const payload = {username:$('adminUsername').value,password:$('adminPassword').value};
  if (adminSetupMode) {
    payload.name=$('adminDisplayName').value; payload.confirmPassword=$('adminConfirmPassword').value; payload.setupToken=$('adminSetupKey').value;
  }
  adminAuthPending=true; $('adminCredentials').disabled=true; $('toggleAdminSetup').disabled=true; $('enterDemo').disabled=true; $('adminAuthStatus').hidden=true;
  try {
    const response=await fetch(adminSetupMode?'/api/auth/admin/setup':'/api/auth/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const result=await response.json();
    if (!response.ok) {
      if(response.status===409){adminAccountState={exists:true,setupAvailable:false};setAdminSetupMode(false);$('toggleAdminSetup').hidden=true;}
      throw new Error(result.error || 'Could not sign in. Please try again.');
    }
    $('adminPasswordForm').reset(); signedInUser=result.user; demoMode=false; uncertainSave=false; await start();
  } catch (error) {
    $('adminPassword').value=''; $('adminConfirmPassword').value=''; $('adminSetupKey').value='';
    $('adminAuthStatus').textContent=error.message; $('adminAuthStatus').hidden=false;
  } finally {
    adminAuthPending=false; $('adminCredentials').disabled=false; $('toggleAdminSetup').disabled=false; $('enterDemo').disabled=false;
  }
});




function setBuyerRegistrationMode(value) {
  resetPasswordVisibility($('buyerPasswordForm'));
  if (!$('buyerPasswordForm')) return;
  buyerRegistrationMode=value;
  $('buyerNameField').hidden=!value; $('buyerDisplayName').required=value;
  $('buyerConfirmField').hidden=!value; $('buyerConfirmPassword').required=value;
  $('buyerRegistrationHint').hidden=!value;
  $('buyerPassword').minLength=value?12:1;
  $('buyerPassword').autocomplete=value?'new-password':'current-password';
  $('buyerAuthSubmit').textContent=value?'Create account':'Log in';
  $('toggleBuyerRegistration').textContent=value?'Already have an account? Log in':"Don't have an account? Create an account";
  $('signInTitle').textContent=value?'Create Buyer account':'Buyer login';
  $('signInDescription').textContent=value?'Set up your account to save purchases and receipts.':'Sign in to shop and keep your purchase receipts.';
  $('buyerAuthStatus').hidden=true;
}
async function loadBuyerAccess() {
  if (!$('buyerPasswordForm')) return false;
  $('buyerPasswordForm').hidden=false; $('buyerCredentials').disabled=true; $('toggleBuyerRegistration').disabled=true;
  setBuyerRegistrationMode(false);
  try {
    const response=await fetch('/api/auth/buyer/status',{cache:'no-store'});
    if(!response.ok)throw new Error('Could not check your account. Reload this page to try again.');
    const result=await response.json();
    if(result.user){signedInUser=result.user;buyerAccountMode=true;demoMode=false;await start();return true;}
  } catch(error){$('buyerAuthStatus').textContent=error.message;$('buyerAuthStatus').hidden=false;}
  finally{$('buyerCredentials').disabled=false;$('toggleBuyerRegistration').disabled=false;}
  return false;
}
$('toggleBuyerRegistration')?.addEventListener('click',()=>{if(!buyerAuthPending)setBuyerRegistrationMode(!buyerRegistrationMode)});
$('buyerPasswordForm')?.addEventListener('submit',async(event)=>{
  event.preventDefault(); if(buyerAuthPending)return;
  const payload={username:$('buyerUsername').value,password:$('buyerPassword').value};
  if(buyerRegistrationMode){payload.name=$('buyerDisplayName').value;payload.confirmPassword=$('buyerConfirmPassword').value;}
  buyerAuthPending=true; $('buyerCredentials').disabled=true; $('toggleBuyerRegistration').disabled=true; $('buyerAuthStatus').hidden=true;
  try {
    const response=await fetch(buyerRegistrationMode?'/api/auth/buyer/register':'/api/auth/buyer/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const result=await response.json();if(!response.ok)throw new Error(result.error || 'Could not log in. Please try again.');
    $('buyerPasswordForm').reset(); signedInUser=result.user; buyerAccountMode=true;demoMode=false;uncertainSave=false;await start();
  } catch(error){
    $('buyerPassword').value='';$('buyerConfirmPassword').value='';$('buyerAuthStatus').textContent=error.message;$('buyerAuthStatus').hidden=false;
  } finally {
    buyerAuthPending=false;$('buyerCredentials').disabled=false;$('toggleBuyerRegistration').disabled=false;
  }
});
