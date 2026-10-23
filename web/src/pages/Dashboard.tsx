import React, { useEffect, useState } from 'react';
import { api, TelemetrySummaryResponse, UserProfile } from '../api/client.js';
import {
  Coins,
  Cpu,
  FolderGit2,
  Layers,
  RefreshCw,
  TrendingUp,
  BrainCircuit,
  Calendar,
  Users as UsersIcon,
  MessageSquare,
} from 'lucide-react';

interface DashboardProps {
  user: UserProfile;
}

export const Dashboard: React.FC<DashboardProps> = ({ user }) => {
  const [data, setData] = useState<TelemetrySummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<string>('all');
  const [scopeAll, setScopeAll] = useState<boolean>(user.role === 'admin');
  const [error, setError] = useState<string | null>(null);

  const fetchTelemetry = async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (period !== 'all') {
        params.period = period;
      }
      if (user.role === 'admin' && scopeAll) {
        params.scope = 'all';
      }
      const res = await api.getTelemetrySummary(params);
      setData(res);
    } catch (err: any) {
      setError(err.message || 'Failed to load telemetry summary.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTelemetry();
  }, [period, scopeAll]);

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat().format(num);
  };

  const formatCost = (cost: number) => {
    return `$${Number(cost || 0).toFixed(4)}`;
  };

  const totals = data?.totals || {
    totalTokens: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    responseTokens: 0,
    costUsd: 0,
    turns: 0,
  };

  return (
    <div className="space-y-6">
      {/* Top Controls Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-sky-500" />
            Telemetry & Token Spend Overview
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Real-time multi-model LLM telemetry aggregated from token-tracker extensions
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Admin Scope Toggle */}
          {user.role === 'admin' && (
            <label className="flex items-center gap-2 cursor-pointer bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={scopeAll}
                onChange={(e) => setScopeAll(e.target.checked)}
                className="rounded border-slate-300 text-sky-600 focus:ring-sky-500 w-3.5 h-3.5"
              />
              <UsersIcon className="w-3.5 h-3.5 text-indigo-500" />
              Team Scope (All Users)
            </label>
          )}

          {/* Period Selector */}
          <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="bg-transparent text-xs font-medium text-slate-700 dark:text-slate-300 focus:outline-none"
            >
              <option value="all">All Time</option>
              <option value="today">Today</option>
              <option value="week">Last 7 Days</option>
              <option value="month">Last 30 Days</option>
            </select>
          </div>

          {/* Refresh Button */}
          <button
            onClick={fetchTelemetry}
            disabled={loading}
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition disabled:opacity-50"
            title="Refresh Metrics"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-sky-500' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Stat Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Tokens */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Tokens</span>
            <div className="p-2 rounded-xl bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {formatNumber(totals.totalTokens)}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <span>Input: {formatNumber(totals.inputTokens)}</span>
            <span>&bull;</span>
            <span>Output: {formatNumber(totals.outputTokens)}</span>
          </div>
        </div>

        {/* Estimated Cost */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Estimated Cost</span>
            <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
              <Coins className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            {formatCost(totals.costUsd)}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {totals.turns} turns processed
          </div>
        </div>

        {/* Active Models */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Active Models</span>
            <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
              <Cpu className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {data?.models?.length || 0}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 truncate">
            {data?.models?.[0]?.modelName || 'No model telemetry'}
          </div>
        </div>

        {/* Workspaces */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Workspaces</span>
            <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400">
              <FolderGit2 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {data?.workspaces?.length || 0}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 truncate">
            {data?.workspaces?.[0]?.workspaceName || 'No active projects'}
          </div>
        </div>
      </div>

      {/* Main Breakdown Section: Model Usage & Workspaces */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Model Breakdown */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-sm text-slate-900 dark:text-white flex items-center gap-2">
              <BrainCircuit className="w-4 h-4 text-sky-500" />
              Model Usage & Cost Distribution
            </h3>
            <span className="text-xs text-slate-400 font-mono">
              {data?.models?.length || 0} models
            </span>
          </div>

          <div className="space-y-4">
            {data?.models && data.models.length > 0 ? (
              data.models.map((model) => (
                <div key={model.modelName} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-800 dark:text-slate-200 truncate max-w-[200px]">
                      {model.modelName}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="text-slate-500 dark:text-slate-400 font-mono">
                        {formatNumber(model.totalTokens)} tok ({model.percentage}%)
                      </span>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400 font-mono">
                        {formatCost(model.costUsd)}
                      </span>
                    </div>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-sky-500 to-indigo-600 h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(2, model.percentage)}%` }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="py-8 text-center text-xs text-slate-400">
                No model telemetry recorded for this timeframe.
              </div>
            )}
          </div>
        </div>

        {/* Top Workspaces Table */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-sm text-slate-900 dark:text-white flex items-center gap-2">
              <FolderGit2 className="w-4 h-4 text-amber-500" />
              Active Project Workspaces
            </h3>
            <span className="text-xs text-slate-400 font-mono">
              {data?.workspaces?.length || 0} projects
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] uppercase font-bold text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <tr>
                  <th className="pb-2">Workspace</th>
                  <th className="pb-2 text-right">Tokens</th>
                  <th className="pb-2 text-right">Cost</th>
                  <th className="pb-2 text-right">Turns</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {data?.workspaces && data.workspaces.length > 0 ? (
                  data.workspaces.map((ws) => (
                    <tr key={ws.workspaceName} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
                      <td className="py-2.5 font-medium text-slate-800 dark:text-slate-200 truncate max-w-[160px]">
                        {ws.workspaceName}
                      </td>
                      <td className="py-2.5 text-right font-mono text-slate-600 dark:text-slate-300">
                        {formatNumber(ws.totalTokens)}
                      </td>
                      <td className="py-2.5 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                        {formatCost(ws.costUsd)}
                      </td>
                      <td className="py-2.5 text-right text-slate-500">
                        {ws.turns}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-slate-400">
                      No project workspace telemetry available.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Recent Sessions & Conversations */}
      <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-sm text-slate-900 dark:text-white flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-sky-500" />
            Recent Agent Sessions & Conversations
          </h3>
          <span className="text-xs text-slate-400">
            Latest 20 recorded sessions
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[10px] uppercase font-bold text-slate-400 border-b border-slate-100 dark:border-slate-800">
              <tr>
                <th className="pb-2">Session Title</th>
                <th className="pb-2">Workspace</th>
                <th className="pb-2">Primary Model</th>
                <th className="pb-2 text-right">Tokens</th>
                <th className="pb-2 text-right">Cost</th>
                <th className="pb-2 text-right">Turns</th>
                <th className="pb-2 text-right">Last Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {data?.recentConversations && data.recentConversations.length > 0 ? (
                data.recentConversations.map((conv) => (
                  <tr key={conv.conversationId} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
                    <td className="py-2.5 font-medium text-slate-800 dark:text-slate-200 truncate max-w-[220px]">
                      {conv.title}
                    </td>
                    <td className="py-2.5 text-slate-500 truncate max-w-[120px]">
                      {conv.workspaceName}
                    </td>
                    <td className="py-2.5 text-slate-600 dark:text-slate-400">
                      <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[11px] font-mono">
                        {conv.primaryModel}
                      </span>
                    </td>
                    <td className="py-2.5 text-right font-mono text-slate-600 dark:text-slate-300">
                      {formatNumber(conv.totalTokens)}
                    </td>
                    <td className="py-2.5 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                      {formatCost(conv.costUsd)}
                    </td>
                    <td className="py-2.5 text-right text-slate-500">
                      {conv.turns}
                    </td>
                    <td className="py-2.5 text-right text-slate-400 text-[11px]">
                      {conv.lastActiveAt ? new Date(conv.lastActiveAt).toLocaleString() : 'N/A'}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    No conversation telemetry sessions recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
