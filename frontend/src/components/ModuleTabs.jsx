import { NavLink } from 'react-router-dom';

export default function ModuleTabs({ tabs }) {
    return (
        <div className="module-tabs">
            <div className="module-tabs__row">
                {tabs.map(tab => (
                    <NavLink
                        key={tab.path}
                        to={tab.path}
                        end={tab.end}
                        className={({ isActive }) => `module-tabs__link ${isActive ? 'is-active' : ''}`}
                    >
                        {tab.label}
                    </NavLink>
                ))}
            </div>
        </div>
    );
}
