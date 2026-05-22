import { AuthProvider, useAuth } from './context/AuthContext';
import { WishlistProvider } from './context/WishlistContext';
import { useRouter } from './hooks/useRouter';
import { Navbar } from './components/Navbar';
import { AdminSidebar } from './components/AdminSidebar';
import { AdminMobileNav } from './components/AdminMobileNav';
import { HomePage } from './pages/HomePage';
import { ProductPage } from './pages/ProductPage';
import { StorePage } from './pages/StorePage';
import { AuthPage } from './pages/AuthPage';
import { AdminOverview } from './pages/admin/AdminOverview';
import { AdminProducts } from './pages/admin/AdminProducts';
import { AdminUsers } from './pages/admin/AdminUsers';
import { AdminSettings } from './pages/admin/AdminSettings';

function currentPath(routeName: string): string {
  switch (routeName) {
    case 'admin':
      return '/admin';
    case 'admin-products':
      return '/admin/products';
    case 'admin-users':
      return '/admin/users';
    case 'admin-settings':
      return '/admin/settings';
    case 'auth':
      return '/auth';
    default:
      return '/';
  }
}

function AdminLayout({
  children,
  navigate,
  routePath,
}: {
  children: React.ReactNode;
  navigate: (path: string) => void;
  routePath: string;
}) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Chargement...</p>
      </div>
    );
  }

  if (!user) {
    navigate('/auth');
    return null;
  }

  return (
    <div className="min-h-screen bg-surface-alt">
      <Navbar navigate={navigate} currentRoute={routePath} />
      <div className="flex pt-16 md:pt-32">
        <AdminSidebar navigate={navigate} currentRoute={routePath} />
        <main className="flex-1 px-4 sm:px-6 lg:px-10 py-6 lg:py-10 pb-24 lg:pb-10">{children}</main>
      </div>
      <AdminMobileNav navigate={navigate} currentRoute={routePath} />
    </div>
  );
}

function PublicLayout({
  children,
  navigate,
  routePath,
}: {
  children: React.ReactNode;
  navigate: (path: string) => void;
  routePath: string;
}) {
  return (
    <div className="min-h-screen bg-surface-alt">
      <Navbar navigate={navigate} currentRoute={routePath} />
      <main className="pt-16 md:pt-32">{children}</main>
    </div>
  );
}

function AppRoutes() {
  const { route, navigate } = useRouter();
  const path = currentPath(route.name);

  if (route.name === 'auth') {
    return <AuthPage navigate={navigate} />;
  }

  if (route.name === 'admin') {
    return (
      <AdminLayout navigate={navigate} routePath={path}>
        <AdminOverview navigate={navigate} />
      </AdminLayout>
    );
  }

  if (route.name === 'admin-products') {
    return (
      <AdminLayout navigate={navigate} routePath={path}>
        <AdminProducts />
      </AdminLayout>
    );
  }

  if (route.name === 'admin-users') {
    return (
      <AdminLayout navigate={navigate} routePath={path}>
        <AdminUsers />
      </AdminLayout>
    );
  }

  if (route.name === 'admin-settings') {
    return (
      <AdminLayout navigate={navigate} routePath={path}>
        <AdminSettings />
      </AdminLayout>
    );
  }

  if (route.name === 'product') {
    return (
      <PublicLayout navigate={navigate} routePath={path}>
        <ProductPage id={route.id} navigate={navigate} />
      </PublicLayout>
    );
  }

  if (route.name === 'store') {
    return (
      <PublicLayout navigate={navigate} routePath={path}>
        <StorePage slug={route.slug} navigate={navigate} />
      </PublicLayout>
    );
  }

  return (
    <PublicLayout navigate={navigate} routePath={path}>
      <HomePage navigate={navigate} />
    </PublicLayout>
  );
}

function App() {
  return (
    <AuthProvider>
      <WishlistProvider>
        <AppRoutes />
      </WishlistProvider>
    </AuthProvider>
  );
}

export default App;
