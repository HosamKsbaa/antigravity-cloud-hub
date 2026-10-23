import React, { useEffect, useState } from 'react';
import { api, RegistryCatalogResponse, RegistryItem, UserProfile } from '../api/client.js';
import {
  Package,
  Sparkles,
  Download,
  Upload,
  Search,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  X,
} from 'lucide-react';

interface RegistryCatalogProps {
  user: UserProfile;
}

export const RegistryCatalog: React.FC<RegistryCatalogProps> = ({ user }) => {
  const [catalog, setCatalog] = useState<RegistryCatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'plugins' | 'skills'>('all');

  // Upload Modal State
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [packageType, setPackageType] = useState<'plugin' | 'skill'>('plugin');
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState('1.0.0');
  const [changelog, setChangelog] = useState('');
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  const isAdmin = user.role === 'admin';

  const fetchCatalog = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getRegistryCatalog();
      setCatalog(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch registry catalog.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCatalog();
  }, []);

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      alert('Please select a .tar.gz bundle file to upload.');
      return;
    }

    setUploadLoading(true);
    setUploadSuccess(null);
    setError(null);

    const formData = new FormData();
    formData.append('bundle', file);
    formData.append('version', version.trim());
    if (changelog.trim()) {
      formData.append('changelog', changelog.trim());
    }

    try {
      if (packageType === 'plugin') {
        await api.publishPlugin(formData);
        setUploadSuccess(`Successfully published plugin package!`);
      } else {
        await api.publishSkill(formData);
        setUploadSuccess(`Successfully published global skill package!`);
      }

      setShowUploadModal(false);
      setFile(null);
      setVersion('1.0.0');
      setChangelog('');
      await fetchCatalog();
    } catch (err: any) {
      setError(err.message || 'Package publish failed.');
    } finally {
      setUploadLoading(false);
    }
  };

  const allItems: Array<RegistryItem & { kind: 'plugin' | 'skill' }> = [
    ...(catalog?.plugins || []).map((p) => ({ ...p, kind: 'plugin' as const })),
    ...(catalog?.skills || []).map((s) => ({ ...s, kind: 'skill' as const })),
  ];

  const filteredItems = allItems.filter((item) => {
    if (categoryFilter === 'plugins' && item.kind !== 'plugin') return false;
    if (categoryFilter === 'skills' && item.kind !== 'skill') return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = item.name.toLowerCase().includes(q);
      const matchDisplayName = (item.displayName || '').toLowerCase().includes(q);
      const matchDesc = (item.description || '').toLowerCase().includes(q);
      const matchTag = (item.tags || []).some((t) => t.toLowerCase().includes(q));
      return matchName || matchDisplayName || matchDesc || matchTag;
    }

    return true;
  });

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <Package className="w-5 h-5 text-sky-500" />
            Antigravity Plugins & Global Skills Registry
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Cloud distribution catalog integrated with local <code className="font-mono text-sky-600 dark:text-sky-400">hdm-plugin-hub</code> IDE extension
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={fetchCatalog}
            disabled={loading}
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition"
            title="Refresh Catalog"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-sky-500' : ''}`} />
          </button>

          {isAdmin && (
            <button
              onClick={() => setShowUploadModal(true)}
              className="flex items-center gap-2 px-3.5 py-2 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-600 hover:to-indigo-700 text-white text-xs font-semibold rounded-xl shadow-md shadow-sky-500/20 transition"
            >
              <Upload className="w-4 h-4" />
              Publish Package
            </button>
          )}
        </div>
      </div>

      {uploadSuccess && (
        <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          <span>{uploadSuccess}</span>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        {/* Category Filter Pills */}
        <div className="flex items-center gap-1.5 w-full sm:w-auto">
          <button
            onClick={() => setCategoryFilter('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition ${
              categoryFilter === 'all'
                ? 'bg-sky-500 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            All Packages ({allItems.length})
          </button>
          <button
            onClick={() => setCategoryFilter('plugins')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition ${
              categoryFilter === 'plugins'
                ? 'bg-sky-500 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            Plugins ({catalog?.plugins?.length || 0})
          </button>
          <button
            onClick={() => setCategoryFilter('skills')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition ${
              categoryFilter === 'skills'
                ? 'bg-sky-500 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Global Skills ({catalog?.skills?.length || 0})
          </button>
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-72">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
            <Search className="w-3.5 h-3.5" />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search plugins & skills..."
            className="w-full pl-9 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs focus:ring-2 focus:ring-sky-500 outline-none dark:text-white"
          />
        </div>
      </div>

      {/* Grid of Catalog Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredItems.map((item) => {
          const isPlugin = item.kind === 'plugin';
          const downloadUrl = isPlugin
            ? `/api/plugins/${encodeURIComponent(item.id)}/download`
            : `/api/skills/${encodeURIComponent(item.id)}/download`;

          return (
            <div
              key={`${item.kind}-${item.id}`}
              className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm flex flex-col justify-between hover:border-sky-300 dark:hover:border-sky-700 transition"
            >
              <div>
                {/* Header Badge */}
                <div className="flex items-start justify-between gap-2 mb-2.5">
                  <div className="flex items-center gap-2">
                    <div
                      className={`p-2 rounded-xl text-white ${
                        isPlugin ? 'bg-sky-500' : 'bg-indigo-500'
                      }`}
                    >
                      {isPlugin ? <Package className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-slate-900 dark:text-white leading-tight">
                        {item.displayName || item.name}
                      </h4>
                      <div className="text-[11px] font-mono text-slate-400">
                        {item.id}
                      </div>
                    </div>
                  </div>

                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                    v{item.latestVersion}
                  </span>
                </div>

                {/* Description */}
                <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-3 mb-3">
                  {item.description || 'No package description provided.'}
                </p>

                {/* Feature Tags */}
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {item.hasRules && (
                    <span className="px-1.5 py-0.5 rounded bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 text-[10px] font-medium border border-sky-200/50">
                      Rules
                    </span>
                  )}
                  {item.hasMcp && (
                    <span className="px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 text-[10px] font-medium border border-purple-200/50">
                      MCP Tools
                    </span>
                  )}
                  {item.hasScripts && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 text-[10px] font-medium border border-amber-200/50">
                      Scripts
                    </span>
                  )}
                  {(item.tags || []).slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px]"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>

              {/* Card Footer */}
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
                <span className="text-[11px] text-slate-400 flex items-center gap-1">
                  <Download className="w-3 h-3" />
                  {item.downloadsCount || 0} downloads
                </span>

                <a
                  href={downloadUrl}
                  download
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-sky-50 hover:text-sky-600 dark:bg-slate-800 dark:hover:bg-sky-950/60 dark:hover:text-sky-400 text-slate-700 dark:text-slate-300 text-xs font-semibold rounded-xl transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download Bundle
                </a>
              </div>
            </div>
          );
        })}
      </div>

      {filteredItems.length === 0 && (
        <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
          <Package className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
          <h4 className="font-semibold text-sm text-slate-700 dark:text-slate-300">
            No packages match your search
          </h4>
          <p className="text-xs text-slate-400 mt-1">
            Try adjusting your search query or switching categories.
          </p>
        </div>
      )}

      {/* Upload Package Modal (Admin) */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-base text-slate-900 dark:text-white flex items-center gap-2">
                <Upload className="w-4 h-4 text-sky-500" />
                Publish Antigravity Package
              </h3>
              <button
                onClick={() => setShowUploadModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                  Package Type
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPackageType('plugin')}
                    className={`py-2 px-3 text-xs font-medium rounded-xl border flex items-center justify-center gap-2 transition ${
                      packageType === 'plugin'
                        ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 font-bold'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <Package className="w-3.5 h-3.5" />
                    Plugin (.tar.gz)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPackageType('skill')}
                    className={`py-2 px-3 text-xs font-medium rounded-xl border flex items-center justify-center gap-2 transition ${
                      packageType === 'skill'
                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-bold'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Global Skill
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                  Package Archive (.tar.gz) *
                </label>
                <input
                  type="file"
                  accept=".tar.gz,.tgz,application/gzip,application/x-gzip"
                  required
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-sky-50 file:text-sky-700 hover:file:bg-sky-100 dark:file:bg-slate-800 dark:file:text-slate-200"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                  Semantic Version *
                </label>
                <input
                  type="text"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="1.0.0"
                  required
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono focus:ring-2 focus:ring-sky-500 outline-none dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                  Changelog (Optional)
                </label>
                <textarea
                  value={changelog}
                  onChange={(e) => setChangelog(e.target.value)}
                  placeholder="Summary of changes in this version..."
                  rows={3}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs focus:ring-2 focus:ring-sky-500 outline-none dark:text-white resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="px-3.5 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploadLoading || !file}
                  className="px-4 py-2 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-600 hover:to-indigo-700 text-white text-xs font-semibold rounded-xl shadow-md transition disabled:opacity-50"
                >
                  {uploadLoading ? 'Uploading & Verifying...' : 'Publish Release'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
