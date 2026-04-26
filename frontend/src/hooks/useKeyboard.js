import { useEffect } from 'react';

/**
 * Register a keyboard shortcut.
 * @param {string} key   - e.g. 'n', 's', '1'
 * @param {function} cb  - callback to invoke
 * @param {{ alt?, ctrl?, shift? }} mods - modifiers (default: alt)
 */
export function useKeyboardShortcut(key, cb, mods = { alt: true }) {
    useEffect(() => {
        const { alt = false, ctrl = false, shift = false, allowInInput = false } = mods;
        const handler = (e) => {
            if (alt && !e.altKey) return;
            if (ctrl && !e.ctrlKey) return;
            if (shift && !e.shiftKey) return;
            if (e.key.toLowerCase() !== key.toLowerCase()) return;
            const tag = document.activeElement?.tagName?.toLowerCase();
            const isEditable = tag === 'input' || tag === 'textarea' || tag === 'select' || document.activeElement?.isContentEditable;
            if (isEditable && !allowInInput) return;
            e.preventDefault();
            cb();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [key, cb, mods]);
}
