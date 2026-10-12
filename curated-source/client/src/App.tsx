import { Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { useAuth } from './lib/auth';
import { lazyPage } from './lib/lazy';
import Home from './pages/Home';
import Catalog from './pages/Catalog';
import ListingPage from './pages/ListingPage';
import NotFound from './pages/NotFound';

const GalleryPage = lazyPage(() => import('./pages/GalleryPage'));
const Galleries = lazyPage(() => import('./pages/Galleries'));
const Login = lazyPage(() => import('./pages/Login'));
const AuthComplete = lazyPage(() => import('./pages/AuthComplete'));
const Register = lazyPage(() => import('./pages/Register'));
const Checkout = lazyPage(() => import('./pages/Checkout'));
const Orders = lazyPage(() => import('./pages/account/Orders'));
const OrderPage = lazyPage(() => import('./pages/account/OrderPage'));
const Settings = lazyPage(() => import('./pages/account/Settings'));
const Sell = lazyPage(() => import('./pages/Sell'));
const VendorDashboard = lazyPage(() => import('./pages/vendor/VendorDashboard'));
const ListingEditor = lazyPage(() => import('./pages/vendor/ListingEditor'));
const AdminDashboard = lazyPage(() => import('./pages/admin/AdminDashboard'));
const LegalPage = lazyPage(() => import('./pages/legal/LegalPage'));
const Contact = lazyPage(() => import('./pages/Contact'));

/** Client-side guard. The API enforces the same permissions server-side. */
function Guard({ permission, children }: { permission?: string; children: ReactNode }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <Spinner />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (permission && !user.permissions.includes(permission)) return <NotFound forbidden />;
  return <>{children}</>;
}

export function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="gallery" element={<Catalog />} />
          <Route path="listing/:slug" element={<ListingPage />} />
          <Route path="galleries" element={<Galleries />} />
          <Route path="galleries/:slug" element={<GalleryPage />} />
          <Route path="login" element={<Login />} />
          <Route path="register" element={<Register />} />
          <Route path="auth/complete" element={<AuthComplete />} />
          <Route path="sell" element={<Sell />} />
          <Route path="checkout/:listingId" element={<Guard permission="order:create"><Checkout /></Guard>} />
          <Route path="account/orders" element={<Guard><Orders /></Guard>} />
          <Route path="account/settings" element={<Guard><Settings /></Guard>} />
          <Route path="orders/:id" element={<Guard><OrderPage /></Guard>} />
          <Route path="vendor" element={<Guard permission="listing:manage"><VendorDashboard /></Guard>} />
          <Route path="vendor/listings/new" element={<Guard permission="listing:manage"><ListingEditor /></Guard>} />
          <Route path="vendor/listings/:id" element={<Guard permission="listing:manage"><ListingEditor /></Guard>} />
          <Route path="admin" element={<Guard permission="admin:access"><AdminDashboard /></Guard>} />
          <Route path="legal/:doc" element={<LegalPage />} />
          <Route path="contact" element={<Contact />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
