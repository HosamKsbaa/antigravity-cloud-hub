import React, { useEffect, useState } from 'react';
import { api, ApiKeyItem, UserProfile } from '../api/client.js';
import {
  Key,
  Plus,
  Trash2,
  Copy,
  Check,
  RefreshCw,
  AlertTriangle,
  X,
  ShieldCheck,
  Code2,
} from 'lucide-react';

interface ApiKeysProps {
  user: UserProfile;
}

export const ApiKeys: React.FC<ApiKeysProps> = () => {
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create Key Modal & Generated Secret State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKeySecret, setCreatedKeySecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchKeys = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getApiKeys();
      setKeys(res.apiKeys);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch API keys.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKeys();
  }, []);

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;

    setActionLoading(true);
    setError(null);

    try {
      const res = await api.createApiKey(newKeyName.trim());
      const secret = res.apiKey?.key || res.apiKey?.secretKey;
      setCreatedKeySecret(secret);
      setNewKeyName('');
      await fetchKeys();
    } catch (err: any) {
      setError(err.message || 'Failed to generate API key.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRevokeKey = async (keyItem: ApiKeyItem) => {
    if (!confirm(`Are you sure you want to revoke API key "${keyItem.name}" (${keyItem.keyPrefix}...)? Any local extensions using this key will immediately lose access.`)) {
      return;
    }

    setActionLoading(true);
    setError(null);

    try {
      await api.deleteApiKey(keyItem.id);
      await fetchKeys();
    } catch (err: any) {
      setError(err.message || 'Failed to revoke API key.');
    } finally {
      setActionLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <Key className="w-5 h-5 text-amber-500" />
            Personal API Access Keys
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Authenticate your local Antigravity IDE extensions (<code className="font-mono text-sky-600 dark:text-sky-400">token-tracker</code> & <code className="font-mono text-sky-600 dark:text-sky-400">hdm-plugin-hub</code>)
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={fetchKeys}
            disabled={loading}
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition"
            title="Refresh List"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-sky-500' : ''}`} />
          </button>

          <button
            onClick={() => {
              setCreatedKeySecret(null);
              setShowCreateModal(true);
            }}
            className="flex items-center gap-2 px-3.5 py-2 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-600 hover:to-indigo-700 text-white text-xs font-semibold rounded-xl shadow-md shadow-sky-500/20 transition"
          >
            <Plus className="w-4 h-4" />
            Generate New Key
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Keys Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-[10px] uppercase font-bold text-slate-400 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-3 px-4">Key Label</th>
                <th className="py-3 px-4">Key Prefix</th>
                <th className="py-3 px-4">Created Date</th>
                <th className="py-3 px-4">Last Used</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {keys.map((k) => (
                <tr key={k.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition">
                  <td className="py-3.5 px-4 font-semibold text-slate-900 dark:text-white">
                    {k.name}
                  </td>
                  <td className="py-3.5 px-4 font-mono text-slate-600 dark:text-slate-300">
                    <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[11px] border border-slate-200 dark:border-slate-700">
                      {k.keyPrefix}...
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-slate-500">
                    {new Date(k.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-3.5 px-4 text-slate-500">
                    {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'Never used'}
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <button
                      onClick={() => handleRevokeKey(k)}
                      disabled={actionLoading}
                      className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg transition"
                      title="Revoke Key"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}

              {keys.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400">
                    No active API keys found. Generate a key to connect your IDE plugins.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Integration Guide Box */}
      <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
        <h3 className="font-semibold text-sm text-slate-900 dark:text-white flex items-center gap-2">
          <Code2 className="w-4 h-4 text-sky-500" />
          IDE Extension Configuration Guide
        </h3>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          Configure your local Antigravity IDE plugins to sync telemetry and download updates:
        </p>

        <div className="bg-slate-950 text-slate-200 p-4 rounded-xl font-mono text-xs overflow-x-auto space-y-2 border border-slate-800">
          <div className="text-slate-500"># ~/.gemini/config/plugins/token-tracker/config.json</div>
          <div>{`{`}</div>
          <div className="pl-4 text-sky-300">{`"hubUrl": "https://agy.34.62.68.230.sslip.io",`}</div>
          <div className="pl-4 text-amber-300">{`"apiKey": "agy_your_secret_key_here"`}</div>
          <div>{`}`}</div>
        </div>
      </div>

      {/* Create Key Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-base text-slate-900 dark:text-white flex items-center gap-2">
                <Key className="w-4 h-4 text-amber-500" />
                {createdKeySecret ? 'API Key Generated' : 'Generate New API Key'}
              </h3>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setCreatedKeySecret(null);
                }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {createdKeySecret ? (
              <div className="space-y-4">
                <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2.5">
                  <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                  <div>
                    <strong>Please copy your API key now.</strong> For security reasons, you will not be able to view this secret again.
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Your Secret Key
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={createdKeySecret}
                      className="w-full px-3 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono select-all dark:text-white"
                    />
                    <button
                      onClick={() => copyToClipboard(createdKeySecret)}
                      className="px-3 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-xs font-medium flex items-center gap-1.5 transition flex-shrink-0"
                    >
                      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                  <button
                    onClick={() => {
                      setShowCreateModal(false);
                      setCreatedKeySecret(null);
                    }}
                    className="px-4 py-2 bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-xs font-semibold rounded-xl transition"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleCreateKey} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                    Key Description / Name *
                  </label>
                  <input
                    type="text"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="e.g. VSCode Token Tracker"
                    required
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs focus:ring-2 focus:ring-sky-500 outline-none dark:text-white"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="px-3.5 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={actionLoading}
                    className="px-4 py-2 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-600 hover:to-indigo-700 text-white text-xs font-semibold rounded-xl shadow-md transition disabled:opacity-50"
                  >
                    {actionLoading ? 'Generating...' : 'Generate Key'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
