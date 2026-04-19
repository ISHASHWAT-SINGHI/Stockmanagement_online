export default function KbdHint({ hints }) {
    return (
        <div className="kbd-bar">
            {hints.map((h, i) => (
                <span key={i} className="kbd-bar-item">
                    <kbd className="kbd">{h.key}</kbd>
                    <span>{h.label}</span>
                </span>
            ))}
        </div>
    );
}
