import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

const api = axios.create({ baseURL: `${API_BASE_URL}/api/v1` });
const auth = axios.create({ baseURL: `${API_BASE_URL}/auth` });

// Add JWT token to every request
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});
auth.interceptors.request.use((config) => {
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

// Global 401 interceptor: redirect to login if token is rejected
const on401 = (error) => {
    if (error?.response?.status === 401) {
        // Only redirect if it's not a login attempt itself
        if (!error?.config?.url?.includes('/login')) {
            localStorage.removeItem('token');
            window.location.href = '/login';
        }
    }
    return Promise.reject(error);
};
api.interceptors.response.use(res => res, on401);
auth.interceptors.response.use(res => res, on401);

// ─── Products ────────────────────────────────────────────────────────────────
export const getProducts = (include_archived = false) => api.get(`/products?include_archived=${include_archived}`);
export const getProduct = (id) => api.get(`/products/${id}`);
export const createProduct = (data) => api.post('/products', data);
export const updateProduct = (id, data) => api.put(`/products/${id}`, data);
export const archiveProduct = (id) => api.post(`/products/${id}/archive`);
export const unarchiveProduct = (id) => api.post(`/products/${id}/unarchive`);
export const bulkUnarchiveProducts = (productIds) => api.post('/products/bulk-unarchive', { product_ids: productIds });

// ─── Barcodes ────────────────────────────────────────────────────────────────
export const getBarcodeInfo = (bc) => api.get(`/barcodes/${bc}`);
export const createBarcode = (d) => api.post('/barcodes', d);

// ─── Suppliers ───────────────────────────────────────────────────────────────
export const getSuppliers = () => api.get('/suppliers');
export const getSupplier = (id) => api.get(`/suppliers/${id}`);
export const createSupplier = (data) => api.post('/suppliers', data);
export const updateSupplier = (id, data) => api.put(`/suppliers/${id}`, data);

// ─── Customers ───────────────────────────────────────────────────────────────
export const getCustomers = () => api.get('/customers');
export const getCustomer = (id) => api.get(`/customers/${id}`);
export const createCustomer = (data) => api.post('/customers', data);
export const updateCustomer = (id, data) => api.put(`/customers/${id}`, data);
export const getCustomerLedger = (id) => api.get(`/customers/${id}/ledger`);

// ─── Purchase Invoices ───────────────────────────────────────────────────────
export const getPurchaseInvoices = () => api.get('/purchase-invoices');
export const getPurchaseInvoice = (id) => api.get(`/purchase-invoices/${id}`);
export const createPurchaseInvoice = (data) => api.post('/purchase-invoices', data);

// ─── Stock Batches ───────────────────────────────────────────────────────────
export const getStockBatchesForProduct = (productId) =>
    api.get(`/stock-batches/product/${productId}`);

// ─── Sales ───────────────────────────────────────────────────────────────────
export const getSales = () => api.get('/sales');
export const getSale = (id) => api.get(`/sales/${id}`);
export const createSale = (data) => api.post('/sales', data);
export const updateSale = (id, data) => api.put(`/sales/${id}`, data);

// ─── Payments ────────────────────────────────────────────────────────────────
export const createPayment = (data) => api.post('/payments', data);

// ─── Stock Ledger ─────────────────────────────────────────────────────────────
export const getStockLedger = (productId) =>
    api.get(`/stock-ledger${productId ? `?product_id=${productId}` : ''}`);

export const adjustStock = (data) => api.post('/stock-adjustments', data);

// ─── Business Settings ───────────────────────────────────────────────────────
export const getBusinessSettings = () => api.get('/settings/business');
export const updateBusinessSettings = (data) => api.put('/settings/business', data);

export default api;
