import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export default function Modal({ title, children, footer, onClose, size = '' }) {
    const ref = useRef(null);

    // Keep a stable ref to onClose so the Escape listener never needs to re-register
    const onCloseRef = useRef(onClose);
    useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

    // Escape key — registered once, always calls the latest onClose via ref
    useEffect(() => {
        const handler = (e) => { if (e.key === 'Escape') onCloseRef.current(); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []); // ← empty: never re-runs, never re-focuses

    // Auto-focus the first real form field — runs once on mount only
    useEffect(() => {
        const first = ref.current?.querySelector('input:not([type=hidden]),select,textarea');
        if (first) first.focus();
    }, []); // ← empty: runs once, won't steal focus on re-render

    return (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
            <div className={`modal-box ${size === 'lg' ? 'modal-lg' : ''}`} ref={ref}>
                <div className="modal-header">
                    <span>{title}</span>
                    <button className="btn-icon" onClick={onClose}><X size={17} /></button>
                </div>
                <div className="modal-body">{children}</div>
                {footer && <div className="modal-footer">{footer}</div>}
            </div>
        </div>
    );
}
