import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

function createClientRequestId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getResponseRequestId(error) {
    return error?.response?.headers?.['x-request-id'] || error?.response?.data?.request_id || null;
}

const api = axios.create({ baseURL: `${API_BASE_URL}/api/v1` });
const auth = axios.create({ baseURL: `${API_BASE_URL}/auth` });

// Add JWT token and request ID to every request
api.interceptors.request.use((config) => {
    config.headers = config.headers || {};
    if (!config.headers['X-Request-ID']) {
        config.headers['X-Request-ID'] = createClientRequestId();
    }

    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

auth.interceptors.request.use((config) => {
    config.headers = config.headers || {};
    if (!config.headers['X-Request-ID']) {
        config.headers['X-Request-ID'] = createClientRequestId();
    }

    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

export const authAPI = {
    login: (username, password) => {
        const params = new URLSearchParams();
        params.append('username', username);
        params.append('password', password);
        return auth.post('/login', params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
    },
    changePassword: (old_password, new_password) => auth.post('/change-password', { old_password, new_password }),
    getMe: () => auth.get('/me'),
    logout: () => auth.post('/logout'),
};

// Response interceptor: keep auth handling and surface request IDs for debugging.
const onResponseError = (error) => {
    if (error?.response?.status === 401) {
        // Only redirect if it's not a login attempt itself
        if (!error?.config?.url?.includes('/login')) {
            localStorage.removeItem('token');
            window.location.href = '/login';
        }
    }

    const requestId = getResponseRequestId(error);
    if (requestId || error?.response?.status >= 500) {
        console.error('[API Error]', {
            method: error?.config?.method?.toUpperCase?.() || error?.config?.method,
            url: error?.config?.url,
            status: error?.response?.status,
            requestId,
            detail: error?.response?.data?.detail || error?.message,
        });
    }

    return Promise.reject(error);
};
api.interceptors.response.use(res => res, onResponseError);
auth.interceptors.response.use(res => res, onResponseError);

// Products
export const getProducts = (include_archived = false, params = {}) => api.get('/products', { params: { include_archived, ...params } });
export const getProduct = (id) => api.get(`/products/${id}`);
export const createProduct = (data) => api.post('/products', data);
export const updateProduct = (id, data) => api.put(`/products/${id}`, data);
export const archiveProduct = (id) => api.post(`/products/${id}/archive`);
export const unarchiveProduct = (id) => api.post(`/products/${id}/unarchive`);
export const bulkUnarchiveProducts = (productIds) => api.post('/products/bulk-unarchive', { product_ids: productIds });

// Barcodes
export const getBarcodeInfo = (bc) => api.get(`/barcodes/${bc}`);
export const createBarcode = (d) => api.post('/barcodes', d);

// Suppliers
export const getSuppliers = () => api.get('/suppliers');
export const getSupplier = (id) => api.get(`/suppliers/${id}`);
export const createSupplier = (data) => api.post('/suppliers', data);
export const updateSupplier = (id, data) => api.put(`/suppliers/${id}`, data);

// Customers
export const getCustomers = () => api.get('/customers');
export const getCustomer = (id) => api.get(`/customers/${id}`);
export const createCustomer = (data) => api.post('/customers', data);
export const updateCustomer = (id, data) => api.put(`/customers/${id}`, data);
export const getCustomerLedger = (id, historyLimit = 50) => api.get(`/customers/${id}/ledger?history_limit=${historyLimit}`);
export const getCustomerLedgerOverview = (params = {}) => api.get('/customers/ledger-overview', { params });
export const getSupplierLedger = (id, historyLimit = 50) => api.get(`/suppliers/${id}/ledger?history_limit=${historyLimit}`);
export const getSupplierLedgerOverview = (params = {}) => api.get('/suppliers/ledger-overview', { params });

// Purchase Invoices
export const getPurchaseInvoices = () => api.get('/purchase-invoices');
export const getPurchaseInvoice = (id) => api.get(`/purchase-invoices/${id}`);
export const createPurchaseInvoice = (data, config = {}) => api.post('/purchase-invoices', data, config);

// Stock Batches
export const getStockBatchesForProduct = (productId) =>
    api.get(`/stock-batches/product/${productId}`);

// Sales
export const getSales = () => api.get('/sales');
export const getSale = (id) => api.get(`/sales/${id}`);
export const createSale = (data) => api.post('/sales', data);
export const updateSale = (id, data) => api.put(`/sales/${id}`, data);
export const getSalePayments = (billId) => api.get(`/sales/${billId}/payments`);
export const createSalePayment = (billId, data) => api.post(`/sales/${billId}/payments`, data);

// Payments
export const getPayments = () => api.get('/payments');
export const createPayment = (data) => api.post('/payments', data);

// Stock Ledger
export const getStockLedger = (productId) =>
    api.get(`/stock-ledger${productId ? `?product_id=${productId}` : ''}`);

export const getStockAdjustments = () => api.get('/stock-adjustments');
export const adjustStock = (data) => api.post('/stock-adjustments', data);

// Daily Ledger
export const getDailyLedger = (ledgerDate) => api.get(`/daily-ledger?ledger_date=${ledgerDate}`);
export const getAccountingSummary = () => api.get('/accounting/summary');

// Credit Notes
export const getCreditNotes = () => api.get('/credit-notes');
export const getCreditNote = (id) => api.get(`/credit-notes/${id}`);
export const createCreditNote = (data) => api.post('/credit-notes', data);

// Sales Returns
export const getSalesReturns = () => api.get('/sales-returns');
export const getSalesReturn = (id) => api.get(`/sales-returns/${id}`);
export const createSalesReturn = (data) => api.post('/sales-returns', data);

// Supplier Stock Returns
export const getStockReturns = () => api.get('/stock-returns');
export const getStockReturn = (id) => api.get(`/stock-returns/${id}`);
export const createStockReturn = (data) => api.post('/stock-returns', data);
export const updateStockReturn = (id, data) => api.put(`/stock-returns/${id}`, data);

// Supplier Payments
export const getSupplierPayments = () => api.get('/supplier-payments');
export const createSupplierPayment = (data) => api.post('/supplier-payments', data);

// Business Settings
export const getBusinessSettings = () => api.get('/settings/business');
export const updateBusinessSettings = (data) => api.put('/settings/business', data);

export default api;
