import { useEffect, useMemo, useState } from 'react';
import { FileText } from 'lucide-react';
import { getStockReturns, getSuppliers } from '../api';
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

const returnTabs = [
    { label: 'Supplier Stock Returns', path: '/stock-returns', end: true },
    { label: 'Supplier Credit Notes', path: '/credit-notes' },
    { label: 'Damage / Expiry', path: '/stock-adjustments' },
    { label: 'Return History', path: '/returns-history' },
];

export default function CreditNotes() {
    const { addToast } = useToast();
    const [loading, setLoading] = useState(true);
    const [stockReturns, setStockReturns] = useState([]);
    const [suppliers, setSuppliers] = useState([]);

    useEffect(() => {
        let active = true;
        const load = async () => {
            setLoading(true);
            const [stockReturnsResult, suppliersResult] = await Promise.allSettled([
                getStockReturns(),
                getSuppliers(),
            ]);

            if (!active) return;

            if (stockReturnsResult.status === 'fulfilled') {
                setStockReturns(stockReturnsResult.value.data);
            } else {
                addToast(getApiErrorMessage(stockReturnsResult.reason, 'Failed to load supplier stock returns'), 'error');
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

    const suppliersById = useMemo(
        () => Object.fromEntries(suppliers.map(supplier => [supplier.id, supplier])),
        [suppliers],
    );

    const supplierCreditNotes = useMemo(
        () => stockReturns.filter(entry => Number(entry.credit_amount || 0) > 0 || entry.status === 'Accepted'),
        [stockReturns],
    );

    return (
        <div style={{ display: 'grid', gap: '1rem' }}>
            <div>
                <div className="page-header">
                    <div>
                        <h2 style={{ fontSize: '1.15rem', marginBottom: '0.2rem' }}>Supplier Credit Notes</h2>
                        <p style={{ color: 'var(--text-muted)' }}>Credit notes received from suppliers against stock returned to supplier/company.</p>
                    </div>
                </div>
                <ModuleTabs tabs={returnTabs} />
            </div>

            <div className="surface" style={{ overflow: 'hidden' }}>
                {loading ? (
                    <div style={{ padding: '1.2rem' }}>
                        {[...Array(6)].map((_, index) => <div key={index} className="skeleton" style={{ height: 42, marginBottom: 8 }} />)}
                    </div>
                ) : supplierCreditNotes.length === 0 ? (
                    <div className="empty-state" style={{ minHeight: 180 }}>
                        <FileText size={34} />
                        <span>No supplier credit notes yet</span>
                        <span style={{ color: 'var(--text-muted)' }}>Accepted supplier returns with credit amounts will appear here.</span>
                    </div>
                ) : (
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Supplier</th>
                                <th>Linked Stock Return</th>
                                <th>Credit Note Number</th>
                                <th>Credit Note Date</th>
                                <th>Status</th>
                                <th style={{ textAlign: 'right' }}>Amount</th>
                                <th>Notes</th>
                            </tr>
                        </thead>
                        <tbody>
                            {supplierCreditNotes.map(note => (
                                <tr key={note.id}>
                                    <td>{suppliersById[note.supplier_id]?.company_name || `Supplier #${note.supplier_id}`}</td>
                                    <td style={{ fontWeight: 600 }}>{note.return_number || `STR-${note.id}`}</td>
                                    <td>{note.credit_note_number || `Linked to ${note.return_number || `STR-${note.id}`}`}</td>
                                    <td>{new Date(note.return_date).toLocaleDateString('en-IN')}</td>
                                    <td><span className="badge badge-muted">{note.status || 'Pending'}</span></td>
                                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(note.credit_amount)}</td>
                                    <td>{note.notes || note.reason || '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
