import { pool } from '../db/index.js';
import { User } from '../db/schema.js';

export interface TelemetrySyncPayload {
  clientVersion?: string;
  machineId?: string;
  syncedAt?: string;
  workspaces?: Array<{
    workspaceName?: string;
    workspacePath?: string;
    conversationsCount?: number;
    turnsCount?: number;
    inputTokens?: number;
    cacheReadTokens?: number;
    outputTokens?: number;
    thinkingTokens?: number;
    responseTokens?: number;
    totalTokens?: number;
    costUsd?: number | string;
  }>;
  dailyUsage?: Array<{
    date?: string;
    modelName?: string;
    workspaceName?: string;
    turns?: number;
    inputTokens?: number;
    cacheReadTokens?: number;
    outputTokens?: number;
    thinkingTokens?: number;
    responseTokens?: number;
    totalTokens?: number;
    costUsd?: number | string;
  }>;
  conversations?: Array<{
    conversationId?: string;
    title?: string;
    workspaceName?: string;
    workspacePath?: string;
    isSubagent?: boolean;
    agentName?: string | null;
    parentConversationId?: string | null;
    rootParentId?: string | null;
    primaryModel?: string;
    turns?: number;
    inputTokens?: number;
    cacheReadTokens?: number;
    outputTokens?: number;
    thinkingTokens?: number;
    responseTokens?: number;
    totalTokens?: number;
    costUsd?: number | string;
    firstAt?: string;
    lastActiveAt?: string;
  }>;
  records?: Array<{
    conversationId?: string;
    stepIndex?: number;
    modelCode?: number;
    modelName?: string;
    backendModel?: string;
    model?: string;
    inputTokens?: number;
    promptTokens?: number;
    cacheReadTokens?: number;
    cacheTokens?: number;
    outputTokens?: number;
    candidateTokens?: number;
    thinkingTokens?: number;
    responseTokens?: number;
    totalStepTokens?: number;
    totalTokens?: number;
    latencyMs?: number;
    ttftMs?: number;
    costUsd?: number | string;
    estimatedCostUsd?: number | string;
    tools?: any;
    promptSummary?: string;
    traceId?: string;
    createdAt?: string;
    timestamp?: string;
    workspaceName?: string;
    workspacePath?: string;
  }>;
}

export interface SummaryQueryOptions {
  period?: string;
  startDate?: string;
  endDate?: string;
  workspace?: string;
  model?: string;
  scope?: string;
}

