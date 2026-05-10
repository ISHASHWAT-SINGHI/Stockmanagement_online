import { useEffect, useMemo, useState } from 'react';
import { CreditCard } from 'lucide-react';
import { getPayments, getSupplierPayments, getCustomers, getSuppliers } from '../api';
import { useToast } from '../hooks/useToast';
import ModuleTabs from '../components/ModuleTabs';

function formatCurrency(value) {
    return `₹${Number(value || 0).toFixed(2)}`;
}

function getApiErrorMessage(error, fallback) {
    const message = error?.response?.data?.detail || error?.message || fallback;
    const requestId = error?.response?.headers?.['x-request-id'] || error?.response?.data?.request_id;
    return requestId ? `${message} (Ref: ${requestId})` : message;
}

const accountingTabs = [
    { label: 'Daily Ledger', path: '/daily-ledger' },
    { label: 'Customer Ledger', path: '/customer-ledger' },
    { label: 'Supplier Ledger', path: '/supplier-ledger' },
    { label: 'Payments', path: '/payments' },
];

export default function Payments() {
    const { addToast } = useToast();
    const [loading, setLoading] = useState(true);
    const [customerPayments, setCustomerPayments] = useState([]);
    const [supplierPayments, setSupplierPayments] = useState([]);
    const [customers, setCustomers] = useState([]);
    const [suppliers, setSuppliers] = useState([]);

    useEffect(() => {
        let active = true;
        const load = async () => {
            setLoading(true);
            const [customerPaymentsResult, supplierPaymentsResult, customersResult, suppliersResult] = await Promise.allSettled([
                getPayments(),
                getSupplierPayments(),
                getCustomers(),
                getSuppliers(),
            ]);

            if (!active) return;

            if (customerPaymentsResult.status === 'fulfilled') {
                setCustomerPayments(customerPaymentsResult.value.data);
            } else {
                addToast(getApiErrorMessage(customerPaymentsResult.reason, 'Failed to load customer payments'), 'error');
            }

            if (supplierPaymentsResult.status === 'fulfilled') {
                setSupplierPayments(supplierPaymentsResult.value.data);
            } else {
                addToast(getApiErrorMessage(supplierPaymentsResult.reason, 'Failed to load supplier payments'), 'error');
            }

            if (customersResult.status === 'fulfilled') {
                setCustomers(customersResult.value.data);
            }

            if (suppliersResult.status === 'fulfilled') {
                setSuppliers(suppliersResult.value.data);
            }

            setLoading(false);
        };

        load();
        return () => {
            active = false;
        };
    }, [addToast]);

    const customersById = useMemo(
        () => Object.fromEntries(customers.map(customer => [customer.id, customer])),
        [customers],
    );
    const suppliersById = useMemo(
        () => Object.fromEntries(suppliers.map(supplier => [supplier.id, supplier])),
        [suppliers],
    );

    return (
        <div style={{ display: 'grid', gap: '1rem' }}>
            <div>
                <div className="page-header">
                    <div>
                        <h2 style={{ fontSize: '1.15rem', marginBottom: '0.2rem' }}>Payments</h2>
                        <p style={{ color: 'var(--text-muted)' }}>Customer collections and supplier payments in one accounting view.</p>
                    </div>
                </div>
                <ModuleTabs tabs={accountingTabs} />
            </div>

            <div className="entry-layout" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
                <div className="surface" style={{ overflow: 'hidden' }}>
                    <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)' }}>
                        <p style={{ fontWeight: 700 }}>Customer Collections</p>
                    </div>
                    {loading ? (
                        <div style={{ padding: '1rem' }}>
                            {[...Array(5)].map((_, index) => <div key={index} className="skeleton" style={{ height: 38, marginBottom: 8 }} />)}
                        </div>
                    ) : customerPayments.length === 0 ? (
                        <div className="empty-state"><CreditCard size={32} /><span>No customer payments recorded</span></div>
                    ) : (
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Customer</th>
                                    <th>Mode</th>
                                    <th>Reference</th>
                                    <th style={{ textAlign: 'right' }}>Amount</th>
                                </tr>
                            </thead>
                            <tbody>
                                {customerPayments.map(payment => (
                                    <tr key={`customer-${payment.id}`}>
                                        <td>{new Date(payment.payment_date).toLocaleDateString('en-IN')}</td>
                                        <td>{customersById[payment.customer_id]?.name || 'Walk-in / Unlinked'}</td>
                                        <td>{payment.payment_mode}</td>
                                        <td>{payment.reference_number || '—'}</td>
                                        <td style={{ textAlign: 'right', color: 'var(--success)', fontWeight: 600 }}>{formatCurrency(payment.amount)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                <div className="surface" style={{ overflow: 'hidden' }}>
                    <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)' }}>
                        <p style={{ fontWeight: 700 }}>Supplier Payments</p>
                    </div>
                    {loading ? (
                        <div style={{ padding: '1rem' }}>
                            {[...Array(5)].map((_, index) => <div key={index} className="skeleton" style={{ height: 38, marginBottom: 8 }} />)}
                        </div>
                    ) : supplierPayments.length === 0 ? (
                        <div className="empty-state"><CreditCard size={32} /><span>No supplier payments recorded</span></div>
                    ) : (
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Supplier</th>
                                    <th>Mode</th>
                                    <th>Reference</th>
                                    <th style={{ textAlign: 'right' }}>Amount</th>
                                </tr>
                            </thead>
                            <tbody>
                                {supplierPayments.map(payment => (
                                    <tr key={`supplier-${payment.id}`}>
                                        <td>{new Date(payment.payment_date).toLocaleDateString('en-IN')}</td>
                                        <td>{suppliersById[payment.supplier_id]?.company_name || `Supplier #${payment.supplier_id}`}</td>
                                        <td>{payment.payment_mode}</td>
                                        <td>{payment.reference_number || '—'}</td>
                                        <td style={{ textAlign: 'right', color: 'var(--success)', fontWeight: 600 }}>{formatCurrency(payment.amount)}</td>
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
