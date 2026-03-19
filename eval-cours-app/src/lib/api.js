import { createClient } from '@supabase/supabase-js';

const DEFAULT_TIMEOUT_MS = 5000;

const trimTrailingSlash = (value) => value.replace(/\/+$/, '');

const resolveDefaultApiBase = () => {
  if (typeof window === 'undefined') return 'http://localhost:8787';
  const { protocol, hostname, port } = window.location;
  if (port === '5173') return `${protocol}//${hostname}:8787`;
  return '';
};

const API_BASE = trimTrailingSlash(import.meta.env.VITE_API_URL || resolveDefaultApiBase());
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_KEY);
const supabase = USE_SUPABASE ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

const parseJson = (raw) => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const httpRequest = async (pathname, options = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}${pathname}`, {
      method: options.method || 'GET',
      headers: {
        'content-type': 'application/json',
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const raw = await response.text();
    const payload = parseJson(raw);
    if (!response.ok) {
      const error = new Error(payload?.error || `http_${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('api_timeout');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const ensureSupabase = () => {
  if (!supabase) throw new Error('supabase_not_configured');
  return supabase;
};

const unwrap = ({ data, error }) => {
  if (error) throw error;
  return data;
};

const supabaseApi = {
  mode: 'supabase',
  verifyPin: async (candidatePin) => {
    const client = ensureSupabase();
    const data = unwrap(
      await client.rpc('eval_verify_pin', {
        candidate_pin: candidatePin,
      })
    );
    return data === true;
  },
  getBootstrap: async () => {
    const client = ensureSupabase();
    const data = unwrap(await client.rpc('eval_bootstrap'));
    return data || {
      hasConfig: false,
      hasYears: false,
      config: null,
      years: null,
      responseCounts: {},
    };
  },
  getYearData: async (yearId) => {
    const client = ensureSupabase();
    const data = unwrap(
      await client.rpc('eval_year_payload', {
        target_year_id: yearId,
      })
    );
    return data || { exists: false, ues: [], responses: {} };
  },
  putConfig: async (config, candidatePin) => {
    const client = ensureSupabase();
    unwrap(
      await client.rpc('eval_save_public_state', {
        candidate_pin: candidatePin,
        next_config: config,
        next_years: null,
      })
    );
    return { ok: true };
  },
  putYears: async (years, candidatePin) => {
    const client = ensureSupabase();
    unwrap(
      await client.rpc('eval_save_public_state', {
        candidate_pin: candidatePin,
        next_config: null,
        next_years: years,
      })
    );
    const boot = unwrap(await client.rpc('eval_bootstrap'));
    return { ok: true, responseCounts: boot?.responseCounts || {} };
  },
  putYearSnapshot: async (yearId, payload, candidatePin) => {
    const client = ensureSupabase();
    unwrap(
      await client.rpc('eval_replace_year_payload', {
        candidate_pin: candidatePin,
        target_year_id: yearId,
        next_ues: payload?.ues || [],
        next_responses: payload?.responses || {},
      })
    );
    return { ok: true };
  },
  putYearUes: async (yearId, ues, candidatePin) => {
    const client = ensureSupabase();
    unwrap(
      await client.rpc('eval_save_year_ues', {
        candidate_pin: candidatePin,
        target_year_id: yearId,
        next_ues: ues,
      })
    );
    return { ok: true };
  },
  putYearResponses: async (yearId, responses, candidatePin) => {
    const client = ensureSupabase();
    unwrap(
      await client.rpc('eval_replace_year_payload', {
        candidate_pin: candidatePin,
        target_year_id: yearId,
        next_ues: null,
        next_responses: responses,
      })
    );
    return { ok: true };
  },
  appendResponse: async (yearId, ueId, courseName, response) => {
    const client = ensureSupabase();
    unwrap(
      await client.from('eval_responses').insert({
        year_id: yearId,
        ue_id: ueId,
        course_name: courseName,
        response,
      })
    );
    return { ok: true };
  },
  updatePin: async (currentPin, nextPin) => {
    const client = ensureSupabase();
    const data = unwrap(
      await client.rpc('eval_change_pin', {
        current_pin: currentPin,
        next_pin: nextPin,
      })
    );
    return data === true;
  },
};

const httpApi = {
  mode: 'http',
  verifyPin: async (candidatePin, localPin) => candidatePin === localPin,
  getBootstrap: () => httpRequest('/api/eval/bootstrap'),
  getYearData: (yearId) => httpRequest(`/api/eval/years/${encodeURIComponent(yearId)}`),
  putConfig: (config) => httpRequest('/api/eval/config', { method: 'PUT', body: { config } }),
  putYears: (years) => httpRequest('/api/eval/years', { method: 'PUT', body: { years } }),
  putYearSnapshot: (yearId, payload) =>
    httpRequest(`/api/eval/years/${encodeURIComponent(yearId)}`, {
      method: 'PUT',
      body: payload,
    }),
  putYearUes: (yearId, ues) =>
    httpRequest(`/api/eval/years/${encodeURIComponent(yearId)}/ues`, {
      method: 'PUT',
      body: { ues },
    }),
  putYearResponses: (yearId, responses) =>
    httpRequest(`/api/eval/years/${encodeURIComponent(yearId)}/responses`, {
      method: 'PUT',
      body: { responses },
    }),
  appendResponse: (yearId, ueId, courseName, response) =>
    httpRequest(`/api/eval/years/${encodeURIComponent(yearId)}/responses`, {
      method: 'POST',
      body: { ueId, courseName, response },
    }),
  updatePin: async () => {
    throw new Error('pin_update_not_supported');
  },
};

export const api = USE_SUPABASE ? supabaseApi : httpApi;