export class TelemetryService {
  /**
   * Sync telemetry records, conversations, dailyUsage, and workspaces.
   */
  async syncTelemetry(userId: string, body: any): Promise<{ syncedCount: number }> {
    if (!body || typeof body !== 'object') {
      return { syncedCount: 0 };
    }

    const client = await pool.connect();
    let syncedCount = 0;

    try {
      await client.query('BEGIN');

      const payload: TelemetrySyncPayload = Array.isArray(body)
        ? { records: body }
        : body;

      const todayStr = new Date().toISOString().split('T')[0];
      const now = new Date();

      // Safe integer clamper for 32-bit postgres columns
      const safeInt32 = (val: any, fallback = 0): number => {
        const num = Number(val);
        if (isNaN(num)) return fallback;
        return Math.min(Math.max(-2147483648, Math.floor(num)), 2147483647);
      };

      // Safe number for bigints / numerics
      const safeNum = (val: any, fallback = 0): number => {
        const num = Number(val);
        return isNaN(num) ? fallback : num;
      };

      // 1. Process conversations
      if (Array.isArray(payload.conversations) && payload.conversations.length > 0) {
        for (const conv of payload.conversations) {
          if (!conv.conversationId) continue;

          const turns = safeInt32(conv.turns, 0);
          const inputTokens = safeNum(conv.inputTokens, 0);
          const cacheReadTokens = safeNum(conv.cacheReadTokens, 0);
          const outputTokens = safeNum(conv.outputTokens, 0);
          const thinkingTokens = safeNum(conv.thinkingTokens, 0);
          const responseTokens = safeNum(conv.responseTokens, 0);
          const totalTokens = safeNum(conv.totalTokens, inputTokens + cacheReadTokens + outputTokens);
          const costUsd = safeNum(conv.costUsd, 0).toFixed(6);
          const firstAt = conv.firstAt ? new Date(conv.firstAt) : now;
          const lastActiveAt = conv.lastActiveAt ? new Date(conv.lastActiveAt) : now;

          await client.query(
            `INSERT INTO telemetry_conversations (
              user_id, conversation_id, title, workspace_name, workspace_path,
              is_subagent, agent_name, parent_conversation_id, root_parent_id,
              primary_model, turns, input_tokens, cache_read_tokens, output_tokens,
              thinking_tokens, response_tokens, total_tokens, cost_usd, first_at, last_active_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
            )
            ON CONFLICT (user_id, conversation_id) DO UPDATE SET
              title = COALESCE(EXCLUDED.title, telemetry_conversations.title),
              workspace_name = COALESCE(EXCLUDED.workspace_name, telemetry_conversations.workspace_name),
              workspace_path = COALESCE(EXCLUDED.workspace_path, telemetry_conversations.workspace_path),
              primary_model = COALESCE(EXCLUDED.primary_model, telemetry_conversations.primary_model),
              turns = EXCLUDED.turns,
              input_tokens = EXCLUDED.input_tokens,
              cache_read_tokens = EXCLUDED.cache_read_tokens,
              output_tokens = EXCLUDED.output_tokens,
              thinking_tokens = EXCLUDED.thinking_tokens,
              response_tokens = EXCLUDED.response_tokens,
              total_tokens = EXCLUDED.total_tokens,
              cost_usd = EXCLUDED.cost_usd,
              last_active_at = COALESCE(EXCLUDED.last_active_at, NOW()),
              updated_at = NOW()`,
            [
              userId,
              conv.conversationId,
              conv.title || null,
              conv.workspaceName || null,
              conv.workspacePath || null,
              Boolean(conv.isSubagent),
              conv.agentName || null,
              conv.parentConversationId || null,
              conv.rootParentId || null,
              conv.primaryModel || null,
              turns,
              inputTokens,
              cacheReadTokens,
              outputTokens,
              thinkingTokens,
              responseTokens,
              totalTokens,
              costUsd,
              firstAt,
              lastActiveAt,
            ]
          );
          syncedCount++;
        }
      }

      // 2. Process records
      if (Array.isArray(payload.records) && payload.records.length > 0) {
        for (let i = 0; i < payload.records.length; i++) {
          const rec = payload.records[i];
          const conversationId = rec.conversationId || 'default-session';
          const stepIndex = safeInt32(rec.stepIndex, i + 1);
          const modelName = rec.modelName || rec.backendModel || rec.model || 'Unknown';
          const backendModel = rec.backendModel || rec.model || rec.modelName || 'Unknown';
          const modelCode = rec.modelCode !== undefined ? safeInt32(rec.modelCode, null as any) : null;
          const inputTokens = safeInt32(rec.inputTokens ?? rec.promptTokens, 0);
          const cacheReadTokens = safeInt32(rec.cacheReadTokens ?? rec.cacheTokens, 0);
          const outputTokens = safeInt32(rec.outputTokens ?? rec.candidateTokens, 0);
          const thinkingTokens = safeInt32(rec.thinkingTokens, 0);
          const responseTokens = safeInt32(rec.responseTokens, Math.max(0, outputTokens - thinkingTokens));
          const totalStepTokens = safeInt32(rec.totalStepTokens ?? rec.totalTokens, inputTokens + cacheReadTokens + outputTokens);
          const latencyMs = safeInt32(rec.latencyMs, 0);
          const ttftMs = safeInt32(rec.ttftMs, 0);
          const costUsd = safeNum(rec.costUsd ?? rec.estimatedCostUsd, 0).toFixed(6);
          const toolsJson = JSON.stringify(rec.tools || []);
          const promptSummary = rec.promptSummary || null;
          const traceId = rec.traceId || null;
          const createdAt = rec.createdAt || rec.timestamp ? new Date(rec.createdAt || rec.timestamp!) : now;

          await client.query(
            `INSERT INTO telemetry_records (
              user_id, conversation_id, step_index, model_code, model_name,
              backend_model, input_tokens, cache_read_tokens, output_tokens,
              thinking_tokens, response_tokens, total_step_tokens, latency_ms,
              ttft_ms, cost_usd, tools, prompt_summary, trace_id, created_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
            )
            ON CONFLICT (user_id, conversation_id, step_index) DO UPDATE SET
              model_name = EXCLUDED.model_name,
              backend_model = EXCLUDED.backend_model,
              input_tokens = EXCLUDED.input_tokens,
              cache_read_tokens = EXCLUDED.cache_read_tokens,
              output_tokens = EXCLUDED.output_tokens,
              thinking_tokens = EXCLUDED.thinking_tokens,
              response_tokens = EXCLUDED.response_tokens,
              total_step_tokens = EXCLUDED.total_step_tokens,
              latency_ms = EXCLUDED.latency_ms,
              ttft_ms = EXCLUDED.ttft_ms,
              cost_usd = EXCLUDED.cost_usd,
              tools = EXCLUDED.tools,
              prompt_summary = EXCLUDED.prompt_summary`,
            [
              userId,
              conversationId,
              stepIndex,
              modelCode,
              modelName,
              backendModel,
              inputTokens,
              cacheReadTokens,
              outputTokens,
              thinkingTokens,
              responseTokens,
              totalStepTokens,
              latencyMs,
              ttftMs,
              costUsd,
              toolsJson,
              promptSummary,
              traceId,
              createdAt,
            ]
          );

          // If records arrive with workspace information and no dailyUsage, update daily summary
          if (rec.workspaceName || rec.workspacePath) {
            const wsName = rec.workspaceName || (rec.workspacePath ? rec.workspacePath.split('/').pop() : '') || 'default';
            const recDate = (rec.createdAt || rec.timestamp ? new Date(rec.createdAt || rec.timestamp!) : now).toISOString().split('T')[0];
            await client.query(
              `INSERT INTO telemetry_daily_summary (
                user_id, date, model_name, workspace_name, turns,
                input_tokens, cache_read_tokens, output_tokens, thinking_tokens,
                response_tokens, total_tokens, cost_usd
              ) VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8, $9, $10, $11)
              ON CONFLICT (user_id, date, model_name, workspace_name) DO UPDATE SET
                turns = telemetry_daily_summary.turns + 1,
                input_tokens = telemetry_daily_summary.input_tokens + EXCLUDED.input_tokens,
                cache_read_tokens = telemetry_daily_summary.cache_read_tokens + EXCLUDED.cache_read_tokens,
                output_tokens = telemetry_daily_summary.output_tokens + EXCLUDED.output_tokens,
                thinking_tokens = telemetry_daily_summary.thinking_tokens + EXCLUDED.thinking_tokens,
                response_tokens = telemetry_daily_summary.response_tokens + EXCLUDED.response_tokens,
                total_tokens = telemetry_daily_summary.total_tokens + EXCLUDED.total_tokens,
                cost_usd = telemetry_daily_summary.cost_usd + EXCLUDED.cost_usd,
                updated_at = NOW()`,
              [
                userId,
                recDate,
                modelName,
                wsName,
                inputTokens,
                cacheReadTokens,
                outputTokens,
                thinkingTokens,
                responseTokens,
                totalStepTokens,
                costUsd,
              ]
            );
          }

          syncedCount++;
        }
      }

      // 3. Process daily usage entries
      if (Array.isArray(payload.dailyUsage) && payload.dailyUsage.length > 0) {
        for (const usage of payload.dailyUsage) {
          const date = usage.date || todayStr;
          const modelName = usage.modelName || 'Gemini 4 Argon (High)';
          const workspaceName = usage.workspaceName || '';
          const turns = safeInt32(usage.turns, 1);
          const inputTokens = safeNum(usage.inputTokens, 0);
          const cacheReadTokens = safeNum(usage.cacheReadTokens, 0);
          const outputTokens = safeNum(usage.outputTokens, 0);
          const thinkingTokens = safeNum(usage.thinkingTokens, 0);
          const responseTokens = safeNum(usage.responseTokens, 0);
          const totalTokens = safeNum(usage.totalTokens, inputTokens + cacheReadTokens + outputTokens);
          const costUsd = safeNum(usage.costUsd, 0).toFixed(6);

          await client.query(
            `INSERT INTO telemetry_daily_summary (
              user_id, date, model_name, workspace_name, turns,
              input_tokens, cache_read_tokens, output_tokens, thinking_tokens,
              response_tokens, total_tokens, cost_usd
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
            )
            ON CONFLICT (user_id, date, model_name, workspace_name) DO UPDATE SET
              turns = EXCLUDED.turns,
              input_tokens = EXCLUDED.input_tokens,
              cache_read_tokens = EXCLUDED.cache_read_tokens,
              output_tokens = EXCLUDED.output_tokens,
              thinking_tokens = EXCLUDED.thinking_tokens,
              response_tokens = EXCLUDED.response_tokens,
              total_tokens = EXCLUDED.total_tokens,
              cost_usd = EXCLUDED.cost_usd,
              updated_at = NOW()`,
            [
              userId,
              date,
              modelName,
              workspaceName,
              turns,
              inputTokens,
              cacheReadTokens,
              outputTokens,
              thinkingTokens,
              responseTokens,
              totalTokens,
              costUsd,
            ]
          );
          syncedCount++;
        }
      }

      // 4. Process workspace summaries if present
      if (Array.isArray(payload.workspaces) && payload.workspaces.length > 0) {
        for (const ws of payload.workspaces) {
          const workspaceName = ws.workspaceName || (ws.workspacePath ? ws.workspacePath.split('/').pop() : '') || 'workspace';
          const turns = safeInt32(ws.turnsCount, 1);
          const inputTokens = safeNum(ws.inputTokens, 0);
          const cacheReadTokens = safeNum(ws.cacheReadTokens, 0);
          const outputTokens = safeNum(ws.outputTokens, 0);
          const thinkingTokens = safeNum(ws.thinkingTokens, 0);
          const responseTokens = safeNum(ws.responseTokens, 0);
          const totalTokens = safeNum(ws.totalTokens, inputTokens + cacheReadTokens + outputTokens);
          const costUsd = safeNum(ws.costUsd, 0).toFixed(6);

          // Insert or update daily summary entry for this workspace
          await client.query(
            `INSERT INTO telemetry_daily_summary (
              user_id, date, model_name, workspace_name, turns,
              input_tokens, cache_read_tokens, output_tokens, thinking_tokens,
              response_tokens, total_tokens, cost_usd
            ) VALUES (
              $1, $2, 'Gemini 4 Argon (High)', $3, $4, $5, $6, $7, $8, $9, $10, $11
            )
            ON CONFLICT (user_id, date, model_name, workspace_name) DO UPDATE SET
              turns = GREATEST(telemetry_daily_summary.turns, EXCLUDED.turns),
              input_tokens = GREATEST(telemetry_daily_summary.input_tokens, EXCLUDED.input_tokens),
              cache_read_tokens = GREATEST(telemetry_daily_summary.cache_read_tokens, EXCLUDED.cache_read_tokens),
              output_tokens = GREATEST(telemetry_daily_summary.output_tokens, EXCLUDED.output_tokens),
              thinking_tokens = GREATEST(telemetry_daily_summary.thinking_tokens, EXCLUDED.thinking_tokens),
              response_tokens = GREATEST(telemetry_daily_summary.response_tokens, EXCLUDED.response_tokens),
              total_tokens = GREATEST(telemetry_daily_summary.total_tokens, EXCLUDED.total_tokens),
              cost_usd = GREATEST(telemetry_daily_summary.cost_usd, EXCLUDED.cost_usd),
              updated_at = NOW()`,
            [
              userId,
              todayStr,
              workspaceName,
              turns,
              inputTokens,
              cacheReadTokens,
              outputTokens,
              thinkingTokens,
              responseTokens,
              totalTokens,
              costUsd,
            ]
          );
          syncedCount++;
        }
      }

      await client.query('COMMIT');
      return { syncedCount };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Telemetry sync transaction error:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Aggregate telemetry summary metrics with model, workspace, and daily breakdown.
   */
  async getSummary(user: User, options: SummaryQueryOptions = {}) {
    const isAdmin = user.role === 'admin';
    const isGlobalScope = isAdmin && options.scope === 'all';

    const whereClauses: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    // Scope condition: regular users are ALWAYS restricted to their own userId
    if (!isGlobalScope) {
      whereClauses.push(`user_id = $${paramIndex++}`);
      params.push(user.id);
    }

    // Period / Date filters
    const period = options.period?.toLowerCase();
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    if (period === 'today') {
      whereClauses.push(`date = $${paramIndex++}`);
      params.push(todayStr);
    } else if (period === 'week' || period === '7d') {
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
      whereClauses.push(`date >= $${paramIndex++}`);
      params.push(weekAgo);
    } else if (period === 'month' || period === '30d') {
      const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      whereClauses.push(`date >= $${paramIndex++}`);
      params.push(monthAgo);
    }

    if (options.startDate) {
      whereClauses.push(`date >= $${paramIndex++}`);
      params.push(options.startDate);
    }
    if (options.endDate) {
      whereClauses.push(`date <= $${paramIndex++}`);
      params.push(options.endDate);
    }

    if (options.workspace) {
      whereClauses.push(`workspace_name = $${paramIndex++}`);
      params.push(options.workspace);
    }

    if (options.model) {
      whereClauses.push(`model_name = $${paramIndex++}`);
      params.push(options.model);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const client = await pool.connect();
    try {
      // 1. Overall totals
      const totalsResult = await client.query(
        `SELECT
          COALESCE(SUM(turns), 0)::BIGINT as total_turns,
          COALESCE(SUM(input_tokens), 0)::BIGINT as input_tokens,
          COALESCE(SUM(cache_read_tokens), 0)::BIGINT as cache_read_tokens,
          COALESCE(SUM(output_tokens), 0)::BIGINT as output_tokens,
          COALESCE(SUM(thinking_tokens), 0)::BIGINT as thinking_tokens,
          COALESCE(SUM(response_tokens), 0)::BIGINT as response_tokens,
          COALESCE(SUM(total_tokens), 0)::BIGINT as total_tokens,
          COALESCE(SUM(cost_usd), 0)::NUMERIC(12, 6) as cost_usd
        FROM telemetry_daily_summary
        ${whereSql}`,
        params
      );

      const totalsRow = totalsResult.rows[0] || {};
      const totalTokens = Number(totalsRow.total_tokens || 0);
      const inputTokens = Number(totalsRow.input_tokens || 0);
      const cacheReadTokens = Number(totalsRow.cache_read_tokens || 0);
      const outputTokens = Number(totalsRow.output_tokens || 0);
      const thinkingTokens = Number(totalsRow.thinking_tokens || 0);
      const responseTokens = Number(totalsRow.response_tokens || 0);
      const totalTurns = Number(totalsRow.total_turns || 0);
      const costUsd = Number(Number(totalsRow.cost_usd || 0).toFixed(6));

      // 2. Breakdown by Model
      const modelsResult = await client.query(
        `SELECT
          model_name,
          COALESCE(SUM(total_tokens), 0)::BIGINT as total_tokens,
          COALESCE(SUM(input_tokens), 0)::BIGINT as input_tokens,
          COALESCE(SUM(output_tokens), 0)::BIGINT as output_tokens,
          COALESCE(SUM(thinking_tokens), 0)::BIGINT as thinking_tokens,
          COALESCE(SUM(response_tokens), 0)::BIGINT as response_tokens,
          COALESCE(SUM(cost_usd), 0)::NUMERIC(12, 6) as cost_usd,
          COALESCE(SUM(turns), 0)::INTEGER as turns
        FROM telemetry_daily_summary
        ${whereSql}
        GROUP BY model_name
        ORDER BY total_tokens DESC`,
        params
      );

      const models = modelsResult.rows.map((row) => {
        const rowTokens = Number(row.total_tokens || 0);
        const percentage = totalTokens > 0 ? Number(((rowTokens / totalTokens) * 100).toFixed(1)) : 0;
        return {
          modelName: row.model_name,
          totalTokens: rowTokens,
          inputTokens: Number(row.input_tokens || 0),
          outputTokens: Number(row.output_tokens || 0),
          thinkingTokens: Number(row.thinking_tokens || 0),
          responseTokens: Number(row.response_tokens || 0),
          costUsd: Number(Number(row.cost_usd || 0).toFixed(6)),
          turns: Number(row.turns || 0),
          percentage,
        };
      });

      // 3. Breakdown by Workspace
      const workspacesResult = await client.query(
        `SELECT
          workspace_name,
          COALESCE(SUM(total_tokens), 0)::BIGINT as total_tokens,
          COALESCE(SUM(input_tokens), 0)::BIGINT as input_tokens,
          COALESCE(SUM(output_tokens), 0)::BIGINT as output_tokens,
          COALESCE(SUM(cost_usd), 0)::NUMERIC(12, 6) as cost_usd,
          COALESCE(SUM(turns), 0)::INTEGER as turns
        FROM telemetry_daily_summary
        ${whereSql}
        GROUP BY workspace_name
        ORDER BY total_tokens DESC`,
        params
      );

      const workspaces = workspacesResult.rows
        .filter((row) => row.workspace_name && row.workspace_name.trim() !== '')
        .map((row) => {
          const rowTokens = Number(row.total_tokens || 0);
          const percentage = totalTokens > 0 ? Number(((rowTokens / totalTokens) * 100).toFixed(1)) : 0;
          return {
            workspaceName: row.workspace_name,
            totalTokens: rowTokens,
            inputTokens: Number(row.input_tokens || 0),
            outputTokens: Number(row.output_tokens || 0),
            costUsd: Number(Number(row.cost_usd || 0).toFixed(6)),
            turns: Number(row.turns || 0),
            percentage,
          };
        });

      // 4. Daily time series
      const dailyResult = await client.query(
        `SELECT
          TO_CHAR(date, 'YYYY-MM-DD') as date,
          COALESCE(SUM(total_tokens), 0)::BIGINT as total_tokens,
          COALESCE(SUM(cost_usd), 0)::NUMERIC(12, 6) as cost_usd,
          COALESCE(SUM(turns), 0)::INTEGER as turns
        FROM telemetry_daily_summary
        ${whereSql}
        GROUP BY date
        ORDER BY date ASC`,
        params
      );

      const daily = dailyResult.rows.map((row) => ({
        date: row.date,
        totalTokens: Number(row.total_tokens || 0),
        costUsd: Number(Number(row.cost_usd || 0).toFixed(6)),
        turns: Number(row.turns || 0),
      }));

      // 5. Recent conversations
      const convWhere = !isGlobalScope ? `WHERE user_id = $1` : '';
      const convParams = !isGlobalScope ? [user.id] : [];
      const convResult = await client.query(
        `SELECT
          conversation_id, title, workspace_name, primary_model,
          turns, total_tokens, cost_usd, last_active_at, created_at
        FROM telemetry_conversations
        ${convWhere}
        ORDER BY last_active_at DESC
        LIMIT 20`,
        convParams
      );

      const recentConversations = convResult.rows.map((row) => ({
        conversationId: row.conversation_id,
        title: row.title || 'Conversation',
        workspaceName: row.workspace_name || 'N/A',
        primaryModel: row.primary_model || 'Gemini',
        turns: Number(row.turns || 0),
        totalTokens: Number(row.total_tokens || 0),
        costUsd: Number(Number(row.cost_usd || 0).toFixed(6)),
        lastActiveAt: row.last_active_at,
        createdAt: row.created_at,
      }));

      const totalsPayload = {
        totalTokens,
        inputTokens,
        cacheReadTokens,
        outputTokens,
        thinkingTokens,
        responseTokens,
        costUsd,
        turns: totalTurns,
      };

      return {
        ok: true,
        success: true,
        totalTokens,
        estimatedCostUsd: costUsd,
        totals: totalsPayload,
        models,
        modelsBreakdown: models,
        workspaces,
        topWorkspaces: workspaces,
        daily,
        recentConversations,
      };
    } finally {
      client.release();
    }
  }
}

export const telemetryService = new TelemetryService();
