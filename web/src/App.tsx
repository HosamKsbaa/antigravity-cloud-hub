import React, { useEffect, useState } from 'react';
import { api, UserProfile } from './api/client.js';
import { Navbar } from './components/Navbar.js';
import { Login } from './pages/Login.js';
import { Dashboard } from './pages/Dashboard.js';
import { RegistryCatalog } from './pages/RegistryCatalog.js';
import { ApiKeys } from './pages/ApiKeys.js';
import { Users } from './pages/Users.js';

export const App: React.FC = () => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return (
      localStorage.getItem('agy_theme') === 'dark' ||
      (!('agy_theme' in localStorage) &&
        window.matchMedia('(prefers-color-scheme: dark)').matches)
    );
  });

  // Sync dark mode class
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('agy_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('agy_theme', 'light');
    }
  }, [darkMode]);

  // Initial Auth Verification & Path Synchronization
  useEffect(() => {
    const initAuth = async () => {
      try {
        const path = window.location.pathname.replace(/^\/+/, '');
        if (['dashboard', 'catalog', 'api-keys', 'users'].includes(path)) {
          setActiveTab(path);
        }

        const me = await api.getMe();
        setUser(me.user);
      } catch {
        setUser(null);
      } finally {
        setAuthLoading(false);
      }
    };

    initAuth();

    const handleUnauthorized = () => {
      setUser(null);
    };

    window.addEventListener('agy_unauthorized', handleUnauthorized);
    window.addEventListener('popstate', () => {
      const path = window.location.pathname.replace(/^\/+/, '');
      if (['dashboard', 'catalog', 'api-keys', 'users'].includes(path)) {
        setActiveTab(path);
      }
    });

    return () => {
      window.removeEventListener('agy_unauthorized', handleUnauthorized);
    };
  }, []);

  const handleLogout = async () => {
    await api.logout();
    setUser(null);
    window.history.pushState({}, '', '/login');
  };

  const handleLoginSuccess = (profile: UserProfile) => {
    setUser(profile);
    setActiveTab('dashboard');
    window.history.pushState({}, '', '/dashboard');
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-sky-500 border-t-transparent rounded-full animate-spin" />
          <div className="text-xs text-slate-500 font-medium">Loading Antigravity Cloud Hub...</div>
        </div>
      </div>
    );
  }

  // If unauthenticated or navigating to /login
  if (!user) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors">
      <Navbar
        user={user}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onLogout={handleLogout}
        darkMode={darkMode}
        setDarkMode={setDarkMode}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'dashboard' && <Dashboard user={user} />}
        {activeTab === 'catalog' && <RegistryCatalog user={user} />}
        {activeTab === 'api-keys' && <ApiKeys user={user} />}
        {activeTab === 'users' && user.role === 'admin' && <Users currentUser={user} />}
        {activeTab === 'users' && user.role !== 'admin' && (
          <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
            <h3 className="font-bold text-slate-800 dark:text-slate-200">Access Restricted</h3>
            <p className="text-xs text-slate-500 mt-1">
              You must be an administrator to view and manage users.
            </p>
          </div>
        )}
      </main>
    </div>
  );
};
