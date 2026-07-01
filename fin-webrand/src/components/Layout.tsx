import { NavLink, Outlet } from 'react-router-dom';
import Icon from './Icon';

const NAV = [
  { to: '/', icon: 'overview', label: 'Обзор', end: true },
  { to: '/income', icon: 'income', label: 'Доход' },
  { to: '/expense', icon: 'expense', label: 'Расход' },
  { to: '/transactions', icon: 'transactions', label: 'Транзакции' },
  { to: '/settings', icon: 'settings', label: 'Настройки' },
];

export default function Layout() {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div>
            <b>Fin System</b>
            <span>WebRand</span>
          </div>
        </div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
            <span className="ic"><Icon name={n.icon} /></span>
            {n.label}
          </NavLink>
        ))}
        <div className="spacer" />
        <div className="nav-item mini" style={{ cursor: 'default' }}>
          <span className="ic"><Icon name="currency" size={16} /></span>сомони (TJS)
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
