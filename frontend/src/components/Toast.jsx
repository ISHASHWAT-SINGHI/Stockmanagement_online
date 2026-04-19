import { CheckCircle, XCircle, Info, X } from 'lucide-react';
import { useToast } from '../hooks/useToast';

const icons = {
    success: <CheckCircle size={16} color="var(--success)" />,
    error: <XCircle size={16} color="var(--danger)" />,
    info: <Info size={16} color="var(--info)" />,
};

export default function Toast() {
    const { toasts, removeToast } = useToast();

    return (
        <div className="toast-container">
            {toasts.map(t => (
                <div key={t.id} className={`toast toast-${t.type}`}>
                    {icons[t.type]}
                    <span style={{ flex: 1 }}>{t.message}</span>
                    <button className="btn-icon" onClick={() => removeToast(t.id)} style={{ padding: '0.2rem' }}>
                        <X size={13} />
                    </button>
                </div>
            ))}
        </div>
    );
}
