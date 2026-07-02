import { useEffect, useState, lazy, Suspense } from 'react';
import { createHashRouter, RouterProvider } from 'react-router-dom';
import Layout from './components/Layout';
import { seedIfEmpty } from './db/seed';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Income = lazy(() => import('./pages/Income'));
const IncomeGroup = lazy(() => import('./pages/IncomeGroup'));
const Expense = lazy(() => import('./pages/Expense'));
const ExpenseGroup = lazy(() => import('./pages/ExpenseGroup'));
const Transactions = lazy(() => import('./pages/Transactions'));
const Settings = lazy(() => import('./pages/Settings'));

const fb = <div style={{ padding: 40, color: '#878d98' }}>Загрузка…</div>;
const page = (el: React.ReactNode) => <Suspense fallback={fb}>{el}</Suspense>;

const router = createHashRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: page(<Dashboard />) },
      { path: 'income', element: page(<Income />) },
      { path: 'income/:group', element: page(<IncomeGroup />) },
      { path: 'expense', element: page(<Expense />) },
      { path: 'expense/:group', element: page(<ExpenseGroup />) },
      { path: 'transactions', element: page(<Transactions />) },
      { path: 'settings', element: page(<Settings />) },
    ],
  },
]);

export default function App() {
  const [ready, setReady] = useState(false);
  useEffect(() => { seedIfEmpty().then(() => setReady(true)); }, []);
  if (!ready) return fb;
  return <RouterProvider router={router} />;
}
