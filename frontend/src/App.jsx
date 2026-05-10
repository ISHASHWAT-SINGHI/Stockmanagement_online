import './index.css'
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ToastProvider } from './hooks/useToast';
import MainLayout from './layouts/MainLayout';
import Dashboard from './pages/Dashboard';
import Products from './pages/Products';
import Sales from './pages/Sales';
import Purchases from './pages/Purchases';
import Contacts from './pages/Contacts';
import DailyLedger from './pages/DailyLedger';
import CreditNotes from './pages/CreditNotes';
import SalesReturns from './pages/SalesReturns';
import StockReturns from './pages/StockReturns';
import CustomerLedger from './pages/CustomerLedger';
import SupplierLedger from './pages/SupplierLedger';
import Payments from './pages/Payments';
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import Settings from './pages/Settings';

const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem('token');
  const location = useLocation();

  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return children;
};

function App() {
  return (
    <ToastProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/change-password" element={<ChangePassword />} />

          <Route path="/" element={<ProtectedRoute><MainLayout /></ProtectedRoute>}>
            <Route index element={<Dashboard />} />
            <Route path="products" element={<Products />} />
            <Route path="sales" element={<Sales />} />
            <Route path="sales/history" element={<Sales />} />
            <Route path="purchases" element={<Purchases />} />
            <Route path="purchases/history" element={<Purchases />} />
            <Route path="contacts" element={<Contacts />} />
            <Route path="daily-ledger" element={<DailyLedger />} />
            <Route path="credit-notes" element={<CreditNotes />} />
            <Route path="sales-returns" element={<SalesReturns />} />
            <Route path="stock-returns" element={<StockReturns />} />
            <Route path="stock-adjustments" element={<StockReturns />} />
            <Route path="returns-history" element={<StockReturns />} />
            <Route path="customer-ledger" element={<CustomerLedger />} />
            <Route path="supplier-ledger" element={<SupplierLedger />} />
            <Route path="payments" element={<Payments />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </Router>
    </ToastProvider>
  );
}

export default App;
