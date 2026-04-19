import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, Users, Truck, ShoppingCart, AlertTriangle, TrendingUp } from 'lucide-react';
import { getProducts, getSuppliers, getCustomers, getSales } from '../api';
import { useKeyboardShortcut } from '../hooks/useKeyboard';

function StatCard({ title, value, icon: Icon, color, onClick, shortcut }) {
    return (
        <div
            className="stat-card"
            onClick={onClick}
            style={{ cursor: onClick ? 'pointer' : 'default' }}
        >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                    <p style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</p>
                    <p style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>
                        {value === null ? <span className="skeleton" style={{ display: 'inline-block', width: 60, height: 32 }} /> : value}
                    </p>
                </div>
                <div style={{
                    width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                    background: color + '22',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <Icon size={20} color={color} />
                </div>
            </div>
            {shortcut && <div style={{ marginTop: '0.75rem' }}><kbd className="kbd">Alt+{shortcut}</kbd></div>}
        </div>
    );
}

export default function Dashboard() {
    const navigate = useNavigate();
    const [stats, setStats] = useState({ products: null, suppliers: null, customers: null, sales: null });
    const [lowStock, setLowStock] = useState([]);
    const [recentSales, setRecentSales] = useState([]);

    useKeyboardShortcut('n', () => navigate('/sales'));

    const load = useCallback(async () => {
        try {
            const [pRes, sRes, cRes, salRes] = await Promise.all([
                getProducts(), getSuppliers(), getCustomers(), getSales()
            ]);
            const products = pRes.data;
            const sales = salRes.data;
            setStats({
                products: products.length,
                suppliers: sRes.data.length,
                customers: cRes.data.length,
                sales: sales.length,
            });
            setLowStock(products.filter(p => p.current_stock <= 5).slice(0, 8));
            setRecentSales([...sales].reverse().slice(0, 5));
        } catch (e) {
            console.error(e);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    return (
        <div>
            {/* Stat Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                <StatCard title="Products" value={stats.products} icon={Package} color="#6366f1" onClick={() => navigate('/products')} shortcut="2" />
                <StatCard title="Sales" value={stats.sales} icon={ShoppingCart} color="#10b981" onClick={() => navigate('/sales')} shortcut="3" />
                <StatCard title="Purchases" value={stats.suppliers} icon={Truck} color="#f59e0b" onClick={() => navigate('/purchases')} shortcut="4" />
                <StatCard title="Customers" value={stats.customers} icon={Users} color="#3b82f6" onClick={() => navigate('/contacts')} shortcut="5" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '1rem' }}>
                {/* Low Stock Alert */}
                <div className="surface" style={{ overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
                        <AlertTriangle size={16} color="var(--warning)" />
                        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Low Stock Alerts</span>
                        {lowStock.length > 0 && <span className="badge badge-warning" style={{ marginLeft: 'auto' }}>{lowStock.length}</span>}
                    </div>
                    {lowStock.length === 0 ? (
                        <div className="empty-state" style={{ padding: '2rem' }}>
                            <Package size={32} />
                            <span>All products are well stocked</span>
                        </div>
                    ) : (
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Product</th>
                                    <th>Brand</th>
                                    <th style={{ textAlign: 'right' }}>Stock</th>
                                </tr>
                            </thead>
                            <tbody>
                                {lowStock.map(p => (
                                    <tr key={p.id} onClick={() => navigate('/products')} style={{ cursor: 'pointer' }}>
                                        <td>{p.product_name}</td>
                                        <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{p.brand_name || '—'}</td>
                                        <td style={{ textAlign: 'right' }}>
                                            <span className={`badge ${p.current_stock === 0 ? 'badge-danger' : 'badge-warning'}`}>
                                                {p.current_stock}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* Recent Sales */}
                <div className="surface" style={{ overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
                        <TrendingUp size={16} color="var(--success)" />
                        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Recent Sales</span>
                    </div>
                    {recentSales.length === 0 ? (
                        <div className="empty-state" style={{ padding: '2rem' }}>
                            <ShoppingCart size={32} />
                            <span>No sales recorded yet</span>
                        </div>
                    ) : (
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Bill No.</th>
                                    <th>Status</th>
                                    <th style={{ textAlign: 'right' }}>Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {recentSales.map(s => (
                                    <tr key={s.id} onClick={() => navigate('/sales')} style={{ cursor: 'pointer' }}>
                                        <td style={{ fontWeight: 500 }}>{s.bill_number}</td>
                                        <td>
                                            <span className={`badge ${s.payment_status === 'Paid' ? 'badge-success' : s.payment_status === 'Partial' ? 'badge-warning' : 'badge-muted'}`}>
                                                {s.payment_status}
                                            </span>
                                        </td>
                                        <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--success)' }}>
                                            ₹{s.grand_total?.toFixed(2)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
}
